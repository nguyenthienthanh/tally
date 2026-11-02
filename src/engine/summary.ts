import type { UsageEvent } from '../types.js'
import { costByModel, costOfEvent, hasPricing } from './cost.js'
import { creditsByModel, creditsOfEvent, type Hypothesis } from './credits.js'

/**
 * The ONE place that computes the per-model table.
 *
 * Before this was extracted, the server and the CLI each computed it. The server had
 * been fixed to use the 5-hour window while the CLI still divided LIFETIME credits by
 * the 5-hour ceiling and printed "10853.5%". Two places computing the same thing means
 * one of them will eventually lie (house rule: no second source of truth).
 */
export interface ModelRow {
  model: string
  /** Credits inside the SELECTED PERIOD (5h, 24h, 7d, 30d or all). */
  credits_period: number
  /** Total credits over ALL indexed history, with no period applied. This answers
   *  "how much has this model eaten since the beginning". */
  credits_lifetime: number
  /** @deprecated Alias of credits_period, kept for older callers. */
  credits_5h: number
  /** USD inside the selected period. */
  usd_period: number
  /** USD over all history. */
  usd: number
  /** What SHARE of the period's credits this model took, which answers "which model am
   *  I actually using". null when the rate is unknown or the period is empty. */
  share_pct: number | null
  /** Only meaningful when the selected period IS the 5-hour window, otherwise null. */
  pct_of_ceiling: number | null
  /** False when the model is NOT in the credit table, so the UI shows the unknown mark
   *  and never a 0. Real case: `claude-haiku-5-5` was absent from tengu_amber_tally on
   *  2026-10-29, and a 0 there reads as "this model is free". Unknown is not zero. */
  credits_known: boolean
}

export interface ModelSummary {
  rows: ModelRow[]
  is_five_hour: boolean
  period_total_credits: number
  window: { startUtc: string; endUtc: string; events: number }
  events: number
}

/**
 * The current 5-hour window, taken from the REAL reset timestamp the client reports
 * rather than by subtracting five hours from now. The two differ, and only the first
 * one lines up with `five_hour_pct`.
 */
export function currentWindow(limits: { five_hour_reset: number; captured_at: number } | null):
  { startMs: number; endMs: number } {
  // `five_hour_reset: 0` means NO window is running (it just reset and nothing has been
  // used). Subtracting five hours from 0 gives a NEGATIVE start, the window silently
  // becomes all time, and the "% of 5h ceiling" column turns into "lifetime credits over
  // a 5-hour ceiling". That is the 10,853% bug class, back through another door.
  if (limits && limits.five_hour_reset > 0) {
    return { startMs: (limits.five_hour_reset - 5 * 3600) * 1000, endMs: limits.captured_at * 1000 }
  }
  const end = limits && limits.captured_at > 0 ? limits.captured_at * 1000 : Date.now()
  return { startMs: end - 5 * 3600 * 1000, endMs: end }
}

export const PERIODS = ['5h', '24h', '7d', '30d', 'all'] as const
export type Period = (typeof PERIODS)[number]

const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  '5h': 5 * 3600_000, '24h': 24 * 3600_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000,
}

/**
 * The time range for a selection.
 * `all` starts at 0: the reader wants EVERYTHING, not merely a long window.
 */
export function periodWindow(p: Period, nowMs = Date.now()): { startMs: number; endMs: number } {
  if (p === 'all') return { startMs: 0, endMs: nowMs }
  return { startMs: nowMs - PERIOD_MS[p], endMs: nowMs }
}

export function summaryByModel(
  events: UsageEvent[],
  cpm: Record<string, number>,
  hypothesis: Hypothesis,
  ceiling: number | null,
  /** The SELECTED period. `pct_of_ceiling` only means anything when it is the 5-hour window. */
  window: { startMs: number; endMs: number },
  /** True when `window` is the current 5-hour window. */
  isFiveHour = true,
): ModelSummary {
  const inWin = events.filter((e) => {
    const t = Date.parse(e.ts_utc)
    return t >= window.startMs && t <= window.endMs
  })
  const lifetime = creditsByModel(events, cpm, hypothesis)
  const win = creditsByModel(inWin, cpm, hypothesis)
  const usdAll = costByModel(events)
  const usdWin = costByModel(inWin)

  // Total credits for the period, the denominator of "what share did this model take".
  // Only models with a KNOWN rate are summed: adding unknown models to the denominator
  // drags every percentage down in silence.
  let periodTotal = 0
  for (const [m, c] of Object.entries(win)) if (cpm[m] !== undefined) periodTotal += c

  const rows = Object.keys({ ...lifetime, ...usdAll }).map((model) => {
    const known = cpm[model] !== undefined
    const credits = win[model] ?? 0
    return {
      model,
      credits_period: credits,
      credits_lifetime: lifetime[model] ?? 0,
      /** Old name kept for existing callers; equal to credits_period. */
      credits_5h: credits,
      usd_period: usdWin[model] ?? 0,
      usd: usdAll[model] ?? 0,
      /** This model's share of the period's credits. */
      share_pct: known && periodTotal > 0 ? credits / periodTotal * 100 : null,
      /** Only meaningful when the selected period IS the 5-hour window. */
      pct_of_ceiling: known && isFiveHour && ceiling ? credits / ceiling * 100 : null,
      credits_known: known,
    }
  }).sort((a, b) => b.credits_period - a.credits_period || b.credits_lifetime - a.credits_lifetime)

  return {
    rows,
    is_five_hour: isFiveHour,
    period_total_credits: periodTotal,
    window: {
      startUtc: new Date(window.startMs).toISOString(),
      endUtc: new Date(window.endMs).toISOString(),
      events: inWin.length,
    },
    events: events.length,
  }
}

export interface ProjectRow {
  project: string
  events: number
  credits: number
  usd: number
  sidechain_usd: number
}

/** Cost by project (cwd). `label` allows anonymising WITHOUT changing how rows group. */
export function summaryByProject(
  events: UsageEvent[],
  cpm: Record<string, number>,
  hypothesis: Hypothesis,
  label: (key: string) => string = (k) => k,
): ProjectRow[] {
  const m = new Map<string, ProjectRow>()
  for (const e of events) {
    const key = label(e.project_key)
    const row = m.get(key) ?? { project: key, events: 0, credits: 0, usd: 0, sidechain_usd: 0 }
    row.events += 1
    row.credits += creditsOfEvent(e, cpm, hypothesis)
    const c = hasPricing(e.model) ? costOfEvent(e) : 0
    row.usd += c
    if (e.is_sidechain) row.sidechain_usd += c
    m.set(key, row)
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd)
}
