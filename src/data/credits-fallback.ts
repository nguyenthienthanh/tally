/**
 * Bảng dự phòng cho credits GÓI. Nguồn ưu tiên là ĐỘNG:
 *   ~/.claude.json#cachedGrowthBookFeatures.tengu_amber_tally
 * File này CHỈ dùng khi không đọc được nguồn động, và UI phải nói rõ đang dùng nguồn nào.
 * Chụp ngày 2026-10-29.
 */
export const CREDITS_AS_OF = '2026-10-29'

/** credits per million tokens */
export const CREDITS_PER_MTOK_FALLBACK: Record<string, number> = {
  'claude-fable-5-1': 8333,
  'claude-fable-5': 8333,
  'claude-opus-4-6': 5000,
  'claude-opus-4-7': 3338,
  'claude-opus-4-8': 2750,
  'claude-sonnet-4-6': 2500,
  'claude-opus-5': 2292,
  'claude-opus-5-5': 1833,
  'claude-sonnet-5-5': 1250,
  'claude-sonnet-5': 1250,
  'claude-haiku-4-5': 833,
}

/** Trần credits trong cửa sổ 5 giờ, theo rate-limit tier */
export const FIVE_HOUR_CREDITS_FALLBACK: Record<string, number> = {
  default_claude_max_5x: 50_000,
  default_claude_max_20x: 200_000,
}
