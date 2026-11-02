import { describe, it, expect } from 'vitest'
import { slidingWindows5h } from '../src/engine/buckets.js'
import { detectFindings } from '../src/engine/findings.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

/** This machine already had 61k events. Math.max(...array) blows the stack around 10^5
 *  arguments: a cliff, not a slowdown. A user three times heavier simply crashes. */
describe('large data scale (found by a reviewer)', () => {
  const N = 150_000
  const base = Date.parse('2026-01-01T00:00:00Z')
  const many = Array.from({ length: N }, (_, i) =>
    ev({ model: 'claude-sonnet-5-5', output_tokens: 10, ts_utc: new Date(base + i * 1000).toISOString() }))

  it(`slidingWindows5h survives ${N.toLocaleString()} events`, () => {
    const w = slidingWindows5h(many, () => 1)
    expect(w).toHaveLength(N)
  })

  it(`detectFindings survives ${N.toLocaleString()} events`, () => {
    expect(() => detectFindings(many, 200_000, 'all', null, CPM)).not.toThrow()
  })
})
