import { spawn } from 'node:child_process'
import { CcError } from '../errors.js'

/**
 * Chi phí ĐO THẬT của một lần `claude -p "/insights"` (2026-10-29, gói max_20x):
 *   opus-5-5  79 602 in + 14 432 out        ≈ 172 credits
 *   opus-5     45 817 write-1h + 11 266 read ≈ 131 credits
 * ⇒ ~303 credits trên trần 200 000 = ~0,15%. Mất ~176 giây.
 * Có `measured_at` để không ai dùng số lạc hậu mà không biết.
 */
export const MEASURED_REFRESH = {
  credits: 303,
  seconds: 176,
  measured_at: '2026-10-29',
  usd_equivalent: 1.07,
} as const

export interface RefreshOpts {
  /** PHẢI true — người dùng đã thấy ước tính và đồng ý (AC-9b.4). */
  consented: boolean
  claudeBin?: string
  cwd?: string
}

/** % trần mà một lần làm mới sẽ tiêu — từ số ĐO THẬT, không phải số cố định bịa ra. */
export function estimateRefreshPct(ceiling: number): number {
  if (!(ceiling > 0)) return 0
  return MEASURED_REFRESH.credits / ceiling * 100
}

/**
 * Chạy `claude -p "/insights"` — làm mới facets + report.html.
 * Đã xác minh chạy được trong print mode (TEST_PLAN "SPIKE ĐÍNH CHÍNH").
 * consented !== true ⇒ ném CcError('INSIGHT_NO_CONSENT') và KHÔNG spawn gì.
 */
export async function refreshInsights(opts: RefreshOpts): Promise<{ reportPath: string }> {
  if (opts.consented !== true) {
    throw new CcError('INSIGHT_NO_CONSENT',
      'Chưa được người dùng đồng ý — việc này tiêu hạn mức gói của họ.')
  }
  const bin = opts.claudeBin ?? 'claude'
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-p', '/insights'], {
      stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd,
    })
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { err += String(d) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude -p /insights thoát mã ${code}: ${err.slice(0, 300)}`))
      const m = out.match(/file:\/\/(\S+report[^\s"]*\.html)/)
      resolve({ reportPath: m?.[1] ?? '' })
    })
  })
}

export { CcError }
