/**
 * Bảng giá API Anthropic — nguồn: skill claude-api (bundled Claude Code 2.1.312).
 * Hệ số cache: write 5m = 1.25x input, write 1h = 2x input.
 * Hệ số cache read mặc định 0.1x input; ngoại lệ ghi trong CACHE_READ_FACTOR.
 * Công thức đã được đối chiếu KHỚP TUYỆT ĐỐI (0.000000%) với total_cost_usd do
 * `claude -p --output-format json` báo cho claude-opus-5 (2026-10-29).
 */
export const PRICING_AS_OF = '2026-10-29'

/** USD per million tokens */
export const PRICING: Record<string, { in: number; out: number }> = {
  'claude-fable-5-1': { in: 10, out: 50 },
  'claude-mythos-5-1': { in: 10, out: 50 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}

export const CACHE_WRITE_5M_FACTOR = 1.25
export const CACHE_WRITE_1H_FACTOR = 2
export const CACHE_READ_FACTOR_DEFAULT = 0.1
export const CACHE_READ_FACTOR: Record<string, number> = {
  'claude-opus-5-5': 0.05,
  'claude-fable-5-1': 0.025,
  'claude-mythos-5-1': 0.025,
}
