import { describe, it, expect } from 'vitest'
import { buildPrompt, parseReply, estimate } from '../src/insight/explain.js'

describe('prompt giải thích', () => {
  const nums = { probe_pct: 55.9, not_hand_driven_pct: 56 }

  it('nói rõ ngôn ngữ, và số điểm khớp với độ sâu', () => {
    expect(buildPrompt(nums, 'vi', 'brief')).toContain('Vietnamese')
    expect(buildPrompt(nums, 'zh', 'full')).toContain('Simplified Chinese')
    expect(buildPrompt(nums, 'en', 'brief')).toContain('exactly 3 points')
    expect(buildPrompt(nums, 'en', 'full')).toContain('exactly 6 points')
  })

  it('CẤM bịa số, và cảnh báo không quy hành vi subagent cho người dùng', () => {
    const p = buildPrompt(nums, 'vi', 'full')
    expect(p).toMatch(/Never invent a figure/i)
    expect(p).toMatch(/subagent/i)
  })

  it('mang chính các con số vào prompt', () => {
    expect(buildPrompt(nums, 'vi', 'brief')).toContain('55.9')
  })
})

describe('bóc câu trả lời', () => {
  const good = '{"headline":"h","points":[{"title":"t","why":"w","action":"a"}]}'

  it('JSON trần', () => {
    expect(parseReply(good)!.points).toHaveLength(1)
    expect(parseReply(good)!.headline).toBe('h')
  })

  it('JSON bọc trong hàng rào markdown vẫn bóc được', () => {
    expect(parseReply('```json\n' + good + '\n```')).not.toBeNull()
  })

  it('JSON kèm lời dẫn vẫn bóc được', () => {
    expect(parseReply('Đây là kết quả:\n' + good + '\nHết.')).not.toBeNull()
  })

  it('trả null khi hỏng — KHÔNG trả một kết quả rỗng trông như thật', () => {
    expect(parseReply('xin chào')).toBeNull()
    expect(parseReply('{"headline":"h"}')).toBeNull()        // thiếu points
    expect(parseReply('{"headline":"h","points":[]}')).toBeNull()
    expect(parseReply('{"points":[{"why":"w"}]}')).toBeNull() // điểm không có tiêu đề
  })

  it('bỏ điểm rỗng nhưng giữ điểm hợp lệ', () => {
    const r = parseReply('{"points":[{"title":""},{"title":"ok","why":"w","action":"a"}]}')
    expect(r!.points).toHaveLength(1)
    expect(r!.points[0]!.title).toBe('ok')
  })
})

describe('ước lượng chi phí theo ĐỘ DÀI INPUT', () => {
  it('input dài hơn thì tốn hơn', () => {
    expect(estimate(40_000, 'brief').from_payload).toBeGreaterThan(estimate(4_000, 'brief').from_payload)
  })

  it('sâu hơn thì tốn hơn và lâu hơn', () => {
    expect(estimate(8_000, 'full').from_payload).toBeGreaterThan(estimate(8_000, 'brief').from_payload)
    expect(estimate(8_000, 'full').seconds).toBeGreaterThan(estimate(8_000, 'brief').seconds)
  })

  it('RẺ HƠN HẲN /insights (~2.400 credits) — đó là lý do tồn tại của nó', () => {
    expect(estimate(10_000, 'full').from_payload).toBeLessThan(2400 / 2)
  })

  it('không bao giờ trả 0 — 0 credits là một lời hứa sai', () => {
    expect(estimate(0, 'brief').from_payload).toBeGreaterThan(0)
  })

  it('CHƯA đo phần nền ⇒ total null và measured false — không hiện một số đẹp rồi sai gấp trăm lần', () => {
    const e = estimate(1200, 'brief')
    expect(e.total).toBeNull()
    expect(e.measured).toBe(false)
    const m = estimate(1200, 'brief', 2300)
    expect(m.total).toBe(m.from_payload + 2300)
    expect(m.measured).toBe(true)
  })
})
