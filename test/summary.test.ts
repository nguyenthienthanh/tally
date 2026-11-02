import { describe, it, expect } from 'vitest'
import { summaryByModel, summaryByProject, currentWindow, periodWindow } from '../src/engine/summary.js'
import { redactPath } from '../src/redact.js'
import { CREDITS_PER_MTOK_FALLBACK as CPM } from '../src/data/credits-fallback.js'
import { ev } from './helpers.js'

const CEIL = 200_000
const W = { startMs: Date.parse('2026-10-29T00:00:00Z'), endMs: Date.parse('2026-10-29T05:00:00Z') }

describe('summaryByModel: ONE source for both the server and the CLI', () => {
  const events = [
    ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-29T01:00:00.000Z' }),
    ev({ model: 'claude-sonnet-5-5', input_tokens: 1_000_000, ts_utc: '2026-10-20T01:00:00.000Z' }),
  ]

  it('the ceiling percentage is computed OVER THE WINDOW, not over all time', () => {
    const s = summaryByModel(events, CPM, 'in_out_write_read25', CEIL, W)
    const row = s.rows.find((r) => r.model === 'claude-sonnet-5-5')!
    expect(row.credits_lifetime).toBeCloseTo(2500, 6)   // both events
    expect(row.credits_5h).toBeCloseTo(1250, 6)         // only the event inside the window
    expect(row.pct_of_ceiling).toBeCloseTo(1250 / CEIL * 100, 6)
  })

  it('with no ceiling the pct is null, never an invented 0%', () => {
    const s = summaryByModel(events, CPM, 'all', null, W)
    expect(s.rows[0]!.pct_of_ceiling).toBeNull()
  })

  it('an empty window gives credits_5h = 0 while lifetime survives (both ends of the gate)', () => {
    const s = summaryByModel(events, CPM, 'all', CEIL,
      { startMs: Date.parse('2030-01-01T00:00:00Z'), endMs: Date.parse('2030-01-01T05:00:00Z') })
    expect(s.window.events).toBe(0)
    expect(s.rows[0]!.credits_5h).toBe(0)
    expect(s.rows[0]!.credits_lifetime).toBeGreaterThan(0)
  })

  it('currentWindow uses rate-limits when present and spans exactly five hours when not', () => {
    const w = currentWindow({ five_hour_reset: 1793256600, captured_at: 1793242400 })
    expect(w.startMs).toBe((1793256600 - 18000) * 1000)
    const w2 = currentWindow(null)
    expect(w2.endMs - w2.startMs).toBe(5 * 3600 * 1000)
  })
})

describe('"unknown" is NOT "zero" (AC-2.3)', () => {
  it('a model with no credit rate gives credits_known=false and pct=null', () => {
    const s = summaryByModel(
      [ev({ model: 'claude-haiku-5-5', output_tokens: 1_000_000, ts_utc: '2026-10-29T01:00:00.000Z' })],
      CPM, 'all', CEIL, W)
    const row = s.rows.find((r) => r.model === 'claude-haiku-5-5')!
    expect(row.credits_known).toBe(false)
    expect(row.pct_of_ceiling).toBeNull()
    expect(row.usd).toBeGreaterThan(0)   // the PRICE is still known, only the credit rate is not
  })

  it('a model WITH a rate gives credits_known=true (the gate is right at both ends)', () => {
    const s = summaryByModel(
      [ev({ model: 'claude-sonnet-5-5', output_tokens: 1_000_000, ts_utc: '2026-10-29T01:00:00.000Z' })],
      CPM, 'all', CEIL, W)
    expect(s.rows[0]!.credits_known).toBe(true)
    expect(s.rows[0]!.pct_of_ceiling).not.toBeNull()
  })
})

describe('cost by project, and anonymising', () => {
  const events = [
    ev({ model: 'claude-opus-5', output_tokens: 1000, project_key: '/Users/e/p/ai-mv-factory', ts_utc: '2026-10-29T01:00:00.000Z' }),
    ev({ model: 'claude-opus-5', output_tokens: 500, project_key: '/Users/e/p/ai-mv-factory', is_sidechain: true, ts_utc: '2026-10-29T01:00:00.000Z' }),
    ev({ model: 'claude-opus-5', output_tokens: 100, project_key: '/Users/e/p/games', ts_utc: '2026-10-29T01:00:00.000Z' }),
  ]

  it('groups by project and separates the subagent share', () => {
    const rows = summaryByProject(events, CPM, 'all')
    const f = rows.find((r) => r.project.includes('ai-mv-factory'))!
    expect(f.events).toBe(2)
    expect(f.sidechain_usd).toBeGreaterThan(0)
    expect(f.sidechain_usd).toBeLessThan(f.usd)
  })

  it('anonymising does NOT change the grouping (still 2 projects) and leaks no name', () => {
    const rows = summaryByProject(events, CPM, 'all', redactPath)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.project).not.toContain('ai-mv-factory')
    const plain = summaryByProject(events, CPM, 'all')
    expect(rows.map((r) => r.events).sort()).toEqual(plain.map((r) => r.events).sort())
  })
})

describe('the selected period, which fixed the "other models show 0% although they were used" case', () => {
  const H = 3600_000
  const now = Date.parse('2026-10-29T18:00:00.000Z')
  const mk = (model: string, hoursAgo: number) =>
    ev({ model, output_tokens: 1000, ts_utc: new Date(now - hoursAgo * H).toISOString() })
  const events = [
    mk('claude-opus-5', 1), mk('claude-opus-5', 2),
    mk('claude-sonnet-5-5', 9),      // outside 5h, inside 24h
    mk('claude-sonnet-4-6', 72),     // outside 24h, inside 7d
  ]
  const win = (p: Parameters<typeof periodWindow>[0]) => periodWindow(p, now)

  it('5h: only models that ran inside that window have figures, which is NOT a bug', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('5h'), true)
    expect(r.rows.find((x) => x.model === 'claude-opus-5')!.credits_period).toBeGreaterThan(0)
    expect(r.rows.find((x) => x.model === 'claude-sonnet-5-5')!.credits_period).toBe(0)
  })

  it('24h: sonnet-5-5 shows up', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('24h'), false)
    expect(r.rows.find((x) => x.model === 'claude-sonnet-5-5')!.credits_period).toBeGreaterThan(0)
    expect(r.rows.find((x) => x.model === 'claude-sonnet-4-6')!.credits_period).toBe(0)
  })

  it('7d: all three models have figures', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('7d'), false)
    for (const m of ['claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6']) {
      expect(r.rows.find((x) => x.model === m)!.credits_period, m).toBeGreaterThan(0)
    }
  })

  it('share_pct adds up to 100% inside the period', () => {
    const r = summaryByModel(events, CPM, 'all', CEIL, win('7d'), false)
    const total = r.rows.reduce((s, x) => s + (x.share_pct ?? 0), 0)
    expect(total).toBeCloseTo(100, 6)
  })

  it('the ceiling percentage ONLY means anything in the 5h window; other periods must be null, not a wrong number', () => {
    const five = summaryByModel(events, CPM, 'all', CEIL, win('5h'), true)
    const week = summaryByModel(events, CPM, 'all', CEIL, win('7d'), false)
    expect(five.rows.find((x) => x.model === 'claude-opus-5')!.pct_of_ceiling).toBeGreaterThan(0)
    expect(week.rows.every((x) => x.pct_of_ceiling === null)).toBe(true)
  })

  it('"all" takes the whole history, and credits_lifetime does not move with the period', () => {
    const a = summaryByModel(events, CPM, 'all', CEIL, win('5h'), true)
    const b = summaryByModel(events, CPM, 'all', CEIL, win('all'), false)
    const life = (r: typeof a) => r.rows.find((x) => x.model === 'claude-sonnet-4-6')!.credits_lifetime
    expect(life(a)).toBe(life(b))
    expect(b.rows.find((x) => x.model === 'claude-sonnet-4-6')!.credits_period).toBe(life(b))
  })
})

describe('the current 5-hour window', () => {
  it('reset = 0 (nothing used yet) must NOT turn the window into all time', () => {
    const w = currentWindow({ five_hour_reset: 0, captured_at: 1_793_590_805 })
    expect(w.endMs).toBe(1_793_590_805_000)
    expect(w.endMs - w.startMs).toBe(5 * 3600 * 1000)
    expect(w.startMs).toBeGreaterThan(0)
  })

  it('with a running window it anchors to the reset timestamp', () => {
    const w = currentWindow({ five_hour_reset: 1_793_594_234, captured_at: 1_793_590_634 })
    expect(w.startMs).toBe((1_793_594_234 - 5 * 3600) * 1000)
  })
})
