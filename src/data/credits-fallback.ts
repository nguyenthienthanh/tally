/**
 * Fallback table for PLAN credits. The preferred source is dynamic:
 *   ~/.claude.json#cachedGrowthBookFeatures.tengu_amber_tally
 * This file is used ONLY when that source cannot be read, and the UI must say which
 * source is in play. Captured on 2026-10-29.
 */
export const CREDITS_AS_OF = '2026-10-29'

/** Credits per million tokens. */
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

/** Credit ceiling inside the 5-hour window, by rate-limit tier. */
export const FIVE_HOUR_CREDITS_FALLBACK: Record<string, number> = {
  default_claude_max_5x: 50_000,
  default_claude_max_20x: 200_000,
}
