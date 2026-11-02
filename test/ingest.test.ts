import { describe, it, expect } from 'vitest'
import { planScan, type FileState } from '../src/ingest/scan.js'
import { parseLine } from '../src/ingest/parse.js'
import { SCHEMA_SQL } from '../src/ingest/db.js'

const st = (o: Partial<FileState> & { path: string }): FileState =>
  ({ size_bytes: 0, mtime_ms: 0, bytes_consumed: 0, ...o })

describe('the byte watermark (DD-6), tested at BOTH ends', () => {
  it('a new file is scanned from 0', () => {
    const r = planScan([{ path: 'a.jsonl', size_bytes: 100, mtime_ms: 5 }], new Map())
    expect(r).toEqual([{ path: 'a.jsonl', from: 0 }])
  })

  it('a file that GREW is read only from where it stopped', () => {
    const known = new Map([['a.jsonl', st({ path: 'a.jsonl', size_bytes: 100, mtime_ms: 5, bytes_consumed: 100 })]])
    const r = planScan([{ path: 'a.jsonl', size_bytes: 250, mtime_ms: 9 }], known)
    expect(r).toEqual([{ path: 'a.jsonl', from: 100 }])
  })

  it('a file that SHRANK (it was rewritten) does not trust the old offset and rescans from 0', () => {
    const known = new Map([['a.jsonl', st({ path: 'a.jsonl', size_bytes: 500, mtime_ms: 5, bytes_consumed: 500 })]])
    const r = planScan([{ path: 'a.jsonl', size_bytes: 120, mtime_ms: 9 }], known)
    expect(r).toEqual([{ path: 'a.jsonl', from: 0 }])
  })

  it('nothing changed, so it is SKIPPED (a rescan has to be cheap)', () => {
    const known = new Map([['a.jsonl', st({ path: 'a.jsonl', size_bytes: 100, mtime_ms: 5, bytes_consumed: 100 })]])
    const r = planScan([{ path: 'a.jsonl', size_bytes: 100, mtime_ms: 5 }], known)
    expect(r).toEqual([{ path: 'a.jsonl', skip: true }])
  })
})

const REC = {
  type: 'assistant', requestId: 'req_A', uuid: 'u_A', sessionId: 's1',
  timestamp: '2026-10-29T03:00:00.000Z', cwd: '/tmp/x', gitBranch: 'main',
  version: '2.1.312', entrypoint: 'cli', isSidechain: false, effort: 'medium',
  requestedModel: 'claude-sonnet-5-5', advisorModel: null,
  message: {
    model: 'claude-sonnet-5-5', role: 'assistant',
    content: [{ type: 'text', text: 'SECRET THAT MUST NOT BE STORED' }, { type: 'tool_use', name: 'Bash', input: {} }],
    usage: {
      input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30,
      cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 40 },
      output_tokens_details: { thinking_tokens: 7 },
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
      service_tier: 'standard', speed: 'standard',
    },
  },
}

describe('parse: privacy is enforced at the PARSER layer (DD-5)', () => {
  it('the returned event contains no conversation content anywhere', () => {
    const { event } = parseLine(JSON.stringify(REC))
    expect(event).not.toBeNull()
    expect(JSON.stringify(event)).not.toContain('SECRET')
    expect(event as unknown as Record<string, unknown>).not.toHaveProperty('content')
  })

  it('the SQL schema has no content column', () => {
    expect(SCHEMA_SQL).not.toMatch(/\bcontent\b/)
  })

  it('tool_calls are counted before content is dropped', () => {
    expect(parseLine(JSON.stringify(REC)).event!.tool_calls).toBe(1)
  })

  it('the cache split by TTL is correct for 5m and 1h', () => {
    const e = parseLine(JSON.stringify(REC)).event!
    expect(e.cache_write_5m).toBe(5)
    expect(e.cache_write_1h).toBe(40)
  })

  it('a missing TTL split sets degraded=true instead of quietly calling it 5m', () => {
    const r = JSON.parse(JSON.stringify(REC))
    delete r.message.usage.cache_creation
    r.message.usage.cache_creation_input_tokens = 45
    const out = parseLine(JSON.stringify(r))
    expect(out.degraded).toBe(true)
    expect(out.event!.cache_write_5m).toBe(45)
  })

  it('a non-assistant record returns a null event and does not throw', () => {
    expect(parseLine(JSON.stringify({ type: 'user', message: { content: 'hi' } })).event).toBeNull()
  })

  it('a broken JSON line returns a null event and does NOT throw (one bad line must not kill a multi-GB scan)', () => {
    expect(() => parseLine('{khong-phai-json')).not.toThrow()
    expect(parseLine('{khong-phai-json').event).toBeNull()
  })
})
