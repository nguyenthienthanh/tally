import { describe, it, expect } from 'vitest'
import { costOfEvent } from '../src/engine/cost.js'
import { expectCode } from './throws.js'

/**
 * A REAL oracle, not a number someone made up.
 * Source: `claude -p "/__does_not_exist_xyz__" --output-format json`, run on 2026-10-29.
 * Claude Code itself reported total_cost_usd = 0.356643 for the usage below (claude-opus-5).
 * This pins the WHOLE price formula: the 2x factor for a 1h cache write and 0.1x for a cache read.
 */
describe('cost engine against Claude Code\'s own oracle', () => {
  it('matches the total_cost_usd claude -p reported, within 1e-9', () => {
    const usd = costOfEvent({
      model: 'claude-opus-5',
      input_tokens: 2, output_tokens: 108,
      cache_read: 11266, cache_write_5m: 0, cache_write_1h: 34830,
    })
    expect(usd).toBeCloseTo(0.356643, 9)
  })

  it('the 1h cache write dominates the cost of that very call (97.7%)', () => {
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

describe('cost engine: the cache-read factor per model', () => {
  it('opus-5-5 reads cache at 0.05x input ($0.20/MTok)', () => {
    const usd = costOfEvent({
      model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 0,
      cache_read: 1_000_000, cache_write_5m: 0, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(0.20, 6)
  })

  it('fable-5-1 reads cache at 0.025x input ($0.25/MTok)', () => {
    const usd = costOfEvent({
      model: 'claude-fable-5-1', input_tokens: 0, output_tokens: 0,
      cache_read: 1_000_000, cache_write_5m: 0, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(0.25, 6)
  })

  it('sonnet-5-5 uses the 0.1x default ($0.20/MTok)', () => {
    const usd = costOfEvent({
      model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 0,
      cache_read: 1_000_000, cache_write_5m: 0, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(0.20, 6)
  })

  it('a 5m cache write costs 1.25x input', () => {
    const usd = costOfEvent({
      model: 'claude-sonnet-5-5', input_tokens: 0, output_tokens: 0,
      cache_read: 0, cache_write_5m: 1_000_000, cache_write_1h: 0,
    })
    expect(usd).toBeCloseTo(2.5, 6)
  })

  it('an unknown model must NOT get an invented price: it throws', () => {
    // It must throw the EXACT code UNKNOWN_MODEL_PRICING. A plain Error is not accepted,
    // otherwise a NOT_IMPLEMENTED stub would turn this test green for the wrong reason.
    expectCode(() => costOfEvent({
      model: 'claude-tu-nghi-ra-9', input_tokens: 1000, output_tokens: 1000,
      cache_read: 0, cache_write_5m: 0, cache_write_1h: 0,
    }), 'UNKNOWN_MODEL_PRICING')
  })
})
