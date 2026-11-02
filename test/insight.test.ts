import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readSessionMeta, readFacets, aggregateDeterministic, aggregateFriction,
} from '../src/insight/sources.js'
import { refreshInsights, estimateRefreshPct, MEASURED_REFRESH } from '../src/insight/run.js'
import { findExistingReports } from '../src/insight/import.js'
import { expectCodeAsync } from './throws.js'

/** Build a fake usage-data directory with the EXACT shape verified on a real machine on 2026-10-29. */
let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tally-'))
  mkdirSync(join(dir, 'session-meta'), { recursive: true })
  mkdirSync(join(dir, 'facets'), { recursive: true })

  const meta = (id: string, over: Record<string, unknown> = {}) => ({
    session_id: id, project_path: '/tmp/p', start_time: '2026-10-28T17:30:00.000Z',
    duration_minutes: 12, user_message_count: 4, assistant_message_count: 9,
    tool_counts: { Bash: 10, Read: 5 }, tool_errors: 3,
    tool_error_categories: { command_failed: 2, file_not_found: 1 },
    user_interruptions: 1, destructive_command_count: 0, bash_would_prompt_count: 2,
    files_modified: 2, lines_added: 30, lines_removed: 4, git_commits: 1, git_pushes: 0,
    input_tokens: 100, output_tokens: 200,
    uses_mcp: false, uses_task_agent: true, uses_web_search: false, uses_web_fetch: true,
    user_response_times: [5, 45], message_hours: [0, 1], ...over,
  })
  for (const id of ['s1', 's2', 's3']) {
    writeFileSync(join(dir, 'session-meta', `${id}.json`), JSON.stringify(meta(id)))
  }
  // ONLY 1 facet for 3 sessions, a 1 in 3 sample, which matches reality (9 facets over 200 sessions)
  writeFileSync(join(dir, 'facets', 's1.json'), JSON.stringify({
    session_id: 's1', outcome: 'mostly_achieved', session_type: 'multi_task',
    claude_helpfulness: 'very_helpful',
    friction_counts: { buggy_code: 2, wrong_approach: 1 },
    user_satisfaction_counts: { likely_satisfied: 3 },
    underlying_goal: 'get the pipeline running',
  }))
  writeFileSync(join(dir, 'report.html'), '<html>bao cao</html>')
  writeFileSync(join(dir, 'report-2026-10-29-104448.html'), '<html>bao cao cu</html>')
})

describe('reading what /insights left behind: FREE, no model call', () => {
  it('reads session-meta with its 30 deterministic keys', () => {
    const m = readSessionMeta(join(dir, 'session-meta'))
    expect(m).toHaveLength(3)
    expect(m[0]!.tool_errors).toBe(3)
    expect(m[0]!.tool_error_categories.command_failed).toBe(2)
  })

  it('reads the facets', () => {
    expect(readFacets(join(dir, 'facets'))).toHaveLength(1)
  })

  it('an empty directory returns [] instead of throwing (the gate is right at the negative end)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'tally-empty-'))
    expect(readSessionMeta(empty)).toEqual([])
    expect(readFacets(empty)).toEqual([])
  })

  it('finds an existing report, newest first (AC-9.8)', () => {
    const r = findExistingReports(dir)
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r[0]!.mtime).toBeGreaterThanOrEqual(r[1]!.mtime)
  })
})

describe('EVERY figure carries its provenance (revised DD-13)', () => {
  it('deterministic stats: provenance=deterministic, sample_size=population', () => {
    const a = aggregateDeterministic(readSessionMeta(join(dir, 'session-meta')))
    expect(a.provenance).toBe('deterministic')
    expect(a.sample_size).toBe(3)
    expect(a.population).toBe(3)
    expect(a.value.tool_errors).toBe(9)       // 3 sessions x 3 errors
    expect(a.value.interruptions).toBe(3)
    expect(a.value.top_tools[0]).toEqual(['Bash', 30])
  })

  it('friction from facets: provenance=llm_derived and sample_size < population', () => {
    const metas = readSessionMeta(join(dir, 'session-meta'))
    const f = aggregateFriction(readFacets(join(dir, 'facets')), metas.length)
    expect(f.provenance).toBe('llm_derived')
    expect(f.sample_size).toBe(1)
    expect(f.population).toBe(3)
    expect(f.value.buggy_code).toBe(2)
  })

  it('the two sources are never mixed: the deterministic total is untouched by facets', () => {
    const metas = readSessionMeta(join(dir, 'session-meta'))
    const det = aggregateDeterministic(metas)
    const fr = aggregateFriction(readFacets(join(dir, 'facets')), metas.length)
    // tool_errors is deterministic (9), buggy_code is inferred (2): two different worlds
    expect(det.value.tool_errors).toBe(9)
    expect(Object.keys(fr.value)).not.toContain('tool_errors')
  })

  it('the hour histogram uses message_hours and invents nothing', () => {
    const a = aggregateDeterministic(readSessionMeta(join(dir, 'session-meta')))
    expect(a.value.hour_histogram).toHaveLength(24)
    expect(a.value.hour_histogram[0]).toBe(3)
    expect(a.value.hour_histogram[5]).toBe(0)
  })

  it('reply-time buckets follow the /insights boundaries (2-10s up to >15m)', () => {
    const a = aggregateDeterministic(readSessionMeta(join(dir, 'session-meta')))
    expect(a.value.response_time_buckets['2-10s']).toBe(3)
    expect(a.value.response_time_buckets['30s-1m']).toBe(3)
  })
})

describe('a refresh really runs `claude -p "/insights"`, so it MUST ask first (AC-9.4, DD-12)', () => {
  const CEIL = 200_000

  it('without consent it throws INSIGHT_NO_CONSENT and spawns nothing', async () => {
    await expectCodeAsync(refreshInsights({ consented: false }), 'INSIGHT_NO_CONSENT')
  })

  it('the ceiling percentage comes from a MEASURED figure, not an invented one', () => {
    expect(estimateRefreshPct(CEIL))
      .toBeCloseTo(MEASURED_REFRESH.credits / CEIL * 100, 6)
  })

  it('on a smaller plan the same refresh takes a LARGER share', () => {
    expect(estimateRefreshPct(50_000)).toBeGreaterThan(estimateRefreshPct(200_000))
  })

  it('a measured constant carries the date it was measured, so it cannot go stale unnoticed', () => {
    expect(MEASURED_REFRESH.measured_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(MEASURED_REFRESH.credits).toBeGreaterThan(0)
    expect(MEASURED_REFRESH.seconds).toBeGreaterThan(0)
  })
})
