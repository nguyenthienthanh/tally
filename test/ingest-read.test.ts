import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, appendFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/ingest/db.js'
import { ingest } from '../src/ingest/index.js'

const rec = (i: number): string => JSON.stringify({
  type: 'assistant', requestId: `r${i}`, uuid: `u${i}`, sessionId: 's1',
  timestamp: '2026-10-29T01:00:00.000Z', cwd: '/tmp/x', version: '1',
  message: {
    model: 'claude-opus-5', role: 'assistant', content: [],
    usage: {
      input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    },
  },
})

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cci-read-')) })
const db = () => openDb(join(dir, `idx-${Math.random()}.sqlite`))

describe('readFrom: the watermark must always be valid', () => {
  it('a last line with NO newline keeps the watermark >= 0 and the second scan does not blow up', async () => {
    writeFileSync(join(dir, 'a.jsonl'), rec(1))           // no trailing \n
    const d = db()
    await ingest(d, dir, false)
    const row = d.prepare('SELECT bytes_consumed FROM ingest_files').get() as { bytes_consumed: number }
    expect(row.bytes_consumed).toBeGreaterThanOrEqual(0)
    await expect(ingest(d, dir, false)).resolves.toBeDefined()
  })

  it('a half-written line is not eaten: finish writing it and the record still lands', async () => {
    const full = rec(7)
    const cut = full.slice(0, 40)
    writeFileSync(join(dir, 'b.jsonl'), cut)              // half a line
    const d = db()
    await ingest(d, dir, false)
    expect((d.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c).toBe(0)
    appendFileSync(join(dir, 'b.jsonl'), full.slice(40) + '\n')   // finish the line
    await ingest(d, dir, false)
    expect((d.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c).toBe(1)
  })

  it('a file ending in a newline leaves the watermark EXACTLY at the file size', async () => {
    writeFileSync(join(dir, 'c.jsonl'), rec(1) + '\n' + rec(2) + '\n')
    const d = db()
    await ingest(d, dir, false)
    const row = d.prepare('SELECT bytes_consumed FROM ingest_files').get() as { bytes_consumed: number }
    expect(row.bytes_consumed).toBe(statSync(join(dir, 'c.jsonl')).size)
  })

  it('multi-byte UTF-8: the watermark still equals the file size', async () => {
    const r = JSON.parse(rec(9)) as Record<string, unknown>
    r['cwd'] = '/tmp/du-an-\u1ef1-🐸'
    writeFileSync(join(dir, 'd.jsonl'), JSON.stringify(r) + '\n')
    const d = db()
    await ingest(d, dir, false)
    const row = d.prepare('SELECT bytes_consumed FROM ingest_files').get() as { bytes_consumed: number }
    expect(row.bytes_consumed).toBe(statSync(join(dir, 'd.jsonl')).size)
  })

  it('a BROKEN JSON line that starts with { still counts in lines_bad, so no silent data loss', async () => {
    writeFileSync(join(dir, 'e.jsonl'), rec(1) + '\n' + '{"type":"assistant","message":{"usage":{"input_t' + '\n')
    const d = db()
    const st = await ingest(d, dir, false)
    expect(st.lines_ok).toBe(1)
    expect(st.lines_bad).toBe(1)
  })

  it('a non-assistant record is not counted as broken', async () => {
    writeFileSync(join(dir, 'f.jsonl'), JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
    const d = db()
    const st = await ingest(d, dir, false)
    expect(st.lines_bad).toBe(0)
    expect(st.lines_ok).toBe(0)
  })
})
