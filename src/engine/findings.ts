import type { UsageEvent, Finding } from '../types.js'
import { costOfEvent, hasPricing } from './cost.js'
import { creditsOfEvent, type Hypothesis } from './credits.js'
import { slidingWindows5h } from './buckets.js'
import { PRICING, CACHE_WRITE_1H_FACTOR, CACHE_WRITE_5M_FACTOR } from '../data/pricing.js'

/** A safe max(): `Math.max(...array)` blows the stack around 10^5 arguments, and this machine had 61k events. */
function maxOf(xs: number[]): number {
  let m = -Infinity
  for (const x of xs) if (x > m) m = x
  return m
}

const SEVERITY_RANK: Record<Finding['severity'], number> = { high: 0, medium: 1, low: 2 }
import { CACHE_READ_FACTOR, CACHE_READ_FACTOR_DEFAULT } from '../data/pricing.js'

/** One tier down, used to compute "how much a downgrade would save". */
const DOWNGRADE: Record<string, string> = {
  'claude-fable-5-1': 'claude-opus-5-5', 'claude-fable-5': 'claude-opus-5-5',
  'claude-opus-5-5': 'claude-sonnet-5-5', 'claude-opus-5': 'claude-sonnet-5-5',
  'claude-opus-4-8': 'claude-sonnet-5-5', 'claude-opus-4-7': 'claude-sonnet-5-5',
  'claude-opus-4-6': 'claude-sonnet-5-5',
  'claude-sonnet-5-5': 'claude-haiku-4-5', 'claude-sonnet-5': 'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-haiku-4-5',
}

export const THRESHOLDS = {
  /** A 1h cache write costs 2x, so it needs at least 3 reads to break even against a 5m TTL. */
  cache1hMinReads: 3,
  cacheHitMin: 0.5,
  cacheHitMinRequests: 10,
  subagentShareMax: 0.5,
  overkillMaxOutput: 500,
  overkillMinCount: 20,
  ceilingPct: 0.8,
} as const

const EXPENSIVE = /^claude-(opus|fable|mythos)/
const HIGH_EFFORT = new Set(['high', 'xhigh', 'max'])

function safeCost(e: UsageEvent): number { return hasPricing(e.model) ? costOfEvent(e) : 0 }
function bySession(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const m = new Map<string, UsageEvent[]>()
  for (const e of events) { const a = m.get(e.session_id) ?? []; a.push(e); m.set(e.session_id, a) }
  return m
}

/**
 * Every finding MUST carry a damage figure in money or credits. No figure, no finding (DD-10).
 *
 * `hypothesis` is a required parameter: the credit hypothesis is decided in ONE place,
 * the calibration result. Hard-coding 'all' here once inflated the damage by about 200x.
 */
export function detectFindings(
  events: UsageEvent[],
  /** null means the plan ceiling could not be read: skip every check that needs it rather than inventing 200,000. */
  ceiling: number | null,
  hypothesis: Hypothesis,
  /** Credits of the window the hypothesis was fitted on, used to flag extrapolation. */
  fittedOnCredits: number | null,
  /** The credit table. It MUST come from the source decided upstream (live preferred).
   *  Reaching for the fallback table in here scores a live-only model at 0 credits and
   *  disables a whole finding IN SILENCE. */
  cpm: Record<string, number>,
): Finding[] {
  if (events.length === 0) return []
  const out: Finding[] = []
  const sessions = bySession(events)

  // ── WASTE_CACHE_1H ───────────────────────────────────────────────────────────
  {
    const bad: string[] = []
    let w1h = 0, usd = 0
    for (const [sid, evs] of sessions) {
      const w = evs.reduce((s, e) => s + e.cache_write_1h, 0)
      if (w === 0) continue
      const reads = evs.reduce((s, e) => s + e.cache_read, 0)
      if (reads / w >= THRESHOLDS.cache1hMinReads) continue
      bad.push(sid); w1h += w
      for (const e of evs) {
        const p = PRICING[e.model]
        if (!p || e.cache_write_1h === 0) continue
        usd += e.cache_write_1h * (CACHE_WRITE_1H_FACTOR - CACHE_WRITE_5M_FACTOR) * p.in / 1e6
      }
    }
    if (bad.length > 0 && usd > 0) {
      out.push({
        id: 'WASTE_CACHE_1H', severity: 'high', damage_kind: 'saving',
        metric: { sessions: bad.length, cache_write_1h_tokens: w1h },
        damage: { usd },
        action: 'Use the 5-minute TTL, or keep the cache warm with a keep-alive, instead of paying the 2x write for a 1-hour TTL.',
        sample_sessions: bad.slice(0, 5),
      })
    }
  }

  // ── WASTE_CACHE_MISS ─────────────────────────────────────────────────────────
  {
    const bad: string[] = []
    let usd = 0
    for (const [sid, evs] of sessions) {
      if (evs.length < THRESHOLDS.cacheHitMinRequests) continue
      const read = evs.reduce((s, e) => s + e.cache_read, 0)
      const input = evs.reduce((s, e) => s + e.input_tokens, 0)
      if (input + read === 0) continue
      if (read / (input + read) >= THRESHOLDS.cacheHitMin) continue
      bad.push(sid)
      for (const e of evs) {
        const p = PRICING[e.model]
        if (!p) continue
        // The saveable share is 1 minus the cache-read factor OF THAT MODEL.
        // Hard-coding 0.9 duplicates CACHE_READ_FACTOR_DEFAULT and is wrong for opus-5-5 (0.05).
        const saved = 1 - (CACHE_READ_FACTOR[e.model] ?? CACHE_READ_FACTOR_DEFAULT)
        usd += e.input_tokens * saved * p.in / 1e6
      }
    }
    if (bad.length > 0 && usd > 0) {
      out.push({
        id: 'WASTE_CACHE_MISS', severity: 'medium', damage_kind: 'saving',
        metric: { sessions: bad.length },
        damage: { usd },
        action: 'Find what breaks the cache in the prompt: timestamps, unsorted JSON, a tool list that changes.',
        sample_sessions: bad.slice(0, 5),
      })
    }
  }

  // ── SUBAGENT_HEAVY ───────────────────────────────────────────────────────────
  {
    const bad: string[] = []
    let credits = 0
    for (const [sid, evs] of sessions) {
      const total = evs.reduce((s, e) => s + safeCost(e), 0)
      if (total <= 0) continue
      const side = evs.filter((e) => e.is_sidechain)
      const share = side.reduce((s, e) => s + safeCost(e), 0) / total
      if (share <= THRESHOLDS.subagentShareMax) continue
      bad.push(sid)
      // The damage is what a downgrade WOULD SAVE, not the entire subagent spend. Nobody
      // removes all subagents, so calling the whole bill "damage" overstates it.
      for (const e of side) {
        const down = DOWNGRADE[e.model]
        if (!down || cpm[down] === undefined || cpm[e.model] === undefined) continue
        const save = creditsOfEvent(e, cpm, hypothesis) - creditsOfEvent({ ...e, model: down }, cpm, hypothesis)
        if (save > 0) credits += save
      }
    }
    if (bad.length > 0 && credits > 0) {
      out.push({
        id: 'SUBAGENT_HEAVY', severity: 'medium', damage_kind: 'saving',
        metric: { sessions: bad.length, scope: 'lifetime' },
        damage: { credits },
        action: 'Drop the model for search and read subagents. Do not let them inherit the expensive model of the main session.',
        sample_sessions: bad.slice(0, 5),
      })
    }
  }

  // ── OVERKILL_MODEL ───────────────────────────────────────────────────────────
  {
    const hits = events.filter((e) =>
      (EXPENSIVE.test(e.model) || (e.effort !== null && HIGH_EFFORT.has(e.effort))) &&
      e.output_tokens < THRESHOLDS.overkillMaxOutput && e.tool_calls === 0)
    if (hits.length > THRESHOLDS.overkillMinCount) {
      let credits = 0
      for (const e of hits) {
        const down = DOWNGRADE[e.model]
        if (!down || cpm[down] === undefined || cpm[e.model] === undefined) continue
        // BOTH sides must use the same hypothesis. Using 'all' on the downgraded side made
        // the CHEAPER model score HIGHER credits, the difference went negative, and the
        // finding never fired.
        credits += creditsOfEvent(e, cpm, hypothesis) - creditsOfEvent({ ...e, model: down }, cpm, hypothesis)
      }
      if (credits > 0) {
        out.push({
          id: 'OVERKILL_MODEL', severity: 'medium', damage_kind: 'saving',
          metric: { requests: hits.length },
          damage: { credits },
          action: 'Drop one model tier, or lower the effort, for short turns that call no tools.',
          sample_sessions: [...new Set(hits.map((e) => e.session_id))].slice(0, 5),
        })
      }
    }
  }

  // -- CEILING_RISK: only assessable when the ceiling is KNOWN ------------------
  if (ceiling !== null && ceiling > 0) {
    const wins = slidingWindows5h(events, (e) => creditsOfEvent(e, cpm, hypothesis))
    const over = wins.filter((w) => w.credits > THRESHOLDS.ceilingPct * ceiling)
    if (over.length > 0) {
      const peak = maxOf(over.map((w) => w.credits))
      // The fit was made on ONE window. A window several times heavier is an EXTRAPOLATION and must say so.
      const extrapolated = typeof fittedOnCredits === 'number' && fittedOnCredits > 0
        && peak > fittedOnCredits * 3
      out.push({
        id: 'CEILING_RISK', severity: 'high', damage_kind: 'peak',
        metric: {
          windows_over_80pct: over.length, peak_credits: Math.round(peak), ceiling,
          ...(extrapolated ? { extrapolated: 'uoc-luong-ngoai-suy' } : {}),
        },
        damage: { credits: peak },
        action: 'Move heavy work out of the peak 5-hour window, or drop the model for the light parts.',
        sample_sessions: [],
      })
    }
  }

  // Sort by severity first, then by amount inside the same severity. Sorting by severity
  // alone put "could save 447,664 credits" below "$105.91", which is correct and absurd
  // to a reader. Credits are not converted into USD: two different units, compare inside
  // a unit and leave the order alone across units.
  const sorted = out.sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (r !== 0) return r
    const ac = a.damage.credits, bc = b.damage.credits
    if (ac !== undefined && bc !== undefined) return bc - ac
    const au = a.damage.usd, bu = b.damage.usd
    if (au !== undefined && bu !== undefined) return bu - au
    return 0
  })
  // The rank is emitted here so the "priority" label is not invented by the UI.
  return sorted.map((f, i) => ({ ...f, rank: i + 1 }))
}
