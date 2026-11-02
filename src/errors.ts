/** Lỗi nghiệp vụ có mã — test phải khẳng định ĐÚNG mã, không chỉ "có ném lỗi".
 *  Lý do: stub ném Error chung sẽ làm mọi test .toThrow() xanh giả
 *  (bẫy "cổng luôn-báo-bận", rules/no-dead-code-no-crossed-jobs.md §2). */
export class CcError extends Error {
  constructor(public readonly code: CcErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'CcError'
  }
}

export type CcErrorCode =
  | 'UNKNOWN_MODEL_PRICING'
  | 'INSIGHT_NO_CONSENT'

