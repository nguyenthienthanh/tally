import type { UsageEvent, Grain } from '../types.js'

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      // `minute` was dropped once because nothing read it. The fragmented activity log
      // needs minute precision, so it came back TOGETHER WITH the code that reads it.
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    })
    fmtCache.set(tz, f)
  }
  return f
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** The ONE place that turns a UTC timestamp into local parts. */
export function localParts(tsUtc: string, tz: string): LocalParts {
  const parts = fmt(tz).formatToParts(new Date(tsUtc))
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0'
  // With hour12:false some runtimes return '24' for midnight.
  const hour = Number(get('hour')) % 24
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour, minute: Number(get('minute')) % 60, weekday: WEEKDAY[get('weekday')] ?? 0,
  }
}

const p2 = (n: number): string => String(n).padStart(2, '0')

export function bucketKey(tsUtc: string, tz: string, grain: Grain): string {
  const p = localParts(tsUtc, tz)
  switch (grain) {
    case 'year': return `${p.year}`
    case 'month': return `${p.year}-${p2(p.month)}`
    case 'day': return `${p.year}-${p2(p.month)}-${p2(p.day)}`
    case 'hour': return `${p.year}-${p2(p.month)}-${p2(p.day)}T${p2(p.hour)}`
  }
}

export interface Bucket { key: string; events: number; input: number; output: number }

export function rollup(events: UsageEvent[], tz: string, grain: Grain): Bucket[] {
  const m = new Map<string, Bucket>()
  for (const e of events) {
    const key = bucketKey(e.ts_utc, tz, grain)
    const b = m.get(key) ?? { key, events: 0, input: 0, output: 0 }
    b.events += 1; b.input += e.input_tokens; b.output += e.output_tokens
    m.set(key, b)
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export interface Window5h { startUtc: string; endUtc: string; credits: number }
const FIVE_H_MS = 5 * 3600 * 1000

/**
 * A ROLLING 5-hour window. The plan limit rolls, it does not snap to the clock.
 * Each event opens a window [t, t+5h); two pointers make it O(n) after the sort.
 */
export function slidingWindows5h(
  events: UsageEvent[], creditsOf: (e: UsageEvent) => number,
): Window5h[] {
  if (events.length === 0) return []
  const rows = events
    .map((e) => ({ t: Date.parse(e.ts_utc), c: creditsOf(e) }))
    .sort((a, b) => a.t - b.t)
  const out: Window5h[] = []
  let j = 0, sum = 0
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0) { sum -= rows[i - 1]!.c; if (j < i) j = i }
    while (j < rows.length && rows[j]!.t < rows[i]!.t + FIVE_H_MS) { sum += rows[j]!.c; j += 1 }
    out.push({
      startUtc: new Date(rows[i]!.t).toISOString(),
      endUtc: new Date(rows[i]!.t + FIVE_H_MS).toISOString(),
      credits: sum,
    })
  }
  return out
}
