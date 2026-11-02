import { describe, it, expect } from 'vitest'
import { localParts, bucketKey, slidingWindows5h } from '../src/engine/buckets.js'
import { ev } from './helpers.js'

describe('bucketing by LOCAL timezone (AC-4.2)', () => {
  it('17:30Z on the 28th is 00:30 on the 29th at GMT+7, a whole day off if bucketed in UTC', () => {
    const p = localParts('2026-10-28T17:30:00.000Z', 'Asia/Ho_Chi_Minh')
    expect(p).toMatchObject({ year: 2026, month: 10, day: 29, hour: 0 })
  })

  it('day, hour, month and year keys have the right shape', () => {
    const tz = 'Asia/Ho_Chi_Minh'
    const t = '2026-10-28T17:30:00.000Z'
    expect(bucketKey(t, tz, 'year')).toBe('2026')
    expect(bucketKey(t, tz, 'month')).toBe('2026-10')
    expect(bucketKey(t, tz, 'day')).toBe('2026-10-29')
    expect(bucketKey(t, tz, 'hour')).toBe('2026-10-29T00')
  })

  it('year boundary: 31 Dec 17:00Z is already the next year at GMT+7', () => {
    expect(bucketKey('2026-12-31T17:00:00.000Z', 'Asia/Ho_Chi_Minh', 'year')).toBe('2027')
  })

  it('DST: in New York on 2026-11-01, both sides of the fall-back land on day 01', () => {
    const tz = 'America/New_York'
    expect(bucketKey('2026-11-01T05:30:00.000Z', tz, 'day')).toBe('2026-11-01')
    expect(bucketKey('2026-11-01T06:30:00.000Z', tz, 'day')).toBe('2026-11-01')
  })

  it('one timestamp in two timezones gives two buckets, so no cached column from the wrong tz', () => {
    const t = '2026-10-28T17:30:00.000Z'
    expect(bucketKey(t, 'Asia/Ho_Chi_Minh', 'day')).not.toBe(bucketKey(t, 'UTC', 'day'))
  })
})

describe('the ROLLING 5h window (AC-4.4), which is not an hour bucket', () => {
  const creditsOf = () => 1000

  it('three events within five hours produce a window holding all three', () => {
    const events = [
      ev({ ts_utc: '2026-10-29T00:00:00.000Z' }),
      ev({ ts_utc: '2026-10-29T02:00:00.000Z' }),
      ev({ ts_utc: '2026-10-29T04:30:00.000Z' }),
    ]
    const w = slidingWindows5h(events, creditsOf)
    expect(Math.max(...w.map((x) => x.credits))).toBe(3000)
  })

  it('events more than five hours apart are NOT summed into one window', () => {
    const events = [
      ev({ ts_utc: '2026-10-29T00:00:00.000Z' }),
      ev({ ts_utc: '2026-10-29T06:00:00.000Z' }),
    ]
    const w = slidingWindows5h(events, creditsOf)
    expect(Math.max(...w.map((x) => x.credits))).toBe(1000)
  })

  it('no events gives an empty list, because a gate has to be right at BOTH ends', () => {
    expect(slidingWindows5h([], creditsOf)).toEqual([])
  })
})
