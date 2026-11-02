import { createReadStream, readdirSync, statSync, mkdirSync, watch as watchFs } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { planScan, type FileState } from './scan.js'
import { parseLine } from './parse.js'

/** Một dòng tool_facts đã gộp — không mang chuỗi lệnh hay nội dung. */
export interface ToolFactRow {
  session_id: string; project_key: string | null; day: string
  tool: string; kind: string; verb: string | null; target: string | null
  ext: string | null; is_sidechain: number; entrypoint: string | null; n: number
}
import { insertEvents, upsertToolFacts, setMeta, getMeta } from './db.js'

/**
 * Tăng số này khi bộ bóc sự thật đổi cách tính.
 *
 * Index giữ watermark theo byte nên file đã quét sẽ bị bỏ qua mãi mãi. Thêm một
 * trường mới mà không quét lại thì bảng mới RỖNG trong im lặng — màn hình sẽ hiện
 * "chưa có dữ liệu" trong khi dữ liệu nằm sẵn trên đĩa.
 */
export const FACTS_VERSION = '3'
import type { UsageEvent } from '../types.js'

export function projectsDir(): string { return join(homedir(), '.claude', 'projects') }
export function dataDir(): string {
  const d = join(homedir(), '.tally')
  mkdirSync(d, { recursive: true })
  return d
}

/** Liệt kê file jsonl — dân số lấy TỪ NGUỒN (readdirSync), không chép tay. */
export function listTranscripts(root: string): Array<{ path: string; size_bytes: number; mtime_ms: number }> {
  const out: Array<{ path: string; size_bytes: number; mtime_ms: number }> = []
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.jsonl')) {
        try { const s = statSync(p); out.push({ path: p, size_bytes: s.size, mtime_ms: s.mtimeMs }) } catch { /* bỏ */ }
      }
    }
  }
  walk(root)
  return out
}

function knownFiles(db: DatabaseSync): Map<string, FileState> {
  // Bộ bóc đổi phiên bản ⇒ watermark cũ không còn đúng: quét lại từ đầu, một lần.
  // Để nguyên thì bảng mới rỗng trong im lặng, và đó là kiểu lỗi không ai thấy.
  if (getMeta(db, 'facts_version') !== FACTS_VERSION) {
    db.exec('DELETE FROM ingest_files')
    db.exec('DELETE FROM tool_facts')
    setMeta(db, 'facts_version', FACTS_VERSION)
    return new Map()
  }
  const rows = db.prepare('SELECT path, size_bytes, mtime_ms, bytes_consumed FROM ingest_files').all() as unknown as FileState[]
  return new Map(rows.map((r) => [r.path, r]))
}

export interface IngestStats {
  files_seen: number; files_scanned: number; files_skipped: number
  lines_ok: number; lines_bad: number; lines_degraded: number; rows_inserted: number
}

/**
 * Đọc một file từ `offset` tới EOF.
 * `consumed` chỉ cộng cho những dòng KẾT THÚC BẰNG NEWLINE — dòng cuối chưa trọn
 * (Claude Code đang ghi dở) không được tính, để lượt sau đọc lại nó TRỌN VẸN.
 *
 * Bản trước trừ `lastLen` (đã gồm newline ảo) khỏi `size`, nên lệch 1 byte về phía âm;
 * với file chỉ có một dòng chưa trọn thì ra **-1**, ghi vào SQLite rồi mọi lượt quét
 * sau đều ném ERR_OUT_OF_RANGE — index chết vĩnh viễn cho tới khi `--full`.
 */
async function readFrom(path: string, offset: number): Promise<{
  events: UsageEvent[]; ok: number; bad: number; degraded: number; consumed: number; facts: ToolFactRow[]
}> {
  const events: UsageEvent[] = []
  let ok = 0, bad = 0, degraded = 0
  let consumed = offset

  const size = statSync(path).size
  if (offset >= size) return { events, ok, bad, degraded, consumed: size, facts: [] }

  const stream = createReadStream(path, { start: offset, encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const pending: string[] = []
  let pendingBytes = 0

  for await (const line of rl) {
    // readline bỏ dấu kết dòng; ta cộng lại 1 byte cho '\n'.
    // Dòng CUỐI có thể không có newline — xử lý sau vòng lặp.
    pending.push(line)
    pendingBytes += Buffer.byteLength(line, 'utf8') + 1
  }

  // File kết thúc bằng newline ⇒ mọi dòng đều trọn. Nếu không, dòng cuối còn dở.
  const factAcc = new Map<string, ToolFactRow>()
  const endsWithNewline = pendingBytes + offset === size
  const complete = endsWithNewline ? pending : pending.slice(0, -1)
  const lastLine = endsWithNewline ? '' : (pending.at(-1) ?? '')

  for (const line of complete) {
    if (line.trim() === '') continue
    const r = parseLine(line)
    if (r.degraded) degraded += 1
    if (r.event) {
      events.push(r.event)
      ok += 1
      for (const f of r.facts ?? []) {
        const key = [r.event.session_id, f.tool, f.kind, f.verb ?? '', f.target ?? '', f.ext ?? '',
          r.event.is_sidechain ? 1 : 0, r.event.entrypoint ?? ''].join('\u0000')
        const prev = factAcc.get(key)
        if (prev) { prev.n += 1; continue }
        factAcc.set(key, {
          session_id: r.event.session_id, project_key: r.event.project_key,
          day: r.event.ts_utc.slice(0, 10),
          tool: f.tool, kind: f.kind, verb: f.verb, target: f.target, ext: f.ext,
          is_sidechain: r.event.is_sidechain ? 1 : 0, entrypoint: r.event.entrypoint, n: 1,
        })
      }
    } else if (r.reason === 'bad_json') bad += 1
  }

  consumed = size - Buffer.byteLength(lastLine, 'utf8')
  return { events, ok, bad, degraded, consumed, facts: [...factAcc.values()] }
}

/** Theo dõi file mới và quét lại (AC-6.4). Gộp nhiều thay đổi liên tiếp vào một lượt quét. */
export function watch(
  root: string, onChange: () => void, debounceMs = 1500,
): { close(): void } {
  let timer: NodeJS.Timeout | null = null
  const w = watchFs(root, { recursive: true }, (_ev, name) => {
    if (!name || !String(name).endsWith('.jsonl')) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; onChange() }, debounceMs)
  })
  return { close: () => { if (timer) clearTimeout(timer); w.close() } }
}

export async function ingest(db: DatabaseSync, root = projectsDir(), full = false,
  onProgress?: (done: number, total: number) => void): Promise<IngestStats> {
  const onDisk = listTranscripts(root)
  const known = full ? new Map<string, FileState>() : knownFiles(db)
  const actions = planScan(onDisk, known)
  const st: IngestStats = {
    files_seen: onDisk.length, files_scanned: 0, files_skipped: 0,
    lines_ok: 0, lines_bad: 0, lines_degraded: 0, rows_inserted: 0,
  }
  const upsert = db.prepare(`INSERT INTO ingest_files
    (path,size_bytes,mtime_ms,bytes_consumed,lines_ok,lines_bad,lines_degraded,last_seen)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(path) DO UPDATE SET size_bytes=excluded.size_bytes, mtime_ms=excluded.mtime_ms,
      bytes_consumed=excluded.bytes_consumed,
      lines_ok=ingest_files.lines_ok+excluded.lines_ok,
      lines_bad=ingest_files.lines_bad+excluded.lines_bad,
      lines_degraded=ingest_files.lines_degraded+excluded.lines_degraded,
      last_seen=excluded.last_seen`)

  let i = 0
  for (const a of actions) {
    i += 1
    onProgress?.(i, actions.length)
    if ('skip' in a) { st.files_skipped += 1; continue }
    const f = onDisk.find((x) => x.path === a.path)
    if (!f) continue
    const r = await readFrom(a.path, a.from)
    st.files_scanned += 1
    st.lines_ok += r.ok; st.lines_bad += r.bad; st.lines_degraded += r.degraded
    st.rows_inserted += insertEvents(db, r.events)
    upsertToolFacts(db, r.facts ?? [])
    upsert.run(a.path, f.size_bytes, f.mtime_ms, r.consumed, r.ok, r.bad, r.degraded, new Date().toISOString())
  }
  setMeta(db, 'last_index_at', new Date().toISOString())
  return st
}
