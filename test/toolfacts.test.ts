import { describe, it, expect } from 'vitest'
import { bashVerbs, fileExt, shortTarget, toolFact } from '../src/ingest/toolfacts.js'

describe('động từ lệnh shell', () => {
  it('bỏ lớp vỏ cd — "cd x && pnpm build" là lệnh BUILD', () => {
    expect(bashVerbs('cd ~/Projects/x && pnpm build')).toEqual(['pnpm'])
  })

  it('lấy đủ các đoạn nối nhau, giữ thứ tự, không trùng', () => {
    expect(bashVerbs('git add -A && git commit -m x && pnpm test')).toEqual(['git', 'pnpm'])
    expect(bashVerbs('grep foo a | sort | uniq -c')).toEqual(['grep', 'sort', 'uniq'])
  })

  it('bỏ tiền tố biến môi trường', () => {
    expect(bashVerbs('SHOT_DIR=/tmp/x node shot.mjs')).toEqual(['node'])
    expect(bashVerbs('A=1 B=2 pytest')).toEqual(['pytest'])
  })

  it('lấy tên lệnh từ đường dẫn, không giữ cả đường dẫn', () => {
    expect(bashVerbs('./node_modules/.bin/vitest run')).toEqual(['vitest'])
    expect(bashVerbs('/usr/bin/env python3 x.py')).toEqual(['python3'])
  })

  it('KHÔNG nhận mảnh vỡ làm động từ', () => {
    // bản thô trước đây đếm được "scratchpad;" — đó là đuôi một đường dẫn
    for (const bad of ['(subshell)', '> out.txt', '$VAR', '| grep x', '&& ls', '"quoted']) {
      expect(bashVerbs(bad), bad).not.toContain(bad)
    }
    expect(bashVerbs('cd /tmp/scratchpad; ls')).toEqual(['ls'])
  })

  it('lệnh toàn vỏ ⇒ RỖNG, không bịa ra một động từ', () => {
    expect(bashVerbs('cd ~/x')).toEqual([])
    expect(bashVerbs('export FOO=bar')).toEqual([])
    expect(bashVerbs('')).toEqual([])
  })

  it('không trả quá giới hạn', () => {
    expect(bashVerbs('a;b;c;d;e;f;g;h', 3)).toHaveLength(3)
  })
})

describe('đuôi file và đường dẫn rút gọn', () => {
  it('đuôi hợp lệ, chữ thường', () => {
    expect(fileExt('/a/b/App.TSX')).toBe('tsx')
    expect(fileExt('x.test.ts')).toBe('ts')
  })

  it('không có đuôi, hoặc đuôi vô lý ⇒ null', () => {
    expect(fileExt('/a/b/Makefile')).toBeNull()
    expect(fileExt('/a/.gitignore')).toBeNull()      // dấu chấm mở đầu không phải đuôi
    expect(fileExt('/a/b.')).toBeNull()
    expect(fileExt('/a/b.averyveryverylongext')).toBeNull()
  })

  it('đường dẫn chỉ giữ BA đoạn cuối — không mang cả cây thư mục của máy', () => {
    expect(shortTarget('/Users/ai/Projects/Personal/repo/src/engine/credits.ts'))
      .toBe('src/engine/credits.ts')
    expect(shortTarget('a.ts')).toBe('a.ts')
    expect(shortTarget('')).toBeNull()
  })
})

describe('xếp loại tool call', () => {
  it('Bash ⇒ exec, giữ động từ, KHÔNG giữ chuỗi lệnh', () => {
    const f = toolFact('Bash', { command: 'cd /x && git push origin main' })
    expect(f.kind).toBe('exec')
    expect(f.verb).toBe('git')
    expect(JSON.stringify(f)).not.toContain('origin')
    expect(JSON.stringify(f)).not.toContain('push')
  })

  it('MCP ⇒ giữ TÊN SERVER, đó là thứ nói anh đang dựa vào cái gì', () => {
    expect(toolFact('mcp__stitch__generate_screen_from_text', {}))
      .toMatchObject({ kind: 'mcp', verb: 'stitch' })
  })

  it('Read/Write ⇒ đường dẫn rút gọn + đuôi, không có nội dung', () => {
    const r = toolFact('Read', { file_path: '/Users/x/p/repo/src/a/b.ts' })
    expect(r).toMatchObject({ kind: 'read', target: 'src/a/b.ts', ext: 'ts' })
    expect(toolFact('Edit', { file_path: '/x/y.css' }).kind).toBe('write')
  })

  it('Skill/Agent ⇒ giữ tên được gọi', () => {
    expect(toolFact('Skill', { skill: 'hallmark' }).verb).toBe('hallmark')
    expect(toolFact('Agent', { subagent_type: 'Explore' }).verb).toBe('Explore')
  })

  it('tool lạ ⇒ other, không ném', () => {
    expect(toolFact('SomethingNew', undefined)).toMatchObject({ kind: 'other', verb: null })
  })

  it('KHÔNG có trường nào mang nội dung dài', () => {
    const f = toolFact('Write', { file_path: '/a/b.ts', content: 'BÍ MẬT'.repeat(50) })
    expect(JSON.stringify(f)).not.toContain('BÍ MẬT')
  })
})

describe('ruột heredoc không phải lệnh', () => {
  it('bỏ cả khối giữa <<TAG và TAG', async () => {
    const { bashVerbs, stripHeredocs } = await import('../src/ingest/toolfacts.js')
    const cmd = [
      "python3 - <<'PYEOF'",
      'import json',
      'for x in y:',
      '    const = 1',
      'PYEOF',
      'pnpm build',
    ].join('\n')
    expect(bashVerbs(cmd)).toEqual(['python3', 'pnpm'])
    expect(stripHeredocs(cmd)).not.toContain('import json')
  })

  it('heredoc không trích dẫn và có dấu - cũng gỡ được', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('cat <<-EOF\nconst a = 1\nEOF\nls')).toEqual(['cat', 'ls'])
    expect(bashVerbs('cat <<EOF\nimport os\nEOF')).toEqual(['cat'])
  })

  it('heredoc không đóng ⇒ nuốt tới hết, KHÔNG rò từ khoá ra ngoài', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs("node <<'X'\nimport a\nconst b\n")).toEqual(['node'])
  })
})

describe('cấu trúc shell không phải lệnh', () => {
  it('vòng lặp bị bỏ, nhưng lệnh BÊN TRONG vòng lặp thì không', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('for i in 1 2 3; do pnpm test; done')).toEqual(['pnpm'])
    // `read` nằm trong ĐIỀU KIỆN của while, không phải việc đang làm — bỏ cả đoạn.
    expect(bashVerbs('while read l; do grep x; done')).toEqual(['grep'])
    expect(bashVerbs('if [ -f x ]; then node a.js; fi')).toEqual(['node'])
  })
})

describe('chuỗi trích dẫn không phải lệnh', () => {
  it('chương trình trong -c "..." không bị đếm như lệnh', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('python3 -c "import json; print(1)"')).toEqual(['python3'])
    expect(bashVerbs(`node -e 'const a = 1; for (;;) break'`)).toEqual(['node'])
  })

  it('dấu nháy thoát không làm lệch bộ gỡ', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('echo "a\\"b" && ls')).toEqual(['echo', 'ls'])
  })
})

describe('parseLine phải MANG facts ra ngoài', () => {
  it('dòng có tool_use ⇒ có facts; thiếu là bảng rỗng trong im lặng', async () => {
    const { parseLine } = await import('../src/ingest/parse.js')
    const line = JSON.stringify({
      type: 'assistant', requestId: 'r1', uuid: 'u1', timestamp: '2026-10-29T10:00:00Z',
      sessionId: 's1', cwd: '/x', version: '2.1',
      message: {
        model: 'claude-opus-5-5', role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', name: 'Bash', input: { command: 'cd /x && pnpm build' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/a/b/c.ts' } },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    const r = parseLine(line)
    expect(r.event).toBeTruthy()
    expect(r.facts, 'parseLine nuốt mất facts').toBeDefined()
    expect(r.facts!.map((f) => f.kind).sort()).toEqual(['exec', 'read'])
    expect(r.facts!.find((f) => f.kind === 'exec')!.verb).toBe('pnpm')
    expect(r.facts!.find((f) => f.kind === 'read')!.ext).toBe('ts')
    // và tuyệt đối không mang chuỗi lệnh ra ngoài
    expect(JSON.stringify(r.facts)).not.toContain('build')
  })
})
