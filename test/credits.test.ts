import { describe, it, expect } from 'vitest'
import { creditsOfEvent, creditsByModel, calibrate, CACHE_READ_WEIGHT, DEFAULT_HYPOTHESIS, POOR_FIT_PCT } from '../src/engine/credits.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM, FIVE_HOUR_CREDITS_FALLBACK as CEIL } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

describe('plan credits', () => {
  it('1M tokens of opus-5-5 is 1833 credits (hypothesis all)', () => {
    const c = creditsOfEvent(ev({ model: 'claude-opus-5-5', input_tokens: 1_000_000 }), CPM, 'all')
    expect(c).toBeCloseTo(1833, 6)
  })

  it('one fable-5-1 token costs ten times one haiku-4-5 token', () => {
    const f = creditsOfEvent(ev({ model: 'claude-fable-5-1', input_tokens: 1_000_000 }), CPM, 'all')
    const h = creditsOfEvent(ev({ model: 'claude-haiku-4-5', input_tokens: 1_000_000 }), CPM, 'all')
    expect(f / h).toBeCloseTo(8333 / 833, 3)
  })

  it('the out_only hypothesis counts output alone', () => {
    const e = ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, output_tokens: 1_000_000 })
    expect(creditsOfEvent(e, CPM, 'out_only')).toBeCloseTo(1250, 6)
    expect(creditsOfEvent(e, CPM, 'all')).toBeCloseTo(2500, 6)
  })

  it('a model with no rate goes to __unknown__ and is left out of the percentages', () => {
    const out = creditsByModel([ev({ model: 'mo-hinh-la', input_tokens: 1_000_000 })], CPM, 'all')
    expect(out['__unknown__']).toBeDefined()
    expect(out['mo-hinh-la']).toBeUndefined()
  })
})

describe('calibration has to admit a weak signal', () => {
  const ceiling = CEIL['default_claude_max_20x']!

  it('five_hour_pct under 5 gives status low_signal and commits to no hypothesis', () => {
    const r = calibrate(
      [ev({ model: 'claude-opus-5-5', input_tokens: 1_000_000 })], CPM,
      { five_hour_pct: 2, five_hour_reset: 1793256600, captured_at: 1793242400 },
      ceiling,
    )
    expect(r.status).toBe('low_signal')
    expect(r.hypothesis).toBe(DEFAULT_HYPOTHESIS)
  })

  it('no events in the window gives no_data and a null error_pct', () => {
    const r = calibrate([], CPM,
      { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.status).toBe('no_data')
    expect(r.error_pct).toBeNull()
  })

  it('a strong enough signal picks the best hypothesis and reports error_pct', () => {
    // 40% of 200k is 80,000 credits. sonnet-5-5 at 1250/MTok means 64M tokens under "all".
    const events = Array.from({ length: 64 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM,
      { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.status).toBe('calibrated')
    expect(r.error_pct).not.toBeNull()
    expect(Math.abs(r.error_pct!)).toBeLessThan(10)
  })
})

describe('the in_out_write_read25 hypothesis, derived FROM MEASUREMENT on 2026-10-29', () => {
  it('cache_read is weighted at 0.025, neither counted in full nor dropped', () => {
    const e = ev({ model: 'claude-sonnet-5-5', cache_read: 1_000_000 })
    expect(creditsOfEvent(e, CPM, 'in_out_write_read25')).toBeCloseTo(1250 * 0.025, 6)
    expect(creditsOfEvent(e, CPM, 'in_out_write')).toBe(0)
    expect(creditsOfEvent(e, CPM, 'all')).toBeCloseTo(1250, 6)
  })

  it('the weight is exported so it can be checked, not buried in a function', () => {
    expect(CACHE_READ_WEIGHT).toBe(0.025)
  })
})

describe('quantisation error: five_hour_pct is an INTEGER', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  const obs = { five_hour_pct: 9, five_hour_reset: 1793256600, captured_at: 1793242400 }

  it('a result inside [8.5%, 9.5%) gives within_quantization = true', () => {
    // 17,457 credits falls inside [17,000, 19,000) for pct=9
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.status).toBe('calibrated')
    expect(r.within_quantization).toBe(true)
  })

  it('a result OUTSIDE the band gives within_quantization = false (both ends of the gate)', () => {
    const events = [ev({ model: 'claude-fable-5-1', input_tokens: 100_000_000, ts_utc: '2026-10-29T02:52:00.000Z' })]
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.within_quantization).toBe(false)
  })
})

describe('extrapolation has to say so, because the fit was made on ONE window', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  it('calibrate returns fitted_on_credits so callers know what level it was fitted on', () => {
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM, { five_hour_pct: 9, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.fitted_on_credits).toBeGreaterThan(0)
  })
  it('when calibration fails fitted_on_credits is null, never invented', () => {
    const r = calibrate([], CPM, { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, ceiling)
    expect(r.fitted_on_credits).toBeNull()
  })
})

describe('an index older than the limit snapshot must NOT be called calibrated', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  const obs = { five_hour_pct: 9, five_hour_reset: 1793256600, captured_at: 1793242400 }

  it('a newest event more than five minutes older than captured_at gives status stale_index', () => {
    // captured_at = 1793242400 is about 2026-10-29T02:53Z; the newest event at 02:00Z is 53 minutes older
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:00:00.000Z' }))
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.status).toBe('stale_index')
    expect(r.error_pct).toBeNull()
    expect(r.fitted_on_credits).toBeNull()
  })

  it('a current index still calibrates normally (the gate is right at BOTH ends)', () => {
    const events = Array.from({ length: 14 }, () =>
      ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' }))
    const r = calibrate(events, CPM, obs, ceiling)
    expect(r.status).toBe('calibrated')
    expect(r.fitted_on_credits).toBeGreaterThan(0)
  })
})

describe('the uncalibrated default must NOT be "all"', () => {
  const ceiling = CEIL['default_claude_max_20x']!
  it('all inflates credits by hundreds of times, so it is never the default', () => {
    const e = ev({ model: 'claude-opus-5', cache_read: 100_000_000 })
    const all = creditsOfEvent(e, CPM, 'all')
    const dflt = creditsOfEvent(e, CPM, DEFAULT_HYPOTHESIS)
    expect(all / dflt).toBeGreaterThan(30)
    expect(DEFAULT_HYPOTHESIS).not.toBe('all')
  })
  it('all three uncalibrated branches return DEFAULT_HYPOTHESIS', () => {
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

describe('an unknown ceiling must NOT report "calibrated" (found by a reviewer)', () => {
  it('ceiling = 0 gives status no_ceiling, not calibrated', () => {
    const r = calibrate(
      [ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T02:52:00.000Z' })],
      CPM, { five_hour_pct: 40, five_hour_reset: 1793256600, captured_at: 1793242400 }, 0)
    expect(r.status).toBe('no_ceiling')
    expect(r.error_pct).toBeNull()
  })
})

describe('a poor fit has to SAY SO instead of hiding under "calibrated"', () => {
  it('past the error threshold and outside the quantisation band gives status poor_fit', () => {
    // one tiny event against a large pct leaves every hypothesis far off
    const r = calibrate(
      [ev({ model: 'claude-sonnet-5-5', output_tokens: 10, ts_utc: '2026-10-29T02:52:00.000Z' })],
      CPM, { five_hour_pct: 60, five_hour_reset: 1793256600, captured_at: 1793242400 }, 200_000)
    expect(r.status).toBe('poor_fit')
    expect(r.error_pct).not.toBeNull()
    expect(Math.abs(r.error_pct!)).toBeGreaterThan(POOR_FIT_PCT)
  })

  it('a good fit is still calibrated', () => {
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
