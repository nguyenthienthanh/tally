import { spawn } from 'node:child_process'
import { CcError } from '../errors.js'

/**
 * The MEASURED cost of one `claude -p "/insights"` run (2026-10-29, max_20x plan):
 *   opus-5-5  79 602 in + 14 432 out        ≈ 172 credits
 *   opus-5     45 817 write-1h + 11 266 read ≈ 131 credits
 * about 303 credits against a 200,000 ceiling, so about 0.15%, and about 176 seconds.
 * `measured_at` exists so nobody uses a stale figure without noticing.
 */
export const MEASURED_REFRESH = {
  credits: 303,
  seconds: 176,
  measured_at: '2026-10-29',
  usd_equivalent: 1.07,
} as const

export interface RefreshOpts {
  /** MUST be true: the user has seen the estimate and agreed (AC-9b.4). */
  consented: boolean
  claudeBin?: string
  cwd?: string
}

/** The share of the ceiling one refresh will spend, from MEASUREMENT, not an invented constant. */
export function estimateRefreshPct(ceiling: number): number {
  if (!(ceiling > 0)) return 0
  return MEASURED_REFRESH.credits / ceiling * 100
}

/**
 * Run `claude -p "/insights"` to refresh the facets and report.html.
 * Verified to work in print mode.
 * If consented is not true it throws CcError('INSIGHT_NO_CONSENT') and spawns NOTHING.
 */
export async function refreshInsights(opts: RefreshOpts): Promise<{ reportPath: string }> {
  if (opts.consented !== true) {
    throw new CcError('INSIGHT_NO_CONSENT',
      'The user has not agreed. This spends their own plan quota.')
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
      if (code !== 0) return reject(new Error(`claude -p /insights exited with code ${code}: ${err.slice(0, 300)}`))
      const m = out.match(/file:\/\/(\S+report[^\s"]*\.html)/)
      resolve({ reportPath: m?.[1] ?? '' })
    })
  })
}

export { CcError }
