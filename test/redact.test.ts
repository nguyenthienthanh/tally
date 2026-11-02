import { describe, it, expect } from 'vitest'
import { redactPath, redactRows } from '../src/redact.js'

describe('ẩn danh đường dẫn (AC-7.3)', () => {
  const P = '/Users/ethan/Projects/Personal/ai-mv-factory'

  it('không lộ bất kỳ phần nào của đường dẫn gốc', () => {
    const r = redactPath(P)
    for (const seg of ['Users', 'ethan', 'Projects', 'Personal', 'ai-mv-factory']) {
      expect(r, seg).not.toContain(seg)
    }
  })

  it('ổn định: cùng đường dẫn ⇒ cùng kết quả (để gộp nhóm vẫn đúng)', () => {
    expect(redactPath(P)).toBe(redactPath(P))
  })

  it('khác đường dẫn ⇒ khác kết quả', () => {
    expect(redactPath(P)).not.toBe(redactPath(P + '-2'))
  })

  it('null ⇒ không ném, trả nhãn rõ ràng', () => {
    expect(redactPath(null)).toBe('dự-án-?')
  })

  it('redactRows chỉ đụng khoá được nêu, giữ nguyên số liệu', () => {
    const rows = [{ project_key: P, credits: 123 }]
    const out = redactRows(rows, ['project_key'])
    expect(out[0]!.credits).toBe(123)
    expect(out[0]!.project_key).not.toContain('ai-mv-factory')
  })
})
