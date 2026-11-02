import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Ask Claude to EXPLAIN the figures tally already measured.
 *
 * This is not `/insights`. That command re-reads the transcripts (about 2,400 credits)
 * and takes NO arguments: the command definition in the binary carries `contentLength: 0`
 * and `getPromptForCommand(e, s)` never reads `e`. A language or depth control attached
 * to it would be a fake knob.
 *
 * Here the input is a few KB of ALREADY MEASURED numbers, which is far cheaper, and both
 * knobs are real: the language sits in the prompt, and the depth decides how much of the
 * data is sent.
 */

export type Lang = 'vi' | 'zh' | 'en'
export type Depth = 'brief' | 'full'

/** A MEASURED cost. Unmeasured stays null: better to say "unknown" than to invent a figure. */
export interface Measured {
  credits: number | null
  seconds: number | null
  measured_at: string | null
}

/**
 * An estimate from the LENGTH OF THE INPUT, not from a feeling.
 * Roughly 4 characters per token, and an Opus turn costs about 1833 credits per million.
 */
export interface Estimate {
  /** The part computable from the prompt and the reply. */
  from_payload: number
  /** The BASELINE cost of one `claude -p` turn (system prompt, tool definitions). */
  overhead: number | null
  /** The total, or null while the baseline is unmeasured. */
  total: number | null
  seconds: number
  /** False while the baseline is unmeasured. The page must say so instead of showing a tidy number. */
  measured: boolean
}

/**
 * Estimate the cost.
 *
 * The computable part is the prompt plus the reply. But `claude -p` also carries a system
 * prompt and the tool definitions, and that BASELINE is several times larger than this
 * prompt: one `/insights` turn with a very short prompt still costs about 2,400 credits.
 * While the baseline is unmeasured, return `null` and let the page say "not measured"
 * rather than showing "2 credits" and letting the user discover it cost a hundred times that.
 */
export function estimate(payloadChars: number, depth: Depth, overhead: number | null = null): Estimate {
  const inTok = payloadChars / 4
  const outTok = depth === 'full' ? 1600 : 600
  const fromPayload = Math.max(1, Math.round(((inTok + outTok) / 1e6) * 1833))
  return {
    from_payload: fromPayload,
    overhead,
    total: overhead === null ? null : fromPayload + overhead,
    seconds: depth === 'full' ? 45 : 20,
    measured: overhead !== null,
  }
}

const LANG_NAME: Record<Lang, string> = { vi: 'Vietnamese', zh: 'Simplified Chinese', en: 'English' }

export interface ExplainResult {
  lang: Lang
  depth: Depth
  at: string
  /** Each point: an observation, why it happens, and one thing to do. */
  points: Array<{ title: string; why: string; action: string }>
  /** A one-line summary. */
  headline: string
}

/** Build the prompt. Separate so it can be tested without spending a single credit. */
export function buildPrompt(numbers: unknown, lang: Lang, depth: Depth): string {
  const n = depth === 'full' ? 6 : 3
  return [
    `Below are MEASURED numbers about how one developer uses Claude Code, taken from their own machine.`,
    ``,
    `Write exactly ${n} points about their working behaviour. For each point give:`,
    `- title: what the pattern is, in plain words, no jargon`,
    `- why: why it happens, grounded in the numbers given`,
    `- action: one concrete thing they could change`,
    ``,
    `Rules you must follow:`,
    `- Use ONLY the numbers below. Never invent a figure, a trend or a comparison.`,
    `- If a number is missing, say what is missing instead of guessing.`,
    `- The numbers are split into three lanes and you must keep them apart:`,
    `  "hand" = the person typing in a terminal; "sub" = subagents inside those sessions;`,
    `  "job" = unattended runs (headless \`claude -p\`, agent worktrees, scheduled pipelines).`,
    `  The "job" lane reads files, probes and opens images because that IS its work.`,
    `  Never describe the job lane's reading or probing as a habit of the person, and never`,
    `  recommend that the person change it. Judge the person by the "hand" lane only.`,
    `- The overall figures (probe_pct, read_per_write, top_commands, mcp) mix all three lanes.`,
    `  When you cite one, say so, or cite the per lane figure instead.`,
    `- Write in ${LANG_NAME[lang]}. Keep each field under 220 characters.`,
    ``,
    `Reply with ONLY a JSON object, no prose around it, no markdown fence:`,
    `{"headline": "...", "points": [{"title": "...", "why": "...", "action": "..."}]}`,
    ``,
    `NUMBERS:`,
    JSON.stringify(numbers, null, 1),
  ].join('\n')
}

/** Pull the JSON out of the reply, even when the model wraps it in a markdown fence. */
export function parseReply(raw: string): { headline: string; points: ExplainResult['points'] } | null {
  const text = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const o = parsed as { headline?: unknown; points?: unknown }
  if (!Array.isArray(o.points)) return null
  const points = o.points
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      title: String(p['title'] ?? '').trim(),
      why: String(p['why'] ?? '').trim(),
      action: String(p['action'] ?? '').trim(),
    }))
    .filter((p) => p.title !== '')
  if (points.length === 0) return null
  return { headline: String(o.headline ?? '').trim(), points }
}

export const explainPath = (home: string, lang: Lang): string =>
  join(home, '.tally', `explain-${lang}.json`)

/** Read the saved explanation, if there is one. */
export function readExplain(home: string, lang: Lang): ExplainResult | null {
  const p = explainPath(home, lang)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ExplainResult
  } catch {
    return null
  }
}

/**
 * Run `claude -p` with that prompt. It spends the user's own plan quota, so it may only
 * be called after they have agreed.
 */
export async function runExplain(
  numbers: unknown, lang: Lang, depth: Depth, home: string,
  bin = 'claude', timeoutMs = 180_000,
): Promise<ExplainResult> {
  const prompt = buildPrompt(numbers, lang, depth)
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')) }, timeoutMs)
    child.stdout.on('data', (b) => { out += String(b) })
    child.stderr.on('data', (b) => { err += String(b) })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`claude -p exited with code ${code}: ${err.slice(0, 300)}`))
      else resolve(out)
    })
  })
  const parsed = parseReply(raw)
  if (!parsed) throw new Error('could not extract JSON from the reply')
  const result: ExplainResult = { lang, depth, at: new Date().toISOString(), ...parsed }
  const p = explainPath(home, lang)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(result, null, 2))
  return result
}
