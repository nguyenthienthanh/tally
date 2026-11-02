#!/usr/bin/env node
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { openDb, allEvents, getMeta } from './ingest/db.js'
import { ingest, dataDir, projectsDir, listTranscripts } from './ingest/index.js'
import { readPlan, readLiveLimits, readCycleCost, usageDataDir } from './plan.js'
import { calibrate, DEFAULT_HYPOTHESIS } from './engine/credits.js'
import { summaryByModel, currentWindow } from './engine/summary.js'
import { rollup } from './engine/buckets.js'
import { detectFindings } from './engine/findings.js'
import { readSessionMeta, readFacets } from './insight/sources.js'
import { serve } from './server/serve.js'
import type { Grain } from './types.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const WEB_ROOT = join(HERE, '..', 'web')
/** Human labels for the CLI. A test asserts that every id in findings.ts appears here. */
const FINDING_LABEL: Record<string, string> = {
  WASTE_CACHE_1H: 'Paying double for cache',
  WASTE_CACHE_MISS: 'Cache broken, paying to read it again',
  SUBAGENT_HEAVY: 'Subagents on an expensive model',
  OVERKILL_MODEL: 'Big model, tiny task',
  CEILING_RISK: 'Sometimes at or past the ceiling',
}

const DB = () => join(dataDir(), 'index.sqlite')

/** What an unknown value looks like in the terminal. Never a 0. */
const UNKNOWN_MARK = 'n/a'

const arg = (name: string, dflt?: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const has = (name: string): boolean => process.argv.includes(`--${name}`)
const n = (x: number): string => x.toLocaleString('en-US', { maximumFractionDigits: 0 })

function cmdDoctor(): void {
  const plan = readPlan()
  const limits = readLiveLimits()
  const cycle = readCycleCost()
  const files = listTranscripts(projectsDir())
  const metas = readSessionMeta(join(usageDataDir(), 'session-meta'))
  const facets = readFacets(join(usageDataDir(), 'facets'))
  // The count must FOLLOW from the lines actually printed. A hand-written number in the
  // heading is correct only until the next source is added, and when it goes wrong it does
  // not turn red, it just stays quiet.
  const lines: Array<[boolean, string]> = []
  const ok = (b: boolean): string => (b ? '✅' : '❌')
  const say = (good: boolean, text: string): void => { lines.push([good, text]) }
  const warnings: string[] = []
  say(plan.tier !== null, `plan        : ${plan.tier ?? 'unreadable'} (${plan.mode}), 5h ceiling = ${plan.ceiling ? n(plan.ceiling) + ' credits' : 'n/a'}`)
  say(plan.credits_source === 'live', `credit table: ${plan.credits_source}, ${Object.keys(plan.credits_per_mtok).length} models, as of ${plan.credits_as_of}`)
  say(!!limits, `live limits : ${limits ? `5h ${limits.five_hour_pct}%, 7d ${limits.seven_day_pct}%, snapshot ${limits.age_minutes.toFixed(0)} min old${limits.age_minutes > 15 ? ' (STALE)' : ''}` : 'missing ~/.claude/cache/rate-limits.json'}`)
  say(!!cycle, `cycle cost  : ${cycle ? `$${cycle.cycle_cost.toFixed(2)}, day ${cycle.days_elapsed} of ${cycle.days_total}` : 'missing usage-cycle.json'}`)
  say(files.length > 0, `transcripts : ${n(files.length)} files, ${(files.reduce((s, f) => s + f.size_bytes, 0) / 1e9).toFixed(2)} GB`)
  say(metas.length > 0, `/insights   : ${metas.length} session-meta (deterministic), ${facets.length} facets (model inferred)`)
  if (metas.length > 0 && facets.length < metas.length) {
    warnings.push(`   friction covers only ${facets.length}/${metas.length} sessions, so every friction figure MUST show its sample size`)
  }

  // `setMeta` has written last_index_at for a long time and nothing read it. It is exactly
  // what you need when calibration reports `stale_index`, so wire it up rather than delete
  // information that already exists.
  if (existsSync(DB())) {
    const d = openDb(DB())
    const at = getMeta(d, 'last_index_at')
    d.close()
    if (at) {
      const mins = Math.round((Date.now() - Date.parse(at)) / 60_000)
      const how = mins < 10 ? 'just now' : mins < 120 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`
      const stale = mins > 60
      say(!stale, `index       : last scan ${how}`)
      if (stale) warnings.push('   stale index, so calibration will report stale_index. Run `tally index`.')
    }
  } else {
    say(false, 'index       : none yet. Run `tally index`.')
  }

  console.log(`tally doctor: ${lines.length} data sources, ${lines.filter((l) => l[0]).length} present\n`)
  for (const [good, text] of lines) console.log(`${ok(good)} ${text}`)
  for (const w of warnings) console.log(w)
}

async function cmdIndex(): Promise<void> {
  const db = openDb(DB())
  const full = has('full')
  const t0 = Date.now()
  let lastPct = -1
  const st = await ingest(db, projectsDir(), full, (done, total) => {
    const pct = Math.floor(done / total * 100)
    if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; process.stderr.write(`\r  scanning ${pct}% (${done}/${total})   `) }
  })
  process.stderr.write('\r' + ' '.repeat(40) + '\r')
  console.log(`scan finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  files seen ${n(st.files_seen)}, scanned ${n(st.files_scanned)}, skipped ${n(st.files_skipped)}`)
  console.log(`  lines ok ${n(st.lines_ok)}, broken ${n(st.lines_bad)}, missing cache split ${n(st.lines_degraded)}`)
  console.log(`  new records ${n(st.rows_inserted)}`)
}

function cmdReport(): void {
  const db = openDb(DB())
  const ev = allEvents(db)
  if (ev.length === 0) { console.log('no data yet. Run `tally index` first.'); return }
  const plan = readPlan()
  const limits = readLiveLimits()
  const grain = (arg('grain', 'day') ?? 'day') as Grain
  const tz = arg('tz') ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  console.log(`\n== PLAN: ${plan.tier ?? '?'}, 5h ceiling ${plan.ceiling ? n(plan.ceiling) : '?'} credits, table: ${plan.credits_source}`)
  if (limits) console.log(`  current limits: 5h ${limits.five_hour_pct}%, 7d ${limits.seven_day_pct}%${limits.age_minutes > 15 ? `  (snapshot ${limits.age_minutes.toFixed(0)} min old)` : ''}`)

  const cal = limits ? calibrate(ev, plan.credits_per_mtok, limits, plan.ceiling ?? 0) : null
  if (cal) {
    const note = cal.status === 'low_signal'
      ? 'low signal (under 5% of the ceiling). The percentages below are ESTIMATES, not calibrated.'
      : cal.status === 'poor_fit' ? `hypothesis "${cal.hypothesis}" fits POORLY (off by ${cal.error_pct?.toFixed(1)}%). Treat the credit figures as rough.`
      : cal.status === 'no_ceiling' ? 'the plan ceiling could not be read, so no calibration is possible'
      : cal.status === 'stale_index' ? 'the index is OLDER than the limit snapshot. Run `tally index` and look again.'
      : cal.status === 'no_data' ? 'no events inside the calibration window'
      : `calibrated: hypothesis "${cal.hypothesis}", off by ${cal.error_pct?.toFixed(1)}%`
    console.log(`  calibration: ${note}`)
  }

  const sum = summaryByModel(ev, plan.credits_per_mtok,
    cal?.hypothesis ?? DEFAULT_HYPOTHESIS, plan.ceiling, currentWindow(limits))
  console.log(`\n== BY MODEL (${n(ev.length)} requests, 5h window: ${n(sum.window.events)} requests)`)
  console.log('  model                    credits 5h   % ceiling    credits total      USD')
  for (const r of sum.rows) {
    if (r.credits_lifetime === 0 && r.usd === 0) continue
    const pct = r.pct_of_ceiling === null ? UNKNOWN_MARK : r.pct_of_ceiling.toFixed(2) + '%'
    const c5 = r.credits_known ? n(r.credits_5h) : UNKNOWN_MARK
    const cl = r.credits_known ? n(r.credits_lifetime) : `${UNKNOWN_MARK} (no rate)`
    console.log(`  ${r.model.padEnd(22)} ${c5.padStart(11)} ${pct.padStart(8)} ${cl.padStart(18)} ${('$' + r.usd.toFixed(2)).padStart(9)}`)
  }

  const rows = rollup(ev, tz, grain)
  console.log(`\n== BY ${grain.toUpperCase()} (tz ${tz}), last 12 buckets`)
  for (const r of rows.slice(-12)) {
    console.log(`  ${r.key.padEnd(14)} ${n(r.events).padStart(7)} requests, in ${n(r.input).padStart(12)}, out ${n(r.output).padStart(9)}`)
  }

  const f = detectFindings(ev, plan.ceiling, cal?.hypothesis ?? DEFAULT_HYPOTHESIS,
    cal?.fitted_on_credits ?? null, plan.credits_per_mtok)
  console.log(`\n== FINDINGS (${f.length})`)
  if (plan.ceiling === null) console.log('  (the plan ceiling could not be read, so checks that need it are skipped)')
  if (f.length === 0) console.log('  nothing found that can be priced')
  for (const x of f) {
    const d = x.damage.usd !== undefined ? `$${x.damage.usd.toFixed(2)}` : `${n(x.damage.credits ?? 0)} credits`
    // Three different kinds of number, three different verbs. Saying "damage 406,020"
    // about a PEAK makes the reader think they lost that much money.
    const verb = x.damage_kind === 'saving' ? 'could save'
      : x.damage_kind === 'peak' ? 'measured peak' : 'already spent'
    console.log(`  [${x.severity}] ${FINDING_LABEL[x.id] ?? x.id}: ${verb} ${d}`)
    const bits: string[] = []
    if (x.metric['sessions'] !== undefined) bits.push(`${n(Number(x.metric['sessions']))} sessions`)
    if (x.metric['requests'] !== undefined) bits.push(`${n(Number(x.metric['requests']))} requests`)
    if (x.metric['scope'] === 'lifetime') bits.push('over all indexed history')
    if (x.metric['windows_over_80pct'] !== undefined) {
      bits.push(`${n(Number(x.metric['windows_over_80pct']))} 5h windows over 80% of the ceiling`)
    }
    if (x.metric['peak_credits'] !== undefined && x.metric['ceiling'] !== undefined) {
      const pct = Number(x.metric['peak_credits']) / Number(x.metric['ceiling']) * 100
      bits.push(`peak = ${pct.toFixed(0)}% of the ceiling`)
    }
    if (x.metric['extrapolated']) bits.push('EXTRAPOLATED: fitted on a much lighter window')
    if (bits.length > 0) console.log(`         ${bits.join(', ')}`)
    console.log(`         -> ${x.action}`)
  }
  console.log()
}

function cmdServe(): void {
  const port = Number(arg('port', '7777'))
  serve({ port, webRoot: WEB_ROOT, dbPath: DB(), tz: arg('tz'), redact: has('redact'), watch: has('watch') })
  console.log(`tally is running: http://127.0.0.1:${port}`)
  console.log('  localhost only, read only, except two token-guarded POST routes: run /insights, and ask Claude to explain')
  console.log('  nothing is sent to the internet')
  if (has('redact')) console.log('  --redact: project names are anonymised')
  if (has('watch')) console.log('  --watch: rescan when a new session lands')
}

const HELP = `tally: a local usage and insight dashboard for Claude Code

  tally index              incrementally scan ~/.claude/projects into SQLite
         --full                rescan everything from zero
  tally report             print the tables in the terminal
         --grain=hour|day|month|year   --tz=Asia/Ho_Chi_Minh
  tally serve              open the dashboard
         --port=7777           --tz=...
         --watch               rescan when a new session lands
         --redact              anonymise project names (for shareable screenshots)
  tally doctor             check every data source

Nothing is sent to the internet. Message text is never read.
`

const cmd = process.argv[2]
switch (cmd) {
  case 'index': await cmdIndex(); break
  case 'report': cmdReport(); break
  case 'serve': cmdServe(); break
  case 'doctor': cmdDoctor(); break
  default: console.log(HELP)
}
