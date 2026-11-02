/**
 * Read BEHAVIOUR out of tool facts.
 *
 * The goal is not a list saying "grep ran 11,849 times". A raw count says nothing. What
 * is worth knowing is: of all those calls, how many only LOOKED without doing anything,
 * how many you actually drove and how many a subagent or an unattended job fired, and
 * which of those can be changed.
 *
 * House rule: every number here must follow FROM MEASUREMENT. If it cannot, it is not said.
 */

export interface ToolFactRow {
  session_id: string
  project_key: string | null
  day: string
  tool: string
  kind: string
  verb: string | null
  target: string | null
  ext: string | null
  is_sidechain: number
  /** `cli` means typed in a terminal, `sdk-cli` means `claude -p` fired by a job. null on an old index. */
  entrypoint: string | null
  n: number
}

/**
 * Three distinct LANES that must not be mixed.
 *
 * `job` is `claude -p` fired by a pipeline or a cron entry. It probes files and opens
 * images in bulk because that IS its work. Folding that lane into the overall figures
 * and concluding "you probe too much" attributes machine behaviour to a person, and the
 * lane was measured to be a large share of everything.
 */
export type Lane = 'hand' | 'sub' | 'job'

/**
 * The marker of an UNATTENDED session, read from the working directory.
 *
 * `claude -p` (entrypoint `sdk-cli`) is one marker. But pipelines also run agents inside
 * their own worktrees at `.claude/worktrees/agent-...` and inside an OpenClaw workspace.
 * Those sessions enter through `cli` exactly like a person typing, so looking at the
 * entrypoint alone filed about 30% of all calls under "you". That was measured.
 */
export const AUTO_CWD = /(^|\/)\.claude\/worktrees\/agent-|(^|\/)\.openclaw(\/|$)/

export function laneOf(r: Pick<ToolFactRow, 'entrypoint' | 'is_sidechain' | 'project_key'>): Lane {
  if (r.entrypoint === 'sdk-cli') return 'job'
  if (r.project_key && AUTO_CWD.test(r.project_key)) return 'job'
  return r.is_sidechain ? 'sub' : 'hand'
}

/** Image extensions. Reading an image is checking a render, not reading code. */
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'heic', 'avif'])

export interface LaneStats {
  lane: Lane
  calls: number
  pct: number
  sessions: number
  exec: number
  probe_pct: number
  reads: number
  writes: number
  read_per_write: number | null
  /** Image reads, and their share of the lane's total reads. */
  image_reads: number
  image_pct: number
  top_verbs: Array<Count & { group: string }>
  /** Project folders, last segment only. */
  top_projects: Count[]
}

/**
 * Shell commands that only LOOK: they change nothing on disk.
 *
 * These groups exist to answer "what is all that reading for" with numbers, not to rank
 * commands. A verb in no group goes to 'other'. Guessing a group is worse than leaving
 * it unclassified.
 */
export const VERB_GROUPS: Record<string, readonly string[]> = {
  /** Search and read: looking around, nothing done yet. */
  probe: ['grep', 'rg', 'ag', 'head', 'tail', 'cat', 'less', 'ls', 'find', 'cut', 'wc',
    'sort', 'uniq', 'awk', 'stat', 'file', 'du', 'tree', 'jq', 'pwd', 'which', 'diff'],
  /** Real changes on disk. */
  change: ['sed', 'mv', 'cp', 'rm', 'mkdir', 'touch', 'chmod', 'ln', 'tee', 'patch'],
  /** Build and test. */
  build: ['pnpm', 'npm', 'npx', 'yarn', 'node', 'tsc', 'vitest', 'jest', 'playwright',
    'pytest', 'make', 'cargo', 'go', 'gradle', 'swift', 'bun', 'deno'],
  /** Source history. */
  vcs: ['git', 'gh', 'hg'],
  /** Out to the network. */
  net: ['curl', 'wget', 'ssh', 'scp', 'rsync'],
  /** Run a script in place. */
  script: ['python3', 'python', 'bash', 'sh', 'zsh', 'perl', 'ruby', 'osascript'],
}

const GROUP_OF = new Map<string, string>()
for (const [g, vs] of Object.entries(VERB_GROUPS)) for (const v of vs) GROUP_OF.set(v, g)

export interface Count { key: string; n: number; pct: number }

export interface Behaviour {
  total: number
  sessions: number
  /** By tool kind: exec, read, write, mcp, agent, ask, other. */
  by_kind: Count[]
  /** Shell commands by kind of work, as a share of all shell commands. */
  by_verb_group: Count[]
  /** The most used commands, each with its group. */
  top_verbs: Array<Count & { group: string }>
  /** File extensions read or written. */
  by_ext: Count[]
  /** MCP servers, and which of them come from a plugin. */
  mcp: Array<Count & { from_plugin: boolean }>
  /** Subagents and skills invoked. */
  agents: Count[]

  /** Calls you did NOT type: subagents plus unattended runs. */
  not_hand_driven: number
  not_hand_driven_pct: number
  /** Calls made by subagents. */
  sidechain: number
  sidechain_pct: number
  /** Calls through a plugin-provided MCP server. */
  plugin_mcp: number

  /** Reads that re-open the same file inside the same session. */
  reread: number
  reread_pct: number
  /** The files re-read most inside one session. */
  reread_top: Array<{ target: string; n: number }>

  /** Look-only shell commands, as a share of all shell commands. */
  probe_pct: number
  /** Reads per single write. */
  read_per_write: number | null

  /** Split by lane: you typing, subagents, unattended runs. Always all three, empty ones included. */
  lanes: LaneStats[]
}

const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

const rank = (m: Map<string, number>, total: number, limit = 12): Count[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => ({ key, n, pct: pct(n, total) }))

/** The figures for ONE lane. A separate function because all three must use the same ruler. */
function laneStats(lane: Lane, rows: ToolFactRow[], grandTotal: number): LaneStats {
  const verbs = new Map<string, number>()
  const projects = new Map<string, number>()
  const sessions = new Set<string>()
  let calls = 0, exec = 0, probe = 0, reads = 0, writes = 0, images = 0
  for (const r of rows) {
    calls += r.n
    sessions.add(r.session_id)
    if (r.project_key) {
      const name = r.project_key.split('/').filter(Boolean).pop() ?? r.project_key
      projects.set(name, (projects.get(name) ?? 0) + r.n)
    }
    if (r.kind === 'exec' && r.verb) {
      exec += r.n
      verbs.set(r.verb, (verbs.get(r.verb) ?? 0) + r.n)
      if ((GROUP_OF.get(r.verb) ?? 'other') === 'probe') probe += r.n
    }
    if (r.kind === 'read') {
      reads += r.n
      if (r.ext && IMAGE_EXT.has(r.ext)) images += r.n
    }
    if (r.kind === 'write') writes += r.n
  }
  return {
    lane,
    calls,
    pct: pct(calls, grandTotal),
    sessions: sessions.size,
    exec,
    probe_pct: pct(probe, exec),
    reads,
    writes,
    read_per_write: writes > 0 ? Math.round((reads / writes) * 10) / 10 : null,
    image_reads: images,
    image_pct: pct(images, reads),
    top_verbs: rank(verbs, exec, 8).map((c) => ({ ...c, group: GROUP_OF.get(c.key) ?? 'other' })),
    top_projects: rank(projects, calls, 5),
  }
}

export function analyseBehaviour(rows: ToolFactRow[]): Behaviour {
  const kinds = new Map<string, number>()
  const verbs = new Map<string, number>()
  const groups = new Map<string, number>()
  const exts = new Map<string, number>()
  const mcp = new Map<string, number>()
  const agents = new Map<string, number>()
  const sessions = new Set<string>()

  let total = 0, exec = 0, probe = 0, reads = 0, writes = 0
  let sidechain = 0, pluginMcp = 0, reread = 0
  const rereadTop: Array<{ target: string; n: number }> = []

  for (const r of rows) {
    total += r.n
    sessions.add(r.session_id)
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + r.n)
    if (r.is_sidechain) sidechain += r.n

    if (r.kind === 'exec' && r.verb) {
      exec += r.n
      verbs.set(r.verb, (verbs.get(r.verb) ?? 0) + r.n)
      const g = GROUP_OF.get(r.verb) ?? 'other'
      groups.set(g, (groups.get(g) ?? 0) + r.n)
      if (g === 'probe') probe += r.n
    }
    if (r.kind === 'read') {
      reads += r.n
      // n > 1 means the SAME file in the SAME session, read several times. Every read
      // after the first is a trip that brought back nothing new.
      if (r.target && r.n > 1) {
        reread += r.n - 1
        rereadTop.push({ target: r.target, n: r.n })
      }
    }
    if (r.kind === 'write') writes += r.n
    if (r.ext) exts.set(r.ext, (exts.get(r.ext) ?? 0) + r.n)
    if (r.kind === 'mcp' && r.verb) {
      mcp.set(r.verb, (mcp.get(r.verb) ?? 0) + r.n)
      if (r.verb.startsWith('plugin_')) pluginMcp += r.n
    }
    if (r.kind === 'agent' && r.verb) agents.set(r.verb, (agents.get(r.verb) ?? 0) + r.n)
  }

  // Not hand driven = subagents plus unattended runs. Adding plugin MCP calls here would
  // double count: most of them already sit inside one of those two lanes.
  const notHand = rows.filter((r) => laneOf(r) !== 'hand').reduce((a, r) => a + r.n, 0)

  return {
    total,
    sessions: sessions.size,
    by_kind: rank(kinds, total, 8),
    by_verb_group: rank(groups, exec, 8),
    top_verbs: rank(verbs, exec, 12).map((c) => ({ ...c, group: GROUP_OF.get(c.key) ?? 'other' })),
    by_ext: rank(exts, [...exts.values()].reduce((s, n) => s + n, 0), 8),
    mcp: rank(mcp, [...mcp.values()].reduce((s, n) => s + n, 0), 8)
      .map((c) => ({ ...c, from_plugin: c.key.startsWith('plugin_') })),
    agents: rank(agents, [...agents.values()].reduce((s, n) => s + n, 0), 8),

    not_hand_driven: notHand,
    not_hand_driven_pct: pct(notHand, total),
    sidechain,
    sidechain_pct: pct(sidechain, total),
    plugin_mcp: pluginMcp,

    reread,
    reread_pct: pct(reread, reads),
    reread_top: rereadTop.sort((a, b) => b.n - a.n).slice(0, 6),

    probe_pct: pct(probe, exec),
    // "no writes at all" is not the same statement as "a ratio of zero".
    read_per_write: writes > 0 ? Math.round((reads / writes) * 10) / 10 : null,

    lanes: (['hand', 'sub', 'job'] as const).map((l) =>
      laneStats(l, rows.filter((r) => laneOf(r) === l), total)),
  }
}
