import { createReadStream, readdirSync, statSync, mkdirSync, watch as watchFs } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { planScan, type FileState } from './scan.js'
import { parseLine } from './parse.js'

/** One aggregated tool_facts row. It carries no command string and no file content. */
export interface ToolFactRow {
  session_id: string; project_key: string | null; day: string
  tool: string; kind: string; verb: string | null; target: string | null
  ext: string | null; is_sidechain: number; entrypoint: string | null; n: number
}
import { insertEvents, upsertToolFacts, setMeta, getMeta } from './db.js'

/**
 * Bump this whenever the fact extractor changes what it derives.
 *
 * The index keeps a byte watermark per file, so an already scanned file would be
 * skipped forever. Adding a field without a rescan leaves the new table EMPTY in
 * silence, and the page says "no data yet" while the data sits right there on disk.
 */
export const FACTS_VERSION = '3'
import type { UsageEvent } from '../types.js'

export function projectsDir(): string { return join(homedir(), '.claude', 'projects') }
export function dataDir(): string {
  const d = join(homedir(), '.tally')
  mkdirSync(d, { recursive: true })
  return d
}

/** List the jsonl files. The population comes FROM THE SOURCE (readdirSync), never a hand-written list. */
export function listTranscripts(root: string): Array<{ path: string; size_bytes: number; mtime_ms: number }> {
  const out: Array<{ path: string; size_bytes: number; mtime_ms: number }> = []
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.jsonl')) {
        try { const s = statSync(p); out.push({ path: p, size_bytes: s.size, mtime_ms: s.mtimeMs }) } catch { /* skip */ }
      }
    }
  }
  walk(root)
  return out
}

function knownFiles(db: DatabaseSync): Map<string, FileState> {
  // A new extractor version makes the old watermarks wrong, so rescan from zero, once.
  // Leaving them turns the new table into a silent empty one, the kind of bug nobody sees.
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
 * Read one file from `offset` to EOF.
 *
 * `consumed` only counts lines that END WITH A NEWLINE. A final half-written line
 * (Claude Code is still writing) is left out so the next run reads it WHOLE.
 *
 * An earlier version subtracted `lastLen` (which included a virtual newline) from
 * `size`, so it was off by one byte on the negative side. For a file holding a single
 * incomplete line that produced **-1**, SQLite stored it happily, and every later scan
 * threw ERR_OUT_OF_RANGE: the index was dead until someone ran `--full`.
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
    // readline strips the line terminator, so add one byte back for '\n'.
    // The LAST line may have none; that case is handled after the loop.
    pending.push(line)
    pendingBytes += Buffer.byteLength(line, 'utf8') + 1
  }

  // A file ending in a newline has only whole lines. Otherwise the last one is unfinished.
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

/** Watch for new transcripts and rescan (AC-6.4). Bursts of changes collapse into one scan. */
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
