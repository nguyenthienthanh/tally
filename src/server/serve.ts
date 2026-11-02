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
 * Server vốn CHỈ-GET ("dashboard không sửa được gì"). Nút "Phân tích lại" cần LÀM một việc
 * tốn hạn mức, nên có đúng MỘT đường ghi, và nó được siết hết mức có thể:
 *   · chỉ POST /api/insight/refresh và POST /api/explain/run — không có đường ghi nào khác
 *   · phải kèm token sinh ngẫu nhiên mỗi lần khởi động, chỉ nhúng vào trang phục vụ tại chỗ
 *     ⇒ một trang web khác trong trình duyệt không gọi được (nó không đọc được token)
 *   · mỗi lúc chỉ một lượt chạy (409 nếu đang chạy)
 *   · không nhận tham số nào từ client ngoài dry_run — không có gì để chèn độc
 *   · in ra terminal mỗi khi chạy thật, để không bao giờ chạy lén
 */

export function buildApi(dbPath: string, tz: string, redact = false) {
  const db = openDb(dbPath)
  const plan = readPlan()
  const cpm = plan.credits_per_mtok

  /**
   * Cache trong tiến trình, khoá theo mtime của file SQLite.
   * Không có cache thì MỖI request đọc lại 61k dòng + tính lại hiệu chuẩn (đo thật:
   * /api/buckets 0,92s; 6 request song song 2,81s) và chặn luôn thread Node.
   * Đọc lại index ⇒ mtime đổi ⇒ cache tự hết hạn. Không có nguồn sự thật thứ hai.
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
  /** Hiệu chuẩn tính MỘT lần cho mỗi lần nạp — mọi endpoint dùng chung kết quả đó. */
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
    load()   // bảo đảm cache còn tươi; nó cũng là nơi dọn cacheSessions khi index đổi
    if (!cacheSessions) {
      cacheSessions = summarizeSessions(cacheEvents ?? [], cpm, calibration().hypothesis)
    }
    return cacheSessions
  }

  /**
   * Sự kiện đã LỌC THEO PHẠM VI. Mọi endpoint đi qua đây — nếu mỗi trang tự lọc
   * một kiểu thì sớm muộn hai trang sẽ nói hai con số khác nhau về cùng một thứ.
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
      // Cửa sổ 5 giờ suy từ mốc reset THẬT; các khoảng khác lùi từ bây giờ.
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
    /** Các con số sẽ được gửi đi — chính là thứ màn hình đang hiện, không hơn. */
    explainPayload() {
      const b = this.behaviour()
      const nowd = this.now()
      return {
        tool_calls: b.total, sessions: b.sessions,
        not_hand_driven_pct: b.not_hand_driven_pct, sidechain_pct: b.sidechain_pct,
        // Ba làn phải đi kèm, nếu không người đọc sẽ nhận phần đọc và dò của máy
        // xưởng làm thói quen của mình.
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
     * Chi phí NỀN của một lượt `claude -p`, ĐO TỪ LỊCH SỬ CỦA CHÍNH MÁY NÀY.
     *
     * Không đoán và không chép một hằng số: lấy các phiên `sdk-cli` ngắn (một lượt
     * hỏi, một lượt đáp) rồi lấy trung vị. Chưa có phiên nào như thế ⇒ null, và
     * màn hình phải nói "chưa đo".
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
      if (small.length < 20) return null      // mẫu quá nhỏ thì trung vị không nói gì
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
      // Dùng CHUNG cacheBuckets: nó đã được xoá đúng lúc index đổi. Dựng cache thứ
      // hai nghĩa là có chỗ thứ hai phải nhớ đi xoá — và chỗ đó sẽ bị quên.
      const key = `activity|${days}|${scope}`
      const hit = cacheBuckets.get(key)
      if (hit) return hit as ActivityPayload
      const ev = scoped(scope)
      const h = calibration().hypothesis
      const lanes = activityLanes(ev, tz, cpm, h, days)
      // Số ngày lưới phải phủ = khoảng cách từ ngày đầu tới ngày cuối CÓ DỮ LIỆU,
      // không phải `days` yêu cầu: xin 365 mà chỉ có 40 ngày thì vẽ 365 ô trống.
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
        // Điều ĐỌC RA ĐƯỢC, suy từ chính số đo ở trên — không phải danh sách tên.
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
      // KHÔNG được thiếu .catch: một phiên bị xoá giữa listTranscripts và readFrom sẽ
      // ném ENOENT, promise reject không ai bắt, Node >=15 mặc định throw ⇒ server TỰ TẮT.
      void ingest(db2, projectsDir(), false)
        .then((st) => {
          if (st.rows_inserted > 0) console.log(`[tally] quét thêm ${st.rows_inserted} bản ghi mới`)
        })
        .catch((e: unknown) => { console.error('[tally] quét nền lỗi:', e) })
        .finally(() => { try { db2.close() } catch { /* đã đóng */ } })
    })
    process.on('exit', () => w.close())
  }

  const token = randomUUID()
  let refreshing = false
  let explaining = false

  /** Phạm vi lấy từ query: 'all' | 'active' | một session_id. Chỉ nhận ký tự an toàn. */
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

    // Đường GHI duy nhất.
    if (url.pathname === '/api/explain/run') {
      // Đường GHI thứ hai. Cùng chốt token, cùng luật 405/401 như refresh: không
      // có đường tắt nào rẻ hơn cho việc tiêu hạn mức của người dùng.
      if (req.method !== 'POST') return sendJson(405, { error: 'POST only' })
      if (req.headers['x-tally-token'] !== token) return sendJson(401, { error: 'thiếu hoặc sai token' })
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
      if (explaining) return sendJson(409, { error: 'đang chạy' })
      explaining = true
      process.stderr.write(`[tally] giải thích: ${lang}/${depth}, dùng Claude của bạn…\n`)
      runExplain(payload, lang, depth, homedir())
        .then((r) => sendJson(200, { ok: true, result: r }))
        .catch((e) => sendJson(500, { error: String(e).slice(0, 300) }))
        .finally(() => { explaining = false })
      return
    }

    if (url.pathname === '/api/insight/refresh') {
      if (req.method !== 'POST') return sendJson(405, { error: 'chỉ POST' })
      if (req.headers['x-tally-token'] !== token) return sendJson(401, { error: 'thiếu hoặc sai token' })
      const dry = url.searchParams.get('dry_run') === '1'
      const pct = plan.ceiling ? estimateRefreshPct(plan.ceiling) : null
      if (dry) return sendJson(200, { dry_run: true, measured: MEASURED_REFRESH, pct_of_ceiling: pct })
      if (refreshing) return sendJson(409, { error: 'đang chạy một lượt rồi' })
      refreshing = true
      console.log(`[tally] CHẠY \`claude -p "/insights"\` theo yêu cầu từ dashboard — ước tính ${MEASURED_REFRESH.credits} credits (~${pct?.toFixed(2) ?? '?'}% trần 5h)`)
      refreshInsights({ consented: true })
        .then((r) => { console.log(`[tally] xong: ${r.reportPath || '(không thấy đường dẫn báo cáo)'}`); sendJson(200, { ok: true, ...r }) })
        .catch((e: unknown) => { console.error('[tally] lỗi:', e); sendJson(500, { error: String(e instanceof Error ? e.message : e) }) })
        .finally(() => { refreshing = false })
      return
    }

    // Mọi thứ còn lại: chỉ GET.
    if (req.method !== 'GET') { res.writeHead(405).end('chỉ GET'); return }
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
          if (!['hour', 'day', 'month', 'year'].includes(g)) return send(400, { error: 'grain không hợp lệ' })
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
          // Chỉ đọc, đường dẫn CỐ ĐỊNH (không nhận tham số từ client ⇒ không traversal).
          const rp = join(usageDataDir(), 'report.html')
          if (!existsSync(rp)) { res.writeHead(404).end('chưa có báo cáo'); return }
          res.writeHead(200, { 'content-type': MIME['.html']!, 'cache-control': 'no-store' })
          res.end(readFileSync(rp))
          return
        }
      }
      // tĩnh
      const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '')
      const file = join(opts.webRoot, rel)
      if (!file.startsWith(opts.webRoot) || !existsSync(file)) { res.writeHead(404).end('không có'); return }
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
  server.listen(opts.port, '127.0.0.1')   // KHÔNG 0.0.0.0 — không mở ra LAN

  // Hâm cache ngay khi lên: lần gọi API đầu tiên phải đọc 61k dòng từ SQLite và
  // dựng mảnh hoạt động — khoảng một giây rơi đúng vào lần mở trang đầu của người
  // dùng. Trả cái giá đó lúc khởi động, khi chưa ai chờ.
  setImmediate(() => {
    try { api.now(); api.activity(30) } catch { /* chưa có index — doctor sẽ nói */ }
  })
  return server
}
