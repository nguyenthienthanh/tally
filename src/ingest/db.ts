import { DatabaseSync } from 'node:sqlite'
import type { UsageEvent } from '../types.js'

/** DDL — KHÔNG có cột nội dung hội thoại (DD-5, AC-7.2). */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  request_id TEXT NOT NULL, uuid TEXT NOT NULL,
  ts_utc TEXT NOT NULL, session_id TEXT NOT NULL,
  project_key TEXT, cwd TEXT, git_branch TEXT,
  model TEXT NOT NULL, requested_model TEXT, advisor_model TEXT,
  effort TEXT, per_turn_effort TEXT, entrypoint TEXT,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  service_tier TEXT, speed TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write_5m INTEGER NOT NULL DEFAULT 0, cache_write_1h INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  web_search_reqs INTEGER NOT NULL DEFAULT 0, web_fetch_reqs INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0, cc_version TEXT,
  PRIMARY KEY (request_id, uuid)
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_utc);
CREATE INDEX IF NOT EXISTS idx_events_model ON events(model);
CREATE TABLE IF NOT EXISTS ingest_files (
  path TEXT PRIMARY KEY, size_bytes INTEGER, mtime_ms INTEGER,
  bytes_consumed INTEGER, lines_ok INTEGER, lines_bad INTEGER,
  lines_degraded INTEGER, last_seen TEXT
);
/* Sự thật SUY RA từ tool call — gộp sẵn theo phiên, không một dòng nào cho mỗi
   lượt gọi và không một chuỗi lệnh nào. Index nằm lại trên đĩa lâu hơn phiên làm
   việc, nên thứ nằm lại phải là thứ tối thiểu. */
CREATE TABLE IF NOT EXISTS tool_facts (
  session_id TEXT NOT NULL, project_key TEXT, day TEXT,
  tool TEXT NOT NULL, kind TEXT NOT NULL,
  verb TEXT, target TEXT, ext TEXT,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  entrypoint TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, tool, kind, verb, target, ext, is_sidechain, entrypoint)
);
CREATE INDEX IF NOT EXISTS idx_tf_kind ON tool_facts(kind);
CREATE INDEX IF NOT EXISTS idx_tf_day ON tool_facts(day);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

const COLS = [
  'request_id', 'uuid', 'ts_utc', 'session_id', 'project_key', 'cwd', 'git_branch',
  'model', 'requested_model', 'advisor_model', 'effort', 'per_turn_effort', 'entrypoint',
  'is_sidechain', 'service_tier', 'speed', 'input_tokens', 'output_tokens', 'cache_read',
  'cache_write_5m', 'cache_write_1h', 'thinking_tokens', 'web_search_reqs', 'web_fetch_reqs',
  'tool_calls', 'cc_version',
] as const

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA_SQL)
  // `CREATE TABLE IF NOT EXISTS` im lặng trước một bảng cũ thiếu cột: mọi lượt ghi
  // sau đó mới ném. Index cũ thì bỏ được (FACTS_VERSION cho quét lại), nên bảng
  // thiếu cột thì dựng lại cho đúng ngay tại đây.
  const cols = db.prepare('PRAGMA table_info(tool_facts)').all() as unknown as Array<{ name: string }>
  if (cols.length > 0 && !cols.some((c) => c.name === 'entrypoint')) {
    db.exec('DROP TABLE tool_facts')
    db.exec(SCHEMA_SQL)
  }
  return db
}

/** INSERT OR IGNORE trên (request_id, uuid) ⇒ chống trùng khi phiên resume ghi lại record cũ. */
/**
 * Gộp sự thật tool call vào bảng, cộng dồn số đếm.
 *
 * Gộp sẵn thay vì một dòng cho mỗi lượt gọi: index nhỏ hơn nhiều lần và vẫn trả
 * lời được mọi câu ngoại trừ thứ tự chính xác của từng lượt — thứ không ai hỏi.
 */
export function upsertToolFacts(
  db: DatabaseSync,
  rows: Array<{ session_id: string; project_key: string | null; day: string;
    tool: string; kind: string; verb: string | null; target: string | null;
    ext: string | null; is_sidechain: number; entrypoint: string | null; n: number }>,
): number {
  if (rows.length === 0) return 0
  const stmt = db.prepare(`INSERT INTO tool_facts
    (session_id, project_key, day, tool, kind, verb, target, ext, is_sidechain, entrypoint, n)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(session_id, tool, kind, verb, target, ext, is_sidechain, entrypoint)
    DO UPDATE SET n = n + excluded.n`)
  let k = 0
  db.exec('BEGIN')
  try {
    for (const r of rows) {
      stmt.run(r.session_id, r.project_key, r.day, r.tool, r.kind,
        r.verb, r.target, r.ext, r.is_sidechain, r.entrypoint, r.n)
      k += 1
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return k
}

/** Mọi dòng tool_facts — dùng cho phân tích hành vi. */
export function allToolFacts(db: DatabaseSync): import('../engine/behaviour.js').ToolFactRow[] {
  return db.prepare(`SELECT session_id, project_key, day, tool, kind, verb, target, ext,
    is_sidechain, entrypoint, n FROM tool_facts`).all() as unknown as import('../engine/behaviour.js').ToolFactRow[]
}

export function insertEvents(db: DatabaseSync, events: UsageEvent[]): number {
  if (events.length === 0) return 0
  const sql = `INSERT OR IGNORE INTO events (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`
  const stmt = db.prepare(sql)
  let n = 0
  db.exec('BEGIN')
  try {
    for (const e of events) {
      const vals = COLS.map((c) => {
        const v = (e as unknown as Record<string, unknown>)[c]
        return typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null)
      })
      const r = stmt.run(...vals)
      n += Number(r.changes)
    }
    db.exec('COMMIT')
  } catch (err) { db.exec('ROLLBACK'); throw err }
  return n
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value)
}
export function getMeta(db: DatabaseSync, key: string): string | null {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value?: string } | undefined
  return r?.value ?? null
}
export function allEvents(db: DatabaseSync): UsageEvent[] {
  const rows = db.prepare('SELECT * FROM events').all() as Array<Record<string, unknown>>
  return rows.map((r) => ({ ...r, is_sidechain: r['is_sidechain'] === 1 })) as unknown as UsageEvent[]
}
