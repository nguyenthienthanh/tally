import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Nhờ Claude GIẢI THÍCH các con số tally đã đo.
 *
 * Khác hẳn `/insights`: lệnh đó đọc lại transcript (tốn ~2.400 credits) và KHÔNG
 * nhận tham số nào — đã kiểm trong nhị phân: `getPromptForCommand(e, s)` không hề
 * dùng `e`. Nên ngôn ngữ và độ sâu gắn vào nó chỉ là núm giả.
 *
 * Ở đây input là vài KB SỐ ĐÃ ĐO, nên rẻ hơn nhiều lần, và cả hai núm đều thật:
 * ngôn ngữ nằm trong prompt, độ sâu quyết định gửi bao nhiêu phần số liệu.
 */

export type Lang = 'vi' | 'zh' | 'en'
export type Depth = 'brief' | 'full'

/** Chi phí ĐO THẬT. Chưa đo thì để null — thà nói "chưa biết" còn hơn bịa một con số. */
export interface Measured {
  credits: number | null
  seconds: number | null
  measured_at: string | null
}

/**
 * Ước lượng theo ĐỘ DÀI INPUT, không phải theo cảm giác.
 * ~4 ký tự một token, và một lượt Opus tốn cỡ 1833 credits mỗi triệu token.
 */
export interface Estimate {
  /** Phần tính được từ prompt và câu trả lời. */
  from_payload: number
  /** Chi phí NỀN của một lượt `claude -p` (system prompt, định nghĩa tool). */
  overhead: number | null
  /** Tổng, hoặc null khi chưa đo được phần nền. */
  total: number | null
  seconds: number
  /** false khi phần nền chưa đo — màn hình phải nói ra, đừng hiện một số đẹp. */
  measured: boolean
}

/**
 * Ước lượng chi phí.
 *
 * Phần tính được là prompt cộng câu trả lời. Nhưng `claude -p` còn mang theo system
 * prompt và định nghĩa tool, và phần NỀN đó lớn hơn prompt này nhiều lần — một lượt
 * `/insights` với prompt rất ngắn vẫn tốn ~2.400 credits. Chưa đo phần nền thì trả
 * `null` và để màn hình nói "chưa đo", đừng hiện "2 credits" rồi để người dùng
 * phát hiện ra nó tốn gấp trăm lần.
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
  /** Mỗi mục: một nhận xét, vì sao, và việc nên làm. */
  points: Array<{ title: string; why: string; action: string }>
  /** Câu tóm tắt một dòng. */
  headline: string
}

/** Dựng prompt. Tách riêng để test được mà không tốn một đồng credit nào. */
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

/** Bóc JSON ra khỏi câu trả lời, kể cả khi model bọc nó trong hàng rào markdown. */
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

/** Đọc bản giải thích đã lưu, nếu có. */
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
 * Chạy `claude -p` với prompt trên. Tiêu hạn mức gói của chính người dùng — chỉ
 * được gọi sau khi họ đã bấm đồng ý.
 */
export async function runExplain(
  numbers: unknown, lang: Lang, depth: Depth, home: string,
  bin = 'claude', timeoutMs = 180_000,
): Promise<ExplainResult> {
  const prompt = buildPrompt(numbers, lang, depth)
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('quá giờ')) }, timeoutMs)
    child.stdout.on('data', (b) => { out += String(b) })
    child.stderr.on('data', (b) => { err += String(b) })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`claude -p thoát mã ${code}: ${err.slice(0, 300)}`))
      else resolve(out)
    })
  })
  const parsed = parseReply(raw)
  if (!parsed) throw new Error('không bóc được JSON từ câu trả lời')
  const result: ExplainResult = { lang, depth, at: new Date().toISOString(), ...parsed }
  const p = explainPath(home, lang)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(result, null, 2))
  return result
}
