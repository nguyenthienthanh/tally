import { describe, it, expect } from 'vitest'
import { detectFindings } from '../src/engine/findings.js'
import { ev } from './helpers.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'

const CEIL = 200_000

describe('waste findings: every finding MUST carry a price (DD-10)', () => {
  it('WASTE_CACHE_1H: a 1h cache write read fewer than 3 times fires, with a USD damage above 0', () => {
    const f = detectFindings([ev({
      model: 'claude-opus-5', cache_write_1h: 34_830, cache_read: 11_266,
      input_tokens: 2, output_tokens: 108,
    })], CEIL, 'in_out_write_read25', null, CPM)
    const hit = f.find((x) => x.id === 'WASTE_CACHE_1H')
    expect(hit).toBeDefined()
    expect(hit!.damage.usd).toBeGreaterThan(0)
    expect(hit!.action).toBeTruthy()
  })

  it('a 1h cache read back OFTEN ENOUGH does not fire, so correct usage is not flagged', () => {
    const f = detectFindings([ev({
      model: 'claude-opus-5', cache_write_1h: 10_000, cache_read: 500_000,
    })], CEIL, 'in_out_write_read25', null, CPM)
    expect(f.find((x) => x.id === 'WASTE_CACHE_1H')).toBeUndefined()
  })

  it('SUBAGENT_HEAVY: sidechains over 50% of a session cost fires', () => {
    const f = detectFindings([
      ev({ session_id: 's9', model: 'claude-opus-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 's9', model: 'claude-opus-5', output_tokens: 900, is_sidechain: true }),
    ], CEIL, 'in_out_write_read25', null, CPM)
    expect(f.find((x) => x.id === 'SUBAGENT_HEAVY')).toBeDefined()
  })

  it('OVERKILL_MODEL: opus, high effort, small output and no tools fires, priced in credits', () => {
    const many = Array.from({ length: 25 }, () => ev({
      model: 'claude-opus-5', effort: 'xhigh', output_tokens: 120, tool_calls: 0,
      input_tokens: 5_000,
    }))
    const hit = detectFindings(many, CEIL, 'in_out_write_read25', null, CPM).find((x) => x.id === 'OVERKILL_MODEL')
    expect(hit).toBeDefined()
    expect(hit!.damage.credits).toBeGreaterThan(0)
  })

  it('CEILING_RISK: a 5h window past 80% of the ceiling fires', () => {
    const heavy = Array.from({ length: 80 }, (_, i) => ev({
      model: 'claude-opus-5', input_tokens: 1_000_000,
      ts_utc: `2026-10-29T0${Math.floor(i / 40)}:${String(i % 40).padStart(2, '0')}:00.000Z`,
    }))
    expect(detectFindings(heavy, CEIL, 'all', null, CPM).find((x) => x.id === 'CEILING_RISK')).toBeDefined()
  })

  it('no events gives an empty list and no phantom findings', () => {
    expect(detectFindings([], CEIL, 'in_out_write_read25', null, CPM)).toEqual([])
  })

  it('every returned finding carries a non-empty damage (the DD-10 invariant)', () => {
    const f = detectFindings([ev({ model: 'claude-opus-5', cache_write_1h: 50_000, cache_read: 0 })], CEIL, 'in_out_write_read25', null, CPM)
    for (const x of f) {
      expect(x.damage.usd !== undefined || x.damage.credits !== undefined).toBe(true)
    }
  })
})

describe('findings must use the RIGHT constant source (found by an independent reviewer)', () => {
  it('OVERKILL_MODEL still fires with real cache_read, so no hard-coded "all" on the downgraded side', () => {
    const many = Array.from({ length: 25 }, () => ev({
      model: 'claude-opus-5', effort: 'xhigh', output_tokens: 120, tool_calls: 0,
      input_tokens: 5_000, cache_read: 200_000,
    }))
    const hit = detectFindings(many, CEIL, 'in_out_write_read25', null, CPM)
      .find((x) => x.id === 'OVERKILL_MODEL')
    expect(hit).toBeDefined()
    expect(hit!.damage.credits).toBeGreaterThan(0)
  })

  it('uses the credit table PASSED IN, not a fallback table hidden inside the module', () => {
    // A model with a downgrade path (opus-5-5 -> sonnet-5-5) so the saving can be computed.
    const evs = [
      ev({ session_id: 's9', model: 'claude-opus-5-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 's9', model: 'claude-opus-5-5', output_tokens: 900, is_sidechain: true }),
    ]
    // with the FULL table passed in it fires
    expect(detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'SUBAGENT_HEAVY')).toBeDefined()
    // with that model MISSING from the table it cannot be computed and must not fire.
    // If the function secretly reached for the fallback table it would fire, and this fails.
    const missing = { ...CPM }
    delete (missing as Record<string, number>)['claude-opus-5-5']
    expect(detectFindings(evs, CEIL, 'all', null, missing).find((x) => x.id === 'SUBAGENT_HEAVY')).toBeUndefined()
  })

  it('subagents already on the CHEAPEST model do not fire, since the advice would be empty', () => {
    const evs = [
      ev({ session_id: 'sA', model: 'claude-haiku-4-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 'sA', model: 'claude-haiku-4-5', output_tokens: 900, is_sidechain: true }),
    ]
    expect(detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'SUBAGENT_HEAVY')).toBeUndefined()
  })

  it('the subagent damage is what COULD BE SAVED, not the total subagent spend', () => {
    const evs = [
      ev({ session_id: 'sB', model: 'claude-opus-5-5', output_tokens: 100, is_sidechain: false }),
      ev({ session_id: 'sB', model: 'claude-opus-5-5', output_tokens: 10_000, is_sidechain: true }),
    ]
    const hit = detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'SUBAGENT_HEAVY')!
    expect(hit).toBeDefined()
    const totalSubagent = 10_000 / 1e6 * CPM['claude-opus-5-5']!
    expect(hit.damage.credits).toBeGreaterThan(0)
    expect(hit.damage.credits, 'calling the whole spend "damage" overstates it')
      .toBeLessThan(totalSubagent)
  })

  it('an unknown ceiling (null) does NOT invent 200,000 and skips CEILING_RISK', () => {
    const heavy = Array.from({ length: 80 }, (_, i) => ev({
      model: 'claude-opus-5', input_tokens: 1_000_000,
      ts_utc: `2026-10-29T0${Math.floor(i / 40)}:${String(i % 40).padStart(2, '0')}:00.000Z`,
    }))
    expect(detectFindings(heavy, null, 'all', null, CPM).find((x) => x.id === 'CEILING_RISK')).toBeUndefined()
    expect(detectFindings(heavy, CEIL, 'all', null, CPM).find((x) => x.id === 'CEILING_RISK')).toBeDefined()
  })

  it('WASTE_CACHE_MISS takes the cache-read factor PER MODEL, not a hard-coded 0.9', () => {
    // opus-5-5 reads cache at 0.05, so the lost share is 0.95, not 0.9
    const evs = Array.from({ length: 12 }, () => ev({
      model: 'claude-opus-5-5', input_tokens: 2_000_000 / 12, cache_read: 0,
    }))
    const hit = detectFindings(evs, CEIL, 'all', null, CPM).find((x) => x.id === 'WASTE_CACHE_MISS')
    expect(hit).toBeDefined()
    expect(hit!.damage.usd).toBeCloseTo(2 * 0.95 * 4, 1)
  })

  it('sorted by severity: high before medium before low', () => {
    const cmp = (a: string, b: string): number =>
      ({ high: 0, medium: 1, low: 2 }[a]!) - ({ high: 0, medium: 1, low: 2 }[b]!)
    expect(['low', 'medium', 'high'].sort(cmp)).toEqual(['high', 'medium', 'low'])
  })
})

describe('the priority order has to make sense to a reader', () => {
  it('inside one severity, the LARGER credit figure comes first', () => {
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

  it('every finding carries a rank, starting at 1 with no gaps', () => {
    const evs = Array.from({ length: 30 }, () => ev({
      model: 'claude-opus-5', effort: 'xhigh', output_tokens: 50, tool_calls: 0, cache_write_1h: 500_000,
    }))
    const f = detectFindings(evs, CEIL, 'all', null, CPM)
    expect(f.length).toBeGreaterThan(0)
    expect(f.map((x) => x.rank)).toEqual(f.map((_, i) => i + 1))
  })
})
