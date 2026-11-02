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
/** Nhãn tiếng người cho CLI. Test chặn: mọi id trong findings.ts phải có mặt ở đây. */
const FINDING_VI: Record<string, string> = {
  WASTE_CACHE_1H: 'Đang trả phí cache đắt gấp đôi',
  WASTE_CACHE_MISS: 'Cache bị phá, phải trả lại tiền đọc',
  SUBAGENT_HEAVY: 'Subagent đang dùng model đắt',
  OVERKILL_MODEL: 'Model mạnh làm việc nhẹ',
  CEILING_RISK: 'Có lúc dùng sát hoặc quá trần',
}

const DB = () => join(dataDir(), 'index.sqlite')

const arg = (name: string, dflt?: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const has = (name: string): boolean => process.argv.includes(`--${name}`)
const n = (x: number): string => x.toLocaleString('vi-VN', { maximumFractionDigits: 0 })

function cmdDoctor(): void {
  const plan = readPlan()
  const limits = readLiveLimits()
  const cycle = readCycleCost()
  const files = listTranscripts(projectsDir())
  const metas = readSessionMeta(join(usageDataDir(), 'session-meta'))
  const facets = readFacets(join(usageDataDir(), 'facets'))
  // Đếm phải SUY RA từ số dòng thật in ra. Một con số chép tay trong tiêu đề chỉ đúng tới
  // lần thêm nguồn kế tiếp, và khi nó sai thì nó không đỏ — nó chỉ im.
  const lines: Array<[boolean, string]> = []
  const ok = (b: boolean): string => (b ? '✅' : '❌')
  const say = (good: boolean, text: string): void => { lines.push([good, text]) }
  const warnings: string[] = []
  say(plan.tier !== null, `gói          : ${plan.tier ?? 'không đọc được'} (${plan.mode}) · trần 5h = ${plan.ceiling ? n(plan.ceiling) + ' credits' : 'n/a'}`)
  say(plan.credits_source === 'live', `hệ số credits: nguồn ${plan.credits_source} · ${Object.keys(plan.credits_per_mtok).length} model · as-of ${plan.credits_as_of}`)
  say(!!limits, `hạn mức live : ${limits ? `5h ${limits.five_hour_pct}% · 7d ${limits.seven_day_pct}% · chụp cách đây ${limits.age_minutes.toFixed(0)} phút${limits.age_minutes > 15 ? ' ⚠️ CŨ' : ''}` : 'thiếu ~/.claude/cache/rate-limits.json'}`)
  say(!!cycle, `chi phí kỳ   : ${cycle ? `$${cycle.cycle_cost.toFixed(2)} · ${cycle.days_elapsed}/${cycle.days_total} ngày` : 'thiếu usage-cycle.json'}`)
  say(files.length > 0, `transcript   : ${n(files.length)} file · ${(files.reduce((s, f) => s + f.size_bytes, 0) / 1e9).toFixed(2)} GB`)
  say(metas.length > 0, `/insights    : ${metas.length} session-meta (tất định) · ${facets.length} facets (LLM suy ra)`)
  if (metas.length > 0 && facets.length < metas.length) {
    warnings.push(`   ⚠️ ma sát chỉ phủ ${facets.length}/${metas.length} phiên — mọi số ma sát PHẢI hiện cỡ mẫu`)
  }

  // `setMeta` ghi last_index_at từ lâu mà chưa ai đọc. Đây đúng là thứ cần biết khi hiệu
  // chuẩn báo `stale_index` — nối vào đây đúng hơn là xoá một thông tin đã có sẵn.
  if (existsSync(DB())) {
    const d = openDb(DB())
    const at = getMeta(d, 'last_index_at')
    d.close()
    if (at) {
      const mins = Math.round((Date.now() - Date.parse(at)) / 60_000)
      const how = mins < 10 ? 'vừa xong' : mins < 120 ? `${mins} phút trước` : `${Math.round(mins / 60)} giờ trước`
      const stale = mins > 60
      say(!stale, `index        : quét lần cuối ${how}`)
      if (stale) warnings.push('   ⚠️ index cũ ⇒ hiệu chuẩn sẽ báo stale_index; chạy `tally index`')
    }
  } else {
    say(false, 'index        : chưa có — chạy `tally index`')
  }

  console.log(`tally doctor — ${lines.length} nguồn dữ liệu (${lines.filter((l) => l[0]).length} ✅)\n`)
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
    if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; process.stderr.write(`\r  quét ${pct}% (${done}/${total})   `) }
  })
  process.stderr.write('\r' + ' '.repeat(40) + '\r')
  console.log(`quét xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  file thấy ${n(st.files_seen)} · quét ${n(st.files_scanned)} · bỏ qua ${n(st.files_skipped)}`)
  console.log(`  dòng ok ${n(st.lines_ok)} · hỏng ${n(st.lines_bad)} · thiếu phân chia cache ${n(st.lines_degraded)}`)
  console.log(`  bản ghi mới ${n(st.rows_inserted)}`)
}

function cmdReport(): void {
  const db = openDb(DB())
  const ev = allEvents(db)
  if (ev.length === 0) { console.log('chưa có dữ liệu — chạy `tally index` trước'); return }
  const plan = readPlan()
  const limits = readLiveLimits()
  const grain = (arg('grain', 'day') ?? 'day') as Grain
  const tz = arg('tz') ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  console.log(`\n■ GÓI: ${plan.tier ?? '?'} · trần 5h ${plan.ceiling ? n(plan.ceiling) : '?'} credits · hệ số: ${plan.credits_source}`)
  if (limits) console.log(`  hạn mức hiện tại: 5h ${limits.five_hour_pct}% · 7 ngày ${limits.seven_day_pct}%${limits.age_minutes > 15 ? `  (số liệu cũ ${limits.age_minutes.toFixed(0)} phút)` : ''}`)

  const cal = limits ? calibrate(ev, plan.credits_per_mtok, limits, plan.ceiling ?? 0) : null
  if (cal) {
    const note = cal.status === 'low_signal'
      ? 'tín hiệu yếu (<5% trần) — % dưới đây là ƯỚC LƯỢNG, chưa hiệu chuẩn'
      : cal.status === 'poor_fit' ? `giả thuyết "${cal.hypothesis}" khớp KÉM (lệch ${cal.error_pct?.toFixed(1)}%) — con số credits chỉ để tham khảo`
      : cal.status === 'no_ceiling' ? 'KHÔNG đọc được trần gói ⇒ không hiệu chuẩn được'
      : cal.status === 'stale_index' ? 'index CŨ hơn mốc chụp hạn mức — chạy `tally index` rồi xem lại'
      : cal.status === 'no_data' ? 'không có event trong cửa sổ hiệu chuẩn'
      : `đã hiệu chuẩn: giả thuyết "${cal.hypothesis}", lệch ${cal.error_pct?.toFixed(1)}%`
    console.log(`  hiệu chuẩn: ${note}`)
  }

  const sum = summaryByModel(ev, plan.credits_per_mtok,
    cal?.hypothesis ?? DEFAULT_HYPOTHESIS, plan.ceiling, currentWindow(limits))
  console.log(`\n■ THEO MODEL (${n(ev.length)} request · cửa sổ 5h: ${n(sum.window.events)} request)`)
  console.log('  model                    credits 5h   % trần       credits tổng       USD')
  for (const r of sum.rows) {
    if (r.credits_lifetime === 0 && r.usd === 0) continue
    const pct = r.pct_of_ceiling === null ? '—' : r.pct_of_ceiling.toFixed(2) + '%'
    const c5 = r.credits_known ? n(r.credits_5h) : '—'
    const cl = r.credits_known ? n(r.credits_lifetime) : '— (chưa có hệ số)'
    console.log(`  ${r.model.padEnd(22)} ${c5.padStart(11)} ${pct.padStart(8)} ${cl.padStart(18)} ${('$' + r.usd.toFixed(2)).padStart(9)}`)
  }

  const rows = rollup(ev, tz, grain)
  console.log(`\n■ THEO ${grain.toUpperCase()} (tz ${tz}) — 12 mốc gần nhất`)
  for (const r of rows.slice(-12)) {
    console.log(`  ${r.key.padEnd(14)} ${n(r.events).padStart(7)} request · in ${n(r.input).padStart(12)} · out ${n(r.output).padStart(9)}`)
  }

  const f = detectFindings(ev, plan.ceiling, cal?.hypothesis ?? DEFAULT_HYPOTHESIS,
    cal?.fitted_on_credits ?? null, plan.credits_per_mtok)
  console.log(`\n■ LỖ HỔNG (${f.length})`)
  if (plan.ceiling === null) console.log('  (không đọc được trần gói ⇒ bỏ qua các đánh giá cần trần)')
  if (f.length === 0) console.log('  không phát hiện gì có thể quy ra tiền')
  for (const x of f) {
    const d = x.damage.usd !== undefined ? `$${x.damage.usd.toFixed(2)}` : `${n(x.damage.credits ?? 0)} credits`
    // Ba loại số khác nhau, ba động từ khác nhau. "Thiệt hại 406.020" cho một ĐỈNH
    // khiến người đọc tưởng mình mất ngần ấy tiền.
    const verb = x.damage_kind === 'saving' ? 'có thể tiết kiệm'
      : x.damage_kind === 'peak' ? 'đỉnh đo được' : 'đã chi'
    console.log(`  [${x.severity}] ${FINDING_VI[x.id] ?? x.id} — ${verb} ${d}`)
    const bits: string[] = []
    if (x.metric['sessions'] !== undefined) bits.push(`${n(Number(x.metric['sessions']))} phiên`)
    if (x.metric['requests'] !== undefined) bits.push(`${n(Number(x.metric['requests']))} request`)
    if (x.metric['scope'] === 'lifetime') bits.push('tính trên toàn bộ lịch sử')
    if (x.metric['windows_over_80pct'] !== undefined) {
      bits.push(`${n(Number(x.metric['windows_over_80pct']))} cửa sổ 5h vượt 80% trần`)
    }
    if (x.metric['peak_credits'] !== undefined && x.metric['ceiling'] !== undefined) {
      const pct = Number(x.metric['peak_credits']) / Number(x.metric['ceiling']) * 100
      bits.push(`đỉnh = ${pct.toFixed(0)}% trần`)
    }
    if (x.metric['extrapolated']) bits.push('CON SỐ NGOẠI SUY — khớp trên cửa sổ nhẹ hơn nhiều')
    if (bits.length > 0) console.log(`         ${bits.join(' · ')}`)
    console.log(`         → ${x.action}`)
  }
  console.log()
}

function cmdServe(): void {
  const port = Number(arg('port', '7777'))
  serve({ port, webRoot: WEB_ROOT, dbPath: DB(), tz: arg('tz'), redact: has('redact'), watch: has('watch') })
  console.log(`tally đang chạy: http://127.0.0.1:${port}`)
  console.log('  chỉ localhost · chỉ đọc, trừ hai đường POST có token: chạy /insights và nhờ Claude giải thích')
  console.log('  không gửi gì ra internet')
  if (has('redact')) console.log('  --redact: tên dự án đã được ẩn danh')
  if (has('watch')) console.log('  --watch: tự quét khi có phiên mới')
}

const HELP = `tally — dashboard usage & insight cho Claude Code (chạy tại máy)

  tally index              quét tăng dần ~/.claude/projects vào SQLite
         --full                quét lại toàn bộ
  tally report             in bảng ra terminal
         --grain=hour|day|month|year   --tz=Asia/Ho_Chi_Minh
  tally serve              mở dashboard
         --port=7777           --tz=...
         --watch               tự quét khi có phiên mới
         --redact              ẩn danh tên dự án (để chụp màn hình chia sẻ)
  tally doctor             kiểm mọi nguồn dữ liệu

Không gửi gì ra internet. Không đọc nội dung hội thoại.
`

const cmd = process.argv[2]
switch (cmd) {
  case 'index': await cmdIndex(); break
  case 'report': cmdReport(); break
  case 'serve': cmdServe(); break
  case 'doctor': cmdDoctor(); break
  default: console.log(HELP)
}
