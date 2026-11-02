/**
 * Build SYNTHETIC data for CI (AC-7.4: the repo holds nobody's real transcripts).
 * Writes ~/.claude/{projects,cache,usage-data} and ~/.claude.json, then `tally index`.
 *
 * SAFETY GATE: if the machine already has ~/.claude.json it EXITS IMMEDIATELY. It must
 * never overwrite a real setup.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const H = homedir()
if (existsSync(join(H, '.claude.json'))) {
  console.log('[fixture] ~/.claude.json already exists. Not overwriting a real setup, exiting.')
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
 * A synthetic tool call needs a BODY.
 *
 * `{ type: 'tool_use', name: 'Bash', input: {} }` counts as one call but derives no verb,
 * no extension and no MCP name, so every table on the Insight page comes out empty and the
 * e2e suite fails on CI with nobody able to see why.
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

// All three lanes have to exist in the fixture. Otherwise the lane table on CI has one row
// and a lane-misclassification bug is never caught.
const laneOf = (i) => (i % 10 === 0
  // `claude -p` fired by a job
  ? { entrypoint: 'sdk-cli', isSidechain: false, cwd: '/tmp/demo' }
  // enters through `cli` like a person, but runs in an agent worktree, so it is still a machine
  : i % 13 === 0
    ? { entrypoint: 'cli', isSidechain: false, cwd: '/tmp/demo/.claude/worktrees/agent-ademo1' }
    : i % 7 === 0
      ? { entrypoint: 'cli', isSidechain: true, cwd: '/tmp/demo' }
      : { entrypoint: 'cli', isSidechain: false, cwd: '/tmp/demo' })

/**
 * Work arrives in BURSTS, not evenly.
 *
 * Each burst is 12 requests a minute apart, with a pause between bursts. One request per
 * minute all day long merges into a SINGLE fragment (the burst threshold is 15 minutes),
 * the activity grid collapses to one intensity level, and the "the scale must distinguish"
 * test fails. Recent bursts pause 25 minutes so the 5-hour window stays dense; older ones
 * pause 3 hours so the history spans more than two weeks.
 */
const BURST = 12
const tsOf = (i) => {
  const burst = Math.floor(i / BURST)
  const within = i % BURST
  const gapMin = burst < 25 ? 25 : 180
  const backMin = burst * (BURST + gapMin) + within
  return now - backMin * 60_000
}

/** Bursts differ in weight: an intensity scale only means something when there is something to compare. */
const burstWeight = (i) => 1 + (Math.floor(i / BURST) % 5) * 4

/**
 * Headless runs must be SEPARATE sessions, a few turns each.
 * The baseline cost estimate for `claude -p` takes the median over short `sdk-cli` sessions
 * and needs at least 20 of them. Packing them all into one sessionId makes the estimate
 * report "not measured", and the consent dialog has no figure to show.
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
        // A fifth of the turns are short answers that call NO tool. That is the shape the
        // "big model, tiny task" finding looks for; attaching a tool to every turn leaves the
        // fixture with no findings at all and half the dashboard empty on CI.
        ...(i % 5 === 2 ? [] : [TOOLS[i % TOOLS.length]]),
        ...(i % 4 === 0 ? [TOOLS[(i + 3) % TOOLS.length]] : []),
      ],
      usage: {
        // Vary strongly so the activity grid gets all five intensity levels inside one day.
        input_tokens: 10 + (i % 97) * 60,
        output_tokens: i % 5 === 2 ? 120 : (100 + (i % 31) * 150) * burstWeight(i),
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

// ONLY 1 facet for 12 sessions, which matches reality: the sample is smaller than the
// population, so the e2e suite can check the "sample N/M" label.
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
console.log(`[fixture] built synthetic data: ${lines.length} requests, 12 session-meta, 1 facet`)
