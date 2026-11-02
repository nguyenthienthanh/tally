export interface UsageEvent {
  request_id: string
  uuid: string
  ts_utc: string
  session_id: string
  project_key: string
  cwd: string | null
  git_branch: string | null
  model: string
  requested_model: string | null
  advisor_model: string | null
  effort: string | null
  per_turn_effort: string | null
  entrypoint: string | null
  is_sidechain: boolean
  service_tier: string | null
  speed: string | null
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_write_5m: number
  cache_write_1h: number
  thinking_tokens: number
  web_search_reqs: number
  web_fetch_reqs: number
  tool_calls: number
  cc_version: string | null
}

export interface ParseResult {
  event: UsageEvent | null
  /** True when the record has no per-TTL cache split and we must fold it into 5m. */
  degraded: boolean
  /**
   * Why no event came out. `parseLine` KNOWS this; if it stays silent the caller has
   * to guess with `line.startsWith('{')`, and a broken JSON line that starts with `{`
   * (a file cut in half when the machine died) never reaches `lines_bad`. That is
   * data loss nobody sees.
   */
  reason?: 'bad_json' | 'not_assistant' | 'no_usage'
  /** Facts DERIVED from this line's tool calls. Never a command string or file content. */
  facts?: import('./ingest/toolfacts.js').ToolFact[]
}

export type Grain = 'hour' | 'day' | 'month' | 'year'

export interface Finding {
  /** Priority rank decided by the engine, 1 is highest. The UI renders, it never re-sorts. */
  rank?: number
  /**
   * What the number in `damage` means. Three different kinds of number once shared the
   * single label "damage":
   *  . saving: money or credits that COULD be saved by acting on the advice
   *  . peak:   a measured PEAK (CEILING_RISK). Nobody can "save" a peak.
   *  . spend:  the total already spent on a group
   * Calling a `peak` "damage" makes the reader think they lost that much money.
   */
  damage_kind: 'saving' | 'peak' | 'spend'
  id: string
  severity: 'high' | 'medium' | 'low'
  metric: Record<string, number | string>
  damage: { usd?: number; credits?: number }
  action: string
  sample_sessions: string[]
}
