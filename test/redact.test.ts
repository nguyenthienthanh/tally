import { describe, it, expect } from 'vitest'
import { redactPath, redactRows } from '../src/redact.js'

describe('anonymising paths (AC-7.3)', () => {
  const P = '/Users/ethan/Projects/Personal/ai-mv-factory'

  it('leaks no part of the original path', () => {
    const r = redactPath(P)
    for (const seg of ['Users', 'ethan', 'Projects', 'Personal', 'ai-mv-factory']) {
      expect(r, seg).not.toContain(seg)
    }
  })

  it('is stable: the same path gives the same result, so grouping still works', () => {
    expect(redactPath(P)).toBe(redactPath(P))
  })

  it('a different path gives a different result', () => {
    expect(redactPath(P)).not.toBe(redactPath(P + '-2'))
  })

  it('null does not throw and returns a clear label', () => {
    expect(redactPath(null)).toBe('project-?')
  })

  it('redactRows touches only the named keys and leaves the figures alone', () => {
    const rows = [{ project_key: P, credits: 123 }]
    const out = redactRows(rows, ['project_key'])
    expect(out[0]!.credits).toBe(123)
    expect(out[0]!.project_key).not.toContain('ai-mv-factory')
  })
})
