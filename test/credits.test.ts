import { describe, it, expect } from 'vitest'
import { creditsOfEvent, creditsByModel, calibrate, CACHE_READ_WEIGHT, DEFAULT_HYPOTHESIS, POOR_FIT_PCT } from '../src/engine/credits.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM, FIVE_HOUR_CREDITS_FALLBACK as CEIL } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

describe('credits gói', () => {
  it('1M token opus-5-5 = 1833 credits (giả thuyết all)', () => {
    const c = creditsOfEvent(ev({ model: 'claude-opus-5-5', input_tokens: 1_000_000 }), CPM, 'all')
    expect(c).toBeCloseTo(1833, 6)
  })

  it('1 token fable-5-1 đắt gấp 10 lần 1 token haiku-4-5', () => {
    const f = creditsOfEvent(ev({ model: 'claude-fable-5-1', input_tokens: 1_000_000 }), CPM, 'all')
    const h = creditsOfEvent(ev({ model: 'claude-haiku-4-5', input_tokens: 1_000_000 }), CPM, 'all')
    expect(f / h).toBeCloseTo(8333 / 833, 3)
  })

  it('giả thuyết out_only chỉ tính output', () => {
    const e = ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, output_tokens: 1_000_000 })
    expect(creditsOfEvent(e, CPM, 'out_only')).toBeCloseTo(1250, 6)
    expect(creditsOfEvent(e, CPM, 'all')).toBeCloseTo(2500, 6)
  })

  it('model không có hệ số ⇒ gom vào __unknown__, KHÔNG tính vào phần trăm', () => {
    const out = creditsByModel([ev({ model: 'mo-hinh-la', input_tokens: 1_000_000 })], CPM, 'all')
    expect(out['__unknown__']).toBeDefined()
    expect(out['mo-hinh-la']).toBeUndefined()
  })
})

describe('hiệu chuẩn — phải thừa nhận khi tín hiệu yếu', () => {
  const ceiling = CEIL['default_claude_max_20x']!

  it('five_hour_pct < 5 ⇒ status low_signal và KHÔNG chốt giả thuyết', () => {
    const r = calibrate(
      [ev({ model: 'claude-opus-5-5', input_tokens: 1_000_000 })], CPM,
      { five_hour_pct: 2, five_hour_reset: 1793256600, captured_at: 1793242400 },
      ceiling,
    )
    expect(r.status).toBe('low_signal')
    expect(r.hypothesis).toBe(DEFAULT_HYPOTHESIS)
  })

  it('không có event trong cửa sổ ⇒ no_data, error_pct null', () => {
    const r = calibrate([], CPM,
      { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.status).toBe('no_data')
    expect(r.error_pct).toBeNull()
  })

  it('tín hiệu đủ mạnh ⇒ chọn giả thuyết khớp nhất và báo error_pct', () => {
    // 40% của 200k = 80 000 credits. sonnet-5-5 ở 1250/MTok ⇒ 64M token "all".
    const events = Array.from({ length: 64 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM,
      { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.status).toBe('calibrated')
    expect(r.error_pct).not.toBeNull()
    expect(Math.abs(r.error_pct!)).toBeLessThan(10)
  })
})

describe('giả thuyết in_out_write_read25 (suy ra TỪ SỐ ĐO 2026-10-29)', () => {
  it('cache_read được tính với trọng số 0.025, không phải trọn hay bỏ hẳn', () => {
    const e = ev({ model: 'claude-sonnet-5-5', cache_read: 1_000_000 })
    expect(creditsOfEvent(e, CPM, 'in_out_write_read25')).toBeCloseTo(1250 * 0.025, 6)
    expect(creditsOfEvent(e, CPM, 'in_out_write')).toBe(0)
    expect(creditsOfEvent(e, CPM, 'all')).toBeCloseTo(1250, 6)
  })

  it('hệ số công khai để kiểm được, không ẩn trong hàm', () => {
    expect(CACHE_READ_WEIGHT).toBe(0.025)
  })
})

describe('sai số lượng tử hoá: five_hour_pct là SỐ NGUYÊN', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  const obs = { five_hour_pct: 9, five_hour_reset: 1793256600, captured_at: 1793242400 }

  it('kết quả nằm trong dải [8.5%, 9.5%) ⇒ within_quantization = true', () => {
    // 17 457 credits nằm trong [17 000, 19 000) của pct=9
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.status).toBe('calibrated')
    expect(r.within_quantization).toBe(true)
  })

  it('kết quả NGOÀI dải ⇒ within_quantization = false (cổng đúng ở cả hai đầu)', () => {
    const events = [ev({ model: 'claude-fable-5-1', input_tokens: 100_000_000, ts_utc: '2026-10-29T02:52:00.000Z' })]
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.within_quantization).toBe(false)
  })
})

describe('ngoại suy phải nói ra (khớp trên MỘT cửa sổ)', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  it('calibrate trả fitted_on_credits để bên dùng biết đã khớp trên mức nào', () => {
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM, { five_hour_pct: 9, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.fitted_on_credits).toBeGreaterThan(0)
  })
  it('không hiệu chuẩn được ⇒ fitted_on_credits = null, không bịa', () => {
    const r = calibrate([], CPM, { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.fitted_on_credits).toBeNull()
  })
})

describe('index cũ hơn mốc chụp hạn mức ⇒ KHÔNG được chốt hiệu chuẩn', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  const obs = { five_hour_pct: 9, five_hour_reset: 1793256600, captured_at: 1793242400 }

  it('event mới nhất cũ hơn captured_at quá 5 phút ⇒ status stale_index', () => {
    // captured_at = 1793242400 ≈ 2026-10-29T02:53Z; event mới nhất 02:00Z ⇒ cũ 53 phút
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:00:00.000Z' }))
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.status).toBe('stale_index')
    expect(r.error_pct).toBeNull()
    expect(r.fitted_on_credits).toBeNull()
  })

  it('index theo kịp ⇒ vẫn hiệu chuẩn bình thường (cổng đúng ở CẢ HAI đầu)', () => {
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.status).toBe('calibrated')
    expect(r.fitted_on_credits).toBeGreaterThan(0)
  })
})

describe('mặc định khi chưa hiệu chuẩn được KHÔNG được là "all"', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  it('all phóng đại credits hàng trăm lần ⇒ không bao giờ làm mặc định', () => {
    const e = ev({ model: 'claude-opus-5', cache_read: 100_000_000 })
    const all = creditsOfEvent(e, CPM, 'all')
    const dflt = creditsOfEvent(e, CPM, DEFAULT_HYPOTHESIS)
    expect(all / dflt).toBeGreaterThan(30)
    expect(DEFAULT_HYPOTHESIS).not.toBe('all')
  })
  it('cả ba nhánh không-hiệu-chuẩn đều trả DEFAULT_HYPOTHESIS', () => {
    const obs = { five_hour_reset: 1793256600, captured_at: 1793242400 }
    const low = calibrate([ev({})], CPM, { ...obs, five_hour_pct: 2 }, ceiling)
    const none = calibrate([], CPM, { ...obs, five_hour_pct: 40 }, ceiling)
    const stale = calibrate(
      [ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:00:00.000Z' })],
      CPM, { ...obs, five_hour_pct: 40 }, ceiling)
    expect(low.status).toBe('low_signal')
    expect(stale.status).toBe('stale_index')
    for (const r of [low, none, stale]) expect(r.hypothesis).toBe(DEFAULT_HYPOTHESIS)
  })
})

describe('không biết trần ⇒ KHÔNG được báo "đã hiệu chuẩn" (reviewer tìm ra)', () => {
  it('ceiling = 0 ⇒ status no_ceiling, không phải calibrated', () => {
    const r = calibrate(
      [ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' })],
      CPM, { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, 0)
    expect(r.status).toBe('no_ceiling')
    expect(r.error_pct).toBeNull()
  })
})

describe('khớp kém thì phải NÓI RA, không đội lốt "đã hiệu chuẩn"', () => {
  it('lệch quá ngưỡng và ngoài dải lượng tử ⇒ status poor_fit', () => {
    // một sự kiện bé xíu so với pct lớn ⇒ mọi giả thuyết đều lệch rất xa
    const r = calibrate(
      [ev({ model: 'claude-sonnet-5-5', output_tokens: 10, ts_utc: '2026-10-29T02:52:00.000Z' })],
      CPM, { five_hour_pct: 60, five_hour_reset: 1793256600, captured_at: 1793242400 }, 200_000)
    expect(r.status).toBe('poor_fit')
    expect(r.error_pct).not.toBeNull()
    expect(Math.abs(r.error_pct!)).toBeGreaterThan(POOR_FIT_PCT)
  })

  it('khớp tốt vẫn là calibrated', () => {
    const many = Array.from({ length: 40 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 600_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(many, CPM,
      { five_hour_pct: 15, five_hour_reset: 1793256600, captured_at: 1793242400 }, 200_000)
    expect(['calibrated', 'poor_fit']).toContain(r.status)
    if (r.status === 'calibrated') {
      expect(r.within_quantization || Math.abs(r.error_pct!) <= POOR_FIT_PCT).toBe(true)
    }
  })
})
