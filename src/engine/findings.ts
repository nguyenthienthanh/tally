import type { UsageEvent, Finding } from '../types.js'
import { costOfEvent, hasPricing } from './cost.js'
import { creditsOfEvent, type Hypothesis } from './credits.js'
import { slidingWindows5h } from './buckets.js'
import { PRICING, CACHE_WRITE_1H_FACTOR, CACHE_WRITE_5M_FACTOR } from '../data/pricing.js'

/** max() an toàn: `Math.max(...mảng)` vỡ stack quanh 10^5 đối số — máy này đã có 61k sự kiện. */
function maxOf(xs: number[]): number {
  let m = -Infinity
  for (const x of xs) if (x > m) m = x
  return m
}

const SEVERITY_RANK: Record<Finding['severity'], number> = { high: 0, medium: 1, low: 2 }
import { CACHE_READ_FACTOR, CACHE_READ_FACTOR_DEFAULT } from '../data/pricing.js'

/** Hạ MỘT bậc model — dùng để tính "tiết kiệm được bao nhiêu nếu hạ bậc". */
const DOWNGRADE: Record<string, string> = {
  'claude-fable-5-1': 'claude-opus-5-5', 'claude-fable-5': 'claude-opus-5-5',
  'claude-opus-5-5': 'claude-sonnet-5-5', 'claude-opus-5': 'claude-sonnet-5-5',
  'claude-opus-4-8': 'claude-sonnet-5-5', 'claude-opus-4-7': 'claude-sonnet-5-5',
  'claude-opus-4-6': 'claude-sonnet-5-5',
  'claude-sonnet-5-5': 'claude-haiku-4-5', 'claude-sonnet-5': 'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-haiku-4-5',
}

export const THRESHOLDS = {
  /** Viết cache 1h tốn 2x; cần ≥3 lượt đọc mới hoàn vốn so với TTL 5m */
  cache1hMinReads: 3,
  cacheHitMin: 0.5,
  cacheHitMinRequests: 10,
  subagentShareMax: 0.5,
  overkillMaxOutput: 500,
  overkillMinCount: 20,
  ceilingPct: 0.8,
} as const

const EXPENSIVE = /^claude-(opus|fable|mythos)/
const HIGH_EFFORT = new Set(['high', 'xhigh', 'max'])

function safeCost(e: UsageEvent): number { return hasPricing(e.model) ? costOfEvent(e) : 0 }
function bySession(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const m = new Map<string, UsageEvent[]>()
  for (const e of events) { const a = m.get(e.session_id) ?? []; a.push(e); m.set(e.session_id, a) }
  return m
}

/**
 * Mỗi phát hiện PHẢI có damage quy ra tiền hoặc credits — không có thì không trả (DD-10).
 * `hypothesis` BẮT BUỘC truyền vào: giả thuyết credits chỉ được quyết ở MỘT chỗ
 * (kết quả hiệu chuẩn). Hardcode 'all' ở đây từng làm damage phóng đại ~200 lần.
 */
export function detectFindings(
  events: UsageEvent[],
  /** null = KHÔNG đọc được trần gói ⇒ bỏ qua mọi đánh giá cần trần, không bịa 200.000. */
  ceiling: number | null,
  hypothesis: Hypothesis,
  /** Credits của cửa sổ đã dùng để khớp giả thuyết — để đánh dấu ngoại suy. */
  fittedOnCredits: number | null,
  /** Bảng hệ số credits — PHẢI truyền từ nguồn đã quyết ở tầng trên (ưu tiên live),
   *  không được tự lấy bảng fallback: model chỉ có trong bảng live sẽ bị tính 0 credits
   *  và phát hiện bị bịt IM LẶNG. */
  cpm: Record<string, number>,
): Finding[] {
  if (events.length === 0) return []
  const out: Finding[] = []
  const sessions = bySession(events)

  // ── WASTE_CACHE_1H ───────────────────────────────────────────────────────────
  {
    const bad: string[] = []
    let w1h = 0, usd = 0
    for (const [sid, evs] of sessions) {
      const w = evs.reduce((s, e) => s + e.cache_write_1h, 0)
      if (w === 0) continue
      const reads = evs.reduce((s, e) => s + e.cache_read, 0)
      if (reads / w >= THRESHOLDS.cache1hMinReads) continue
      bad.push(sid); w1h += w
      for (const e of evs) {
        const p = PRICING[e.model]
        if (!p || e.cache_write_1h === 0) continue
        usd += e.cache_write_1h * (CACHE_WRITE_1H_FACTOR - CACHE_WRITE_5M_FACTOR) * p.in / 1e6
      }
    }
    if (bad.length > 0 && usd > 0) {
      out.push({
        id: 'WASTE_CACHE_1H', severity: 'high', damage_kind: 'saving',
        metric: { sessions: bad.length, cache_write_1h_tokens: w1h },
        damage: { usd },
        action: 'Dùng TTL 5 phút, hoặc giữ cache ấm bằng keep-alive thay vì trả phí viết 2x cho TTL 1 giờ.',
        sample_sessions: bad.slice(0, 5),
      })
    }
  }

  // ── WASTE_CACHE_MISS ─────────────────────────────────────────────────────────
  {
    const bad: string[] = []
    let usd = 0
    for (const [sid, evs] of sessions) {
      if (evs.length < THRESHOLDS.cacheHitMinRequests) continue
      const read = evs.reduce((s, e) => s + e.cache_read, 0)
      const input = evs.reduce((s, e) => s + e.input_tokens, 0)
      if (input + read === 0) continue
      if (read / (input + read) >= THRESHOLDS.cacheHitMin) continue
      bad.push(sid)
      for (const e of evs) {
        const p = PRICING[e.model]
        if (!p) continue
        // Phần phí lẽ ra tiết kiệm được = 1 − hệ số đọc cache CỦA MODEL ĐÓ.
        // Hardcode 0.9 là bản sao của CACHE_READ_FACTOR_DEFAULT và sai cho opus-5-5 (0.05).
        const saved = 1 - (CACHE_READ_FACTOR[e.model] ?? CACHE_READ_FACTOR_DEFAULT)
        usd += e.input_tokens * saved * p.in / 1e6
      }
    }
    if (bad.length > 0 && usd > 0) {
      out.push({
        id: 'WASTE_CACHE_MISS', severity: 'medium', damage_kind: 'saving',
        metric: { sessions: bad.length },
        damage: { usd },
        action: 'Tìm thứ phá cache trong prompt: dấu thời gian, JSON không sort, danh sách tool thay đổi.',
        sample_sessions: bad.slice(0, 5),
      })
    }
  }

  // ── SUBAGENT_HEAVY ───────────────────────────────────────────────────────────
  {
    const bad: string[] = []
    let credits = 0
    for (const [sid, evs] of sessions) {
      const total = evs.reduce((s, e) => s + safeCost(e), 0)
      if (total <= 0) continue
      const side = evs.filter((e) => e.is_sidechain)
      const share = side.reduce((s, e) => s + safeCost(e), 0) / total
      if (share <= THRESHOLDS.subagentShareMax) continue
      bad.push(sid)
      // Thiệt hại = phần TIẾT KIỆM ĐƯỢC nếu hạ model subagent, KHÔNG phải toàn bộ chi phí
      // subagent. Không ai bỏ được hết subagent; gọi cả cụm là "thiệt hại" là thổi phồng.
      for (const e of side) {
        const down = DOWNGRADE[e.model]
        if (!down || cpm[down] === undefined || cpm[e.model] === undefined) continue
        const save = creditsOfEvent(e, cpm, hypothesis) - creditsOfEvent({ ...e, model: down }, cpm, hypothesis)
        if (save > 0) credits += save
      }
    }
    if (bad.length > 0 && credits > 0) {
      out.push({
        id: 'SUBAGENT_HEAVY', severity: 'medium', damage_kind: 'saving',
        metric: { sessions: bad.length, scope: 'lifetime' },
        damage: { credits },
        action: 'Hạ model cho subagent tìm kiếm/đọc file — đừng để chúng thừa hưởng model đắt của phiên chính.',
        sample_sessions: bad.slice(0, 5),
      })
    }
  }

  // ── OVERKILL_MODEL ───────────────────────────────────────────────────────────
  {
    const hits = events.filter((e) =>
      (EXPENSIVE.test(e.model) || (e.effort !== null && HIGH_EFFORT.has(e.effort))) &&
      e.output_tokens < THRESHOLDS.overkillMaxOutput && e.tool_calls === 0)
    if (hits.length > THRESHOLDS.overkillMinCount) {
      let credits = 0
      for (const e of hits) {
        const down = DOWNGRADE[e.model]
        if (!down || cpm[down] === undefined || cpm[e.model] === undefined) continue
        // CẢ HAI vế phải cùng một giả thuyết. Dùng 'all' ở vế hạ bậc làm model RẺ hơn
        // ra credits LỚN hơn ⇒ hiệu số âm ⇒ phát hiện không bao giờ chạy.
        credits += creditsOfEvent(e, cpm, hypothesis) - creditsOfEvent({ ...e, model: down }, cpm, hypothesis)
      }
      if (credits > 0) {
        out.push({
          id: 'OVERKILL_MODEL', severity: 'medium', damage_kind: 'saving',
          metric: { requests: hits.length },
          damage: { credits },
          action: 'Hạ một bậc model (hoặc hạ effort) cho lớp việc ngắn, không gọi tool.',
          sample_sessions: [...new Set(hits.map((e) => e.session_id))].slice(0, 5),
        })
      }
    }
  }

  // ── CEILING_RISK — chỉ đánh giá được khi BIẾT trần ───────────────────────────
  if (ceiling !== null && ceiling > 0) {
    const wins = slidingWindows5h(events, (e) => creditsOfEvent(e, cpm, hypothesis))
    const over = wins.filter((w) => w.credits > THRESHOLDS.ceilingPct * ceiling)
    if (over.length > 0) {
      const peak = maxOf(over.map((w) => w.credits))
      // Khớp trên MỘT cửa sổ; cửa sổ nặng hơn nhiều lần là NGOẠI SUY, phải nói ra.
      const extrapolated = typeof fittedOnCredits === 'number' && fittedOnCredits > 0
        && peak > fittedOnCredits * 3
      out.push({
        id: 'CEILING_RISK', severity: 'high', damage_kind: 'peak',
        metric: {
          windows_over_80pct: over.length, peak_credits: Math.round(peak), ceiling,
          ...(extrapolated ? { extrapolated: 'uoc-luong-ngoai-suy' } : {}),
        },
        damage: { credits: peak },
        action: 'Giãn việc nặng ra khỏi cửa sổ 5 giờ đang cao điểm, hoặc hạ model cho phần việc nhẹ.',
        sample_sessions: [],
      })
    }
  }

  // Xếp: mức nghiêm trọng trước, rồi trong cùng mức thì tiền lớn lên trên.
  // Chỉ xếp theo mức khiến "có thể tiết kiệm 447.664 credits" nằm dưới "$105,91" —
  // đúng nhưng vô lý với người đọc. Không quy đổi credits sang USD: hai đơn vị
  // khác nhau, so trong cùng đơn vị thôi, khác đơn vị thì giữ nguyên thứ tự.
  const sorted = out.sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (r !== 0) return r
    const ac = a.damage.credits, bc = b.damage.credits
    if (ac !== undefined && bc !== undefined) return bc - ac
    const au = a.damage.usd, bu = b.damage.usd
    if (au !== undefined && bu !== undefined) return bu - au
    return 0
  })
  // Thứ hạng hiện ra màn hình, để nhãn "ưu tiên" không phải do UI tự bịa.
  return sorted.map((f, i) => ({ ...f, rank: i + 1 }))
}
