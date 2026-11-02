/**
 * Dựng dữ liệu TỔNG HỢP cho CI (AC-7.4: repo không chứa transcript thật của ai).
 * Viết ra ~/.claude/{projects,cache,usage-data} và ~/.claude.json, rồi `tally index`.
 *
 * CHỐT CHẶN: nếu máy đã có ~/.claude.json thì THOÁT NGAY — không bao giờ ghi đè máy thật.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const H = homedir()
if (existsSync(join(H, '.claude.json'))) {
  console.log('[fixture] đã có ~/.claude.json — KHÔNG ghi đè máy thật, thoát.')
  process.exit(0)
}

const proj = join(H, '.claude', 'projects', '-tmp-demo')
mkdirSync(proj, { recursive: true })
mkdirSync(join(H, '.claude', 'cache'), { recursive: true })
mkdirSync(join(H, '.claude', 'usage-data', 'session-meta'), { recursive: true })
mkdirSync(join(H, '.claude', 'usage-data', 'facets'), { recursive: true })

const now = Date.now()
const models = ['claude-opus-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

/**
 * Tool call giả lập phải CÓ RUỘT.
 *
 * `{ type: 'tool_use', name: 'Bash', input: {} }` đếm được một lượt gọi nhưng
 * không sinh ra động từ, đuôi file hay tên MCP nào, nên mọi bảng của trang Thói
 * quen dùng rỗng và e2e trên CI đỏ mà không ai hiểu vì sao.
 */
const TOOLS = [
  { type: 'tool_use', name: 'Bash', input: { command: 'grep -rn needle src/' } },
  { type: 'tool_use', name: 'Bash', input: { command: 'cd app && pnpm test' } },
  { type: 'tool_use', name: 'Bash', input: { command: 'git status --short' } },
  { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/demo/src/app.ts' } },
  { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/demo/out/frame-001.png' } },
  { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/demo/src/app.ts' } },
  { type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: {} },
  { type: 'tool_use', name: 'Agent', input: { subagent_type: 'Explore' } },
]

// Ba làn phải có mặt trong fixture, nếu không bảng làn trên CI chỉ có một dòng
// và lỗi "xếp nhầm làn" không bao giờ bị test bắt.
const laneOf = (i) => (i % 10 === 0
  // `claude -p` do job gọi
  ? { entrypoint: 'sdk-cli', isSidechain: false, cwd: '/tmp/demo' }
  // vào bằng `cli` như người gõ, nhưng chạy trong worktree agent ⇒ vẫn là máy
  : i % 13 === 0
    ? { entrypoint: 'cli', isSidechain: false, cwd: '/tmp/demo/.claude/worktrees/agent-ademo1' }
    : i % 7 === 0
      ? { entrypoint: 'cli', isSidechain: true, cwd: '/tmp/demo' }
      : { entrypoint: 'cli', isSidechain: false, cwd: '/tmp/demo' })

/**
 * 500 request gần đây cách nhau một phút (đủ dày cho cửa sổ 5 giờ và cho hiệu
 * chuẩn), phần còn lại giãn ra 40 phút một bước để lịch sử phủ hơn 40 ngày —
 * nếu tất cả dồn vào hai ngày thì lưới hoạt động chỉ có một bậc cường độ và
 * test "thang cường độ phải phân biệt" đỏ mà không ai hiểu vì sao.
 */
const tsOf = (i) => (i < 500 ? now - i * 60_000 : now - (500 * 60_000 + (i - 500) * 40 * 60_000))

/**
 * Phiên headless phải là PHIÊN RIÊNG, mỗi phiên vài lượt.
 * Ước tính chi phí nền của `claude -p` lấy trung vị trên các phiên `sdk-cli`
 * ngắn và cần ít nhất 20 phiên; nhét tất cả vào chung một sessionId thì ước
 * tính trả "chưa đo được" và hộp xin phép không có con số nào để hiện.
 */
const sessionOf = (i, lane) => (lane.entrypoint === 'sdk-cli' ? `job${Math.floor(i / 20)}` : `s${i % 20}`)

const lines = []
for (let i = 0; i < 2000; i += 1) {
  const m = models[i % 3]
  const lane = laneOf(i)
  lines.push(JSON.stringify({
    type: 'assistant',
    requestId: `req_${i}`,
    uuid: `u_${i}`,
    sessionId: sessionOf(i, lane),
    timestamp: new Date(tsOf(i)).toISOString(),
    cwd: lane.cwd,
    gitBranch: 'main',
    version: '2.1.312',
    entrypoint: lane.entrypoint,
    isSidechain: lane.isSidechain,
    effort: 'medium',
    message: {
      model: m,
      role: 'assistant',
      content: [
        { type: 'text', text: 'noi dung gia lap' },
        // Một phần năm số lượt là câu trả lời ngắn KHÔNG gọi tool nào. Đó là hình
        // dạng mà phát hiện "model mạnh làm việc nhẹ" tìm; gắn tool cho mọi lượt
        // thì fixture không còn phát hiện nào và nửa trang Tổng quan rỗng trên CI.
        ...(i % 5 === 2 ? [] : [TOOLS[i % TOOLS.length]]),
        ...(i % 4 === 0 ? [TOOLS[(i + 3) % TOOLS.length]] : []),
      ],
      usage: {
        // Dao động mạnh để lưới hoạt động có đủ 5 bậc cường độ trong một ngày.
        input_tokens: 10 + (i % 97) * 60,
        output_tokens: i % 5 === 2 ? 120 : 100 + (i % 31) * 150,
        cache_read_input_tokens: 5000 + (i % 53) * 900,
        cache_creation: {
          ephemeral_5m_input_tokens: i % 3 === 0 ? 0 : 200,
          ephemeral_1h_input_tokens: i % 3 === 0 ? 900 : 0,
        },
        output_tokens_details: { thinking_tokens: 0 },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: 'standard',
        speed: 'standard',
      },
    },
  }))
}
writeFileSync(join(proj, 'demo.jsonl'), lines.join('\n') + '\n')

const nowSec = Math.floor(now / 1000)
writeFileSync(join(H, '.claude', 'cache', 'rate-limits.json'), JSON.stringify({
  five_hour_pct: 9,
  five_hour_reset: nowSec + 3600,
  seven_day_pct: 3,
  seven_day_reset: nowSec + 86_400,
  captured_at: nowSec,
}))

writeFileSync(join(H, '.claude', 'cache', 'usage-cycle.json'), JSON.stringify({
  cycle_cost: 123.45, cycle_start: '20261001', days_total: 31, days_elapsed: 10,
}))

writeFileSync(join(H, '.claude.json'), JSON.stringify({
  oauthAccount: {
    organizationRateLimitTier: 'default_claude_max_20x',
    organizationType: 'claude_max',
    billingType: 'stripe_subscription',
  },
  cachedGrowthBookFeatures: {
    tengu_amber_tally: {
      fiveHourCredits: { default_claude_max_5x: 50_000, default_claude_max_20x: 200_000 },
      creditsPerMillionTokens: {
        'claude-opus-5': 2292,
        'claude-sonnet-5-5': 1250,
        'claude-opus-5-5': 1833,
      },
    },
  },
}))

for (let i = 0; i < 12; i += 1) {
  writeFileSync(join(H, '.claude', 'usage-data', 'session-meta', `s${i}.json`), JSON.stringify({
    session_id: `s${i}`,
    project_path: '/tmp/demo',
    start_time: new Date(now - i * 3_600_000).toISOString(),
    duration_minutes: 10,
    user_message_count: 3,
    assistant_message_count: 8,
    tool_counts: { Bash: 5, Read: 3 },
    tool_errors: 2,
    tool_error_categories: { command_failed: 1, other: 1 },
    user_interruptions: 1,
    destructive_command_count: 0,
    bash_would_prompt_count: 2,
    files_modified: 1,
    lines_added: 10,
    lines_removed: 2,
    git_commits: 0,
    git_pushes: 0,
    input_tokens: 100,
    output_tokens: 200,
    uses_mcp: false,
    uses_task_agent: false,
    uses_web_search: false,
    uses_web_fetch: false,
    user_response_times: [5, 45],
    message_hours: [9, 10],
  }))
}

// CHỈ 1 facet cho 12 phiên — giữ đúng tình huống thật: mẫu nhỏ hơn dân số,
// để e2e kiểm được nhãn "cỡ mẫu N/M".
writeFileSync(join(H, '.claude', 'usage-data', 'facets', 's0.json'), JSON.stringify({
  session_id: 's0',
  outcome: 'mostly_achieved',
  session_type: 'single_task',
  claude_helpfulness: 'very_helpful',
  friction_counts: { buggy_code: 2, wrong_approach: 1 },
  user_satisfaction_counts: { likely_satisfied: 2 },
  underlying_goal: 'demo',
}))

writeFileSync(join(H, '.claude', 'usage-data', 'report.html'), '<html><body>demo</body></html>')
console.log(`[fixture] đã dựng dữ liệu tổng hợp: ${lines.length} request, 12 session-meta, 1 facet`)
