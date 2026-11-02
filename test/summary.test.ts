import { describe, it, expect } from 'vitest'
import { summaryByModel, summaryByProject, currentWindow, periodWindow } from '../src/engine/summary.js'
import { redactPath } from '../src/redact.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

const CEIL = 200_000
const W = { startMs: Date.parse('2026-10-29T00:00:00Z'), endMs: Date.parse('2026-10-29T05:00:00Z') }

describe('summaryByModel — MỘT nguồn cho cả server lẫn CLI', () => {
  const events = [
    ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T01:00:00.000Z' }),
    ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-20T01:00:00.000Z' }),
  ]

  it('% trần tính TRÊN CỬA SỔ, không phải toàn thời gian', () => {
    const s = summaryByModel(events, CPM, 'in_out_write_read25', CEIL, W)
    const row = s.rows.find((r) => r.model === 'claude-sonnet-5-5')!
    expect(row.credits_lifetime).toBeCloseTo(2500, 6)   // cả hai event
    expect(row.credits_5h).toBeCloseTo(1250, 6)         // chỉ event trong cửa sổ
    expect(row.pct_of_ceiling).toBeCloseTo(1250 / CEIL * 100, 6)
  })

  it('không có trần ⇒ pct null, KHÔNG bịa 0%', () => {
    const s = summaryByModel(events, CPM, 'all', null, W)
    expect(s.rows[0]!.pct_of_ceiling).toBeNull()
  })

  it('cửa sổ rỗng ⇒ credits_5h = 0 nhưng lifetime vẫn còn (cổng hai đầu)', () => {
    const s = summaryByModel(events, CPM, 'all', CEIL,
      { startMs: Date.parse('2030-01-01T00:00:00Z'), endMs: Date.parse('2030-01-01T05:00:00Z') })
    expect(s.window.events).toBe(0)
    expect(s.rows[0]!.credits_5h).toBe(0)
    expect(s.rows[0]!.credits_lifetime).toBeGreaterThan(0)
  })

  it('currentWindow dùng rate-limits khi có, dài đúng 5 giờ khi không', () => {
    const w = currentWindow({ five_hour_reset: 1793256600, captured_at: 1793242400 })
    expect(w.startMs).toBe((1793256600 - 18000) * 1000)
    const w2 = currentWindow(null)
    expect(w2.endMs - w2.startMs).toBe(5 * 3600 * 1000)
  })
})

describe('"không biết" KHÁC "bằng không" (AC-2.3)', () => {
  it('model không có hệ số credits ⇒ credits_known=false và pct=null', () => {
    const s = summaryByModel(
      [ev({ model: 'claude-haiku-5-5', output_tokens: 1_000_000, ts_utc: '2026-10-29T01:00:00.000Z' })],
      CPM, 'all', CEIL, W)
    const row = s.rows.find((r) => r.model === 'claude-haiku-5-5')!
    expect(row.credits_known).toBe(false)
    expect(row.pct_of_ceiling).toBeNull()
    expect(row.usd).toBeGreaterThan(0)   // vẫn biết GIÁ, chỉ không biết hệ số credits
  })

  it('model CÓ hệ số ⇒ credits_known=true (cổng đúng ở cả hai đầu)', () => {
    const s = summaryByModel(
      [ev({ model: 'claude-sonnet-5-5', output_tokens: 1_000_000, ts_utc: '2026-10-29T01:00:00.000Z' })],
      CPM, 'all', CEIL, W)
    expect(s.rows[0]!.credits_known).toBe(true)
    expect(s.rows[0]!.pct_of_ceiling).not.toBeNull()
  })
})

describe('chi phí theo dự án + ẩn danh', () => {
  const events = [
    ev({ model: 'claude-opus-5', output_tokens: 1000, project_key: '/Users/e/p/ai-mv-factory', ts_utc: '2026-10-29T01:00:00.000Z' }),
    ev({ model: 'claude-opus-5', output_tokens: 500, project_key: '/Users/e/p/ai-mv-factory', is_sidechain: true, ts_utc: '2026-10-29T01:00:00.000Z' }),
    ev({ model: 'claude-opus-5', output_tokens: 100, project_key: '/Users/e/p/games', ts_utc: '2026-10-29T01:00:00.000Z' }),
  ]

  it('gộp theo dự án, tách được phần subagent', () => {
    const rows = summaryByProject(events, CPM, 'all')
    const f = rows.find((r) => r.project.includes('ai-mv-factory'))!
    expect(f.events).toBe(2)
    expect(f.sidechain_usd).toBeGreaterThan(0)
    expect(f.sidechain_usd).toBeLessThan(f.usd)
  })

  it('ẩn danh KHÔNG làm đổi cách gộp nhóm (vẫn 2 dự án) và không lộ tên', () => {
    const rows = summaryByProject(events, CPM, 'all', redactPath)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.project).not.toContain('ai-mv-factory')
    const plain = summaryByProject(events, CPM, 'all')
    expect(rows.map((r) => r.events).sort()).toEqual(plain.map((r) => r.events).sort())
  })
})

describe('khoảng xem được chọn — sửa cho ca "model khác 0% trong khi có dùng"', () => {
  const H = 3600_000
  const now = Date.parse('2026-10-29T18:00:00.000Z')
  const mk = (model: string, hoursAgo: number) =>
    ev({ model, output_tokens: 1000, ts_utc: new Date(now - hoursAgo * H).toISOString() })
  const events = [
    mk('claude-opus-5', 1), mk('claude-opus-5', 2),
    mk('claude-sonnet-5-5', 9),      // ngoài 5 giờ, trong 24 giờ
    mk('claude-sonnet-4-6', 72),     // ngoài 24 giờ, trong 7 ngày
  ]
  const win = (p: Parameters<typeof periodWindow>[0]) => periodWindow(p, now)

  it('5 giờ: chỉ model chạy trong cửa sổ đó mới có số — đây KHÔNG phải lỗi', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('5h'), true)
    expect(r.rows.find((x) => x.model === 'claude-opus-5')!.credits_period).toBeGreaterThan(0)
    expect(r.rows.find((x) => x.model === 'claude-sonnet-5-5')!.credits_period).toBe(0)
  })

  it('24 giờ: sonnet-5-5 hiện ra', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('24h'), false)
    expect(r.rows.find((x) => x.model === 'claude-sonnet-5-5')!.credits_period).toBeGreaterThan(0)
    expect(r.rows.find((x) => x.model === 'claude-sonnet-4-6')!.credits_period).toBe(0)
  })

  it('7 ngày: cả ba model đều có số', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('7d'), false)
    for (const m of ['claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6']) {
      expect(r.rows.find((x) => x.model === m)!.credits_period, m).toBeGreaterThan(0)
    }
  })

  it('share_pct cộng lại đúng 100% trong khoảng', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('7d'), false)
    const total = r.rows.reduce((s, x) => s + (x.share_pct ?? 0), 0)
    expect(total).toBeCloseTo(100, 6)
  })

  it('% trần CHỈ có nghĩa ở cửa sổ 5 giờ — khoảng khác phải là null, không phải số sai', () => {
    const five = summaryByModel(events, CPM, 'all', CEIL, win('5h'), true)
    const week = summaryByModel(events, CPM, 'all', CEIL, win('7d'), false)
    expect(five.rows.find((x) => x.model === 'claude-opus-5')!.pct_of_ceiling).toBeGreaterThan(0)
    expect(week.rows.every((x) => x.pct_of_ceiling === null)).toBe(true)
  })

  it('"tất cả" lấy trọn lịch sử, credits_lifetime không đổi theo khoảng', () => {
    const a = summaryByModel(events, CPM, 'all', CEIL, win('5h'), true)
    const b = summaryByModel(events, CPM, 'all', CEIL, win('all'), false)
    const life = (r: typeof a) => r.rows.find((x) => x.model === 'claude-sonnet-4-6')!.credits_lifetime
    expect(life(a)).toBe(life(b))
    expect(b.rows.find((x) => x.model === 'claude-sonnet-4-6')!.credits_period).toBe(life(b))
  })
})

describe('cửa sổ 5 giờ hiện tại', () => {
  it('reset = 0 (chưa dùng gì) KHÔNG được biến cửa sổ thành toàn thời gian', () => {
    const w = currentWindow({ five_hour_reset: 0, captured_at: 1_793_590_805 })
    expect(w.endMs).toBe(1_793_590_805_000)
    expect(w.endMs - w.startMs).toBe(5 * 3600 * 1000)
    expect(w.startMs).toBeGreaterThan(0)
  })

  it('có cửa sổ đang chạy thì neo vào mốc reset', () => {
    const w = currentWindow({ five_hour_reset: 1_793_594_234, captured_at: 1_793_590_634 })
    expect(w.startMs).toBe((1_793_594_234 - 5 * 3600) * 1000)
  })
})
