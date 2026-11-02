import { describe, it, expect } from 'vitest'
import { summarizeSessions, filterByScope, ACTIVE_WITHIN_MIN } from '../src/engine/sessions.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

const NOW = Date.parse('2026-10-29T12:00:00.000Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const e = (sid: string, min: number, o = {}) =>
  ev({ session_id: sid, model: 'claude-sonnet-5-5', output_tokens: 1000, ts_utc: ago(min), ...o })

describe('gom theo phiên', () => {
  const events = [
    e('s-live', 2), e('s-live', 9), e('s-live', 30),
    e('s-idle', 40), e('s-idle', 70),
    e('s-old', 5000),
  ]
  const sum = summarizeSessions(events, CPM, 'all', NOW)

  it('mỗi phiên một dòng, xếp theo lần cuối hoạt động', () => {
    expect(sum.rows.map((r) => r.session_id)).toEqual(['s-live', 's-idle', 's-old'])
    expect(sum.total).toBe(3)
  })

  it(`"đang chạy" = im dưới ${ACTIVE_WITHIN_MIN} phút, và đếm đúng`, () => {
    expect(sum.rows[0]!.active).toBe(true)
    expect(sum.rows[1]!.active).toBe(false)
    expect(sum.active_count).toBe(1)
    expect(sum.active_within_min).toBe(ACTIVE_WITHIN_MIN)
  })

  it('đúng ngưỡng vẫn tính là đang chạy (biên dưới)', () => {
    const r = summarizeSessions([e('x', ACTIVE_WITHIN_MIN)], CPM, 'all', NOW)
    expect(r.rows[0]!.active).toBe(true)
    const r2 = summarizeSessions([e('x', ACTIVE_WITHIN_MIN + 1)], CPM, 'all', NOW)
    expect(r2.rows[0]!.active).toBe(false)
  })

  it('kéo dài và im lặng tính đúng bằng phút', () => {
    const live = sum.rows.find((r) => r.session_id === 's-live')!
    expect(live.duration_min).toBe(28)   // từ 30 phút trước tới 2 phút trước
    expect(live.idle_min).toBe(2)
  })

  it('tách được phần subagent', () => {
    const r = summarizeSessions([
      e('s', 1), e('s', 2, { is_sidechain: true }), e('s', 3, { is_sidechain: true }),
    ], CPM, 'all', NOW)
    expect(r.rows[0]!.requests).toBe(3)
    expect(r.rows[0]!.sidechain_requests).toBe(2)
    expect(r.rows[0]!.sidechain_usd).toBeGreaterThan(0)
    expect(r.rows[0]!.sidechain_usd).toBeLessThan(r.rows[0]!.usd)
  })

  it('phiên có model chưa biết hệ số ⇒ credits_known false, KHÔNG âm thầm thành 0', () => {
    const r = summarizeSessions([e('s', 1, { model: 'claude-model-chua-co-trong-bang' })], CPM, 'all', NOW)
    expect(r.rows[0]!.credits_known).toBe(false)
  })

  it('newest_utc cho biết dữ liệu mới tới đâu', () => {
    expect(sum.newest_utc).toBe(ago(2))
  })

  it('không có sự kiện ⇒ không ném, newest_utc null', () => {
    const r = summarizeSessions([], CPM, 'all', NOW)
    expect(r.rows).toEqual([])
    expect(r.newest_utc).toBeNull()
  })
})

describe('lọc theo phạm vi — MỘT cổng duy nhất cho mọi trang', () => {
  const events = [e('s-live', 2), e('s-idle', 60), e('s-idle', 61), e('s-old', 9000)]
  const sum = summarizeSessions(events, CPM, 'all', NOW)

  it('tất cả ⇒ nguyên vẹn', () => {
    expect(filterByScope(events, 'all', sum)).toHaveLength(4)
  })

  it('đang chạy ⇒ chỉ sự kiện của phiên đang chạy', () => {
    const f = filterByScope(events, 'active', sum)
    expect(f).toHaveLength(1)
    expect(f[0]!.session_id).toBe('s-live')
  })

  it('một session_id cụ thể ⇒ đúng phiên đó', () => {
    const f = filterByScope(events, 's-idle', sum)
    expect(f).toHaveLength(2)
    expect(f.every((x) => x.session_id === 's-idle')).toBe(true)
  })

  it('id không tồn tại ⇒ rỗng, không ném và KHÔNG âm thầm trả về tất cả', () => {
    expect(filterByScope(events, 'khong-co-phien-nay', sum)).toHaveLength(0)
  })

  it('không phiên nào đang chạy ⇒ "đang chạy" trả rỗng, không rơi về tất cả', () => {
    const quiet = [e('a', 600), e('b', 700)]
    const s2 = summarizeSessions(quiet, CPM, 'all', NOW)
    expect(s2.active_count).toBe(0)
    expect(filterByScope(quiet, 'active', s2)).toHaveLength(0)
  })
})
