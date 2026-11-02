import { describe, it, expect } from 'vitest'
import { buildReadings, type DeterministicValue } from '../src/insight/readings.js'

const base: DeterministicValue = {
  sessions: 100, tool_errors: 10, interruptions: 5, destructive_commands: 2, would_prompt: 50,
  top_tools: [['Read', 600], ['Bash', 200], ['Write', 100], ['mcp__x__y', 100]],
  error_categories: { Other: 5, 'Command Failed': 5 },
  hour_histogram: Array.from({ length: 24 }, (_, h) => (h === 22 ? 100 : 10)),
  response_time_buckets: { '<2s': 1, '2-10s': 1, '10-30s': 1, '30s-1m': 1, '2-5m': 20, '15m+': 6 },
}
const find = (rs: ReturnType<typeof buildReadings>, id: string) => rs.find((r) => r.id === id)

describe('readings, not a list of names', () => {
  const r = buildReadings(base)

  it('the peak hour comes from the histogram, with its share', () => {
    const x = find(r, 'peakHour')!
    expect(x.value).toBe(22)
    expect(Number(x.params!.share)).toBeGreaterThan(20)
  })

  it('after-hours is computed correctly and flagged past half', () => {
    const x = find(r, 'afterHours')!
    // 14 hours fall outside 08:00 to 18:00, and hour 22 alone holds 100, so most work is after hours
    expect(x.value).toBeGreaterThan(40)
    expect(x.flag).toBe('watch')
  })

  it('read to write ratio: 600 reads over 300 writes is 2.0', () => {
    expect(find(r, 'readShare')!.value).toBe(60)
    expect(find(r, 'readWriteRatio')!.value).toBe(2)
    expect(find(r, 'readWriteRatio')!.flag).toBeUndefined()
  })

  it('reading far more than writing gets flagged', () => {
    const heavy = buildReadings({ ...base, top_tools: [['Read', 900], ['Write', 100]] })
    expect(find(heavy, 'readWriteRatio')!.value).toBe(9)
    expect(find(heavy, 'readWriteRatio')!.flag).toBe('watch')
  })

  it('the tool error rate is over TOTAL calls, not over sessions', () => {
    const x = find(r, 'toolErrorRate')!
    expect(x.value).toBe(1)              // 10 / 1000
    expect(x.params!.total).toBe(1000)
    expect(x.flag).toBeUndefined()
  })

  it('a tool error rate above 5% gets flagged', () => {
    const bad = buildReadings({ ...base, tool_errors: 100 })
    expect(find(bad, 'toolErrorRate')!.flag).toBe('watch')
  })

  it('permission friction: occurrences per session', () => {
    const x = find(r, 'permissionFriction')!
    expect(x.value).toBe(0.5)
    expect(x.params!.total).toBe(50)
    expect(x.flag).toBeUndefined()
  })

  it('the median reply time is the BUCKET holding the midpoint', () => {
    expect(find(r, 'replyTime')!.text).toBe('2-5m')
  })

  it('the MCP share is computed correctly', () => {
    expect(find(r, 'mcpShare')!.value).toBe(10)
  })

  it('with no data the reading is skipped, never invented as 0', () => {
    const empty = buildReadings({
      ...base, hour_histogram: [], response_time_buckets: {}, top_tools: [], would_prompt: 0,
      destructive_commands: 0,
    })
    for (const id of ['peakHour', 'afterHours', 'replyTime', 'readShare', 'toolErrorRate', 'permissionFriction', 'destructive']) {
      expect(find(empty, id), id).toBeUndefined()
    }
    // what can be computed from sessions is still there
    expect(find(empty, 'interruptRate')).toBeDefined()
  })

  it('no division by zero when there are no sessions yet', () => {
    expect(() => buildReadings({ ...base, sessions: 0 })).not.toThrow()
  })
})
