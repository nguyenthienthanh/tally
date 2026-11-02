import { describe, it, expect } from 'vitest'
import { summarizeSessions, filterByScope, ACTIVE_WITHIN_MIN } from '../src/engine/sessions.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

const NOW = Date.parse('2026-10-29T12:00:00.000Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const e = (sid: string, min: number, o = {}) =>
  ev({ session_id: sid, model: 'claude-sonnet-5-5', output_tokens: 1000, ts_utc: ago(min), ...o })

describe('grouping by session', () => {
  const events = [
    e('s-live', 2), e('s-live', 9), e('s-live', 30),
    e('s-idle', 40), e('s-idle', 70),
    e('s-old', 5000),
  ]
  const sum = summarizeSessions(events, CPM, 'all', NOW)

  it('one row per session, ordered by last activity', () => {
    expect(sum.rows.map((r) => r.session_id)).toEqual(['s-live', 's-idle', 's-old'])
    expect(sum.total).toBe(3)
  })

  it(`"running" means quiet for under ${ACTIVE_WITHIN_MIN} minutes, and the count is right`, () => {
    expect(sum.rows[0]!.active).toBe(true)
    expect(sum.rows[1]!.active).toBe(false)
    expect(sum.active_count).toBe(1)
    expect(sum.active_within_min).toBe(ACTIVE_WITHIN_MIN)
  })

  it('exactly at the threshold it still counts as running (lower bound)', () => {
    const r = summarizeSessions([e('x', ACTIVE_WITHIN_MIN)], CPM, 'all', NOW)
    expect(r.rows[0]!.active).toBe(true)
    const r2 = summarizeSessions([e('x', ACTIVE_WITHIN_MIN + 1)], CPM, 'all', NOW)
    expect(r2.rows[0]!.active).toBe(false)
  })

  it('duration and idle time are computed correctly in minutes', () => {
    const live = sum.rows.find((r) => r.session_id === 's-live')!
    expect(live.duration_min).toBe(28)   // from 30 minutes ago to 2 minutes ago
    expect(live.idle_min).toBe(2)
  })

  it('the subagent share is separated out', () => {
    const r = summarizeSessions([
      e('s', 1), e('s', 2, { is_sidechain: true }), e('s', 3, { is_sidechain: true }),
    ], CPM, 'all', NOW)
    expect(r.rows[0]!.requests).toBe(3)
    expect(r.rows[0]!.sidechain_requests).toBe(2)
    expect(r.rows[0]!.sidechain_usd).toBeGreaterThan(0)
    expect(r.rows[0]!.sidechain_usd).toBeLessThan(r.rows[0]!.usd)
  })

  it('a session using a model with no rate sets credits_known false instead of quietly becoming 0', () => {
    const r = summarizeSessions([e('s', 1, { model: 'claude-model-chua-co-trong-bang' })], CPM, 'all', NOW)
    expect(r.rows[0]!.credits_known).toBe(false)
  })

  it('newest_utc says how fresh the data is', () => {
    expect(sum.newest_utc).toBe(ago(2))
  })

  it('no events does not throw and leaves newest_utc null', () => {
    const r = summarizeSessions([], CPM, 'all', NOW)
    expect(r.rows).toEqual([])
    expect(r.newest_utc).toBeNull()
  })
})

describe('scope filtering: ONE gate for every page', () => {
  const events = [e('s-live', 2), e('s-idle', 60), e('s-idle', 61), e('s-old', 9000)]
  const sum = summarizeSessions(events, CPM, 'all', NOW)

  it('all returns everything untouched', () => {
    expect(filterByScope(events, 'all', sum)).toHaveLength(4)
  })

  it('active returns only events from running sessions', () => {
    const f = filterByScope(events, 'active', sum)
    expect(f).toHaveLength(1)
    expect(f[0]!.session_id).toBe('s-live')
  })

  it('a specific session_id returns exactly that session', () => {
    const f = filterByScope(events, 's-idle', sum)
    expect(f).toHaveLength(2)
    expect(f.every((x) => x.session_id === 's-idle')).toBe(true)
  })

  it('an unknown id returns empty, never throws, and never quietly falls back to everything', () => {
    expect(filterByScope(events, 'khong-co-phien-nay', sum)).toHaveLength(0)
  })

  it('with nothing running, active returns empty instead of falling back to everything', () => {
    const quiet = [e('a', 600), e('b', 700)]
    const s2 = summarizeSessions(quiet, CPM, 'all', NOW)
    expect(s2.active_count).toBe(0)
    expect(filterByScope(quiet, 'active', s2)).toHaveLength(0)
  })
})
