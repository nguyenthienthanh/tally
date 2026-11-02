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

describe('readFrom — watermark phải luôn hợp lệ', () => {
  it('dòng cuối KHÔNG có newline ⇒ watermark >= 0 và quét lượt 2 KHÔNG nổ', async () => {
    writeFileSync(join(dir, 'a.jsonl'), rec(1))           // không có \n cuối
    const d = db()
    await ingest(d, dir, false)
    const row = d.prepare('SELECT bytes_consumed FROM ingest_files').get() as { bytes_consumed: number }
    expect(row.bytes_consumed).toBeGreaterThanOrEqual(0)
    await expect(ingest(d, dir, false)).resolves.toBeDefined()
  })

  it('dòng dở KHÔNG bị ăn mất: ghi nốt phần còn lại thì bản ghi vẫn vào', async () => {
    const full = rec(7)
    const cut = full.slice(0, 40)
    writeFileSync(join(dir, 'b.jsonl'), cut)              // nửa dòng
    const d = db()
    await ingest(d, dir, false)
    expect((d.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c).toBe(0)
    appendFileSync(join(dir, 'b.jsonl'), full.slice(40) + '\n')   // ghi nốt
    await ingest(d, dir, false)
    expect((d.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c).toBe(1)
  })

  it('file có newline cuối ⇒ watermark bằng ĐÚNG kích thước file', async () => {
    writeFileSync(join(dir, 'c.jsonl'), rec(1) + '\n' + rec(2) + '\n')
    const d = db()
    await ingest(d, dir, false)
    const row = d.prepare('SELECT bytes_consumed FROM ingest_files').get() as { bytes_consumed: number }
    expect(row.bytes_consumed).toBe(statSync(join(dir, 'c.jsonl')).size)
  })

  it('UTF-8 nhiều byte: watermark vẫn bằng kích thước file', async () => {
    const r = JSON.parse(rec(9)) as Record<string, unknown>
    r['cwd'] = '/tmp/Dự-án-🐸'
    writeFileSync(join(dir, 'd.jsonl'), JSON.stringify(r) + '\n')
    const d = db()
    await ingest(d, dir, false)
    const row = d.prepare('SELECT bytes_consumed FROM ingest_files').get() as { bytes_consumed: number }
    expect(row.bytes_consumed).toBe(statSync(join(dir, 'd.jsonl')).size)
  })

  it('dòng JSON HỎNG bắt đầu bằng { vẫn phải vào lines_bad (không mất dữ liệu im lặng)', async () => {
    writeFileSync(join(dir, 'e.jsonl'), rec(1) + '\n' + '{"type":"assistant","message":{"usage":{"input_t' + '\n')
    const d = db()
    const st = await ingest(d, dir, false)
    expect(st.lines_ok).toBe(1)
    expect(st.lines_bad).toBe(1)
  })

  it('record KHÔNG phải assistant không bị tính là hỏng', async () => {
    writeFileSync(join(dir, 'f.jsonl'), JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
    const d = db()
    const st = await ingest(d, dir, false)
    expect(st.lines_bad).toBe(0)
    expect(st.lines_ok).toBe(0)
  })
})
