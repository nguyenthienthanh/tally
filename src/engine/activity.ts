import type { UsageEvent } from '../types.js'
import { localParts } from './buckets.js'
import { creditsOfEvent, type Hypothesis } from './credits.js'

/**
 * The activity log as FRAGMENTS.
 *
 * Working with Claude Code is not evenly spread. It arrives in bursts separated by long
 * idle stretches. Drawing it as one bar per day lies about the real rhythm: a day with
 * 400 requests packed into 40 minutes looks exactly like a day spread over 12 hours.
 *
 * Here each BURST is its own fragment, placed where it happened in the day and as wide
 * as it lasted. The gaps between fragments are real gaps.
 */

/** A gap longer than this starts a new burst. */
export const IDLE_GAP_MIN = 15

export interface Fragment {
  /** Minute of the local day, [0, 1440). */
  start_min: number
  /** Always > start_min. A one-request burst still gets a minimum width so it stays visible. */
  end_min: number
  requests: number
  credits: number
}

export interface DayLane {
  /** YYYY-MM-DD in the selected timezone. */
  day: string
  weekday: number
  fragments: Fragment[]
  requests: number
  credits: number
}

/** Minimum fragment width, so a short burst does not vanish from the screen. */
const MIN_WIDTH_MIN = 4

const pad = (n: number): string => String(n).padStart(2, '0')

export function activityLanes(
  events: UsageEvent[],
  tz: string,
  cpm: Record<string, number>,
  hypothesis: Hypothesis,
  days = 30,
): DayLane[] {
  // Filter BEFORE sorting: copying and sorting all 61k events only to keep 30 days is
  // paying for what you throw away, and that cost lands on page load.
  //
  // The cutoff is measured from the NEWEST event, not from now: "the last 30 days" has
  // to mean 30 days that have data, or someone back from a week off opens an empty chart.
  let newest = -Infinity
  for (const e of events) {
    const t = Date.parse(e.ts_utc)
    if (Number.isFinite(t) && t > newest) newest = t
  }
  if (newest === -Infinity) return []
  const cutoff = newest - (days + 2) * 86_400_000
  const sorted = events
    .filter((e) => {
      const t = Date.parse(e.ts_utc)
      return Number.isFinite(t) && t >= cutoff
    })
    .sort((a, b) => Date.parse(a.ts_utc) - Date.parse(b.ts_utc))
  const lanes = new Map<string, DayLane>()

  let lastT = -Infinity
  let cur: Fragment | null = null
  let curDay = ''

  const close = (): void => {
    if (!cur || !curDay) return
    if (cur.end_min - cur.start_min < MIN_WIDTH_MIN) cur.end_min = cur.start_min + MIN_WIDTH_MIN
    if (cur.end_min > 1440) cur.end_min = 1440
    lanes.get(curDay)!.fragments.push(cur)
    cur = null
  }

  for (const e of sorted) {
    const t = Date.parse(e.ts_utc)
    if (!Number.isFinite(t)) continue
    const p = localParts(e.ts_utc, tz)
    const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`
    const minute = p.hour * 60 + p.minute

    if (!lanes.has(day)) {
      lanes.set(day, { day, weekday: p.weekday, fragments: [], requests: 0, credits: 0 })
    }
    const lane = lanes.get(day)!
    const c = creditsOfEvent(e, cpm, hypothesis)
    lane.requests += 1
    lane.credits += c

    // A day change also breaks a fragment: each lane only draws its own day, so a burst
    // running past midnight becomes two fragments, which is what the reader actually saw.
    const broke = day !== curDay || (t - lastT) / 60_000 > IDLE_GAP_MIN
    if (broke) {
      close()
      curDay = day
      cur = { start_min: minute, end_min: minute, requests: 0, credits: 0 }
    }
    cur!.end_min = Math.max(cur!.end_min, minute)
    cur!.requests += 1
    cur!.credits += c
    lastT = t
  }
  close()

  return [...lanes.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, days)
    .reverse()
}
