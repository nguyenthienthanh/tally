import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Find an existing `/insights` report (AC-9b.8). Read only, spends no quota. Newest first. */
export function findExistingReports(dir: string): Array<{ path: string; mtime: number }> {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const out: Array<{ path: string; mtime: number }> = []
  for (const n of names) {
    if (!/^report.*\.(html|md)$/.test(n)) continue
    const p = join(dir, n)
    try { out.push({ path: p, mtime: statSync(p).mtimeMs }) } catch { /* skip */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}
