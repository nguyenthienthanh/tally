export interface FileState { path: string; size_bytes: number; mtime_ms: number; bytes_consumed: number }
export type ScanAction = { path: string; from: number } | { path: string; skip: true }
export interface OnDisk { path: string; size_bytes: number; mtime_ms: number }

/**
 * A per-file BYTE watermark (DD-6). Three cases, all three covered by tests:
 *   unknown file                          -> read from 0
 *   size < bytes_consumed (file rewritten) -> read from 0, never trust the old offset
 *   size and mtime unchanged               -> skip
 */
export function planScan(onDisk: OnDisk[], known: Map<string, FileState>): ScanAction[] {
  return onDisk.map((f) => {
    const prev = known.get(f.path)
    if (!prev) return { path: f.path, from: 0 }
    if (f.size_bytes < prev.bytes_consumed) return { path: f.path, from: 0 }
    if (f.size_bytes === prev.bytes_consumed && f.mtime_ms === prev.mtime_ms) {
      return { path: f.path, skip: true as const }
    }
    return { path: f.path, from: prev.bytes_consumed }
  })
}
