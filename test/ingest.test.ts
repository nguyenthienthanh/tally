import { describe, it, expect } from 'vitest'
import { planScan, type FileState } from '../src/ingest/scan.js'
import { parseLine } from '../src/ingest/parse.js'
import { SCHEMA_SQL } from '../src/ingest/db.js'

const st = (o: Partial<FileState> & { path: string }): FileState =>
  ({ size_bytes: 0, mtime_ms: 0, bytes_consumed: 0, ...o })

describe('watermark theo byte (DD-6) — test CẢ HAI chiều', () => {
  it('file mới ⇒ quét từ 0', () => {
    const r = planScan([{ path: 'a.jsonl', size_bytes: 100, mtime_ms: 5 }], new Map())
    expect(r).toEqual([{ path: 'a.jsonl', from: 0 }])
  })

  it('file DÀI RA ⇒ chỉ đọc phần mới', () => {
    const known = new Map([['a.jsonl', st({ path: 'a.jsonl', size_bytes: 100, mtime_ms: 5, bytes_consumed: 100 })]])
    const r = planScan([{ path: 'a.jsonl', size_bytes: 250, mtime_ms: 9 }], known)
    expect(r).toEqual([{ path: 'a.jsonl', from: 100 }])
  })

  it('file NGẮN ĐI (bị ghi lại) ⇒ KHÔNG tin offset cũ, quét lại từ 0', () => {
    const known = new Map([['a.jsonl', st({ path: 'a.jsonl', size_bytes: 500, mtime_ms: 5, bytes_consumed: 500 })]])
    const r = planScan([{ path: 'a.jsonl', size_bytes: 120, mtime_ms: 9 }], known)
    expect(r).toEqual([{ path: 'a.jsonl', from: 0 }])
  })

  it('không đổi gì ⇒ BỎ QUA (lần quét lại phải rẻ)', () => {
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
    content: [{ type: 'text', text: 'BÍ MẬT KHÔNG ĐƯỢC LƯU' }, { type: 'tool_use', name: 'Bash', input: {} }],
    usage: {
      input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30,
      cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 40 },
      output_tokens_details: { thinking_tokens: 7 },
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
      service_tier: 'standard', speed: 'standard',
    },
  },
}

describe('parse — riêng tư là chốt ở TẦNG PARSER (DD-5)', () => {
  it('event trả về KHÔNG chứa nội dung hội thoại ở bất kỳ đâu', () => {
    const { event } = parseLine(JSON.stringify(REC))
    expect(event).not.toBeNull()
    expect(JSON.stringify(event)).not.toContain('BÍ MẬT')
    expect(event as unknown as Record<string, unknown>).not.toHaveProperty('content')
  })

  it('schema SQL không có cột nội dung', () => {
    expect(SCHEMA_SQL).not.toMatch(/\bcontent\b/)
  })

  it('đếm được tool_calls trước khi bỏ content', () => {
    expect(parseLine(JSON.stringify(REC)).event!.tool_calls).toBe(1)
  })

  it('tách cache theo TTL đúng 5m/1h', () => {
    const e = parseLine(JSON.stringify(REC)).event!
    expect(e.cache_write_5m).toBe(5)
    expect(e.cache_write_1h).toBe(40)
  })

  it('thiếu phân chia TTL ⇒ degraded=true, KHÔNG âm thầm coi là 5m', () => {
    const r = JSON.parse(JSON.stringify(REC))
    delete r.message.usage.cache_creation
    r.message.usage.cache_creation_input_tokens = 45
    const out = parseLine(JSON.stringify(r))
    expect(out.degraded).toBe(true)
    expect(out.event!.cache_write_5m).toBe(45)
  })

  it('record không phải assistant ⇒ event null, không ném lỗi', () => {
    expect(parseLine(JSON.stringify({ type: 'user', message: { content: 'hi' } })).event).toBeNull()
  })

  it('dòng JSON hỏng ⇒ event null, KHÔNG ném lỗi (một dòng hỏng không được làm sập 3,6GB)', () => {
    expect(() => parseLine('{khong-phai-json')).not.toThrow()
    expect(parseLine('{khong-phai-json').event).toBeNull()
  })
})
