import type { UsageEvent } from '../types.js'

export type Hypothesis = 'all' | 'in_out' | 'out_only' | 'in_out_write' | 'in_out_write_read25'

/**
 * Trọng số cache_read trong giả thuyết `in_out_write_read25`.
 * Suy ra TỪ SỐ ĐO, không phải đoán: với cửa sổ 5h thật ngày 2026-10-29
 * (`five_hour_pct` = 9 ⇒ mục tiêu 18 000 credits), in+out+write cho 10 415 credits,
 * còn cache_read tính trọn cho 281 695. Trọng số cần để khớp = 0,0269; 0,025 (= 1/40)
 * cho lệch −3,0% và nằm TRONG dải lượng tử hoá của một `pct` nguyên.
 * Vẫn là GIẢ THUYẾT: Anthropic không công bố công thức.
 */
export const CACHE_READ_WEIGHT = 0.025

/**
 * Giả thuyết mặc định khi CHƯA hiệu chuẩn được (tín hiệu yếu / index cũ / không có dữ liệu).
 * KHÔNG dùng 'all': nó gộp trọn cache_read nên phóng đại credits hàng trăm lần và cho ra
 * những con số vô nghĩa kiểu "10.853% trần". Dùng ước lượng tốt nhất đã ĐO được,
 * và luôn kèm `status` để người đọc biết nó chưa được hiệu chuẩn trong phiên này.
 */
export const DEFAULT_HYPOTHESIS: Hypothesis = 'in_out_write_read25'

export interface CalibrationResult {
  hypothesis: Hypothesis
  /** Lệch so với TÂM dải. null khi không hiệu chuẩn được. */
  error_pct: number | null
  /** true khi kết quả nằm TRONG dải lượng tử hoá của một `pct` nguyên ⇒ coi như khớp. */
  within_quantization: boolean
  /** Tổng credits của cửa sổ dùng để khớp. Ước lượng cho cửa sổ NẶNG HƠN NHIỀU
   *  là ngoại suy — người đọc phải biết để không tin quá mức. */
  fitted_on_credits: number | null
  status: 'calibrated' | 'poor_fit' | 'low_signal' | 'no_data' | 'stale_index' | 'no_ceiling'
}

/** Index được coi là theo kịp nếu event mới nhất không cũ hơn mốc chụp quá ngần này. */
export const STALE_INDEX_TOLERANCE_MS = 5 * 60 * 1000

import { UNKNOWN } from './cost.js'
export { UNKNOWN }

/** Ngưỡng tín hiệu: dưới mức này thì KHÔNG chốt giả thuyết (LLD §3). */
export const MIN_SIGNAL_PCT = 5

/** Lệch quá ngần này thì KHÔNG được gọi là "đã hiệu chuẩn" nữa — con số chỉ để tham khảo. */
export const POOR_FIT_PCT = 15
export const HYPOTHESES: Hypothesis[] = [
  'all', 'in_out', 'out_only', 'in_out_write', 'in_out_write_read25',
]

function tokensFor(e: UsageEvent, h: Hypothesis): number {
  switch (h) {
    case 'all': return e.input_tokens + e.output_tokens + e.cache_read + e.cache_write_5m + e.cache_write_1h
    case 'in_out': return e.input_tokens + e.output_tokens
    case 'out_only': return e.output_tokens
    case 'in_out_write': return e.input_tokens + e.output_tokens + e.cache_write_5m + e.cache_write_1h
    case 'in_out_write_read25':
      return e.input_tokens + e.output_tokens + e.cache_write_5m + e.cache_write_1h
        + e.cache_read * CACHE_READ_WEIGHT
  }
}

export function creditsOfEvent(e: UsageEvent, cpm: Record<string, number>, h: Hypothesis): number {
  const rate = cpm[e.model]
  if (rate === undefined) return 0
  return tokensFor(e, h) / 1_000_000 * rate
}

export function creditsByModel(
  events: UsageEvent[], cpm: Record<string, number>, h: Hypothesis,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of events) {
    if (cpm[e.model] === undefined) { out[UNKNOWN] = (out[UNKNOWN] ?? 0); continue }
    out[e.model] = (out[e.model] ?? 0) + creditsOfEvent(e, cpm, h)
  }
  return out
}

/**
 * Chọn giả thuyết khớp số đo thật nhất. Thứ tự kiểm QUAN TRỌNG:
 * tín hiệu yếu được xét TRƯỚC khi xét thiếu dữ liệu — vì khi pct < 5 thì dù có event
 * ta cũng không được phép chốt (sai số tương đối quá nhạy).
 */
export function calibrate(
  events: UsageEvent[], cpm: Record<string, number>,
  observed: { five_hour_pct: number; five_hour_reset: number; captured_at: number },
  ceiling: number,
): CalibrationResult {
  // Không biết trần thì KHÔNG có gì để so. Bản trước vẫn trả 'calibrated' vì `best` được
  // khởi tạo sẵn nhãn đó, và CLI in ra "lệch undefined%".
  if (!(ceiling > 0)) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'no_ceiling',
    }
  }
  if (observed.five_hour_pct < MIN_SIGNAL_PCT) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'low_signal',
    }
  }
  const startMs = (observed.five_hour_reset - 5 * 3600) * 1000
  const endMs = observed.captured_at * 1000
  const inWindow = events.filter((e) => {
    const t = Date.parse(e.ts_utc)
    return t >= startMs && t <= endMs
  })
  if (inWindow.length === 0) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'no_data',
    }
  }

  // `five_hour_pct` phản ánh mức dùng TỚI LÚC CHỤP, còn event chỉ có tới lần quét gần nhất.
  // So một con số sống với một tập event cũ thì LUÔN thiếu một cách có hệ thống —
  // và sai số đó bị quy nhầm cho giả thuyết. Thà nói "index cũ" còn hơn chốt sai.
  // Math.max(...mảng) vỡ stack quanh 10^5 đối số — máy này đã có 61k sự kiện.
  let newest = -Infinity
  for (const e of events) {
    const t = Date.parse(e.ts_utc)
    if (Number.isFinite(t) && t > newest) newest = t
  }
  if (Number.isFinite(newest) && newest < endMs - STALE_INDEX_TOLERANCE_MS) {
    return {
      hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
      fitted_on_credits: null, status: 'stale_index',
    }
  }

  // `five_hour_pct` là SỐ NGUYÊN ⇒ giá trị thật nằm trong [pct-0.5, pct+0.5) phần trăm.
  // So với một điểm duy nhất sẽ phóng đại sai số, nhất là khi pct nhỏ.
  const target = observed.five_hour_pct / 100 * ceiling
  const lo = Math.max(0, (observed.five_hour_pct - 0.5) / 100 * ceiling)
  const hi = (observed.five_hour_pct + 0.5) / 100 * ceiling

  let best: CalibrationResult | null = null
  let bestAbs = Infinity
  for (const h of HYPOTHESES) {
    const got = inWindow.reduce((s, e) => s + creditsOfEvent(e, cpm, h), 0)
    const err = target === 0 ? Infinity : (got - target) / target * 100
    if (Math.abs(err) < bestAbs) {
      bestAbs = Math.abs(err)
      best = {
        hypothesis: h, error_pct: err,
        within_quantization: got >= lo && got < hi,
        fitted_on_credits: got,
        status: 'calibrated',
      }
    }
  }
  // Khớp được nhưng lệch nhiều thì nói thẳng là khớp kém. Hiện ±31% dưới nhãn
  // "đã hiệu chuẩn" là để người đọc tin một con số không đáng tin.
  if (best && best.error_pct !== null && Math.abs(best.error_pct) > POOR_FIT_PCT && !best.within_quantization) {
    return { ...best, status: 'poor_fit' }
  }
  // Không giả thuyết nào ghi được (mọi err = Infinity) ⇒ thừa nhận không hiệu chuẩn được.
  return best ?? {
    hypothesis: DEFAULT_HYPOTHESIS, error_pct: null, within_quantization: false,
    fitted_on_credits: null, status: 'no_data',
  }
}
