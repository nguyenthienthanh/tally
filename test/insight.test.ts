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

/** Dựng một thư mục usage-data giả theo ĐÚNG hình dạng thật đã xác minh trên máy 2026-10-29. */
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
  // CHỈ 1 facet cho 3 phiên — mẫu 1/3, đúng tình huống thật (9 facet / 200 phiên)
  writeFileSync(join(dir, 'facets', 's1.json'), JSON.stringify({
    session_id: 's1', outcome: 'mostly_achieved', session_type: 'multi_task',
    claude_helpfulness: 'very_helpful',
    friction_counts: { buggy_code: 2, wrong_approach: 1 },
    user_satisfaction_counts: { likely_satisfied: 3 },
    underlying_goal: 'làm cho pipeline chạy',
  }))
  writeFileSync(join(dir, 'report.html'), '<html>bao cao</html>')
  writeFileSync(join(dir, 'report-2026-10-29-104448.html'), '<html>bao cao cu</html>')
})

describe('đọc dữ liệu /insights để lại — MIỄN PHÍ, không gọi LLM', () => {
  it('đọc được session-meta với 30 khoá tất định', () => {
    const m = readSessionMeta(join(dir, 'session-meta'))
    expect(m).toHaveLength(3)
    expect(m[0]!.tool_errors).toBe(3)
    expect(m[0]!.tool_error_categories.command_failed).toBe(2)
  })

  it('đọc được facets', () => {
    expect(readFacets(join(dir, 'facets'))).toHaveLength(1)
  })

  it('thư mục rỗng ⇒ [] chứ không ném lỗi (cổng đúng ở đầu âm)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'tally-empty-'))
    expect(readSessionMeta(empty)).toEqual([])
    expect(readFacets(empty)).toEqual([])
  })

  it('tìm được báo cáo có sẵn, mới nhất trước (AC-9.8)', () => {
    const r = findExistingReports(dir)
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r[0]!.mtime).toBeGreaterThanOrEqual(r[1]!.mtime)
  })
})

describe('MỖI con số phải mang nhãn nguồn (DD-13 bản mới)', () => {
  it('thống kê tất định: provenance=deterministic, sample_size=population', () => {
    const a = aggregateDeterministic(readSessionMeta(join(dir, 'session-meta')))
    expect(a.provenance).toBe('deterministic')
    expect(a.sample_size).toBe(3)
    expect(a.population).toBe(3)
    expect(a.value.tool_errors).toBe(9)       // 3 phiên × 3 lỗi
    expect(a.value.interruptions).toBe(3)
    expect(a.value.top_tools[0]).toEqual(['Bash', 30])
  })

  it('ma sát từ facets: provenance=llm_derived và sample_size < population', () => {
    const metas = readSessionMeta(join(dir, 'session-meta'))
    const f = aggregateFriction(readFacets(join(dir, 'facets')), metas.length)
    expect(f.provenance).toBe('llm_derived')
    expect(f.sample_size).toBe(1)
    expect(f.population).toBe(3)
    expect(f.value.buggy_code).toBe(2)
  })

  it('KHÔNG được trộn hai nguồn: tổng tất định không bị facets làm thay đổi', () => {
    const metas = readSessionMeta(join(dir, 'session-meta'))
    const det = aggregateDeterministic(metas)
    const fr = aggregateFriction(readFacets(join(dir, 'facets')), metas.length)
    // tool_errors là tất định (9); buggy_code là suy luận (2) — hai thế giới khác nhau
    expect(det.value.tool_errors).toBe(9)
    expect(Object.keys(fr.value)).not.toContain('tool_errors')
  })

  it('histogram giờ dùng message_hours, không bịa', () => {
    const a = aggregateDeterministic(readSessionMeta(join(dir, 'session-meta')))
    expect(a.value.hour_histogram).toHaveLength(24)
    expect(a.value.hour_histogram[0]).toBe(3)
    expect(a.value.hour_histogram[5]).toBe(0)
  })

  it('bucket thời gian phản hồi theo mốc của /insights (2-10s…>15m)', () => {
    const a = aggregateDeterministic(readSessionMeta(join(dir, 'session-meta')))
    expect(a.value.response_time_buckets['2-10s']).toBe(3)
    expect(a.value.response_time_buckets['30s-1m']).toBe(3)
  })
})

describe('làm mới = chạy `claude -p "/insights"` thật ⇒ PHẢI xin phép (AC-9.4, DD-12)', () => {
  const CEIL = 200_000

  it('chưa đồng ý ⇒ ném INSIGHT_NO_CONSENT và KHÔNG spawn claude', async () => {
    await expectCodeAsync(refreshInsights({ consented: false }), 'INSIGHT_NO_CONSENT')
  })

  it('ước tính % trần tính từ số ĐO THẬT, không phải số bịa', () => {
    expect(estimateRefreshPct(CEIL))
      .toBeCloseTo(MEASURED_REFRESH.credits / CEIL * 100, 6)
  })

  it('gói nhỏ hơn ⇒ cùng một lần làm mới chiếm % LỚN hơn', () => {
    expect(estimateRefreshPct(50_000)).toBeGreaterThan(estimateRefreshPct(200_000))
  })

  it('hằng số đo thật phải có ngày đo (chống số lạc hậu không ai biết)', () => {
    expect(MEASURED_REFRESH.measured_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(MEASURED_REFRESH.credits).toBeGreaterThan(0)
    expect(MEASURED_REFRESH.seconds).toBeGreaterThan(0)
  })
})
