import { expect } from 'vitest'
import { CcError, type CcErrorCode } from '../src/errors.js'

/** Khẳng định ĐÚNG MÃ lỗi, không phụ thuộc câu chữ message.
 *  Chống xanh giả: một Error chung (vd stub NOT_IMPLEMENTED) sẽ KHÔNG qua được. */
export function expectCode(fn: () => unknown, code: CcErrorCode): void {
  let caught: unknown
  try { fn() } catch (e) { caught = e }
  expect(caught, `phải ném CcError(${code})`).toBeInstanceOf(CcError)
  expect((caught as CcError).code).toBe(code)
}

export async function expectCodeAsync(p: Promise<unknown>, code: CcErrorCode): Promise<void> {
  let caught: unknown
  try { await p } catch (e) { caught = e }
  expect(caught, `phải ném CcError(${code})`).toBeInstanceOf(CcError)
  expect((caught as CcError).code).toBe(code)
}
