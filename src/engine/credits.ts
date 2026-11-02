import type { UsageEvent } from '../types.js'

export type Hypothesis = 'all' | 'in_out' | 'out_only' | 'in_out_write' | 'in_out_write_read25'

/**
 * The cache_read weight used by the `in_out_write_read25` hypothesis.
 *
 * Derived FROM MEASUREMENT, not guessed: on the real 5-hour window of 2026-10-29
 * (`five_hour_pct` = 9, so the target was 18,000 credits), in+out+write gave 10,415
 * credits while counting cache_read in full gave 281,695. The weight needed to match
 * was 0.0269; 0.025 (= 1/40) lands at -3.0% and falls INSIDE the quantisation band of
 * an integer `pct`.
 *
 * It is still a HYPOTHESIS: Anthropic does not publish the formula.
 */
export const CACHE_READ_WEIGHT = 0.025

/**
 * The hypothesis used while calibration is not possible (low signal, stale index, no data).
 *
 * NOT 'all': counting cache_read in full inflates credits by hundreds of times and
 * produces nonsense such as "10,853% of the ceiling". Use the best MEASURED estimate
 * instead, and always ship a `status` so the reader knows it was not calibrated here.
 */
export const DEFAULT_HYPOTHESIS: Hypothesis = 'in_out_write_read25'

export interface CalibrationResult {
  hypothesis: Hypothesis
  /** Error against the CENTRE of the band. null when calibration was not possible. */
  error_pct: number | null
  /** True when the result falls INSIDE the quantisation band of an integer `pct`, so it counts as a match. */
  within_quantization: boolean
  /** Total credits of the window the fit was made on. An estimate for a MUCH heavier
   *  window is an extrapolation, and the reader has to be told so. */
  fitted_on_credits: number | null
  status: 'calibrated' | 'poor_fit' | 'low_signal' | 'no_data' | 'stale_index' | 'no_ceiling'
}

/** The index counts as current if its newest event is no older than this against the snapshot. */
export const STALE_INDEX_TOLERANCE_MS = 5 * 60 * 1000

import { UNKNOWN } from './cost.js'
export { UNKNOWN }

/** Signal threshold: below this, no hypothesis may be chosen (LLD section 3). */
export const MIN_SIGNAL_PCT = 5

/** Past this error the result may no longer be called "calibrated". The figure is rough. */
export const POOR_FIT_PCT = 15
export const HYPOTHESES: Hypothesis[] = [
  'all', 'in_out', 'out_only', 'in_out_write', 'in_out_write_read25',
]

function tokensFor(e: UsageEvent, h: Hypothesis): number {
  switch (h) {
    case 'all': return e.input_tokens + e.output_tokens + e.cache_read + e.cache_write_5m + e.cache_write_1h
    case 'in_out': return e.input_tokens + e.output_tokens
    case 'out_only': return e.output_tokens
    case 'in_out_write': return e.input_tokens + e.output_tokens + e.cache_write_5m + e.cache_write_1h
    case 'in_out_write_read25':
      return e.input_tokens + e.output_tokens + e.cache_write_5m + e.cache_write_1h
        + e.cache_read * CACHE_READ_WEIGHT
  }
}

export function creditsOfEvent(e: UsageEvent, cpm: Record<string, number>, h: Hypothesis): number {
  const rate = cpm[e.model]
  if (rate === undefined) return 0
  return tokensFor(e, h) / 1_000_000 * rate
}

export function creditsByModel(
  events: UsageEvent[], cpm: Record<string, number>, h: Hypothesis,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of events) {
    if (cpm[e.model] === undefined) { out[UNKNOWN] = (out[UNKNOWN] ?? 0); continue }
    out[e.model] = (out[e.model] ?? 0) + creditsOfEvent(e, cpm, h)
  }
  return out
}

/**
 * Pick the hypothesis that best reproduces the measurement. The order of the checks
 * MATTERS: low signal is tested BEFORE missing data, because below pct 5 we must not
 * commit to a hypothesis even when events exist (the relative error is too sensitive).
 */
export function calibrate(
  events: UsageEvent[], cpm: Record<string, number>,
  observed: { five_hour_pct: number; five_hour_reset: number; captured_at: number },
  ceiling: number,
): CalibrationResult {
  // With no ceiling there is NOTHING to compare against. An earlier version still
  // returned 'calibrated' because `best` carried that label, and the CLI printed
  // "error undefined%".
  if (!(ceiling > 0)) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'no_ceiling',
    }
  }
  if (observed.five_hour_pct < MIN_SIGNAL_PCT) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'low_signal',
    }
  }
  const startMs = (observed.five_hour_reset - 5 * 3600) * 1000
  const endMs = observed.captured_at * 1000
  const inWindow = events.filter((e) => {
    const t = Date.parse(e.ts_utc)
    return t >= startMs && t <= endMs
  })
  if (inWindow.length === 0) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'no_data',
    }
  }

  // `five_hour_pct` reflects usage UP TO THE SNAPSHOT, while events only go up to the
  // last scan. Comparing a live number against a stale event set undercounts
  // systematically, and that error gets blamed on the hypothesis. Better to say
  // "stale index" than to commit to a wrong fit.
  // Math.max(...array) blows the stack around 10^5 arguments, and this machine already
  // had 61k events.
  let newest = -Infinity
  for (const e of events) {
    const t = Date.parse(e.ts_utc)
    if (Number.isFinite(t) && t > newest) newest = t
  }
  if (Number.isFinite(newest) && newest < endMs - STALE_INDEX_TOLERANCE_MS) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'stale_index',
    }
  }

  // `five_hour_pct` is an INTEGER, so the true value lies in [pct-0.5, pct+0.5) percent.
  // Comparing against a single point exaggerates the error, especially at small pct.
  const target = observed.five_hour_pct / 100 * ceiling
  const lo = Math.max(0, (observed.five_hour_pct - 0.5) / 100 * ceiling)
  const hi = (observed.five_hour_pct + 0.5) / 100 * ceiling

  let best: CalibrationResult | null = null
  let bestAbs = Infinity
  for (const h of HYPOTHESES) {
    const got = inWindow.reduce((s, e) => s + creditsOfEvent(e, cpm, h), 0)
    const err = target === 0 ? Infinity : (got - target) / target * 100
    if (Math.abs(err) < bestAbs) {
      bestAbs = Math.abs(err)
      best = {
        hypothesis: h, error_pct: err,
        within_quantization: got >= lo && got < hi,
        fitted_on_credits: got,
        status: 'calibrated',
      }
    }
  }
  // A fit that still misses badly must say so. Showing +-31% under the label
  // "calibrated" asks the reader to trust a number that does not deserve it.
  if (best && best.error_pct !== null && Math.abs(best.error_pct) > POOR_FIT_PCT && !best.within_quantization) {
    return { ...best, status: 'poor_fit' }
  }
  // No hypothesis scored at all (every err was Infinity), so admit it cannot be calibrated.
  return best ?? {
    hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
    fitted_on_credits: null, status: 'no_data',
  }
}
