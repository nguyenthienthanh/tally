import { describe, it, expect } from 'vitest'
import { activityLanes, IDLE_GAP_MIN } from '../src/engine/activity.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

const at = (iso: string) => ev({ model: 'claude-sonnet-5-5', output_tokens: 1000, ts_utc: iso })
const TZ = 'UTC'

describe('nhật ký hoạt động dạng mảnh', () => {
  it('các request sát nhau gộp thành MỘT mảnh', () => {
    const l = activityLanes([
      at('2026-10-20T09:00:00Z'), at('2026-10-20T09:05:00Z'), at('2026-10-20T09:11:00Z'),
    ], TZ, CPM, 'all')
    expect(l).toHaveLength(1)
    expect(l[0]!.fragments).toHaveLength(1)
    expect(l[0]!.fragments[0]!.requests).toBe(3)
  })

  it(`cách nhau quá ${IDLE_GAP_MIN} phút thì TÁCH mảnh — đó là khoảng nghỉ thật`, () => {
    const l = activityLanes([
      at('2026-10-20T09:00:00Z'),
      at('2026-10-20T09:40:00Z'), at('2026-10-20T09:45:00Z'),
    ], TZ, CPM, 'all')
    expect(l[0]!.fragments).toHaveLength(2)
    expect(l[0]!.fragments[0]!.requests).toBe(1)
    expect(l[0]!.fragments[1]!.requests).toBe(2)
  })

  it('đúng ngưỡng thì CHƯA tách (biên dưới)', () => {
    const l = activityLanes([
      at('2026-10-20T09:00:00Z'), at(`2026-10-20T09:${IDLE_GAP_MIN}:00Z`),
    ], TZ, CPM, 'all')
    expect(l[0]!.fragments).toHaveLength(1)
  })

  it('mảnh một request vẫn có bề rộng để nhìn thấy, không phải 0', () => {
    const l = activityLanes([at('2026-10-20T09:00:00Z')], TZ, CPM, 'all')
    const f = l[0]!.fragments[0]!
    expect(f.end_min).toBeGreaterThan(f.start_min)
  })

  it('đợt chạy qua NỬA ĐÊM tách thành hai mảnh ở hai làn', () => {
    const l = activityLanes([
      at('2026-10-20T23:55:00Z'), at('2026-10-21T00:02:00Z'),
    ], TZ, CPM, 'all')
    expect(l).toHaveLength(2)
    expect(l[0]!.fragments).toHaveLength(1)
    expect(l[1]!.fragments).toHaveLength(1)
  })

  it('mảnh nằm đúng chỗ trong ngày (phút, không phải giờ tròn)', () => {
    const l = activityLanes([at('2026-10-20T14:37:00Z')], TZ, CPM, 'all')
    expect(l[0]!.fragments[0]!.start_min).toBe(14 * 60 + 37)
  })

  it('theo múi giờ: cùng mốc UTC rơi vào ngày khác nhau ở tz khác nhau', () => {
    const e = [at('2026-10-20T17:30:00Z')]
    expect(activityLanes(e, 'UTC', CPM, 'all')[0]!.day).toBe('2026-10-20')
    expect(activityLanes(e, 'Asia/Tokyo', CPM, 'all')[0]!.day).toBe('2026-10-21')
  })

  it('làn xếp theo thứ tự thời gian tăng dần và cắt đúng số ngày yêu cầu', () => {
    const e = Array.from({ length: 10 }, (_, i) => at(`2026-10-${String(10 + i).padStart(2, '0')}T09:00:00Z`))
    const l = activityLanes(e, TZ, CPM, 'all', 3)
    expect(l).toHaveLength(3)
    expect(l.map((x) => x.day)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19'])
  })

  it('không có sự kiện ⇒ không có làn, KHÔNG ném', () => {
    expect(activityLanes([], TZ, CPM, 'all')).toEqual([])
  })

  it('mốc thời gian hỏng bị bỏ qua, không làm sập cả bảng', () => {
    const l = activityLanes([ev({ ts_utc: 'không-phải-ngày' }), at('2026-10-20T09:00:00Z')], TZ, CPM, 'all')
    expect(l).toHaveLength(1)
    expect(l[0]!.requests).toBe(1)
  })
})

describe('cửa sổ tính từ sự kiện MỚI NHẤT, không phải từ bây giờ', () => {
  it('dữ liệu cũ hàng năm vẫn hiện, không ra biểu đồ rỗng', () => {
    const old = ['2019-03-01', '2019-03-02', '2019-03-03']
      .map((d) => ev({ model: 'claude-sonnet-5-5', output_tokens: 10, ts_utc: `${d}T09:00:00Z` }))
    const l = activityLanes(old, 'UTC', CPM, 'all', 30)
    expect(l, 'lọc theo Date.now() sẽ cho mảng rỗng ở đây').toHaveLength(3)
  })
})
