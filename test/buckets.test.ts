import { describe, it, expect } from 'vitest'
import { localParts, bucketKey, slidingWindows5h } from '../src/engine/buckets.js'
import { ev } from './helpers.js'

describe('bucket theo múi giờ ĐỊA PHƯƠNG (AC-4.2)', () => {
  it('17:30Z ngày 28 ⇒ ở GMT+7 là 00:30 ngày 29 (lệch nguyên ngày nếu cắt theo UTC)', () => {
    const p = localParts('2026-10-28T17:30:00.000Z', 'Asia/Ho_Chi_Minh')
    expect(p).toMatchObject({ year: 2026, month: 10, day: 29, hour: 0 })
  })

  it('bucket day/hour/month/year đúng dạng khoá', () => {
    const tz = 'Asia/Ho_Chi_Minh'
    const t = '2026-10-28T17:30:00.000Z'
    expect(bucketKey(t, tz, 'year')).toBe('2026')
    expect(bucketKey(t, tz, 'month')).toBe('2026-10')
    expect(bucketKey(t, tz, 'day')).toBe('2026-10-29')
    expect(bucketKey(t, tz, 'hour')).toBe('2026-10-29T00')
  })

  it('biên NĂM: 31/12 17:00Z ⇒ GMT+7 là năm sau', () => {
    expect(bucketKey('2026-12-31T17:00:00.000Z', 'Asia/Ho_Chi_Minh', 'year')).toBe('2027')
  })

  it('DST: New York 2026-11-01, trước và sau mốc lùi giờ đều ra ngày 01', () => {
    const tz = 'America/New_York'
    expect(bucketKey('2026-11-01T05:30:00.000Z', tz, 'day')).toBe('2026-11-01')
    expect(bucketKey('2026-11-01T06:30:00.000Z', tz, 'day')).toBe('2026-11-01')
  })

  it('cùng một mốc, hai tz khác nhau ⇒ hai bucket khác nhau (không dùng cột cache sai tz)', () => {
    const t = '2026-10-28T17:30:00.000Z'
    expect(bucketKey(t, 'Asia/Ho_Chi_Minh', 'day')).not.toBe(bucketKey(t, 'UTC', 'day'))
  })
})

describe('cửa sổ 5h TRƯỢT (AC-4.4) — khác bucket hour', () => {
  const creditsOf = () => 1000

  it('ba event trong 5 giờ ⇒ có cửa sổ cộng dồn cả ba', () => {
    const events = [
      ev({ ts_utc: '2026-10-29T00:00:00.000Z' }),
      ev({ ts_utc: '2026-10-29T02:00:00.000Z' }),
      ev({ ts_utc: '2026-10-29T04:30:00.000Z' }),
    ]
    const w = slidingWindows5h(events, creditsOf)
    expect(Math.max(...w.map((x) => x.credits))).toBe(3000)
  })

  it('event cách nhau > 5 giờ ⇒ KHÔNG bị cộng vào cùng cửa sổ', () => {
    const events = [
      ev({ ts_utc: '2026-10-29T00:00:00.000Z' }),
      ev({ ts_utc: '2026-10-29T06:00:00.000Z' }),
    ]
    const w = slidingWindows5h(events, creditsOf)
    expect(Math.max(...w.map((x) => x.credits))).toBe(1000)
  })

  it('không có event ⇒ danh sách rỗng (cổng phải đúng ở CẢ HAI đầu)', () => {
    expect(slidingWindows5h([], creditsOf)).toEqual([])
  })
})
