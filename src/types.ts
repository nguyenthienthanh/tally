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
  /** true khi record thiếu phân chia cache theo TTL và ta phải dồn vào 5m */
  degraded: boolean
  /**
   * Vì sao không ra event. `parseLine` BIẾT điều này — nếu nó không nói ra thì bên gọi
   * phải đoán bằng `line.startsWith('{')`, và một dòng JSON hỏng bắt đầu bằng `{`
   * (file bị cắt ngang lúc máy sập) sẽ không vào `lines_bad`: mất dữ liệu IM LẶNG.
   */
  reason?: 'bad_json' | 'not_assistant' | 'no_usage'
  /** Sự thật SUY RA từ tool call của dòng này — không mang chuỗi lệnh hay nội dung. */
  facts?: import('./ingest/toolfacts.js').ToolFact[]
}

export type Grain = 'hour' | 'day' | 'month' | 'year'

export interface Finding {
  /** Thứ hạng ưu tiên do engine quyết, 1 là cao nhất. UI chỉ hiện, không tự xếp. */
  rank?: number
  /**
   * Con số trong `damage` nghĩa là gì. Ba loại số khác nhau từng đội chung nhãn "thiệt hại":
   *  · saving — tiền/credits TIẾT KIỆM ĐƯỢC nếu làm theo lời khuyên
   *  · peak   — mức ĐỈNH đo được (CEILING_RISK): không ai "tiết kiệm" được cái đỉnh
   *  · spend  — tổng đã chi cho một nhóm
   * Gọi `peak` là "thiệt hại" khiến người đọc tưởng họ mất ngần ấy tiền.
   */
  damage_kind: 'saving' | 'peak' | 'spend'
  id: string
  severity: 'high' | 'medium' | 'low'
  metric: Record<string, number | string>
  damage: { usd?: number; credits?: number }
  action: string
  sample_sessions: string[]
}
