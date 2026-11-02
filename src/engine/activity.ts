import type { UsageEvent } from '../types.js'
import { localParts } from './buckets.js'
import { creditsOfEvent, type Hypothesis } from './credits.js'

/**
 * Nhật ký hoạt động dưới dạng MẢNH.
 *
 * Làm việc với Claude Code không diễn ra đều đặn — nó đến theo từng đợt, cách nhau
 * bằng những khoảng dài không làm gì. Vẽ nó thành cột theo ngày là nói dối về nhịp
 * thật: một ngày 400 request dồn trong 40 phút trông y hệt một ngày rải đều 12 tiếng.
 *
 * Ở đây mỗi ĐỢT là một mảnh riêng, đặt đúng chỗ nó xảy ra trong ngày, rộng đúng bằng
 * thời gian nó kéo dài. Khoảng trống giữa các mảnh là khoảng trống thật.
 */

/** Cách nhau quá ngần này thì tính là hai đợt khác nhau. */
export const IDLE_GAP_MIN = 15

export interface Fragment {
  /** Phút trong ngày địa phương, [0, 1440). */
  start_min: number
  /** Luôn > start_min. Một đợt chỉ có một request vẫn được bề rộng tối thiểu để nhìn thấy. */
  end_min: number
  requests: number
  credits: number
}

export interface DayLane {
  /** YYYY-MM-DD theo múi giờ đã chọn. */
  day: string
  weekday: number
  fragments: Fragment[]
  requests: number
  credits: number
}

/** Bề rộng tối thiểu của một mảnh, để một đợt ngắn không biến mất khỏi màn hình. */
const MIN_WIDTH_MIN = 4

const pad = (n: number): string => String(n).padStart(2, '0')

export function activityLanes(
  events: UsageEvent[],
  tz: string,
  cpm: Record<string, number>,
  hypothesis: Hypothesis,
  days = 30,
): DayLane[] {
  // Lọc TRƯỚC khi sắp: chép rồi sắp cả 61k sự kiện để cuối cùng giữ 30 ngày là trả
  // giá cho thứ mình vứt đi, và cái giá đó rơi đúng vào lần tải trang.
  //
  // Mốc tính từ sự kiện MỚI NHẤT, không phải từ bây giờ: "30 ngày gần nhất" phải
  // nghĩa là 30 ngày có dữ liệu, kẻo ai nghỉ một tuần mở lên thấy biểu đồ rỗng.
  let newest = -Infinity
  for (const e of events) {
    const t = Date.parse(e.ts_utc)
    if (Number.isFinite(t) && t > newest) newest = t
  }
  if (newest === -Infinity) return []
  const cutoff = newest - (days + 2) * 86_400_000
  const sorted = events
    .filter((e) => {
      const t = Date.parse(e.ts_utc)
      return Number.isFinite(t) && t >= cutoff
    })
    .sort((a, b) => Date.parse(a.ts_utc) - Date.parse(b.ts_utc))
  const lanes = new Map<string, DayLane>()

  let lastT = -Infinity
  let cur: Fragment | null = null
  let curDay = ''

  const close = (): void => {
    if (!cur || !curDay) return
    if (cur.end_min - cur.start_min < MIN_WIDTH_MIN) cur.end_min = cur.start_min + MIN_WIDTH_MIN
    if (cur.end_min > 1440) cur.end_min = 1440
    lanes.get(curDay)!.fragments.push(cur)
    cur = null
  }

  for (const e of sorted) {
    const t = Date.parse(e.ts_utc)
    if (!Number.isFinite(t)) continue
    const p = localParts(e.ts_utc, tz)
    const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`
    const minute = p.hour * 60 + p.minute

    if (!lanes.has(day)) {
      lanes.set(day, { day, weekday: p.weekday, fragments: [], requests: 0, credits: 0 })
    }
    const lane = lanes.get(day)!
    const c = creditsOfEvent(e, cpm, hypothesis)
    lane.requests += 1
    lane.credits += c

    // Đổi ngày cũng là cắt mảnh: mỗi làn chỉ vẽ phần thuộc về ngày của nó, nên một
    // đợt chạy qua nửa đêm thành hai mảnh — đúng với thứ người đọc nhìn thấy.
    const broke = day !== curDay || (t - lastT) / 60_000 > IDLE_GAP_MIN
    if (broke) {
      close()
      curDay = day
      cur = { start_min: minute, end_min: minute, requests: 0, credits: 0 }
    }
    cur!.end_min = Math.max(cur!.end_min, minute)
    cur!.requests += 1
    cur!.credits += c
    lastT = t
  }
  close()

  return [...lanes.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, days)
    .reverse()
}
