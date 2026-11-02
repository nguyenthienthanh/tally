import type { UsageEvent } from '../types.js'
import { costByModel, costOfEvent, hasPricing } from './cost.js'
import { creditsByModel, creditsOfEvent, type Hypothesis } from './credits.js'

/**
 * MỘT chỗ duy nhất tính bảng "theo model".
 * Trước khi tách ra, server và CLI mỗi nơi tự tính; server đã sửa sang cửa sổ 5 giờ
 * còn CLI vẫn chia credits TOÀN THỜI GIAN cho trần 5 giờ và in ra "10853.5%".
 * Hai chỗ tính cùng một thứ thì sớm muộn một chỗ nói dối (luật: cấm nguồn sự thật thứ hai).
 */
export interface ModelRow {
  model: string
  /** Credits trong KHOẢNG ĐANG XEM (5 giờ / 24 giờ / 7 ngày / 30 ngày / tất cả). */
  credits_period: number
  /** Tổng credits trên TOÀN BỘ lịch sử đã quét — không giới hạn khoảng nào.
   *  Đây là con số trả lời "từ trước tới giờ model này đã ăn bao nhiêu". */
  credits_lifetime: number
  /** @deprecated bí danh của credits_period, giữ cho nơi gọi cũ. */
  credits_5h: number
  /** USD trong khoảng đang xem. */
  usd_period: number
  /** USD trên toàn bộ lịch sử. */
  usd: number
  /** Model này chiếm bao nhiêu PHẦN credits của khoảng đang xem — câu trả lời cho
   *  "tôi thật sự dùng model nào". null khi chưa biết hệ số hoặc khoảng rỗng. */
  share_pct: number | null
  /** Chỉ có nghĩa khi khoảng đang xem LÀ cửa sổ 5 giờ; ngoài ra luôn null. */
  pct_of_ceiling: number | null
  /** false khi model KHÔNG có trong bảng hệ số credits ⇒ hiện '—', tuyệt đối không hiện 0.
   *  Ca thật: `claude-haiku-5-5` chưa có trong tengu_amber_tally (2026-10-29) — hiện 0
   *  sẽ khiến người đọc tưởng nó miễn phí. "Không biết" khác "bằng không". */
  credits_known: boolean
}

export interface ModelSummary {
  rows: ModelRow[]
  is_five_hour: boolean
  period_total_credits: number
  window: { startUtc: string; endUtc: string; events: number }
  events: number
}

/**
 * Cửa sổ 5 giờ hiện tại. Suy từ mốc RESET THẬT mà client báo, không phải lùi 5 giờ
 * từ bây giờ — hai thứ đó lệch nhau và chỉ cái đầu mới khớp với `five_hour_pct`.
 */
export function currentWindow(limits: { five_hour_reset: number; captured_at: number } | null):
  { startMs: number; endMs: number } {
  // `five_hour_reset: 0` nghĩa là KHÔNG có cửa sổ nào đang chạy (vừa reset, chưa
  // dùng gì). Trừ 5 giờ khỏi 0 ra mốc ÂM, nên cửa sổ hoá thành toàn thời gian và
  // cột "% trần 5h" lặng lẽ thành "credits trọn đời chia trần 5 giờ" — đúng lớp
  // lỗi 10.853% đã sửa một lần, quay lại bằng một cửa khác.
  if (limits && limits.five_hour_reset > 0) {
    return { startMs: (limits.five_hour_reset - 5 * 3600) * 1000, endMs: limits.captured_at * 1000 }
  }
  const end = limits && limits.captured_at > 0 ? limits.captured_at * 1000 : Date.now()
  return { startMs: end - 5 * 3600 * 1000, endMs: end }
}

export const PERIODS = ['5h', '24h', '7d', '30d', 'all'] as const
export type Period = (typeof PERIODS)[number]

const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  '5h': 5 * 3600_000, '24h': 24 * 3600_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000,
}

/**
 * Khoảng thời gian cho một lựa chọn.
 * `all` lấy từ mốc 0 — người dùng muốn thấy TOÀN BỘ, không phải một cửa sổ dài.
 */
export function periodWindow(p: Period, nowMs = Date.now()): { startMs: number; endMs: number } {
  if (p === 'all') return { startMs: 0, endMs: nowMs }
  return { startMs: nowMs - PERIOD_MS[p], endMs: nowMs }
}

export function summaryByModel(
  events: UsageEvent[],
  cpm: Record<string, number>,
  hypothesis: Hypothesis,
  ceiling: number | null,
  /** Khoảng ĐANG XEM. Chỉ khi nó đúng là cửa sổ 5 giờ thì `pct_of_ceiling` mới có nghĩa. */
  window: { startMs: number; endMs: number },
  /** true khi `window` chính là cửa sổ 5 giờ hiện tại. */
  isFiveHour = true,
): ModelSummary {
  const inWin = events.filter((e) => {
    const t = Date.parse(e.ts_utc)
    return t >= window.startMs && t <= window.endMs
  })
  const lifetime = creditsByModel(events, cpm, hypothesis)
  const win = creditsByModel(inWin, cpm, hypothesis)
  const usdAll = costByModel(events)
  const usdWin = costByModel(inWin)

  // Tổng credits của khoảng đang xem — mẫu số cho "model này chiếm bao nhiêu phần".
  // Chỉ cộng model BIẾT hệ số: cộng cả model chưa biết vào mẫu số sẽ làm mọi phần
  // trăm tụt xuống một cách im lặng.
  let periodTotal = 0
  for (const [m, c] of Object.entries(win)) if (cpm[m] !== undefined) periodTotal += c

  const rows = Object.keys({ ...lifetime, ...usdAll }).map((model) => {
    const known = cpm[model] !== undefined
    const credits = win[model] ?? 0
    return {
      model,
      credits_period: credits,
      credits_lifetime: lifetime[model] ?? 0,
      /** Giữ tên cũ cho nơi gọi đã có; bằng credits_period. */
      credits_5h: credits,
      usd_period: usdWin[model] ?? 0,
      usd: usdAll[model] ?? 0,
      /** Model này chiếm bao nhiêu phần credits của khoảng đang xem. */
      share_pct: known && periodTotal > 0 ? credits / periodTotal * 100 : null,
      /** Chỉ có nghĩa khi khoảng đang xem LÀ cửa sổ 5 giờ. */
      pct_of_ceiling: known && isFiveHour && ceiling ? credits / ceiling * 100 : null,
      credits_known: known,
    }
  }).sort((a, b) => b.credits_period - a.credits_period || b.credits_lifetime - a.credits_lifetime)

  return {
    rows,
    is_five_hour: isFiveHour,
    period_total_credits: periodTotal,
    window: {
      startUtc: new Date(window.startMs).toISOString(),
      endUtc: new Date(window.endMs).toISOString(),
      events: inWin.length,
    },
    events: events.length,
  }
}

export interface ProjectRow {
  project: string
  events: number
  credits: number
  usd: number
  sidechain_usd: number
}

/** Chi phí theo dự án (cwd). `label` cho phép ẩn danh mà KHÔNG đổi cách gộp nhóm. */
export function summaryByProject(
  events: UsageEvent[],
  cpm: Record<string, number>,
  hypothesis: Hypothesis,
  label: (key: string) => string = (k) => k,
): ProjectRow[] {
  const m = new Map<string, ProjectRow>()
  for (const e of events) {
    const key = label(e.project_key)
    const row = m.get(key) ?? { project: key, events: 0, credits: 0, usd: 0, sidechain_usd: 0 }
    row.events += 1
    row.credits += creditsOfEvent(e, cpm, hypothesis)
    const c = hasPricing(e.model) ? costOfEvent(e) : 0
    row.usd += c
    if (e.is_sidechain) row.sidechain_usd += c
    m.set(key, row)
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd)
}
