import type { ParseResult, UsageEvent } from '../types.js'
import { toolFact, allBashVerbs, type ToolFact } from './toolfacts.js'

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  output_tokens_details?: { thinking_tokens?: number }
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number }
  service_tier?: string
  speed?: string
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Parse MỘT dòng jsonl. Riêng tư là chốt Ở ĐÂY (DD-5): `message.content` được dùng để
 * đếm tool_use và bóc SỰ THẬT SUY RA (tên tool, động từ lệnh, đuôi file) rồi BỊ BỎ.
 * Chuỗi lệnh, nội dung file và mọi lời nhắn KHÔNG BAO GIỜ ra khỏi hàm này.
 * Dòng hỏng ⇒ trả null, KHÔNG ném (một dòng hỏng không được làm sập cả lần quét 3,6GB).
 */
export function parseLine(line: string): ParseResult {
  let rec: Record<string, unknown>
  try {
    rec = JSON.parse(line) as Record<string, unknown>
  } catch {
    return { event: null, degraded: false, reason: 'bad_json' }
  }
  if (rec['type'] !== 'assistant') return { event: null, degraded: false, reason: 'not_assistant' }
  const msg = rec['message'] as Record<string, unknown> | undefined
  const u = msg?.['usage'] as RawUsage | undefined
  if (!msg || !u) return { event: null, degraded: false, reason: 'no_usage' }

  const content = msg['content']
  let toolCalls = 0
  const facts: ToolFact[] = []
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      const blk = b as { type?: string; name?: string; input?: Record<string, unknown> }
      if (blk.type !== 'tool_use') continue
      toolCalls += 1
      const f = toolFact(blk.name ?? 'unknown', blk.input)
      facts.push(f)
      // Một lệnh shell thường nối nhiều việc; đếm cả chuỗi chứ không chỉ việc đầu.
      if (f.kind === 'exec') {
        for (const v of allBashVerbs(blk.input).slice(1)) {
          facts.push({ tool: 'Bash', kind: 'exec', verb: v, target: null, ext: null })
        }
      }
    }
  }

  const split = u.cache_creation
  const degraded = split === undefined && num(u.cache_creation_input_tokens) > 0
  const w5m = split ? num(split.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens)
  const w1h = split ? num(split.ephemeral_1h_input_tokens) : 0

  const cwd = str(rec['cwd'])
  const event: UsageEvent = {
    request_id: str(rec['requestId']) ?? '', uuid: str(rec['uuid']) ?? '',
    ts_utc: str(rec['timestamp']) ?? '', session_id: str(rec['sessionId']) ?? '',
    project_key: cwd ?? 'unknown', cwd, git_branch: str(rec['gitBranch']),
    model: str(msg['model']) ?? 'unknown',
    requested_model: str(rec['requestedModel']), advisor_model: str(rec['advisorModel']),
    effort: str(rec['effort']), per_turn_effort: str(rec['perTurnEffort']),
    entrypoint: str(rec['entrypoint']), is_sidechain: rec['isSidechain'] === true,
    service_tier: str(u.service_tier), speed: str(u.speed),
    input_tokens: num(u.input_tokens), output_tokens: num(u.output_tokens),
    cache_read: num(u.cache_read_input_tokens),
    cache_write_5m: w5m, cache_write_1h: w1h,
    thinking_tokens: num(u.output_tokens_details?.thinking_tokens),
    web_search_reqs: num(u.server_tool_use?.web_search_requests),
    web_fetch_reqs: num(u.server_tool_use?.web_fetch_requests),
    tool_calls: toolCalls, cc_version: str(rec['version']),
  }
  return { event, degraded, facts }
}
