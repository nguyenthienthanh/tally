import type { UsageEvent } from '../src/types.js'

let n = 0
export function ev(over: Partial<UsageEvent> = {}): UsageEvent {
  n += 1
  return {
    request_id: `req_${n}`, uuid: `uuid_${n}`,
    ts_utc: '2026-10-29T03:00:00.000Z', session_id: 's1',
    project_key: 'p1', cwd: '/tmp/p1', git_branch: 'main',
    model: 'claude-sonnet-5-5', requested_model: null, advisor_model: null,
    effort: 'medium', per_turn_effort: null, entrypoint: 'cli',
    is_sidechain: false, service_tier: 'standard', speed: 'standard',
    input_tokens: 0, output_tokens: 0, cache_read: 0,
    cache_write_5m: 0, cache_write_1h: 0, thinking_tokens: 0,
    web_search_reqs: 0, web_fetch_reqs: 0, tool_calls: 0, cc_version: '2.1.312',
    ...over,
  }
}
