import { describe, it, expect } from 'vitest'
import { slidingWindows5h } from '../src/engine/buckets.js'
import { detectFindings } from '../src/engine/findings.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

/** Máy này đã có 61k sự kiện. Math.max(...mảng) vỡ stack quanh 10^5 đối số — vách đứng,
 *  không phải chậm dần. Người dùng nặng gấp 3 là sập. */
describe('thang dữ liệu lớn (reviewer tìm ra)', () => {
  const N = 150_000
  const base = Date.parse('2026-01-01T00:00:00Z')
  const many = Array.from({ length: N }, (_, i) =>
    ev({ model: 'claude-sonnet-5-5', output_tokens: 10, ts_utc: new Date(base + i * 1000).toISOString() }))

  it(`slidingWindows5h chịu được ${N.toLocaleString()} sự kiện`, () => {
    const w = slidingWindows5h(many, () => 1)
    expect(w).toHaveLength(N)
  })

  it(`detectFindings chịu được ${N.toLocaleString()} sự kiện`, () => {
    expect(() => detectFindings(many, 200_000, 'all', null, CPM)).not.toThrow()
  })
})
