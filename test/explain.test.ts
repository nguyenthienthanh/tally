import { describe, it, expect } from 'vitest'
import { buildPrompt, parseReply, estimate } from '../src/insight/explain.js'

describe('the explain prompt', () => {
  const nums = { probe_pct: 55.9, not_hand_driven_pct: 56 }

  it('names the language, and the number of points follows the depth', () => {
    expect(buildPrompt(nums, 'vi', 'brief')).toContain('Vietnamese')
    expect(buildPrompt(nums, 'zh', 'full')).toContain('Simplified Chinese')
    expect(buildPrompt(nums, 'en', 'brief')).toContain('exactly 3 points')
    expect(buildPrompt(nums, 'en', 'full')).toContain('exactly 6 points')
  })

  it('forbids inventing figures, and warns against attributing subagent behaviour to the person', () => {
    const p = buildPrompt(nums, 'vi', 'full')
    expect(p).toMatch(/Never invent a figure/i)
    expect(p).toMatch(/subagent/i)
  })

  it('carries the measured numbers into the prompt', () => {
    expect(buildPrompt(nums, 'vi', 'brief')).toContain('55.9')
  })
})

describe('parsing the reply', () => {
  const good = '{"headline":"h","points":[{"title":"t","why":"w","action":"a"}]}'

  it('bare JSON', () => {
    expect(parseReply(good)!.points).toHaveLength(1)
    expect(parseReply(good)!.headline).toBe('h')
  })

  it('JSON inside a markdown fence still parses', () => {
    expect(parseReply('```json\n' + good + '\n```')).not.toBeNull()
  })

  it('JSON with prose around it still parses', () => {
    expect(parseReply('Here is the result:\n' + good + '\nDone.')).not.toBeNull()
  })

  it('returns null on garbage, never an empty result that looks real', () => {
    expect(parseReply('hello there')).toBeNull()
    expect(parseReply('{"headline":"h"}')).toBeNull()        // no points
    expect(parseReply('{"headline":"h","points":[]}')).toBeNull()
    expect(parseReply('{"points":[{"why":"w"}]}')).toBeNull() // a point with no title
  })

  it('drops empty points and keeps the valid ones', () => {
    const r = parseReply('{"points":[{"title":""},{"title":"ok","why":"w","action":"a"}]}')
    expect(r!.points).toHaveLength(1)
    expect(r!.points[0]!.title).toBe('ok')
  })
})

describe('cost estimate from the LENGTH OF THE INPUT', () => {
  it('a longer input costs more', () => {
    expect(estimate(40_000, 'brief').from_payload).toBeGreaterThan(estimate(4_000, 'brief').from_payload)
  })

  it('more depth costs more and takes longer', () => {
    expect(estimate(8_000, 'full').from_payload).toBeGreaterThan(estimate(8_000, 'brief').from_payload)
    expect(estimate(8_000, 'full').seconds).toBeGreaterThan(estimate(8_000, 'brief').seconds)
  })

  it('is far cheaper than /insights (about 2,400 credits), which is why it exists', () => {
    expect(estimate(10_000, 'full').from_payload).toBeLessThan(2400 / 2)
  })

  it('never returns 0, because 0 credits is a false promise', () => {
    expect(estimate(0, 'brief').from_payload).toBeGreaterThan(0)
  })

  it('an unmeasured baseline gives total null and measured false, instead of a tidy number that is off by a hundred times', () => {
    const e = estimate(1200, 'brief')
    expect(e.total).toBeNull()
    expect(e.measured).toBe(false)
    const m = estimate(1200, 'brief', 2300)
    expect(m.total).toBe(m.from_payload + 2300)
    expect(m.measured).toBe(true)
  })
})
