import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Đọc dữ liệu mà `/insights` của Claude Code để lại — MIỄN PHÍ, không gọi LLM.
 * Xác minh trên máy 2026-10-29: 200 session-meta (2026-09-30 → 2026-10-29) + 9 facets.
 */

/** Mọi số liệu PHẢI mang nhãn nguồn. Không bao giờ trộn hai nguồn vào một con số (DD-13b). */
export type Provenance = 'deterministic' | 'llm_derived'

export interface SessionMeta {
  session_id: string
  project_path: string
  start_time: string
  duration_minutes: number
  user_message_count: number
  assistant_message_count: number
  tool_counts: Record<string, number>
  tool_errors: number
  tool_error_categories: Record<string, number>
  user_interruptions: number
  destructive_command_count: number
  bash_would_prompt_count: number
  files_modified: number
  lines_added: number
  lines_removed: number
  git_commits: number
  git_pushes: number
  input_tokens: number
  output_tokens: number
  uses_mcp: boolean
  uses_task_agent: boolean
  uses_web_search: boolean
  uses_web_fetch: boolean
  user_response_times: number[]
  message_hours: number[]
}

export interface Facet {
  session_id: string
  outcome: string
  session_type: string
  claude_helpfulness: string
  friction_counts: Record<string, number>
  user_satisfaction_counts: Record<string, number>
  underlying_goal: string
}

export interface Aggregate<T> {
  provenance: Provenance
  /** Số phiên THỰC SỰ đóng góp vào con số này. Bắt buộc hiện lên UI (DD-17). */
  sample_size: number
  /** Tổng số phiên có session-meta — để người đọc biết mẫu chiếm bao nhiêu. */
  population: number
  value: T
}

/** Mốc bucket thời gian phản hồi — theo đúng mốc của `/insights` gốc. */
export const RT_BUCKETS = ['<2s', '2-10s', '10-30s', '30s-1m', '1-2m', '2-5m', '5-15m', '>15m'] as const
export type RtBucket = typeof RT_BUCKETS[number]

export function rtBucket(seconds: number): RtBucket {
  if (seconds < 2) return '<2s'
  if (seconds < 10) return '2-10s'
  if (seconds < 30) return '10-30s'
  if (seconds < 60) return '30s-1m'
  if (seconds < 120) return '1-2m'
  if (seconds < 300) return '2-5m'
  if (seconds < 900) return '5-15m'
  return '>15m'
}

function readJsonDir<T>(dir: string): T[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const out: T[] = []
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    try { out.push(JSON.parse(readFileSync(join(dir, n), 'utf8')) as T) } catch { /* bỏ file hỏng */ }
  }
  return out
}

export function readSessionMeta(dir: string): SessionMeta[] { return readJsonDir<SessionMeta>(dir) }
export function readFacets(dir: string): Facet[] { return readJsonDir<Facet>(dir) }

export interface DeterministicValue {
  sessions: number
  tool_errors: number
  interruptions: number
  destructive_commands: number
  would_prompt: number
  top_tools: Array<[string, number]>
  error_categories: Record<string, number>
  hour_histogram: number[]
  response_time_buckets: Record<string, number>
}

/** Thống kê TẤT ĐỊNH — provenance luôn 'deterministic', mẫu = toàn bộ dân số. */
export function aggregateDeterministic(metas: SessionMeta[]): Aggregate<DeterministicValue> {
  const tools: Record<string, number> = {}
  const cats: Record<string, number> = {}
  const hours = new Array<number>(24).fill(0)
  const rt: Record<string, number> = Object.fromEntries(RT_BUCKETS.map((b) => [b, 0]))
  let toolErrors = 0, interruptions = 0, destructive = 0, wouldPrompt = 0

  for (const m of metas) {
    toolErrors += m.tool_errors ?? 0
    interruptions += m.user_interruptions ?? 0
    destructive += m.destructive_command_count ?? 0
    wouldPrompt += m.bash_would_prompt_count ?? 0
    for (const [k, v] of Object.entries(m.tool_counts ?? {})) tools[k] = (tools[k] ?? 0) + v
    for (const [k, v] of Object.entries(m.tool_error_categories ?? {})) cats[k] = (cats[k] ?? 0) + v
    for (const h of m.message_hours ?? []) {
      if (Number.isInteger(h) && h >= 0 && h < 24) hours[h] = (hours[h] ?? 0) + 1
    }
    for (const s of m.user_response_times ?? []) {
      const b = rtBucket(s); rt[b] = (rt[b] ?? 0) + 1
    }
  }
  return {
    provenance: 'deterministic', sample_size: metas.length, population: metas.length,
    value: {
      sessions: metas.length, tool_errors: toolErrors, interruptions,
      destructive_commands: destructive, would_prompt: wouldPrompt,
      top_tools: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 20),
      error_categories: cats, hour_histogram: hours, response_time_buckets: rt,
    },
  }
}

/** Ma sát do LLM suy ra — sample_size = số facet, thường NHỎ HƠN population (DD-17). */
export function aggregateFriction(
  facets: Facet[], population: number,
): Aggregate<Record<string, number>> {
  const v: Record<string, number> = {}
  for (const f of facets) {
    for (const [k, n] of Object.entries(f.friction_counts ?? {})) v[k] = (v[k] ?? 0) + n
  }
  return { provenance: 'llm_derived', sample_size: facets.length, population, value: v }
}

export function latestReport(dir: string): { path: string; mtime: number } | null {
  try {
    const p = join(dir, 'report.html')
    return { path: p, mtime: statSync(p).mtimeMs }
  } catch { return null }
}
