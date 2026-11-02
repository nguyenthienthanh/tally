import { createHash } from 'node:crypto'

/**
 * Ẩn danh đường dẫn dự án để chia sẻ ảnh chụp an toàn (AC-7.3).
 * Băm ổn định ⇒ cùng một dự án vẫn gộp đúng nhóm, nhưng không lộ tên thư mục.
 * Giữ lại tên cuối CÓ ĐỘ DÀI để người chủ máy vẫn tự nhận ra dự án của mình.
 */
export function redactPath(p: string | null): string {
  if (!p) return 'dự-án-?'
  const h = createHash('sha256').update(p).digest('hex').slice(0, 8)
  const base = p.split('/').filter(Boolean).pop() ?? ''
  return `dự-án-${h}-${base.length}c`
}

export function redactRows<T extends Record<string, unknown>>(
  rows: T[], keys: string[],
): T[] {
  return rows.map((r) => {
    const out = { ...r }
    for (const k of keys) {
      if (typeof out[k] === 'string') (out as Record<string, unknown>)[k] = redactPath(out[k] as string)
    }
    return out
  })
}
