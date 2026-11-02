export interface FileState { path: string; size_bytes: number; mtime_ms: number; bytes_consumed: number }
export type ScanAction = { path: string; from: number } | { path: string; skip: true }
export interface OnDisk { path: string; size_bytes: number; mtime_ms: number }

/**
 * Watermark theo BYTE (DD-6). Ba ca, test cả ba:
 *   chưa biết                          ⇒ từ 0
 *   size < bytes_consumed (bị ghi lại) ⇒ từ 0  — KHÔNG tin offset cũ
 *   size & mtime không đổi             ⇒ bỏ qua
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
