import { describe, it, expect } from 'vitest'
import { activityLanes, IDLE_GAP_MIN } from '../src/engine/activity.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

const at = (iso: string) => ev({ model: 'claude-sonnet-5-5', output_tokens: 1000, ts_utc: iso })
const TZ = 'UTC'

describe('the fragmented activity log', () => {
  it('requests close together merge into ONE fragment', () => {
    const l = activityLanes([
      at('2026-10-20T09:00:00Z'), at('2026-10-20T09:05:00Z'), at('2026-10-20T09:11:00Z'),
    ], TZ, CPM, 'all')
    expect(l).toHaveLength(1)
    expect(l[0]!.fragments).toHaveLength(1)
    expect(l[0]!.fragments[0]!.requests).toBe(3)
  })

  it(`a gap over ${IDLE_GAP_MIN} minutes SPLITS the fragment, because that is a real pause`, () => {
    const l = activityLanes([
      at('2026-10-20T09:00:00Z'),
      at('2026-10-20T09:40:00Z'), at('2026-10-20T09:45:00Z'),
    ], TZ, CPM, 'all')
    expect(l[0]!.fragments).toHaveLength(2)
    expect(l[0]!.fragments[0]!.requests).toBe(1)
    expect(l[0]!.fragments[1]!.requests).toBe(2)
  })

  it('exactly at the threshold it does not split yet (lower bound)', () => {
    const l = activityLanes([
      at('2026-10-20T09:00:00Z'), at(`2026-10-20T09:${IDLE_GAP_MIN}:00Z`),
    ], TZ, CPM, 'all')
    expect(l[0]!.fragments).toHaveLength(1)
  })

  it('a one-request fragment still has a visible width, not 0', () => {
    const l = activityLanes([at('2026-10-20T09:00:00Z')], TZ, CPM, 'all')
    const f = l[0]!.fragments[0]!
    expect(f.end_min).toBeGreaterThan(f.start_min)
  })

  it('a burst running past MIDNIGHT splits into two fragments on two lanes', () => {
    const l = activityLanes([
      at('2026-10-20T23:55:00Z'), at('2026-10-21T00:02:00Z'),
    ], TZ, CPM, 'all')
    expect(l).toHaveLength(2)
    expect(l[0]!.fragments).toHaveLength(1)
    expect(l[1]!.fragments).toHaveLength(1)
  })

  it('a fragment sits at the right place in the day (minutes, not whole hours)', () => {
    const l = activityLanes([at('2026-10-20T14:37:00Z')], TZ, CPM, 'all')
    expect(l[0]!.fragments[0]!.start_min).toBe(14 * 60 + 37)
  })

  it('timezone aware: one UTC instant falls on different days in different zones', () => {
    const e = [at('2026-10-20T17:30:00Z')]
    expect(activityLanes(e, 'UTC', CPM, 'all')[0]!.day).toBe('2026-10-20')
    expect(activityLanes(e, 'Asia/Tokyo', CPM, 'all')[0]!.day).toBe('2026-10-21')
  })

  it('lanes come back in ascending time order and are cut to the requested number of days', () => {
    const e = Array.from({ length: 10 }, (_, i) => at(`2026-10-${String(10 + i).padStart(2, '0')}T09:00:00Z`))
    const l = activityLanes(e, TZ, CPM, 'all', 3)
    expect(l).toHaveLength(3)
    expect(l.map((x) => x.day)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19'])
  })

  it('no events gives no lanes and does NOT throw', () => {
    expect(activityLanes([], TZ, CPM, 'all')).toEqual([])
  })

  it('a broken timestamp is skipped instead of breaking the whole chart', () => {
    const l = activityLanes([ev({ ts_utc: 'not-a-date' }), at('2026-10-20T09:00:00Z')], TZ, CPM, 'all')
    expect(l).toHaveLength(1)
    expect(l[0]!.requests).toBe(1)
  })
})

describe('the window is measured from the NEWEST event, not from now', () => {
  it('data a year old still renders instead of an empty chart', () => {
    const old = ['2019-03-01', '2019-03-02', '2019-03-03']
      .map((d) => ev({ model: 'claude-sonnet-5-5', output_tokens: 10, ts_utc: `${d}T09:00:00Z` }))
    const l = activityLanes(old, 'UTC', CPM, 'all', 30)
    expect(l, 'filtering by Date.now() would give an empty array here').toHaveLength(3)
  })
})
