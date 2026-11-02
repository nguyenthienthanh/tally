/**
 * A domain error that carries a code, so a test can assert the EXACT code instead of
 * just "something threw". A stub that throws a plain Error turns every `.toThrow()`
 * green for the wrong reason (the "gate that always reports busy" trap,
 * rules/no-dead-code-no-crossed-jobs.md section 2).
 */
export class CcError extends Error {
  constructor(public readonly code: CcErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'CcError'
  }
}

export type CcErrorCode =
  | 'UNKNOWN_MODEL_PRICING'
  | 'INSIGHT_NO_CONSENT'
