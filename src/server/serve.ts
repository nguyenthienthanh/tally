import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { openDb, allEvents } from '../ingest/db.js'
import { dataDir, watch, ingest, projectsDir } from '../ingest/index.js'
import { readPlan, readLiveLimits, readCycleCost, usageDataDir } from '../plan.js'
import { summaryByModel, summaryByProject, currentWindow, periodWindow, PERIODS, type Period } from '../engine/summary.js'
import { activityLanes, IDLE_GAP_MIN, type DayLane } from '../engine/activity.js'
import { summarizeSessions, filterByScope } from '../engine/sessions.js'
import { buildReadings } from '../insight/readings.js'
import { homedir } from 'node:os'
import { analyseBehaviour } from '../engine/behaviour.js'
import { buildPrompt, estimate, readExplain, runExplain, type Lang, type Depth } from '../insight/explain.js'
import { allToolFacts } from '../ingest/db.js'

interface ActivityPayload {
  tz: string; hypothesis: string; idle_gap_min: number; days_span: number; lanes: DayLane[]
}
import { calibrate, DEFAULT_HYPOTHESIS } from '../engine/credits.js'
import { rollup, slidingWindows5h, localParts } from '../engine/buckets.js'
import { creditsOfEvent } from '../engine/credits.js'
import { detectFindings } from '../engine/findings.js'
import {
  readSessionMeta, readFacets, aggregateDeterministic, aggregateFriction, latestReport,
} from '../insight/sources.js'
import { findExistingReports } from '../insight/import.js'
import { estimateRefreshPct, MEASURED_REFRESH, refreshInsights } from '../insight/run.js'
import { redactPath } from '../redact.js'
import type { Grain } from '../types.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export interface ServeOpts { port: number; webRoot: string; dbPath?: string; tz?: string; redact?: boolean; watch?: boolean }

/**
 * The server is GET-only by design: the dashboard changes nothing. Two buttons do need to
 * DO something that spends quota, so there are exactly two write routes, and both are
 * tightened as far as they can be:
 *   - only POST /api/insight/refresh and POST /api/explain/run, no other write path
 *   - both require a token minted at every server start and embedded only in the page
 *     served here, so another site open in the same browser cannot call them
 *   - one run at a time (409 while a run is in flight)
 *   - no client parameters beyond the documented ones, so there is nothing to inject
 *   - every real run prints a line to the terminal, so nothing ever runs unnoticed
 */

export function buildApi(dbPath: string, tz: string, redact = false) {
  const db = openDb(dbPath)
  const plan = readPlan()
  const cpm = plan.credits_per_mtok

  /**
   * An in-process cache keyed on the SQLite file's mtime.
   * Without it EVERY request re-reads 61k rows and recomputes the calibration (measured:
   * /api/buckets 0.92s, six parallel requests 2.81s) and blocks the Node thread.
   * A rescan changes the mtime, which expires the cache. No second source of truth.
   */
  let cacheKey = ''
  let cacheEvents: ReturnType<typeof allEvents> | null = null
  let cacheCal: ReturnType<typeof calibrate> | null = null
  const cacheBuckets = new Map<string, unknown>()
  let cacheSessions: ReturnType<typeof summarizeSessions> | null = null
  let cacheBehaviour: ReturnType<typeof analyseBehaviour> | null = null

  const dbMtime = (): string => {
    try { return String(statSync(dbPath).mtimeMs) } catch { return '0' }
  }
  const load = () => {
    const k = dbMtime()
    if (k !== cacheKey || cacheEvents === null) {
      cacheKey = k; cacheEvents = allEvents(db); cacheCal = null; cacheBuckets.clear(); cacheSessions = null; cacheBehaviour = null
    }
    return cacheEvents
  }
  /** Calibration runs ONCE per load, and every endpoint shares that result. */
  const calibration = () => {
    const ev = load()
    if (cacheCal === null) {
      const lim = readLiveLimits()
      cacheCal = lim
        ? calibrate(ev, cpm, lim, plan.ceiling ?? 0)
        : { hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
            fitted_on_credits: null, status: 'no_data' as const }
    }
    return cacheCal
  }

  const sessionsSummary = () => {
    load()   // keeps the cache fresh, and it is also where cacheSessions is cleared on a reindex
    if (!cacheSessions) {
      cacheSessions = summarizeSessions(cacheEvents ?? [], cpm, calibration().hypothesis)
    }
    return cacheSessions
  }

  /**
   * Events already FILTERED BY SCOPE. Every endpoint goes through here: if each page
   * filtered its own way, two pages would eventually report two numbers for one thing.
   */
  const scoped = (scope: string) => (scope === 'all' ? load() : filterByScope(load(), scope, sessionsSummary()))

  return {
    plan,
    now() {
      const limits = readLiveLimits()
      const cycle = readCycleCost()
      return {
        plan, limits, cycle,
        stale: limits ? limits.age_minutes > 15 : null,
        credits_source: plan.credits_source,
        pricing_as_of: plan.credits_as_of,
      }
    },
    byModel(period: Period = '5h', scope = 'all') {
      const ev = scoped(scope)
      const cal = calibration()
      const isFive = period === '5h'
      // The 5-hour window comes from the REAL reset timestamp; other periods count back from now.
      const win = isFive ? currentWindow(readLiveLimits()) : periodWindow(period)
      return {
        ...summaryByModel(ev, cpm, cal.hypothesis, plan.ceiling, win, isFive),
        period, scope, ceiling: plan.ceiling, hypothesis: cal.hypothesis, calibration: cal,
      }
    },
    buckets(grain: Grain) {
      const ev = load()
      const memo = cacheBuckets.get(grain)
      if (memo) return memo
      const hyp = calibration().hypothesis
      const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
      for (const e of ev) {
        const p = localParts(e.ts_utc, tz)
        const row = heat[p.weekday]
        if (row) row[p.hour] = (row[p.hour] ?? 0) + 1
      }
      const wins = slidingWindows5h(ev, (e) => creditsOfEvent(e, cpm, hyp))
      const out = {
        grain, tz, hypothesis: hyp, rows: rollup(ev, tz, grain), heatmap: heat,
        peak_5h: wins.length ? Math.max(...wins.map((w) => w.credits)) : 0,
        peak_extrapolated: (() => {
          const fit = calibration().fitted_on_credits
          const pk = wins.length ? Math.max(...wins.map((w) => w.credits)) : 0
          return typeof fit === 'number' && fit > 0 && pk > fit * 3
        })(),
        windows_over_80: plan.ceiling ? wins.filter((w) => w.credits > 0.8 * plan.ceiling!).length : 0,
        ceiling: plan.ceiling,
      }
      cacheBuckets.set(grain, out)
      return out
    },
    /** The numbers that will be sent out: exactly what the page is showing, nothing more. */
    explainPayload() {
      const b = this.behaviour()
      const nowd = this.now()
      return {
        tool_calls: b.total, sessions: b.sessions,
        not_hand_driven_pct: b.not_hand_driven_pct, sidechain_pct: b.sidechain_pct,
        // The three lanes have to travel with the figures, or the reader takes an
        // unattended pipeline's reading and probing for their own habits.
        lanes: b.lanes.map((l) => ({
          lane: l.lane, pct: l.pct, calls: l.calls, sessions: l.sessions,
          probe_pct: l.probe_pct, read_per_write: l.read_per_write,
          image_pct: l.image_pct, reads: l.reads, writes: l.writes,
          top_projects: l.top_projects.slice(0, 3).map((p) => ({ k: p.key, pct: p.pct })),
        })),
        probe_pct: b.probe_pct, read_per_write: b.read_per_write,
        reread_pct: b.reread_pct,
        verb_groups: b.by_verb_group.map((g) => ({ k: g.key, pct: g.pct })),
        top_commands: b.top_verbs.slice(0, 10).map((v) => ({ k: v.key, pct: v.pct, group: v.group })),
        mcp: b.mcp.map((m) => ({ k: m.key, pct: m.pct, plugin: m.from_plugin })),
        five_hour_pct: nowd.limits?.five_hour_pct ?? null,
        plan: nowd.plan.tier ?? null,
      }
    },
    /**
     * The BASELINE cost of one `claude -p` turn, MEASURED FROM THIS MACHINE'S OWN HISTORY.
     *
     * Neither guessed nor copied from a constant: take the short `sdk-cli` sessions (one
     * question, one answer) and use their median. With no such sessions it returns null
     * and the page has to say "not measured".
     */
    headlessOverhead(): { median: number; p90: number; samples: number } | null {
      const ev = load().filter((e) => e.entrypoint === 'sdk-cli')
      if (ev.length === 0) return null
      const cal = calibration()
      const per = new Map<string, { n: number; c: number }>()
      for (const e of ev) {
        const a = per.get(e.session_id) ?? { n: 0, c: 0 }
        a.n += 1
        a.c += creditsOfEvent(e, cpm, cal.hypothesis)
        per.set(e.session_id, a)
      }
      const small = [...per.values()].filter((x) => x.n <= 3).map((x) => x.c).sort((a, b) => a - b)
      if (small.length < 20) return null      // too small a sample for a median to mean anything
      const at = (q: number): number => Math.round(small[Math.floor(small.length * q)] ?? 0)
      return { median: at(0.5), p90: at(0.9), samples: small.length }
    },
    explain(lang: Lang) {
      const saved = readExplain(homedir(), lang)
      const payload = this.explainPayload()
      const chars = JSON.stringify(payload).length
      const oh = this.headlessOverhead()
      return {
        saved,
        payload_chars: chars,
        overhead: oh,
        estimate: {
          brief: estimate(chars, 'brief', oh?.median ?? null),
          full: estimate(chars, 'full', oh?.median ?? null),
        },
        ceiling: plan.ceiling,
      }
    },
    behaviour() {
      load()
      if (!cacheBehaviour) cacheBehaviour = analyseBehaviour(allToolFacts(db))
      if (!redact) return cacheBehaviour
      return {
        ...cacheBehaviour,
        reread_top: cacheBehaviour.reread_top.map((r) => ({ ...r, target: redactPath(r.target) })),
        lanes: cacheBehaviour.lanes.map((l) => ({
          ...l,
          top_projects: l.top_projects.map((p) => ({ ...p, key: redactPath(p.key) })),
        })),
      }
    },
    sessions(scope = 'all', limit = 200) {
      const all = sessionsSummary()
      const rows = scope === 'active' ? all.rows.filter((r) => r.active) : all.rows
      return {
        ...all,
        scope,
        shown: Math.min(limit, rows.length),
        rows: rows.slice(0, limit).map((r) => (redact ? { ...r, project_key: redactPath(r.project_key) } : r)),
      }
    },
    activity(days: number, scope = 'all') {
      // Reuse cacheBuckets: it is already cleared at the right moment on a reindex. A
      // second cache means a second place to remember to clear, and that place gets forgotten.
      const key = `activity|${days}|${scope}`
      const hit = cacheBuckets.get(key)
      if (hit) return hit as ActivityPayload
      const ev = scoped(scope)
      const h = calibration().hypothesis
      const lanes = activityLanes(ev, tz, cpm, h, days)
      // The grid must span from the first to the last day WITH DATA, not the requested
      // `days`: asking for 365 with only 40 days of data draws 365 empty cells.
      const span = lanes.length
        ? Math.round((Date.parse(lanes[lanes.length - 1]!.day) - Date.parse(lanes[0]!.day)) / 86_400_000) + 1
        : 0
      const out: ActivityPayload = {
        tz, hypothesis: h, idle_gap_min: IDLE_GAP_MIN, days_span: span, lanes,
      }
      cacheBuckets.set(key, out)
      return out
    },
    projects(scope = 'all') {
      const ev = scoped(scope)
      const h = calibration().hypothesis
      const label = redact ? redactPath : (k: string | null) => k ?? '?'
      return { redacted: redact, rows: summaryByProject(ev, cpm, h, label).slice(0, 20) }
    },
    findings(scope = 'all') {
      const ev = scoped(scope)
      const cal = calibration()
      const h = cal.hypothesis
      return {
        hypothesis: h, calibration: cal,
        ceiling: plan.ceiling,
        findings: detectFindings(ev, plan.ceiling, h, cal.fitted_on_credits, cpm),
      }
    },
    insight() {
      const dir = usageDataDir()
      const metas = readSessionMeta(join(dir, 'session-meta'))
      const facets = readFacets(join(dir, 'facets'))
      const det = aggregateDeterministic(metas)
      return {
        redacted: redact,
        // READINGS derived from the measurements above, not a list of names.
        readings: det?.value ? buildReadings(det.value) : [],
        deterministic: det,
        friction: aggregateFriction(facets, metas.length),
        report: latestReport(dir),
        reports: findExistingReports(dir).slice(0, 10),
        refresh: {
          measured: MEASURED_REFRESH,
          pct_of_ceiling: plan.ceiling ? estimateRefreshPct(plan.ceiling) : null,
        },
      }
    },
  }
}

export function serve(opts: ServeOpts): ReturnType<typeof createServer> {
  const dbPath = opts.dbPath ?? join(dataDir(), 'index.sqlite')
  const tz = opts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const api = buildApi(dbPath, tz, opts.redact === true)
  const plan = api.plan
  if (opts.watch) {
    const w = watch(projectsDir(), () => {
      const db2 = openDb(dbPath)
      // The .catch is not optional: a session deleted between listTranscripts and readFrom
      // throws ENOENT, the rejection goes unhandled, and Node 15+ throws by default, which
      // kills the server.
      void ingest(db2, projectsDir(), false)
        .then((st) => {
          if (st.rows_inserted > 0) console.log(`[tally] scanned ${st.rows_inserted} new records`)
        })
        .catch((e: unknown) => { console.error('[tally] background scan failed:', e) })
        .finally(() => { try { db2.close() } catch { /* already closed */ } })
    })
    process.on('exit', () => w.close())
  }

  const token = randomUUID()
  let refreshing = false
  let explaining = false

  /** Scope from the query: 'all', 'active' or one session_id. Only safe characters are accepted. */
  const scopeOf = (u: URL): string => {
    const v = u.searchParams.get('scope') ?? 'all'
    return /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : 'all'
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const sendJson = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }

    // The write routes.
    if (url.pathname === '/api/explain/run') {
      // The second write route. Same token gate, same 405/401 rules as refresh: there is
      // no cheaper shortcut for spending someone else's quota.
      if (req.method !== 'POST') return sendJson(405, { error: 'POST only' })
      if (req.headers['x-tally-token'] !== token) return sendJson(401, { error: 'missing or wrong token' })
      const lang = (['vi', 'zh', 'en'].includes(url.searchParams.get('lang') ?? '')
        ? url.searchParams.get('lang') : 'vi') as Lang
      const depth = (url.searchParams.get('depth') === 'full' ? 'full' : 'brief') as Depth
      const payload = api.explainPayload()
      if (url.searchParams.get('dry_run') === '1') {
        return sendJson(200, {
          dry_run: true, lang, depth,
          estimate: estimate(JSON.stringify(payload).length, depth),
          prompt_chars: buildPrompt(payload, lang, depth).length,
        })
      }
      if (explaining) return sendJson(409, { error: 'a run is already in flight' })
      explaining = true
      process.stderr.write(`[tally] explain: ${lang}/${depth}, using your own Claude\n`)
      runExplain(payload, lang, depth, homedir())
        .then((r) => sendJson(200, { ok: true, result: r }))
        .catch((e) => sendJson(500, { error: String(e).slice(0, 300) }))
        .finally(() => { explaining = false })
      return
    }

    if (url.pathname === '/api/insight/refresh') {
      if (req.method !== 'POST') return sendJson(405, { error: 'POST only' })
      if (req.headers['x-tally-token'] !== token) return sendJson(401, { error: 'missing or wrong token' })
      const dry = url.searchParams.get('dry_run') === '1'
      const pct = plan.ceiling ? estimateRefreshPct(plan.ceiling) : null
      if (dry) return sendJson(200, { dry_run: true, measured: MEASURED_REFRESH, pct_of_ceiling: pct })
      if (refreshing) return sendJson(409, { error: 'a run is already in flight' })
      refreshing = true
      console.log(`[tally] RUNNING \`claude -p "/insights"\` at the dashboard's request, estimated ${MEASURED_REFRESH.credits} credits (about ${pct?.toFixed(2) ?? '?'}% of the 5h ceiling)`)
      refreshInsights({ consented: true })
        .then((r) => { console.log(`[tally] done: ${r.reportPath || '(no report path found)'}`); sendJson(200, { ok: true, ...r }) })
        .catch((e: unknown) => { console.error('[tally] failed:', e); sendJson(500, { error: String(e instanceof Error ? e.message : e) }) })
        .finally(() => { refreshing = false })
      return
    }

    // Everything else is GET only.
    if (req.method !== 'GET') { res.writeHead(405).end('GET only'); return }
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    try {
      switch (url.pathname) {
        case '/api/now': return send(200, api.now())
        case '/api/by-model': {
          const p = url.searchParams.get('period')
          return send(200, api.byModel(
            PERIODS.includes(p as Period) ? (p as Period) : '5h', scopeOf(url)))
        }
        case '/api/buckets': {
          const g = (url.searchParams.get('grain') ?? 'day') as Grain
          if (!['hour', 'day', 'month', 'year'].includes(g)) return send(400, { error: 'invalid grain' })
          return send(200, api.buckets(g))
        }
        case '/api/findings': return send(200, api.findings(scopeOf(url)))
        case '/api/projects': return send(200, api.projects(scopeOf(url)))
        case '/api/activity': {
          const n = Number(url.searchParams.get('days') ?? '30')
          return send(200, api.activity(Number.isFinite(n) && n > 0 ? Math.min(n, 400) : 30, scopeOf(url)))
        }
        case '/api/sessions': {
          const lim = Number(url.searchParams.get('limit') ?? '200')
          return send(200, api.sessions(
            url.searchParams.get('scope') ?? 'all',
            Number.isFinite(lim) && lim > 0 ? Math.min(lim, 2000) : 200))
        }
        case '/api/behaviour': return send(200, api.behaviour())
        case '/api/explain': {
          const l = url.searchParams.get('lang')
          return send(200, api.explain((['vi', 'zh', 'en'].includes(l ?? '') ? l : 'vi') as Lang))
        }
        case '/api/insight': return send(200, api.insight())
        case '/api/insight/report': {
          // Read only, with a FIXED path: no client parameter, so no traversal.
          const rp = join(usageDataDir(), 'report.html')
          if (!existsSync(rp)) { res.writeHead(404).end('no report yet'); return }
          res.writeHead(200, { 'content-type': MIME['.html']!, 'cache-control': 'no-store' })
          res.end(readFileSync(rp))
          return
        }
      }
      // static files
      const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '')
      const file = join(opts.webRoot, rel)
      if (!file.startsWith(opts.webRoot) || !existsSync(file)) { res.writeHead(404).end('not found'); return }
      if (file.endsWith('index.html')) {
        const html = readFileSync(file, 'utf8')
          .replace('<!--TALLY_TOKEN-->', `<meta name="tally-token" content="${token}">`)
        res.writeHead(200, { 'content-type': MIME['.html']!, 'cache-control': 'no-store' })
        res.end(html)
        return
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
    } catch (err) {
      send(500, { error: String(err instanceof Error ? err.message : err) })
    }
  }
  const server = createServer(handler)
  server.listen(opts.port, '127.0.0.1')   // never 0.0.0.0: this is not exposed to the LAN

  // Warm the cache at startup: the first API call has to read 61k rows from SQLite and
  // build the activity fragments, about a second that would otherwise land on the user's
  // first page load. Pay it at startup, while nobody is waiting.
  setImmediate(() => {
    try { api.now(); api.activity(30) } catch { /* no index yet, doctor will say so */ }
  })
  return server
}
