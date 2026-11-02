/**
 * Đọc HÀNH VI từ sự thật tool call.
 *
 * Mục tiêu không phải là liệt kê "grep 11.849 lần". Số đếm không nói gì cả. Cái
 * đáng biết là: trong ngần ấy lượt gọi, bao nhiêu phần là ĐI TÌM mà chưa làm gì,
 * bao nhiêu phần do CHÍNH ANH sai khiến và bao nhiêu phần do plugin/subagent tự
 * gọi, và cái nào trong đó sửa được.
 *
 * Luật: mỗi con số phải suy được TỪ SỐ ĐO. Không suy được thì không nói.
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
  /** `cli` = gõ trong terminal, `sdk-cli` = `claude -p` do job gọi. null với index cũ. */
  entrypoint: string | null
  n: number
}

/**
 * Ba LÀN khác nhau, không được trộn.
 *
 * `job` là `claude -p` do xưởng/cron gọi: nó dò file và đọc ảnh hàng loạt vì đó
 * CHÍNH LÀ việc của nó. Trộn làn này vào số chung rồi kết luận "anh dò nhiều quá"
 * là quy hành vi của máy cho người — đã đo thấy làn này chiếm phần lớn.
 */
export type Lane = 'hand' | 'sub' | 'job'

/**
 * Dấu hiệu MỘT PHIÊN MÁY TỰ CHẠY, đọc từ thư mục làm việc.
 *
 * `claude -p` (entrypoint `sdk-cli`) là một dấu. Nhưng xưởng còn chạy agent trong
 * worktree riêng `.claude/worktrees/agent-…` và trong workspace của OpenClaw: những
 * phiên đó vào bằng `cli` y như người gõ, nên chỉ nhìn entrypoint là xếp nhầm 30%
 * lượt gọi sang cột "anh" — đã đo thấy đúng như vậy.
 */
export const AUTO_CWD = /(^|\/)\.claude\/worktrees\/agent-|(^|\/)\.openclaw(\/|$)/

export function laneOf(r: Pick<ToolFactRow, 'entrypoint' | 'is_sidechain' | 'project_key'>): Lane {
  if (r.entrypoint === 'sdk-cli') return 'job'
  if (r.project_key && AUTO_CWD.test(r.project_key)) return 'job'
  return r.is_sidechain ? 'sub' : 'hand'
}

/** Đuôi file là ẢNH: đọc ảnh là xem kết quả render, không phải đọc mã. */
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
  /** Lượt đọc là ảnh, và phần trăm trên tổng lượt đọc của làn. */
  image_reads: number
  image_pct: number
  top_verbs: Array<Count & { group: string }>
  /** Thư mục dự án, chỉ lấy tên cuối. */
  top_projects: Count[]
}

/**
 * Lệnh shell chỉ để NHÌN: chúng không đổi gì trên đĩa.
 *
 * Phân nhóm này là để trả lời "đọc nhiều thế để làm gì" bằng số, chứ không phải
 * để xếp hạng lệnh. Một lệnh không có trong bất kỳ nhóm nào thì vào 'khác' —
 * đoán bừa một nhóm còn tệ hơn không xếp.
 */
export const VERB_GROUPS: Record<string, readonly string[]> = {
  /** Tìm và đọc: dò dẫm, chưa làm gì. */
  probe: ['grep', 'rg', 'ag', 'head', 'tail', 'cat', 'less', 'ls', 'find', 'cut', 'wc',
    'sort', 'uniq', 'awk', 'stat', 'file', 'du', 'tree', 'jq', 'pwd', 'which', 'diff'],
  /** Sửa đổi thật trên đĩa. */
  change: ['sed', 'mv', 'cp', 'rm', 'mkdir', 'touch', 'chmod', 'ln', 'tee', 'patch'],
  /** Dựng và kiểm. */
  build: ['pnpm', 'npm', 'npx', 'yarn', 'node', 'tsc', 'vitest', 'jest', 'playwright',
    'pytest', 'make', 'cargo', 'go', 'gradle', 'swift', 'bun', 'deno'],
  /** Lịch sử mã nguồn. */
  vcs: ['git', 'gh', 'hg'],
  /** Ra ngoài mạng. */
  net: ['curl', 'wget', 'ssh', 'scp', 'rsync'],
  /** Chạy script tại chỗ. */
  script: ['python3', 'python', 'bash', 'sh', 'zsh', 'perl', 'ruby', 'osascript'],
}

const GROUP_OF = new Map<string, string>()
for (const [g, vs] of Object.entries(VERB_GROUPS)) for (const v of vs) GROUP_OF.set(v, g)

export interface Count { key: string; n: number; pct: number }

export interface Behaviour {
  total: number
  sessions: number
  /** Theo loại tool: exec/read/write/mcp/agent/ask/other. */
  by_kind: Count[]
  /** Lệnh shell theo nhóm việc, kèm phần trăm trên tổng lệnh shell. */
  by_verb_group: Count[]
  /** Lệnh hay dùng nhất, kèm nhóm của nó. */
  top_verbs: Array<Count & { group: string }>
  /** Đuôi file được đọc hoặc ghi. */
  by_ext: Count[]
  /** MCP server, và server nào đến từ plugin. */
  mcp: Array<Count & { from_plugin: boolean }>
  /** Subagent và skill được gọi. */
  agents: Count[]

  /** Lượt gọi KHÔNG do anh gõ: subagent + MCP của plugin. */
  not_hand_driven: number
  not_hand_driven_pct: number
  /** Lượt gọi của subagent. */
  sidechain: number
  sidechain_pct: number
  /** Lượt gọi qua MCP của plugin. */
  plugin_mcp: number

  /** Lượt ĐỌC là lần đọc lại cùng một file trong cùng một phiên. */
  reread: number
  reread_pct: number
  /** File bị đọc lại nhiều nhất trong một phiên. */
  reread_top: Array<{ target: string; n: number }>

  /** Lệnh shell chỉ để nhìn, trên tổng lệnh shell. */
  probe_pct: number
  /** Số lượt đọc cho mỗi một lượt ghi. */
  read_per_write: number | null

  /** Tách theo làn: tay gõ, subagent, job tự chạy. Luôn đủ ba, kể cả làn rỗng. */
  lanes: LaneStats[]
}

const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

const rank = (m: Map<string, number>, total: number, limit = 12): Count[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => ({ key, n, pct: pct(n, total) }))

/** Số của MỘT làn. Tách hàm vì ba làn phải đo bằng đúng một cái thước. */
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
      // n > 1 nghĩa là CÙNG một file, CÙNG một phiên, đọc nhiều lần: mọi lần sau
      // lần đầu là một lượt đi lại không mang về thông tin mới.
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

  // KHÔNG do tay gõ = subagent + job tự chạy. Cộng thêm plugin MCP ở đây là đếm
  // hai lần: phần lớn lượt plugin MCP đã nằm trong một trong hai làn kia.
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
    // "không có lượt ghi nào" khác "tỉ lệ bằng không".
    read_per_write: writes > 0 ? Math.round((reads / writes) * 10) / 10 : null,

    lanes: (['hand', 'sub', 'job'] as const).map((l) =>
      laneStats(l, rows.filter((r) => laneOf(r) === l), total)),
  }
}
