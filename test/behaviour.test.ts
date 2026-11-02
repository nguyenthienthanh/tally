import { describe, it, expect } from 'vitest'
import { analyseBehaviour, VERB_GROUPS, type ToolFactRow } from '../src/engine/behaviour.js'

const row = (o: Partial<ToolFactRow>): ToolFactRow => ({
  session_id: 's1', project_key: '/p', day: '2026-10-29',
  tool: 'Bash', kind: 'exec', verb: null, target: null, ext: null, is_sidechain: 0,
  entrypoint: 'cli', n: 1, ...o,
})

describe('reading behaviour from tool facts', () => {
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

  it('the look-only share is over shell commands, not over all tool calls', () => {
    // 80 probe over 100 exec is 80%, NOT 80/128
    expect(b.probe_pct).toBe(80)
  })

  it('a re-read is every read AFTER the first of the same file in the same session', () => {
    expect(b.reread).toBe(3)                 // a.ts read 4 times means 3 redundant reads
    expect(b.reread_pct).toBe(60)            // 3 of 5 reads
    expect(b.reread_top[0]).toEqual({ target: 'src/a.ts', n: 4 })
  })

  it('the read to write ratio', () => {
    expect(b.read_per_write).toBe(1)         // 5 reads over 5 writes
  })

  it('NO writes gives null, not 0, because missing is not zero', () => {
    const r = analyseBehaviour([row({ kind: 'read', target: 'x', n: 3 })])
    expect(r.read_per_write).toBeNull()
  })

  it('separates what you did not type: subagents and unattended runs', () => {
    expect(b.sidechain).toBe(3)
    expect(b.plugin_mcp).toBe(10)
    // plugin_mcp is NOT added in: those 10 calls happened inside a hand-driven session,
    // so adding them would count the same call twice.
    expect(b.not_hand_driven).toBe(3)
    expect(b.not_hand_driven_pct).toBe(2.3)    // 3 / 128
  })

  it('the "job" lane catches both `claude -p` AND agents running in their own worktree', () => {
    const r = analyseBehaviour([
      row({ kind: 'exec', verb: 'grep', n: 10 }),                                    // hand driven
      row({ session_id: 's2', kind: 'exec', verb: 'ls', entrypoint: 'sdk-cli', n: 5 }),
      // Entered through `cli`, not a sidechain, but the directory is an agent worktree:
      // looking at the entrypoint alone files this under the person.
      row({ session_id: 's3', kind: 'exec', verb: 'cat',
        project_key: '/Users/x/Projects/ai-mv-factory/.claude/worktrees/agent-a05288f6', n: 20 }),
      row({ session_id: 's4', kind: 'exec', verb: 'cat', project_key: '/Users/x/.openclaw/workspace', n: 5 }),
    ])
    const by = Object.fromEntries(r.lanes.map((l) => [l.lane, l]))
    expect(by['job']!.calls).toBe(30)
    expect(by['hand']!.calls).toBe(10)
    expect(by['sub']!.calls).toBe(0)
    expect(r.lanes).toHaveLength(3)            // an empty lane still has to show up, never be hidden
  })

  it('counts IMAGE READS per lane: an unattended pipeline reading images is doing its job', () => {
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
    // With no shell commands probe_pct must be 0, and the screen shows the unknown mark.
    expect(hand.probe_pct).toBe(0)
  })

  it('recognises an MCP server that came from a plugin', () => {
    const fig = b.mcp.find((m) => m.key === 'plugin_x_figma')!
    expect(fig.from_plugin).toBe(true)
    expect(b.mcp.find((m) => m.key === 'openclaw')!.from_plugin).toBe(false)
  })

  it('every top command carries its GROUP, and an unknown verb goes to "other"', () => {
    expect(b.top_verbs.find((v) => v.key === 'grep')!.group).toBe('probe')
    expect(b.top_verbs.find((v) => v.key === 'pnpm')!.group).toBe('build')
    const odd = analyseBehaviour([row({ kind: 'exec', verb: 'khonghebiet', n: 1 })])
    expect(odd.top_verbs[0]!.group).toBe('other')
  })

  it('no shell commands means no division by zero', () => {
    const r = analyseBehaviour([row({ kind: 'read', target: 'x', n: 1 })])
    expect(r.probe_pct).toBe(0)
    expect(() => analyseBehaviour([])).not.toThrow()
    expect(analyseBehaviour([]).total).toBe(0)
  })

  it('a verb is never in two groups, because overlapping groups push percentages past 100', () => {
    const seen = new Map<string, string>()
    for (const [g, vs] of Object.entries(VERB_GROUPS)) {
      for (const v of vs) {
        expect(seen.has(v), `${v} is in both ${seen.get(v)} and ${g}`).toBe(false)
        seen.set(v, g)
      }
    }
  })
})
