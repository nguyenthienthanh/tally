import { expect } from 'vitest'
import { CcError, type CcErrorCode } from '../src/errors.js'

/** Assert the EXACT error code, independent of the message text.
 *  Guards against a false green: a plain Error (a NOT_IMPLEMENTED stub, say) will NOT pass. */
export function expectCode(fn: () => unknown, code: CcErrorCode): void {
  let caught: unknown
  try { fn() } catch (e) { caught = e }
  expect(caught, `must throw CcError(${code})`).toBeInstanceOf(CcError)
  expect((caught as CcError).code).toBe(code)
}

export async function expectCodeAsync(p: Promise<unknown>, code: CcErrorCode): Promise<void> {
  let caught: unknown
  try { await p } catch (e) { caught = e }
  expect(caught, `must throw CcError(${code})`).toBeInstanceOf(CcError)
  expect((caught as CcError).code).toBe(code)
}
