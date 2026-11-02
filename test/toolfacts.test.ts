import { describe, it, expect } from 'vitest'
import { bashVerbs, fileExt, shortTarget, toolFact } from '../src/ingest/toolfacts.js'

describe('shell command verbs', () => {
  it('strips the cd wrapper: "cd x && pnpm build" is a BUILD', () => {
    expect(bashVerbs('cd ~/Projects/x && pnpm build')).toEqual(['pnpm'])
  })

  it('takes every chained segment, in order, without duplicates', () => {
    expect(bashVerbs('git add -A && git commit -m x && pnpm test')).toEqual(['git', 'pnpm'])
    expect(bashVerbs('grep foo a | sort | uniq -c')).toEqual(['grep', 'sort', 'uniq'])
  })

  it('drops leading environment assignments', () => {
    expect(bashVerbs('SHOT_DIR=/tmp/x node shot.mjs')).toEqual(['node'])
    expect(bashVerbs('A=1 B=2 pytest')).toEqual(['pytest'])
  })

  it('takes the command name out of a path instead of keeping the whole path', () => {
    expect(bashVerbs('./node_modules/.bin/vitest run')).toEqual(['vitest'])
    expect(bashVerbs('/usr/bin/env python3 x.py')).toEqual(['python3'])
  })

  it('never accepts a fragment as a verb', () => {
    // an earlier naive version counted "scratchpad;", which is the tail of a path
    for (const bad of ['(subshell)', '> out.txt', '$VAR', '| grep x', '&& ls', '"quoted']) {
      expect(bashVerbs(bad), bad).not.toContain(bad)
    }
    expect(bashVerbs('cd /tmp/scratchpad; ls')).toEqual(['ls'])
  })

  it('a command made only of wrappers returns EMPTY instead of inventing a verb', () => {
    expect(bashVerbs('cd ~/x')).toEqual([])
    expect(bashVerbs('export FOO=bar')).toEqual([])
    expect(bashVerbs('')).toEqual([])
  })

  it('never returns more than the limit', () => {
    expect(bashVerbs('a;b;c;d;e;f;g;h', 3)).toHaveLength(3)
  })
})

describe('file extensions and shortened paths', () => {
  it('a valid extension, lower case', () => {
    expect(fileExt('/a/b/App.TSX')).toBe('tsx')
    expect(fileExt('x.test.ts')).toBe('ts')
  })

  it('no extension, or an implausible one, gives null', () => {
    expect(fileExt('/a/b/Makefile')).toBeNull()
    expect(fileExt('/a/.gitignore')).toBeNull()      // a leading dot is not an extension
    expect(fileExt('/a/b.')).toBeNull()
    expect(fileExt('/a/b.averyveryverylongext')).toBeNull()
  })

  it('a path keeps only its last THREE segments, never a whole machine directory tree', () => {
    expect(shortTarget('/Users/ai/Projects/Personal/repo/src/engine/credits.ts'))
      .toBe('src/engine/credits.ts')
    expect(shortTarget('a.ts')).toBe('a.ts')
    expect(shortTarget('')).toBeNull()
  })
})

describe('classifying a tool call', () => {
  it('Bash becomes exec, keeps the verb, and keeps NO command string', () => {
    const f = toolFact('Bash', { command: 'cd /x && git push origin main' })
    expect(f.kind).toBe('exec')
    expect(f.verb).toBe('git')
    expect(JSON.stringify(f)).not.toContain('origin')
    expect(JSON.stringify(f)).not.toContain('push')
  })

  it('MCP keeps the SERVER NAME, which is what says where the dependency is', () => {
    expect(toolFact('mcp__stitch__generate_screen_from_text', {}))
      .toMatchObject({ kind: 'mcp', verb: 'stitch' })
  })

  it('Read and Write keep a shortened path and an extension, with no content', () => {
    const r = toolFact('Read', { file_path: '/Users/x/p/repo/src/a/b.ts' })
    expect(r).toMatchObject({ kind: 'read', target: 'src/a/b.ts', ext: 'ts' })
    expect(toolFact('Edit', { file_path: '/x/y.css' }).kind).toBe('write')
  })

  it('Skill and Agent keep the name that was invoked', () => {
    expect(toolFact('Skill', { skill: 'hallmark' }).verb).toBe('hallmark')
    expect(toolFact('Agent', { subagent_type: 'Explore' }).verb).toBe('Explore')
  })

  it('an unknown tool becomes other and does not throw', () => {
    expect(toolFact('SomethingNew', undefined)).toMatchObject({ kind: 'other', verb: null })
  })

  it('no field carries long content', () => {
    const f = toolFact('Write', { file_path: '/a/b.ts', content: 'SECRET'.repeat(50) })
    expect(JSON.stringify(f)).not.toContain('SECRET')
  })
})

describe('a heredoc body is not a command', () => {
  it('drops the whole block between <<TAG and TAG', async () => {
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

  it('an unquoted heredoc, and one with a dash, are stripped too', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('cat <<-EOF\nconst a = 1\nEOF\nls')).toEqual(['cat', 'ls'])
    expect(bashVerbs('cat <<EOF\nimport os\nEOF')).toEqual(['cat'])
  })

  it('an unterminated heredoc swallows to the end and leaks no keyword', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs("node <<'X'\nimport a\nconst b\n")).toEqual(['node'])
  })
})

describe('shell syntax is not a command', () => {
  it('the loop keyword is dropped, but the command INSIDE the loop is not', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('for i in 1 2 3; do pnpm test; done')).toEqual(['pnpm'])
    // `read` is part of the while CONDITION, not the work being done, so the segment goes.
    expect(bashVerbs('while read l; do grep x; done')).toEqual(['grep'])
    expect(bashVerbs('if [ -f x ]; then node a.js; fi')).toEqual(['node'])
  })
})

describe('a quoted string is not a command', () => {
  it('a program inside -c "..." is not counted as a command', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('python3 -c "import json; print(1)"')).toEqual(['python3'])
    expect(bashVerbs(`node -e 'const a = 1; for (;;) break'`)).toEqual(['node'])
  })

  it('an escaped quote does not throw the stripper off', async () => {
    const { bashVerbs } = await import('../src/ingest/toolfacts.js')
    expect(bashVerbs('echo "a\\"b" && ls')).toEqual(['echo', 'ls'])
  })
})

describe('parseLine must CARRY the facts out', () => {
  it('a line with tool_use yields facts; losing them leaves a silently empty table', async () => {
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
    expect(r.facts, 'parseLine swallowed the facts').toBeDefined()
    expect(r.facts!.map((f) => f.kind).sort()).toEqual(['exec', 'read'])
    expect(r.facts!.find((f) => f.kind === 'exec')!.verb).toBe('pnpm')
    expect(r.facts!.find((f) => f.kind === 'read')!.ext).toBe('ts')
    // and under no circumstances does it carry the command string out
    expect(JSON.stringify(r.facts)).not.toContain('build')
  })
})
