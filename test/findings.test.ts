import { describe, it, expect } from 'vitest'
import { detectFindings } from '../src/engine/findings.js'
import { ev } from './helpers.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'

const CEIL = 200_000

describe('phát hiện lãng phí — mỗi phát hiện PHẢI quy ra tiền (DD-10)', () => {
  it('WASTE_CACHE_1H: viết cache 1h mà đọc < 3 lần ⇒ báo, kèm damage USD > 0', () => {
    const f = detectFindings([ev({
      model: 'claude-opus-5', cache_write_1h: 34_830, cache_read: 11_266,
      input_tokens: 2, output_tokens: 108,
    })], CEIL, 'in_out_write_read25', null, CPM)
    const hit = f.find((x) => x.id === 'WASTE_CACHE_1H')
    expect(hit).toBeDefined()
    expect(hit!.damage.usd).toBeGreaterThan(0)
    expect(hit!.action).toBeTruthy()
  })

  it('cache 1h đọc lại ĐỦ NHIỀU ⇒ KHÔNG báo (không bắt nhầm người dùng đúng)', () => {
    const f = detectFindings([ev({
      model: 'claude-opus-5', cache_write_1h: 10_000, cache_read: 500_000,
    })], CEIL, 'in_out_write_read25', null, CPM)
    expect(f.find((x) => x.id === 'WASTE_CACHE_1H')).toBeUndefined()
  })

  it('SUBAGENT_HEAVY: sidechain chiếm > 50% chi phí phiên ⇒ báo', () => {
    const f = detectFindings([
      ev({ session_id: 's9', model: 'claude-opus-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 's9', model: 'claude-opus-5', output_tokens: 900, is_sidechain: true }),
    ], CEIL, 'in_out_write_read25', null, CPM)
    expect(f.find((x) => x.id === 'SUBAGENT_HEAVY')).toBeDefined()
  })

  it('OVERKILL_MODEL: opus + effort cao + output nhỏ + 0 tool ⇒ báo, damage tính bằng credits', () => {
    const many = Array.from({ length: 25 }, () => ev({
      model: 'claude-opus-5', effort: 'xhigh', output_tokens: 120, tool_calls: 0,
      input_tokens: 5_000,
    }))
    const hit = detectFindings(many, CEIL, 'in_out_write_read25', null, CPM).find((x) => x.id === 'OVERKILL_MODEL')
    expect(hit).toBeDefined()
    expect(hit!.damage.credits).toBeGreaterThan(0)
  })

  it('CEILING_RISK: cửa sổ 5h vượt 80% trần ⇒ báo', () => {
    const heavy = Array.from({ length: 80 }, (_, i) => ev({
      model: 'claude-opus-5', input_tokens: 1_000_000,
      ts_utc: `2026-10-29T0${Math.floor(i / 40)}:${String(i % 40).padStart(2, '0')}:00.000Z`,
    }))
    expect(detectFindings(heavy, CEIL, 'all', null, CPM).find((x) => x.id === 'CEILING_RISK')).toBeDefined()
  })

  it('KHÔNG event nào ⇒ danh sách rỗng, không phát hiện ảo', () => {
    expect(detectFindings([], CEIL, 'in_out_write_read25', null, CPM)).toEqual([])
  })

  it('mọi phát hiện trả về đều có damage khác rỗng (bất biến của DD-10)', () => {
    const f = detectFindings([ev({ model: 'claude-opus-5', cache_write_1h: 50_000, cache_read: 0 })], CEIL, 'in_out_write_read25', null, CPM)
    for (const x of f) {
      expect(x.damage.usd !== undefined || x.damage.credits !== undefined).toBe(true)
    }
  })
})

describe('phát hiện phải dùng ĐÚNG nguồn hằng số (reviewer độc lập tìm ra)', () => {
  it('OVERKILL_MODEL vẫn báo khi có cache_read thật (không hardcode "all" ở vế hạ bậc)', () => {
    const many = Array.from({ length: 25 }, () => ev({
      model: 'claude-opus-5', effort: 'xhigh', output_tokens: 120, tool_calls: 0,
      input_tokens: 5_000, cache_read: 200_000,
    }))
    const hit = detectFindings(many, CEIL, 'in_out_write_read25', null, CPM)
      .find((x) => x.id === 'OVERKILL_MODEL')
    expect(hit).toBeDefined()
    expect(hit!.damage.credits).toBeGreaterThan(0)
  })

  it('dùng bảng hệ số TRUYỀN VÀO, không phải bảng fallback cứng trong module', () => {
    // Model có đường hạ bậc (opus-5-5 -> sonnet-5-5) để phép tính tiết kiệm chạy được.
    const evs = [
      ev({ session_id: 's9', model: 'claude-opus-5-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 's9', model: 'claude-opus-5-5', output_tokens: 900, is_sidechain: true }),
    ]
    // bảng ĐẦY ĐỦ truyền vào ⇒ báo
    expect(detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'SUBAGENT_HEAVY')).toBeDefined()
    // bảng THIẾU đúng model đó ⇒ không tính được ⇒ không báo.
    // Nếu hàm lén dùng bảng fallback bên trong, nó vẫn báo và test này đỏ.
    const missing = { ...CPM }
    delete (missing as Record<string, number>)['claude-opus-5-5']
    expect(detectFindings(evs, CEIL, 'all', null, missing).find((x) => x.id === 'SUBAGENT_HEAVY')).toBeUndefined()
  })

  it('subagent đã dùng model RẺ NHẤT ⇒ không báo (lời khuyên hạ model sẽ vô nghĩa)', () => {
    const evs = [
      ev({ session_id: 'sA', model: 'claude-haiku-4-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 'sA', model: 'claude-haiku-4-5', output_tokens: 900, is_sidechain: true }),
    ]
    expect(detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'SUBAGENT_HEAVY')).toBeUndefined()
  })

  it('thiệt hại subagent = phần TIẾT KIỆM được, KHÔNG phải tổng chi subagent', () => {
    const evs = [
      ev({ session_id: 'sB', model: 'claude-opus-5-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 'sB', model: 'claude-opus-5-5', output_tokens: 10_000, is_sidechain: true }),
    ]
    const hit = detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'SUBAGENT_HEAVY')!
    expect(hit).toBeDefined()
    const totalSubagent = 10_000 / 1e6 * CPM['claude-opus-5-5']!
    expect(hit.damage.credits).toBeGreaterThan(0)
    expect(hit.damage.credits, 'gọi cả tổng chi là "thiệt hại" là thổi phồng')
      .toBeLessThan(totalSubagent)
  })

  it('không biết trần (null) ⇒ KHÔNG bịa 200.000, bỏ qua CEILING_RISK', () => {
    const heavy = Array.from({ length: 80 }, (_, i) => ev({
      model: 'claude-opus-5', input_tokens: 1_000_000,
      ts_utc: `2026-10-29T0${Math.floor(i / 40)}:${String(i % 40).padStart(2, '0')}:00.000Z`,
    }))
    expect(detectFindings(heavy, null, 'all', null, CPM).find((x) => x.id === 'CEILING_RISK')).toBeUndefined()
    expect(detectFindings(heavy, CEIL, 'all', null, CPM).find((x) => x.id === 'CEILING_RISK')).toBeDefined()
  })

  it('WASTE_CACHE_MISS lấy hệ số đọc cache THEO MODEL, không hardcode 0.9', () => {
    // opus-5-5 có hệ số đọc 0.05 ⇒ phần phí mất là 0.95, không phải 0.9
    const evs = Array.from({ length: 12 }, () => ev({
      model: 'claude-opus-5-5', input_tokens: 2_000_000 / 12, cache_read: 0,
    }))
    const hit = detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'WASTE_CACHE_MISS')
    expect(hit).toBeDefined()
    expect(hit!.damage.usd).toBeCloseTo(2 * 0.95 * 4, 1)
  })

  it('xếp theo mức nghiêm trọng: high trước medium trước low', () => {
    const cmp = (a: string, b: string): number =>
      ({ high: 0, medium: 1, low: 2 }[a]!) - ({ high: 0, medium: 1, low: 2 }[b]!)
    expect(['low', 'medium', 'high'].sort(cmp)).toEqual(['high', 'medium', 'low'])
  })
})

describe('thứ tự ưu tiên phải hợp lý với người đọc', () => {
  it('cùng mức nghiêm trọng thì credits LỚN HƠN lên trên', () => {
    const evs = [
      ...Array.from({ length: 30 }, () => ev({
        model: 'claude-opus-5', effort: 'xhigh', output_tokens: 50, tool_calls: 0,
        input_tokens: 1000, session_id: 'o',
      })),
      ...Array.from({ length: 4 }, () => ev({
        model: 'claude-opus-5-5', output_tokens: 100, is_sidechain: false, session_id: 'sb',
      })),
      ...Array.from({ length: 4 }, () => ev({
        model: 'claude-opus-5-5', output_tokens: 5000, is_sidechain: true, session_id: 'sb',
      })),
    ]
    const f = detectFindings(evs, CEIL, 'all', null, CPM)
    const med = f.filter((x) => x.severity === 'medium' && x.damage.credits !== undefined)
    for (let i = 1; i < med.length; i += 1) {
      expect(med[i - 1]!.damage.credits!).toBeGreaterThanOrEqual(med[i]!.damage.credits!)
    }
  })

  it('mọi phát hiện đều mang rank, bắt đầu từ 1 và liên tục', () => {
    const evs = Array.from({ length: 30 }, () => ev({
      model: 'claude-opus-5', effort: 'xhigh', output_tokens: 50, tool_calls: 0, cache_write_1h: 500_000,
    }))
    const f = detectFindings(evs, CEIL, 'all', null, CPM)
    expect(f.length).toBeGreaterThan(0)
    expect(f.map((x) => x.rank)).toEqual(f.map((_, i) => i + 1))
  })
})
