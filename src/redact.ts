import { createHash } from 'node:crypto'

/**
 * Anonymise a project path so a screenshot can be shared safely (AC-7.3).
 *
 * The hash is stable, so the same project still groups together, but the folder name
 * is gone. The length of the last segment is kept so the owner of the machine can
 * still recognise their own project.
 */
export function redactPath(p: string | null): string {
  if (!p) return 'project-?'
  const h = createHash('sha256').update(p).digest('hex').slice(0, 8)
  const base = p.split('/').filter(Boolean).pop() ?? ''
  return `project-${h}-${base.length}c`
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
