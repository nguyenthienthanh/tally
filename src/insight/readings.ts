/**
 * Biến số liệu thô của `/insights` thành những ĐIỀU ĐỌC RA ĐƯỢC.
 *
 * Danh sách "Read 1333 · Bash 696" không nói gì cả: nó là số đếm, không phải nhận
 * xét. Cái đáng biết là tỉ lệ, nhịp, và chỗ nào đang cọ xát — kèm một câu nói rõ
 * con số đó nghĩa là gì.
 *
 * Luật ở đây: mỗi điều đọc ra phải suy được TỪ SỐ ĐO. Không có thì không nói.
 * Diễn giải nào chỉ đúng một nửa thì phải hạ giọng, đừng khẳng định.
 */

export interface Reading {
  /** Khoá i18n cho nhãn và câu giải thích: `read.<id>.label` / `read.<id>.mean`. */
  id: string
  /** Con số chính, đã định dạng ở phía UI. */
  value: number
  /** 'count' | 'pct' | 'ratio' | 'hour' | 'text' — UI dùng để chọn cách hiển thị. */
  kind: 'count' | 'pct' | 'ratio' | 'hour' | 'text'
  /** Giá trị chữ khi kind = 'text'. */
  text?: string
  /** Tham số chèn vào câu giải thích. */
  params?: Record<string, string | number>
  /** 'watch' khi con số đáng để mắt tới — UI gắn nhãn, KHÔNG tự bịa mức nghiêm trọng. */
  flag?: 'watch'
}

export interface DeterministicValue {
  sessions: number
  tool_errors: number
  interruptions: number
  destructive_commands: number
  would_prompt: number
  top_tools: Array<[string, number]>
  error_categories: Record<string, number>
  hour_histogram: number[]
  response_time_buckets: Record<string, number>
}

/** Tool chỉ ĐỌC, không đổi gì trên máy. */
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'WebFetch', 'WebSearch'])
/** Tool có GHI: sửa file hoặc chạy lệnh. */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'])

/** Giờ ngoài 08:00–18:00 tính là ngoài giờ. */
const OFFICE_START = 8
const OFFICE_END = 18

/** Thứ tự các mức thời gian trả lời, từ nhanh tới chậm. */
const RT_ORDER = ['<2s', '2-10s', '10-30s', '30s-1m', '1-2m', '2-5m', '5-15m', '15m+', '>15m']

const pct = (a: number, b: number): number => (b > 0 ? (a / b) * 100 : 0)

export function buildReadings(d: DeterministicValue): Reading[] {
  const out: Reading[] = []
  const tools = d.top_tools ?? []
  const totalTools = tools.reduce((s, [, n]) => s + n, 0)
  const sessions = Math.max(1, d.sessions ?? 0)

  // ── nhịp: giờ nào làm nhiều nhất ─────────────────────────────────────────────
  const hist = d.hour_histogram ?? []
  const histTotal = hist.reduce((s, n) => s + n, 0)
  if (histTotal > 0) {
    let peak = 0
    for (let i = 1; i < hist.length; i += 1) if ((hist[i] ?? 0) > (hist[peak] ?? 0)) peak = i
    out.push({
      id: 'peakHour', value: peak, kind: 'hour',
      params: { share: Math.round(pct(hist[peak] ?? 0, histTotal)) },
    })

    let off = 0
    for (let h = 0; h < hist.length; h += 1) {
      if (h < OFFICE_START || h >= OFFICE_END) off += hist[h] ?? 0
    }
    const offPct = pct(off, histTotal)
    out.push({
      id: 'afterHours', value: Math.round(offPct), kind: 'pct',
      params: { from: OFFICE_END, to: OFFICE_START },
      ...(offPct >= 40 ? { flag: 'watch' as const } : {}),
    })
  }

  // ── nhịp: bạn để Claude chờ bao lâu ──────────────────────────────────────────
  const rt = d.response_time_buckets ?? {}
  const rtTotal = Object.values(rt).reduce((s, n) => s + n, 0)
  if (rtTotal > 0) {
    // Mức chứa điểm giữa — trung vị theo nhóm, không phải trung bình của nhãn chữ.
    let seen = 0
    let median = RT_ORDER[0]!
    for (const k of RT_ORDER) {
      seen += rt[k] ?? 0
      if (seen >= rtTotal / 2) { median = k; break }
    }
    const slow = RT_ORDER.slice(RT_ORDER.indexOf('2-5m')).reduce((s, k) => s + (rt[k] ?? 0), 0)
    out.push({
      id: 'replyTime', value: Math.round(pct(slow, rtTotal)), kind: 'text', text: median,
      params: { slowPct: Math.round(pct(slow, rtTotal)) },
    })
  }

  // ── cách sai khiến: đọc nhiều hay làm nhiều ─────────────────────────────────
  if (totalTools > 0) {
    const reads = tools.filter(([n]) => READ_TOOLS.has(n)).reduce((s, [, n]) => s + n, 0)
    const writes = tools.filter(([n]) => WRITE_TOOLS.has(n)).reduce((s, [, n]) => s + n, 0)
    out.push({ id: 'readShare', value: Math.round(pct(reads, totalTools)), kind: 'pct' })
    if (writes > 0) {
      out.push({
        id: 'readWriteRatio', value: Math.round((reads / writes) * 10) / 10, kind: 'ratio',
        ...(reads / writes >= 8 ? { flag: 'watch' as const } : {}),
      })
    }
    out.push({
      id: 'toolsPerSession', value: Math.round((totalTools / sessions) * 10) / 10, kind: 'ratio',
      params: { sessions },
    })
    const mcp = tools.filter(([n]) => n.startsWith('mcp__')).reduce((s, [, n]) => s + n, 0)
    if (mcp > 0) out.push({ id: 'mcpShare', value: Math.round(pct(mcp, totalTools)), kind: 'pct' })
  }

  // ── ma sát ──────────────────────────────────────────────────────────────────
  if (totalTools > 0) {
    const errPct = pct(d.tool_errors ?? 0, totalTools)
    out.push({
      id: 'toolErrorRate', value: Math.round(errPct * 10) / 10, kind: 'pct',
      params: { errors: d.tool_errors ?? 0, total: totalTools },
      ...(errPct >= 5 ? { flag: 'watch' as const } : {}),
    })
  }
  const wp = d.would_prompt ?? 0
  if (wp > 0) {
    const perSession = wp / sessions
    out.push({
      id: 'permissionFriction', value: Math.round(perSession * 10) / 10, kind: 'ratio',
      params: { total: wp },
      ...(perSession >= 1 ? { flag: 'watch' as const } : {}),
    })
  }
  if ((d.destructive_commands ?? 0) > 0) {
    out.push({
      id: 'destructive', value: d.destructive_commands, kind: 'count',
      params: { perSession: Math.round((d.destructive_commands / sessions) * 100) / 100 },
    })
  }
  out.push({
    id: 'interruptRate', value: Math.round(pct(d.interruptions ?? 0, sessions) * 10) / 10,
    kind: 'pct', params: { total: d.interruptions ?? 0, sessions },
  })

  return out
}
