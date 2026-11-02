import { describe, it, expect } from 'vitest'
import { analyseBehaviour, VERB_GROUPS, type ToolFactRow } from '../src/engine/behaviour.js'

const row = (o: Partial<ToolFactRow>): ToolFactRow => ({
  session_id: 's1', project_key: '/p', day: '2026-10-29',
  tool: 'Bash', kind: 'exec', verb: null, target: null, ext: null, is_sidechain: 0,
  entrypoint: 'cli', n: 1, ...o,
})

describe('đọc hành vi từ sự thật tool call', () => {
  const rows = [
    row({ kind: 'exec', verb: 'grep', n: 60 }),
    row({ kind: 'exec', verb: 'head', n: 20 }),
    row({ kind: 'exec', verb: 'pnpm', n: 20 }),
    row({ kind: 'read', target: 'src/a.ts', ext: 'ts', n: 4 }),
    row({ kind: 'read', target: 'src/b.ts', ext: 'ts', n: 1 }),
    row({ kind: 'write', target: 'src/a.ts', ext: 'ts', n: 5 }),
    row({ kind: 'mcp', verb: 'plugin_x_figma', n: 10 }),
    row({ kind: 'mcp', verb: 'openclaw', n: 5 }),
    row({ kind: 'agent', verb: 'Explore', n: 3, is_sidechain: 1 }),
  ]
  const b = analyseBehaviour(rows)

  it('phần trăm lệnh chỉ để NHÌN tính trên tổng lệnh shell, không trên tổng tool', () => {
    // 80 probe / 100 exec = 80%, KHÔNG phải 80/128
    expect(b.probe_pct).toBe(80)
  })

  it('đọc lại = mọi lần SAU lần đầu của cùng file trong cùng phiên', () => {
    expect(b.reread).toBe(3)                 // a.ts đọc 4 lần ⇒ 3 lần thừa
    expect(b.reread_pct).toBe(60)            // 3 / 5 lượt đọc
    expect(b.reread_top[0]).toEqual({ target: 'src/a.ts', n: 4 })
  })

  it('tỉ lệ đọc trên ghi', () => {
    expect(b.read_per_write).toBe(1)         // 5 đọc / 5 ghi
  })

  it('KHÔNG có lượt ghi ⇒ null, không phải 0 — "không có" khác "bằng không"', () => {
    const r = analyseBehaviour([row({ kind: 'read', target: 'x', n: 3 })])
    expect(r.read_per_write).toBeNull()
  })

  it('tách được phần KHÔNG do tay anh gõ: subagent và máy tự chạy', () => {
    expect(b.sidechain).toBe(3)
    expect(b.plugin_mcp).toBe(10)
    // KHÔNG cộng plugin_mcp vào: 10 lượt đó nằm trong phiên anh gõ, cộng nữa là
    // đếm hai lần cùng một lượt gọi.
    expect(b.not_hand_driven).toBe(3)
    expect(b.not_hand_driven_pct).toBe(2.3)    // 3 / 128
  })

  it('làn "job" bắt được cả `claude -p` LẪN agent chạy trong worktree riêng', () => {
    const r = analyseBehaviour([
      row({ kind: 'exec', verb: 'grep', n: 10 }),                                    // tay gõ
      row({ session_id: 's2', kind: 'exec', verb: 'ls', entrypoint: 'sdk-cli', n: 5 }),
      // Vào bằng `cli`, KHÔNG sidechain, nhưng thư mục là worktree agent của xưởng:
      // chỉ nhìn entrypoint thì lượt này bị xếp nhầm sang cột của người.
      row({ session_id: 's3', kind: 'exec', verb: 'cat',
        project_key: '/Users/x/Projects/ai-mv-factory/.claude/worktrees/agent-a05288f6', n: 20 }),
      row({ session_id: 's4', kind: 'exec', verb: 'cat', project_key: '/Users/x/.openclaw/workspace', n: 5 }),
    ])
    const by = Object.fromEntries(r.lanes.map((l) => [l.lane, l]))
    expect(by['job']!.calls).toBe(30)
    expect(by['hand']!.calls).toBe(10)
    expect(by['sub']!.calls).toBe(0)
    expect(r.lanes).toHaveLength(3)            // làn rỗng vẫn phải hiện, không được giấu
  })

  it('đếm riêng lượt ĐỌC ẢNH của từng làn: máy xưởng đọc ảnh là việc của nó', () => {
    const r = analyseBehaviour([
      row({ kind: 'read', target: 'a/b/x.png', ext: 'png', entrypoint: 'sdk-cli', n: 8 }),
      row({ kind: 'read', target: 'a/b/y.ts', ext: 'ts', entrypoint: 'sdk-cli', n: 2 }),
      row({ kind: 'read', target: 'a/b/z.ts', ext: 'ts', n: 4 }),
    ])
    const job = r.lanes.find((l) => l.lane === 'job')!
    expect(job.image_reads).toBe(8)
    expect(job.image_pct).toBe(80)
    const hand = r.lanes.find((l) => l.lane === 'hand')!
    expect(hand.image_reads).toBe(0)
    expect(hand.image_pct).toBe(0)
    // Không có lệnh shell nào ⇒ probe_pct phải là 0, và màn hình hiện dấu gạch.
    expect(hand.probe_pct).toBe(0)
  })

  it('nhận ra MCP đến từ plugin', () => {
    const fig = b.mcp.find((m) => m.key === 'plugin_x_figma')!
    expect(fig.from_plugin).toBe(true)
    expect(b.mcp.find((m) => m.key === 'openclaw')!.from_plugin).toBe(false)
  })

  it('mỗi lệnh hay dùng đều mang NHÓM của nó, lệnh lạ vào "other"', () => {
    expect(b.top_verbs.find((v) => v.key === 'grep')!.group).toBe('probe')
    expect(b.top_verbs.find((v) => v.key === 'pnpm')!.group).toBe('build')
    const odd = analyseBehaviour([row({ kind: 'exec', verb: 'khonghebiet', n: 1 })])
    expect(odd.top_verbs[0]!.group).toBe('other')
  })

  it('không có lệnh shell nào ⇒ không chia cho 0', () => {
    const r = analyseBehaviour([row({ kind: 'read', target: 'x', n: 1 })])
    expect(r.probe_pct).toBe(0)
    expect(() => analyseBehaviour([])).not.toThrow()
    expect(analyseBehaviour([]).total).toBe(0)
  })

  it('một lệnh KHÔNG nằm ở hai nhóm — nhóm chồng nhau làm phần trăm vượt 100', () => {
    const seen = new Map<string, string>()
    for (const [g, vs] of Object.entries(VERB_GROUPS)) {
      for (const v of vs) {
        expect(seen.has(v), `${v} nằm ở cả ${seen.get(v)} và ${g}`).toBe(false)
        seen.set(v, g)
      }
    }
  })
})
