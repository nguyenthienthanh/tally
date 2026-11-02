import type { UsageEvent } from '../types.js'
import { creditsOfEvent, type Hypothesis } from './credits.js'
import { costOfEvent, hasPricing } from './cost.js'

/**
 * Grouping by SESSION.
 *
 * The 5-hour window answers exactly one question: "am I about to hit the ceiling".
 * It cannot answer "which session is burning it", "what has that running one cost so
 * far" or "what did I do in that session yesterday". A session is the unit people
 * actually think in.
 */

/**
 * Quiet for longer than this and a session counts as finished.
 *
 * This is INFERRED from timestamps, not read from the process table: a session left
 * open in a terminal while someone makes coffee for 20 minutes is counted as finished.
 * The page has to state this threshold rather than let the reader take it for truth.
 */
export const ACTIVE_WITHIN_MIN = 15

export interface SessionRow {
  session_id: string
  project_key: string
  git_branch: string | null
  first_utc: string
  last_utc: string
  /** Minutes from the first event to the last. */
  duration_min: number
  /** Minutes from the last event to `nowMs`. */
  idle_min: number
  active: boolean
  requests: number
  sidechain_requests: number
  credits: number
  /** False when the session used a model with no known rate. Unknown is not zero. */
  credits_known: boolean
  usd: number
  sidechain_usd: number
  models: string[]
  entrypoints: string[]
}

export interface SessionsSummary {
  rows: SessionRow[]
  total: number
  active_count: number
  active_within_min: number
  /** The reference point for "running", so the page can say how stale the data is. */
  newest_utc: string | null
}

export type Scope = 'all' | 'active'

export function summarizeSessions(
  events: UsageEvent[],
  cpm: Record<string, number>,
  hypothesis: Hypothesis,
  nowMs = Date.now(),
): SessionsSummary {
  const acc = new Map<string, {
    first: number; last: number; req: number; side: number; credits: number
    usd: number; sideUsd: number; unknown: boolean
    models: Set<string>; entries: Set<string>; project: string; branch: string | null
  }>()
  let newest = -Infinity

  for (const e of events) {
    const t = Date.parse(e.ts_utc)
    if (!Number.isFinite(t)) continue
    if (t > newest) newest = t
    let a = acc.get(e.session_id)
    if (!a) {
      a = {
        first: t, last: t, req: 0, side: 0, credits: 0, usd: 0, sideUsd: 0, unknown: false,
        models: new Set(), entries: new Set(), project: e.project_key, branch: e.git_branch,
      }
      acc.set(e.session_id, a)
    }
    if (t < a.first) a.first = t
    if (t > a.last) a.last = t
    a.req += 1
    if (e.is_sidechain) a.side += 1
    if (cpm[e.model] === undefined) a.unknown = true
    a.credits += creditsOfEvent(e, cpm, hypothesis)
    const c = hasPricing(e.model) ? costOfEvent(e) : 0
    a.usd += c
    if (e.is_sidechain) a.sideUsd += c
    a.models.add(e.model)
    if (e.entrypoint) a.entries.add(e.entrypoint)
  }

  const rows: SessionRow[] = [...acc.entries()].map(([session_id, a]) => {
    const idle = (nowMs - a.last) / 60_000
    return {
      session_id,
      project_key: a.project,
      git_branch: a.branch,
      first_utc: new Date(a.first).toISOString(),
      last_utc: new Date(a.last).toISOString(),
      duration_min: Math.round((a.last - a.first) / 60_000),
      idle_min: Math.max(0, Math.round(idle)),
      active: idle <= ACTIVE_WITHIN_MIN,
      requests: a.req,
      sidechain_requests: a.side,
      credits: a.credits,
      credits_known: !a.unknown,
      usd: a.usd,
      sidechain_usd: a.sideUsd,
      models: [...a.models].sort(),
      entrypoints: [...a.entries].sort(),
    }
  }).sort((x, y) => Date.parse(y.last_utc) - Date.parse(x.last_utc))

  return {
    rows,
    total: rows.length,
    active_count: rows.filter((r) => r.active).length,
    active_within_min: ACTIVE_WITHIN_MIN,
    newest_utc: newest === -Infinity ? null : new Date(newest).toISOString(),
  }
}

/** Filter events by the selected scope. One gate, shared by every page. */
export function filterByScope(
  events: UsageEvent[],
  scope: Scope | string,
  sessions: SessionsSummary,
): UsageEvent[] {
  if (scope === 'all') return events
  if (scope === 'active') {
    const ids = new Set(sessions.rows.filter((r) => r.active).map((r) => r.session_id))
    return events.filter((e) => ids.has(e.session_id))
  }
  // Any other string is read as one specific session_id.
  return events.filter((e) => e.session_id === scope)
}
