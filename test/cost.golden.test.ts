import { describe, it, expect } from 'vitest'
import { costOfEvent } from '../src/engine/cost.js'
import { expectCode } from './throws.js'

/**
 * ORACLE THẬT — không phải số tự nghĩ ra.
 * Nguồn: `claude -p "/__khong_ton_tai_xyz__" --output-format json` chạy 2026-10-29.
 * Claude Code tự báo total_cost_usd = 0.356643 cho usage dưới đây (claude-opus-5).
 * Đây là chốt chặn cho TOÀN BỘ công thức giá: hệ số 2x của cache 1h và 0.1x của cache read.
 */
describe('cost engine — oracle từ chính Claude Code', () => {
  it('khớp total_cost_usd mà claude -p báo, sai số < 1e-9', () => {
    const usd = costOfEvent({
      model: 'claude-opus-5',
      input_tokens: 2, output_tokens: 108,
      cache_read: 11266, cache_write_5m: 0, cache_write_1h: 34830,
    })
    expect(usd).toBeCloseTo(0.356643, 9)
  })

  it('cache 1h chiếm phần lớn chi phí của chính lần gọi đó (97.7%)', () => {
    const total = costOfEvent({
      model: 'claude-opus-5', input_tokens: 2, output_tokens: 108,
      cache_read: 11266, cache_write_5m: 0, cache_write_1h: 34830,
    })
    const onlyWrite = costOfEvent({
      model: 'claude-opus-5', input_tokens: 0, output_tokens: 0,
      cache_read: 0, cache_write_5m: 0, cache_write_1h: 34830,
    })
    expect(onlyWrite / total).toBeGreaterThan(0.97)
  })
})

describe('cost engine — hệ số cache read theo model', () => {
  it('opus-5-5 đọc cache = 0.05x input ($0.20/MTok)', () => {
    const usd = costOfEvent({
      model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 0,
      cache_read: 1_000_000, cache_write_5m: 0, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(0.20, 6)
  })

  it('fable-5-1 đọc cache = 0.025x input ($0.25/MTok)', () => {
    const usd = costOfEvent({
      model: 'claude-fable-5-1', input_tokens: 0, output_tokens: 0,
      cache_read: 1_000_000, cache_write_5m: 0, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(0.25, 6)
  })

  it('sonnet-5-5 dùng mặc định 0.1x ($0.20/MTok)', () => {
    const usd = costOfEvent({
      model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 0,
      cache_read: 1_000_000, cache_write_5m: 0, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(0.20, 6)
  })

  it('viết cache 5m = 1.25x input', () => {
    const usd = costOfEvent({
      model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 0,
      cache_read: 0, cache_write_5m: 1_000_000, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(2.5, 6)
  })

  it('model lạ KHÔNG được bịa giá — phải ném lỗi hoặc trả NaN có chủ ý', () => {
    // Phải ném ĐÚNG mã UNKNOWN_MODEL_PRICING — không nhận Error chung,
    // nếu không thì stub NOT_IMPLEMENTED sẽ làm test này xanh giả.
    expectCode(() => costOfEvent({
      model: 'claude-tu-nghi-ra-9', input_tokens: 1000, output_tokens: 1000,
      cache_read: 0, cache_write_5m: 0, cache_write_1h: 0,
    }), 'UNKNOWN_MODEL_PRICING')
  })
})
