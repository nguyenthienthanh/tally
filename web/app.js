// tally UI — không phụ thuộc ngoài, không gọi mạng ra (chỉ fetch chính localhost này)
const LANGS = ['vi', 'zh', 'en']
const dicts = {}
let L = 'vi', T = {}

const t = (k) => T[k] ?? k
/** Chèn {tham_số} vào câu dịch. Thiếu tham số thì để nguyên dấu ngoặc — nhìn là biết sót. */
/** Bản dịch nếu có, không thì bản dự phòng — cho chuỗi do engine sinh ra. */
const tOr = (k, fallback) => (T[k] ?? fallback)
const tp = (k, params = {}) => t(k).replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m))
const $ = (s, r = document) => r.querySelector(s)
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v
    else if (k === 'html') n.innerHTML = v
    else if (k === 'text') n.textContent = v
    else n.setAttribute(k, v)
  }
  for (const c of [].concat(kids)) n.append(c)
  return n
}
// Đường dẫn dài làm bảng tràn ngang và không ai đọc. Giữ hai đoạn cuối có nghĩa,
// bản đầy đủ nằm ở title để vẫn tra được.
const shortPath = (p) => {
  if (!p || p.startsWith('dự-án-')) return p
  const parts = p.split('/').filter(Boolean)
  const tail = parts.slice(-2).join('/')
  return parts.length > 2 ? '…/' + tail : tail
}
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`
/**
 * "Không có" KHÁC "bằng không".
 *
 * Bản cũ trả 0 cho undefined, nên một lần gõ nhầm tên trường (`input_tokens` trong
 * khi API trả `input`) biến thành cả một bảng số 0 trông rất thật. Giờ nó hiện "—".
 */
const nf = (x, d = 0) => (x === undefined || x === null || Number.isNaN(x)
  ? '—'
  : new Intl.NumberFormat(L === 'zh' ? 'zh-CN' : L === 'en' ? 'en-US' : 'vi-VN',
      { maximumFractionDigits: d }).format(x))
const usd = (x) => '$' + nf(x, 2)

async function pickLang() {
  const saved = localStorage.getItem('tally.lang')
  const nav = (navigator.language || 'en').slice(0, 2)
  L = LANGS.includes(saved) ? saved : LANGS.includes(nav) ? nav : 'en'
  for (const l of LANGS) dicts[l] = (await import(`./src/i18n/${l}.js`)).default
  T = dicts[L]
  document.documentElement.lang = L
}

function applyStatic() {
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n)
  for (const b of document.querySelectorAll('.lang')) b.setAttribute('aria-pressed', String(b.dataset.lang === L))
}

const api = async (p) => {
  const r = await fetch(p)
  if (!r.ok) throw new Error(`${p} → ${r.status}`)
  return r.json()
}


// ── phạm vi xem ─────────────────────────────────────────────────────────────────
// 'all' | 'active' | <session_id>. Mọi trang đọc từ ĐÂY và gắn vào mọi lời gọi API,
// để hai trang không bao giờ nói hai con số khác nhau về cùng một thứ.
const getScope = () => localStorage.getItem('tally.scope') || 'all'
const setScope = (v) => { try { localStorage.setItem('tally.scope', v) } catch {} ; render() }
const sq = (extra = '') => {
  const sc = getScope()
  const q = sc === 'all' ? '' : `scope=${encodeURIComponent(sc)}`
  return [extra, q].filter(Boolean).join('&') ? '?' + [extra, q].filter(Boolean).join('&') : ''
}

// ── nhãn nguồn số liệu (DD-13b, DD-17) ──────────────────────────────────────────
const provTag = (agg) => {
  const det = agg.provenance === 'deterministic'
  const label = det ? t('in.measured') : t('in.inferred')
  const sample = det ? '' : ` · ${t('in.sample')} ${agg.sample_size}/${agg.population}`
  return el('span', { class: `tag ${det ? 'det tag--in' : 'llm tag--out'}`, text: label + sample })
}

/**
 * MỘT SỐ ĐO trong hàng — không còn là một cái ô.
 *
 * Console cấm "một trang toàn ô nhỏ bằng nhau", và đó đúng là bệnh của bản cũ:
 * mở trang nào ra cũng bốn thẻ y hệt, không cái nào quan trọng hơn cái nào.
 */
const stat = (key, value, sub) => el('div', { class: 'fact', 'data-testid': `stat-${key}` }, [
  el('span', { class: 'n', html: value }),
  el('span', { class: 'l', text: sub ? `${t(key)} · ${sub}` : t(key) }),
])

/**
 * SỐ ĐỌC DẪN TRANG — chữ ký của tool. Mỗi trang đúng một cái, đặt lớn.
 * Xanh lạnh khi là thứ MÁY đo; hổ phách khi là thứ thuộc về NGƯỜI.
 */
const readingLead = ({ key, value, caption, person = false, meter = null, side = null, facts = [], after = [] }) =>
  el('section', { class: 'reading-lead', ...(key ? { 'data-testid': `stat-${key}` } : {}) }, [
    el('div', { class: 'reading-top' }, [
      el('div', { class: 'reading-main' }, [
        el('div', { class: `reading-val${person ? ' is-person' : ''}`, text: value }),
        el('div', { class: 'reading-cap', text: caption }),
      ]),
      el('div', { class: 'spacer' }),
      ...(side ? [el('div', { class: 'reading-side' }, [
        el('div', { class: 'k', text: side.k }),
        el('div', { class: 'v', text: side.v }),
        ...(side.n ? [el('div', { class: 'n', text: side.n })] : []),
      ])] : []),
    ]),
    ...(meter !== null ? [el('div', { class: 'meter' },
      el('i', { class: meter > 100 ? 'over' : '', style: `width:${Math.min(100, Math.max(0, meter))}%` }))] : []),
    ...(facts.length ? [el('div', { class: 'facts' },
      facts.flatMap((f, i) => (i ? [el('div', { class: 'sep' }), f] : [f])))] : []),
    ...after,
  ])

const gauge = (pct) => {
  const cls = pct >= 80 ? 'bar bad' : pct >= 50 ? 'bar warn' : 'bar'
  return el('div', { class: cls }, [el('i', { style: `width:${Math.min(100, pct)}%` })])
}

// Số liệu nói bằng tiếng người, không phải key=value. Luật UX: không jargon trần.
const metricText = (f) => {
  const parts = []
  const m = f.metric
  if (m.sessions !== undefined) parts.push(`${nf(m.sessions)} ${t('find.sessions')}`)
  if (m.requests !== undefined) parts.push(`${nf(m.requests)} ${t('common.requests')}`)
  if (m.scope === 'lifetime') parts.push(t('find.scopeLifetime'))
  if (m.windows_over_80pct !== undefined) parts.push(`${nf(m.windows_over_80pct)} ${t('find.windowsOver')}`)
  if (m.peak_credits !== undefined && m.ceiling) parts.push(`${t('find.peakIs')} ${nf(m.peak_credits / m.ceiling * 100, 0)}% ${t('dash.ceiling')}`)
  if (m.extrapolated) parts.push(t('find.extrapolated'))
  return parts.join(' · ')
}

const findingCard = (f) => {
  const dmg = f.damage.usd !== undefined ? usd(f.damage.usd) : `${nf(f.damage.credits)} credits`
  const sub = metricText(f)
  return el('div', { class: `finding ${f.severity}`, 'data-testid': `finding-${f.id}` }, [
    // Số thứ tự do engine quyết; UI không tự bịa mức ưu tiên.
    el('span', { class: 'rank', text: String(f.rank ?? '') }),
    el('div', { class: 'body' }, [
      el('div', { class: 'ftitle' }, [
        el('b', { text: t(`find.${f.id}`) }),
        ...(f.severity === 'high' ? [el('span', { class: 'tag tag--on', text: t('sev.high') })] : []),
      ]),
      // Câu hành động phải đi qua i18n — engine giữ bản tiếng Việt cho CLI.
      el('p', { class: 'fnote', text: tOr(`find.act.${f.id}`, f.action) }),
      ...(sub ? [el('p', { class: 'fnote', text: sub })] : []),
    ]),
    el('div', { class: 'amount' }, [
      el('div', { class: 'v', text: dmg }),
      // Động từ theo damage_kind: gọi một con số ĐỈNH là "tiết kiệm được" khiến
      // người đọc tưởng họ đang mất ngần ấy tiền.
      el('div', { class: 'k', text: t(`find.verb.${f.damage_kind}`) }),
    ]),
  ])
}

// ── trang 1: Tổng quan ──────────────────────────────────────────────────────────
async function pageDashboard(root) {
  const [now, find] = await Promise.all([api('/api/now'), api('/api/findings' + sq())])
  const btnRefresh = el('button', { class: 'btn btn--primary', type: 'button', 'data-testid': 'dash-refresh', text: t('dash.refresh') })
  btnRefresh.onclick = () => render()
  const lim = now.limits
  const resetIn = lim ? Math.max(0, (lim.five_hour_reset * 1000 - Date.now()) / 60000) : null
  const pct = lim?.five_hour_pct ?? 0

  root.append(
    el('div', { class: 'page-head' }, [
      el('h1', { text: t('dash.title') }),
      el('p', { class: 'sub', text: t('dash.sub') }),
    ]),

    readingLead({
      key: 'dash.fiveHour',
      value: `${nf(pct)}%`,
      caption: tp('dash.fiveHourCap', { limit: t('dash.fiveHour') }),
      meter: pct,
      side: resetIn !== null
        ? { k: t('dash.resetLabel'), v: `${nf(resetIn)} ${t('common.minutes')}`, n: t('dash.resetNote') }
        : null,
      facts: [
        stat('dash.sevenDay', `${nf(lim?.seven_day_pct ?? 0)}%`, t('dash.sevenDayNote')),
        stat('dash.plan', (now.plan.tier ?? '?').replace(/^default_claude_/, ''), now.plan.mode),
        stat('dash.ceiling', now.plan.ceiling === null ? '—' : `${nf(now.plan.ceiling)}`,
          now.plan.ceiling === null ? t('dash.noCeiling') : 'credits'),
        ...(now.cycle ? [
          stat('dash.cycleCost', usd(now.cycle.cycle_cost), `${now.cycle.days_elapsed}/${now.cycle.days_total} ${t('common.days')}`),
          stat('dash.burn', usd(now.cycle.cycle_cost / Math.max(1, now.cycle.days_elapsed)) + '/d',
            `${t('dash.burnNote')} ${now.cycle.days_elapsed} ${t('common.days')}`),
        ] : []),
      ],
      after: [
        el('div', { class: 'row', style: 'margin-top:4px' }, [
          provTag({ provenance: 'deterministic' }),
          ...(now.stale ? [el('span', { class: 'tag tag--out', 'data-testid': 'stale', text: t('dash.stale') })] : []),
        ]),
      ],
    }),

    el('section', {}, [
      el('div', { class: 'h2row' }, [
        el('h2', { text: `${t('dash.topFindings')} (${find.findings.length})` }),
        el('span', { class: 'muted', style: 'font-size:14px', text: t('dash.sortedBy') }),
      ]),
      ...(find.findings.length
        ? [el('div', { class: 'trail', 'data-testid': 'findings-list' }, find.findings.map(findingCard))]
        : [el('div', { class: 'state', 'data-testid': 'findings-empty' }, [
            el('b', { text: t('state.noFindingsTitle') }),
            el('span', { text: t('state.noFindingsBody') }),
          ])]),
      el('div', { class: 'row' }, [btnRefresh]),
    ]),
  )
}

// ── trang 2: Phân tích ──────────────────────────────────────────────────────────
async function pageAnalytics(root) {
  const grain = localStorage.getItem('tally.grain') ?? 'day'
  const period = localStorage.getItem('tally.period') ?? '5h'
  const [bm, bk, pj, act] = await Promise.all([
    api('/api/by-model' + sq(`period=${period}`)), api(`/api/buckets?grain=${grain}`),
    api('/api/projects' + sq()), api('/api/activity' + sq('days=365')),
  ])

  const cal = bm.calibration
  const err = Math.abs(cal.error_pct ?? 0).toFixed(1)
  const calNote = cal.status === 'calibrated' ? `${t('an.calibration')}: ${cal.hypothesis} (±${err}%)`
    : cal.status === 'poor_fit' ? `${t('an.poorFit')} ${cal.hypothesis} ±${err}%`
    : cal.status === 'low_signal' ? t('an.lowSignal')
    : cal.status === 'stale_index' ? t('an.staleIndex')
    : cal.status === 'no_ceiling' ? t('an.noCeilingCal')
    : `${t('an.calibration')}: ${t('common.none')}`
  const winNote = `${t('an.windowNote')} ${nf(bm.window.events)} ${t('common.requests')}`

  const tbl = el('table', { 'data-testid': 'model-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: t('an.model') }),
      el('th', { text: t('an.creditsPeriod') }),
      el('th', { text: t('an.share') }),
      ...(bm.is_five_hour ? [el('th', { text: t('an.pctCeiling') })] : []),
      el('th', { text: t('an.creditsAll') }),
      el('th', { text: t('an.usdAll') }),
    ])),
    el('tbody', {}, bm.rows.filter((r) => r.credits_lifetime > 0 || r.usd > 0).map((r) => el('tr', {}, [
      el('td', { class: 'name', text: r.model }),
      el('td', { class: r.credits_known ? '' : 'dash', text: r.credits_known ? nf(r.credits_period) : '—' }),
      el('td', { class: r.share_pct === null ? 'dash' : '', text: r.share_pct === null ? '—' : nf(r.share_pct, 1) + '%' }),
      ...(bm.is_five_hour ? [el('td', { class: r.pct_of_ceiling === null ? 'dash' : '', text: r.pct_of_ceiling === null ? '—' : nf(r.pct_of_ceiling, 2) + '%' })] : []),
      el('td', { class: r.credits_known ? '' : 'dash', text: r.credits_known ? nf(r.credits_lifetime) : '—' }),
      el('td', { text: usd(r.usd) }),
    ]))),
  ])

  const sel = el('select', { 'data-testid': 'grain-select' },
    ['hour', 'day', 'month', 'year'].map((g) =>
      el('option', { value: g, text: t('an.' + g), ...(g === grain ? { selected: 'selected' } : {}) })))
  sel.onchange = () => { localStorage.setItem('tally.grain', sel.value); render() }

  // Khoảng xem của bảng model. Khoá cứng 5 giờ là lý do bảng từng toàn số 0: trong
  // 5 giờ vừa rồi có thể chỉ một model chạy, dù cả tuần dùng nhiều model.
  const PERIODS = ['5h', '24h', '7d', '30d', 'all']
  const periodPicker = el('div', { class: 'seg', 'data-testid': 'period-picker', role: 'group' },
    PERIODS.map((p) => {
      const b = el('button', {
        class: 'segbtn', type: 'button', 'data-period': p,
        'aria-pressed': String(p === period), text: t(`an.period.${p}`),
      })
      b.onclick = () => { localStorage.setItem('tally.period', p); render() }
      return b
    }))

  // ── SIGNATURE: biểu đồ hoạt động ────────────────────────────────────────────
  // Lưới tuần × thứ như GitHub: nhìn một phát thấy cả năm, chỗ nào dày chỗ nào nghỉ.
  // Bấm vào một ngày thì mở NHỊP TRONG NGÀY đó — mỗi mảnh là một đợt làm việc thật,
  // đặt đúng giờ, rộng đúng thời lượng. Lưới cho bức tranh, mảnh cho câu chuyện.
  const DOW = { vi: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], zh: ['日', '一', '二', '三', '四', '五', '六'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }[L]
  const MON = { vi: 'Th', zh: '月', en: '' }[L]

  const byDay = new Map(act.lanes.map((l) => [l.day, l]))
  const dayMax = Math.max(1, ...act.lanes.map((l) => l.credits))
  // Thang log: một ngày đỉnh gấp trăm lần ngày thường sẽ làm thang tuyến tính
  // dìm mọi ngày khác xuống bậc 1 — đúng lỗi đã gặp ở thang mảnh.
  const dayStep = (c) => (c <= 0 ? 0 : Math.max(1, Math.min(5, Math.ceil(Math.log1p(c) / Math.log1p(dayMax) * 5))))

  const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const last = act.lanes.length ? new Date(act.lanes[act.lanes.length - 1].day + 'T00:00:00') : new Date()
  const end = new Date(last); end.setDate(end.getDate() + (6 - end.getDay()))
  const weeks = Math.ceil(act.days_span / 7) + 1
  const first = new Date(end); first.setDate(first.getDate() - (weeks * 7 - 1))

  const grid = el('div', { class: 'ghgrid', 'data-testid': 'activity' })
  const months = el('div', { class: 'ghmonths' })
  const cols = el('div', { class: 'ghcols' })
  let lastMonth = -1
  for (let w = 0; w < weeks; w += 1) {
    const col = el('div', { class: 'ghcol' })
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(first); date.setDate(first.getDate() + w * 7 + d)
      if (date > end || date > new Date()) { col.append(el('div', { class: 'ghcell ghcell--void' })); continue }
      const key = toKey(date)
      const lane = byDay.get(key)
      const credits = lane?.credits ?? 0
      const cell = el('button', {
        class: 'ghcell', 'data-i': String(dayStep(credits)), 'data-day': key,
        type: 'button',
        title: lane
          ? `${key} · ${nf(lane.requests)} ${t('common.requests')} · ${nf(credits)} credits · ${lane.fragments.length} ${t('an.bursts')}`
          : `${key} · ${t('an.noWork')}`,
      })
      if (!lane) cell.setAttribute('aria-disabled', 'true')
      col.append(cell)
    }
    const m = new Date(first); m.setDate(first.getDate() + w * 7)
    months.append(el('span', { class: 'ghmonth', text: m.getMonth() !== lastMonth ? MON + (m.getMonth() + 1) : '' }))
    lastMonth = m.getMonth()
    cols.append(col)
  }
  const dows = el('div', { class: 'ghdows' }, [1, 3, 5].map((i) =>
    el('span', { class: 'ghdow', style: `grid-row:${i + 1}`, text: DOW[i] })))
  grid.append(el('div', { class: 'ghspacer' }), months, dows, cols)

  const legend = el('div', { class: 'legend' }, [
    el('span', { text: t('an.fragLight') }),
    ...[0, 1, 2, 3, 4, 5].map((i) => el('span', { class: 'sw ghcell', 'data-i': String(i) })),
    el('span', { text: t('an.fragHeavy') }),
  ])

  // Chi tiết một ngày: hiện khi bấm, mặc định đóng — không ai cần nó ngay.
  const detail = el('div', { class: 'daydetail', 'data-testid': 'day-detail' })
  const showDay = (key) => {
    const lane = byDay.get(key)
    detail.replaceChildren()
    if (!lane) return
    const fMax = Math.max(1, ...lane.fragments.map((f) => f.credits / Math.max(1, f.end_min - f.start_min)))
    detail.append(
      el('div', { class: 'daydetail-head' }, [
        el('b', { text: `${key} · ${DOW[lane.weekday]}` }),
        el('span', { class: 'muted', text: `${nf(lane.requests)} ${t('common.requests')} · ${nf(lane.credits)} credits · ${lane.fragments.length} ${t('an.bursts')}` }),
      ]),
      el('div', { class: 'track' }, lane.fragments.map((f) => {
        const r = f.credits / Math.max(1, f.end_min - f.start_min)
        const i = Math.max(1, Math.min(5, Math.ceil(Math.log1p(r) / Math.log1p(fMax) * 5)))
        return el('div', {
          class: 'frag', 'data-i': String(i),
          style: `left:${f.start_min / 1440 * 100}%;width:${Math.max(0.5, (f.end_min - f.start_min) / 1440 * 100)}%`,
          title: `${hhmm(f.start_min)}–${hhmm(f.end_min)} · ${nf(f.requests)} ${t('common.requests')} · ${nf(f.credits)} credits`,
        })
      })),
      el('div', { class: 'scale' }, [0, 6, 12, 18, 24].map((h) =>
        el('span', { text: String(h), style: `left:${h / 24 * 100}%` }))),
      el('p', { class: 'muted', style: 'font-size:13px;margin-top:10px', text: t('an.activityNote') }),
    )
  }
  grid.addEventListener('click', (e) => {
    const c = e.target.closest?.('.ghcell[data-day]')
    if (!c || c.getAttribute('aria-disabled')) return
    for (const o of grid.querySelectorAll('.ghcell[aria-pressed="true"]')) o.removeAttribute('aria-pressed')
    c.setAttribute('aria-pressed', 'true')
    showDay(c.dataset.day)
  })
  if (act.lanes.length) showDay(act.lanes[act.lanes.length - 1].day)

  const hmax = Math.max(1, ...bk.heatmap.flat())
  const heat = el('div', { class: 'heat', 'data-testid': 'heatmap' })
  bk.heatmap.forEach((row, d) => {
    heat.append(el('div', { class: 'hd lbl', text: DOW[d] }))
    row.forEach((v, h) => heat.append(el('div', {
      class: 'cell', title: `${DOW[d]} ${h}h: ${nf(v)}`,
      style: v ? `background:color-mix(in oklab,var(--color-cool) ${Math.round(v / hmax * 100)}%,var(--color-paper-3))` : '',
    })))
  })

  root.append(
    el('div', { class: 'page-head' }, [
      el('h1', { text: t('an.title') }),
      el('p', { class: 'sub', text: t('an.sub') }),
    ]),
    el('div', { class: 'facts' }, [
      (() => {
        const c = stat('an.peak5h', `${nf(bk.peak_5h)}<small> credits</small>`,
          bk.ceiling ? `${nf(bk.peak_5h / bk.ceiling * 100, 1)}% ${t('dash.ceiling')}` : undefined)
        // Đỉnh nặng hơn nhiều lần cửa sổ đã hiệu chuẩn ⇒ là NGOẠI SUY, phải nói ra.
        // Ngoại suy khi đỉnh nặng hơn nhiều lần cửa sổ đã khớp; nhưng KHI CHƯA
        // khớp được lần nào thì con số càng không chắc — vẫn phải nói ra.
        const unsure = bk.peak_extrapolated || cal.status !== 'calibrated'
        if (unsure) {
          c.append(el('div', { class: 'tag llm tag--out', 'data-testid': 'peak-extrapolated',
            text: '≈ ' + t(bk.peak_extrapolated ? 'an.extrapolated' : 'an.uncalibrated') }))
        }
        return c
      })(),
      stat('common.requests', nf(bm.events)),
    ]),
    el('div', { class: 'h2row' }, [
      el('h2', { text: t('an.byModel') }),
      periodPicker,
    ]),
    // Nói thẳng mỗi cột nghĩa là gì, ngay chỗ người đọc gặp nó. Cột "trọn đời"
    // từng bị hiểu nhầm vì cái tên không tự giải thích.
    el('p', { class: 'muted colnote', text: t('an.colNote') }),
    el('p', { class: 'colnote' }, [
      ...(cal.status === 'calibrated' ? [] : [el('span', { class: 'tag tag--out', 'data-testid': 'cal-warn', text: '⚠' })]),
      el('span', { class: 'muted', text: ' ' + calNote + ' · ' + winNote }),
    ]),
    el('div', { class: 'tablewrap' }, tbl),
    el('h2', { text: t('an.activity') }),
    el('p', { class: 'muted', style: 'font-size:14px;margin-bottom:12px', text: t('an.gridNote') }),
    grid, legend, detail,
    el('div', { class: 'h2row' }, [
      el('h2', { text: t('an.overTime') }),
      el('span', { class: 'muted', text: t('an.grain') }), sel,
    ]),
    el('div', { class: 'tablewrap' }, el('table', { 'data-testid': 'time-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: t('an.when') }), el('th', { text: t('common.requests') }),
        el('th', { text: t('an.inTok') }), el('th', { text: t('an.outTok') }),
      ])),
      el('tbody', {}, bk.rows.slice(-14).reverse().map((r) => el('tr', {}, [
        el('td', { class: 'name', text: r.key }), el('td', { text: nf(r.events) }),
        el('td', { class: 'num', text: nf(r.input) }), el('td', { class: 'num', text: nf(r.output) }),
      ]))),
    ])),
    el('h2', {}, [
      document.createTextNode(t('an.byProject') + ' '),
      ...(pj.redacted ? [el('span', { class: 'tag', 'data-testid': 'redacted-tag', text: t('an.redacted') })] : []),
    ]),
    el('table', { 'data-testid': 'project-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: t('an.project') }), el('th', { text: t('common.requests') }),
        el('th', { text: t('an.usd') }), el('th', { text: t('an.subagentShare') }),
      ])),
      el('tbody', {}, pj.rows.slice(0, 10).map((r) => el('tr', {}, [
        el('td', { class: 'name', title: r.project, text: shortPath(r.project) }), el('td', { text: nf(r.events) }),
        el('td', { text: usd(r.usd) }),
        el('td', { text: r.usd > 0 ? nf(r.sidechain_usd / r.usd * 100, 0) + '%' : '—' }),
      ]))),
    ]),
    el('h2', { text: t('an.heatmap') }),
    el('div', { class: 'panel' }, heat),
  )
}

// ── trang 3: Thói quen dùng ─────────────────────────────────────────────────────
// KHÔNG phải bảng kê tên tool. Mỗi mục là một con số có nghĩa, kèm MỘT CÂU nói nó
// nghĩa là gì. Danh sách tên thô đẩy xuống cuối, gập lại — ai cần mới mở.
async function pageInsight(root) {
  const [d, bh, ex] = await Promise.all([api('/api/insight'), api('/api/behaviour'), api(`/api/explain?lang=${L}`)])

  if (!d.deterministic) {
    root.append(
      el('div', { class: 'page-head' }, [el('h1', { text: t('in.title') })]),
      el('div', { class: 'state', 'data-testid': 'insight-empty' }, [
        el('b', { text: t('in.emptyTitle') }), el('span', { text: t('in.empty') })]),
    )
    return
  }

  const det = d.deterministic
  const v = det.value
  const byId = Object.fromEntries((d.readings ?? []).map((r) => [r.id, r]))

  const fmtVal = (r) => {
    if (r.kind === 'hour') return `${String(r.value).padStart(2, '0')}:00`
    if (r.kind === 'pct') return nf(r.value, r.value < 10 ? 1 : 0) + '%'
    if (r.kind === 'ratio') return nf(r.value, 1) + '×'
    if (r.kind === 'text') return r.text
    return nf(r.value)
  }

  // Một điều đọc ra: con số to, nhãn, và một câu giải thích. Không có câu thì không hiện.
  const reading = (id) => {
    const r = byId[id]
    if (!r) return null
    const params = { ...(r.params ?? {}), value: fmtVal(r) }
    return el('div', { class: 'reading', 'data-testid': `reading-${id}` }, [
      el('div', { class: 'rhead' }, [
        el('span', { class: 'rval', text: fmtVal(r) }),
        ...(r.flag === 'watch' ? [el('span', { class: 'tag tag--out', text: t('read.watch') })] : []),
      ]),
      el('div', { class: 'rlabel', text: t(`read.${id}.label`) }),
      el('p', { class: 'rmean', text: tp(`read.${id}.mean`, params) }),
    ])
  }

  let firstSection = true
  const section = (title, ids, tag) => {
    const kids = ids.map(reading).filter(Boolean)
    if (kids.length === 0) return []
    // Khối đầu giữ tên hook cũ `insight-stats` để hợp đồng với test không gãy
    // khi trang được viết lại.
    const attrs = { class: 'readings', ...(firstSection ? { 'data-testid': 'insight-stats' } : {}) }
    firstSection = false
    return [
      el('div', { class: 'h2row' }, [el('h2', { text: title }), ...(tag ? [tag] : [])]),
      el('div', attrs, kids),
    ]
  }

  // Danh sách thô: có ích khi cần tra, nhưng không phải thứ mở trang ra là thấy.
  const rawList = (title, pairs, note) => {
    const d2 = el('details', { class: 'raw' }, [
      el('summary', { text: `${title} (${pairs.length})` }),
      ...(note ? [el('p', { class: 'muted colnote', text: note })] : []),
      el('div', { class: 'tablewrap' }, el('table', {}, el('tbody', {},
        pairs.map(([k, n]) => el('tr', {}, [
          el('td', { class: 'name', text: k }), el('td', { text: nf(n) }),
        ]))))),
    ])
    return d2
  }

  const tools = v.top_tools ?? []
  const totalTools = tools.reduce((s, [, n]) => s + n, 0)
  const fr = d.friction

  root.append(
    el('div', { class: 'page-head' }, [
      el('h1', { text: t('in.title') }),
      el('p', { class: 'sub', text: t('in.sub2') }),
    ]),

    ...section(t('in.rhythm'), ['peakHour', 'afterHours', 'replyTime'], provTag(det)),
    ...section(t('in.howYouDrive'), ['readShare', 'readWriteRatio', 'toolsPerSession', 'mcpShare'], provTag(det)),
    ...section(t('in.frictionSec'), ['toolErrorRate', 'permissionFriction', 'destructive', 'interruptRate'], provTag(det)),

    // ── Ai thật sự đang gõ ────────────────────────────────────────────────────
    // Khối này phải đứng TRƯỚC mọi con số tool khác: nếu hơn nửa lượt gọi là của
    // subagent thì các tỉ lệ bên dưới không nói về thói quen của người đọc nữa.
    ...(bh && bh.total > 0 ? [
      el('div', { class: 'h2row' }, [
        el('h2', { text: t('bh.whoDrives') }),
        provTag({ provenance: 'deterministic' }),
      ]),
      readingLead({
        value: `${nf(bh.not_hand_driven_pct, 0)}%`,
        caption: t('bh.notHandCap'),
        person: true,
        meter: bh.not_hand_driven_pct,
        facts: [
          ...(bh.lanes ?? []).map((l) => stat(`bh.l.${l.lane}`, nf(l.calls), `${nf(l.pct, 0)}%`)),
          stat('bh.totalCalls', nf(bh.total), `${nf(bh.sessions)} ${t('sum.sessions').toLowerCase()}`),
        ],
        after: [el('p', { class: 'muted colnote', text: tp('bh.notHandMean', { pct: nf(bh.not_hand_driven_pct, 0) }) })],
      }),
      // Một bảng cho ba làn, đo bằng cùng một thước: không so được thì không
      // biết con số nào là thói quen của người và con số nào là việc của máy.
      el('div', { class: 'tablewrap' }, el('table', { 'data-testid': 'lane-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: t('bh.lane') }), el('th', { text: t('bh.share') }),
          el('th', { class: 'num', text: t('bh.laneProbe') }),
          el('th', { class: 'num', text: t('bh.laneImg') }),
          el('th', { class: 'num', text: t('bh.laneRpw') }),
          el('th', { text: t('bh.laneWhere') }),
        ])),
        el('tbody', {}, (bh.lanes ?? []).map((l) => el('tr', { 'data-testid': `lane-${l.lane}` }, [
          el('td', { class: 'name' }, [
            el('div', { text: t(`bh.l.${l.lane}`) }),
            el('div', { class: 'muted', style: 'font-size:13px', text: t(`bh.lm.${l.lane}`) }),
          ]),
          el('td', {}, el('div', { class: 'inbar' }, [
            el('div', { class: 'track' }, el('i', { style: `width:${Math.min(100, l.pct)}%` })),
            el('span', { class: 'pct', text: nf(l.pct, 1) + '%' }),
          ])),
          el('td', { class: 'num weak', text: l.exec > 0 ? nf(l.probe_pct, 0) + '%' : '—' }),
          el('td', { class: 'num weak', text: l.reads > 0 ? nf(l.image_pct, 0) + '%' : '—' }),
          el('td', { class: 'num weak', text: l.read_per_write === null ? '—' : nf(l.read_per_write, 1) }),
          el('td', { class: 'muted', style: 'font-size:13px',
            text: (l.top_projects ?? []).slice(0, 2).map((p) => p.key).join(', ') || '—' }),
        ]))),
      ])),
      el('p', { class: 'muted colnote', text: t('bh.laneNote') }),
    ] : []),

    // ── Lệnh shell: làm gì với chúng ──────────────────────────────────────────
    ...(bh && bh.by_verb_group.length ? [
      el('div', { class: 'h2row' }, [
        el('h2', { text: t('bh.shellWork') }),
        provTag({ provenance: 'deterministic' }),
      ]),
      el('p', { class: 'muted colnote', text: tp('bh.probeMean', { pct: nf(bh.probe_pct, 0) }) }),
      el('p', { class: 'muted colnote', text: t('bh.mixNote') }),
      el('div', { class: 'tablewrap' }, el('table', { 'data-testid': 'verb-group-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: t('bh.group') }), el('th', { text: t('bh.share') }),
          el('th', { class: 'num', text: t('bh.calls') }), el('th', { text: t('bh.groupMeans') }),
        ])),
        el('tbody', {}, bh.by_verb_group.map((g) => el('tr', {}, [
          el('td', { class: 'name', text: t(`bh.g.${g.key}`) }),
          el('td', {}, el('div', { class: 'inbar' }, [
            el('div', { class: 'track' }, el('i', { style: `width:${Math.min(100, g.pct)}%` })),
            el('span', { class: 'pct', text: nf(g.pct, 1) + '%' }),
          ])),
          el('td', { class: 'num weak', text: nf(g.n) }),
          el('td', { class: 'muted', style: 'font-size:14px', text: t(`bh.gm.${g.key}`) }),
        ]))),
      ])),
      el('details', { class: 'raw' }, [
        el('summary', { text: `${t('bh.topVerbs')} (${bh.top_verbs.length})` }),
        el('div', { class: 'tablewrap' }, el('table', {}, el('tbody', {},
          bh.top_verbs.map((v) => el('tr', {}, [
            el('td', { class: 'name' }, el('code', { text: v.key })),
            el('td', { class: 'muted', style: 'font-size:14px', text: t(`bh.g.${v.group}`) }),
            el('td', { class: 'num', text: nf(v.n) }),
            el('td', { class: 'num weak', text: nf(v.pct, 1) + '%' }),
          ]))))),
      ]),
    ] : []),

    // ── Dựa vào cái gì bên ngoài ──────────────────────────────────────────────
    ...(bh && bh.mcp.length ? [
      el('div', { class: 'h2row' }, [
        el('h2', { text: t('bh.outside') }),
        provTag({ provenance: 'deterministic' }),
      ]),
      el('div', { class: 'tablewrap' }, el('table', { 'data-testid': 'mcp-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: t('bh.server') }), el('th', { text: t('bh.fromWhere') }),
          el('th', { class: 'num', text: t('bh.calls') }), el('th', { class: 'num', text: t('bh.share') }),
        ])),
        el('tbody', {}, bh.mcp.map((m) => el('tr', {}, [
          el('td', { class: 'name' }, el('code', { text: m.key })),
          el('td', {}, el('span', { class: `tag ${m.from_plugin ? 'tag--on' : 'tag--out'}`,
            text: t(m.from_plugin ? 'bh.viaPlugin' : 'bh.viaSetup') })),
          el('td', { class: 'num', text: nf(m.n) }),
          el('td', { class: 'num weak', text: nf(m.pct, 1) + '%' }),
        ]))),
      ])),
    ] : []),

    ...(fr?.value && Object.keys(fr.value).length ? [
      el('div', { class: 'h2row' }, [el('h2', { text: t('in.friction') }), provTag(fr)]),
      el('p', { class: 'muted colnote', text: t('in.frictionNote') }),
      ...(() => {
        // Số trần không so được với nhau. 10 trên mẫu 10 phiên là CHUYỆN THƯỜNG
        // XUYÊN; 10 trên mẫu 400 phiên là chuyện hiếm. Phải hiện cả phần trăm.
        const entries = Object.entries(fr.value).sort((a, b) => b[1] - a[1]).slice(0, 6)
        // Mẫu số là TỔNG SỐ LẦN vướng, không phải số phiên: một phiên có thể vướng
        // nhiều lần, nên chia cho cỡ mẫu sẽ ra "100% 10/10" — đọc như "mọi phiên
        // đều bị", trong khi sự thật chỉ là "đây là loại vướng hay gặp nhất".
        const base = Object.values(fr.value).reduce((a, b) => a + b, 0) || 1
        return [el('div', { class: 'readings readings--narrow' }, entries.map(([k, n]) =>
          el('div', { class: 'reading', 'data-testid': `friction-${k}` }, [
            el('div', { class: 'rhead' }, [
              el('span', { class: 'rval', text: nf(n / base * 100, 0) + '%' }),
              el('span', { class: 'tag tag--out', text: `${nf(n)}/${nf(base)}` }),
            ]),
            el('div', { class: 'rlabel', text: tOr(`fr.${k}`, k) }),
            el('p', { class: 'rmean', text: tOr(`frm.${k}`, '') }),
          ])))]
      })(),
    ] : []),

    el('h2', { text: t('in.rawTitle') }),
    el('p', { class: 'muted colnote', text: t('in.rawNote') }),
    rawList(t('in.topTools'), tools, `${t('in.toolTotal')} ${nf(totalTools)}`),
    rawList(t('in.errorTypes'), Object.entries(v.error_categories ?? {})),
  )

  // ── Claude nói gì về các con số trên ────────────────────────────────────────
  const saved = ex?.saved
  root.append(
    el('div', { class: 'h2row' }, [
      el('h2', { text: t('ex.title') }),
      ...(saved ? [el('span', { class: 'tag llm tag--out',
        text: `${t('ex.ranAt')} ${new Date(saved.at).toLocaleDateString()} · ${saved.depth === 'full' ? t('ex.full') : t('ex.brief')}` })] : []),
    ]),
    ...(saved
      ? [
          ...(saved.headline ? [el('p', { class: 'lead', 'data-testid': 'ex-headline', text: saved.headline })] : []),
          el('div', { class: 'trail', 'data-testid': 'ex-points' }, saved.points.map((pt, i) =>
            el('div', { class: 'finding medium' }, [
              el('span', { class: 'rank', text: String(i + 1) }),
              el('div', { class: 'body' }, [
                el('div', { class: 'ftitle' }, [el('b', { text: pt.title })]),
                ...(pt.why ? [el('p', { class: 'fnote', text: `${t('ex.why')}: ${pt.why}` })] : []),
                ...(pt.action ? [el('p', { class: 'fnote', text: `${t('ex.action')}: ${pt.action}` })] : []),
              ]),
            ]))),
        ]
      : [el('div', { class: 'state', 'data-testid': 'ex-empty' }, [
          el('b', { text: t('ex.none') }), el('span', { text: t('ex.noneBody') })])]),
  )

  const btnAnalyze = el('button', { class: 'btn btn--primary', type: 'button', 'data-testid': 'insight-analyze', text: t('ex.run') })
  const pct = d.refresh?.pct_of_ceiling ?? null
  const row = el('div', { class: 'row' }, [
    btnAnalyze,
    ...(d.report ? [el('a', {
      class: 'btn', href: '/api/insight/report', target: '_blank', rel: 'noopener',
      'data-testid': 'open-report', text: t('in.openReport'),
    })] : []),
  ])
  btnAnalyze.onclick = () => {
    const dlg = $('#consent')
    let lang = L
    let depth = localStorage.getItem('tally.exDepth') || 'brief'

    const paint = () => {
      for (const b of dlg.querySelectorAll('[data-exlang]')) b.setAttribute('aria-pressed', String(b.dataset.exlang === lang))
      for (const b of dlg.querySelectorAll('[data-exdepth]')) b.setAttribute('aria-pressed', String(b.dataset.exdepth === depth))
      const est = ex.estimate[depth]
      // Chi phí phải nói rõ phần nào ĐO ĐƯỢC. Hiện một con số đẹp mà không đo là
      // hứa suông bằng hạn mức của người khác.
      $('#consent-cost').textContent = est.measured
        ? tp('ex.costMeasured', {
            total: nf(est.total), sec: est.seconds, oh: nf(est.overhead),
            n: nf(ex.overhead.samples),
            pct: ex.ceiling ? nf(est.total / ex.ceiling * 100, 3) : '?',
          })
        : tp('ex.costUnmeasured', { payload: nf(est.from_payload) })
    }
    dlg.onclick = (e) => {
      const b = e.target.closest('[data-exlang],[data-exdepth]')
      if (!b) return
      if (b.dataset.exlang) lang = b.dataset.exlang
      else { depth = b.dataset.exdepth; try { localStorage.setItem('tally.exDepth', depth) } catch {} }
      paint()
    }
    $('#consent-body').textContent = t('ex.body')
    $('#consent-status').textContent = ''
    paint()
    dlg.returnValue = ''
    dlg.showModal()
    $('#consent-yes').onclick = async () => {
      $('#consent-status').textContent = t('ex.running')
      $('#consent-yes').disabled = true
      try {
        const r = await fetch(`/api/explain/run?lang=${lang}&depth=${depth}`, {
          method: 'POST', headers: { 'x-tally-token': TOKEN },
        })
        if (!r.ok) throw new Error(String(r.status))
        dlg.close()
        render()
      } catch (err) {
        $('#consent-status').textContent = `${t('ex.failed')}: ${String(err).slice(0, 120)}`
      } finally {
        $('#consent-yes').disabled = false
      }
    }
  }
  root.append(row)
}

// ── trang: Phiên ────────────────────────────────────────────────────────────────
// Cửa sổ 5 giờ chỉ trả lời "sắp đụng trần chưa". Phiên trả lời "cái gì đang đốt",
// "phiên kia tốn bao nhiêu rồi", "hôm qua tôi làm gì". Đây mới là đơn vị người dùng nghĩ theo.
async function pageSessions(root) {
  const filter = localStorage.getItem('tally.sessFilter') ?? 'all'
  const ss = await api(`/api/sessions?scope=${filter}&limit=300`)
  const scope = getScope()

  const stale = ss.newest_utc ? (Date.now() - Date.parse(ss.newest_utc)) / 60000 : null

  const fbtn = (v, label, count) => {
    const b = el('button', {
      class: 'segbtn', type: 'button', 'data-filter': v, 'aria-pressed': String(v === filter),
      text: count === undefined ? label : `${label} (${nf(count)})`,
    })
    b.onclick = () => { localStorage.setItem('tally.sessFilter', v); render() }
    return b
  }

  const fmtWhen = (iso) => {
    const d = new Date(iso)
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const dur = (m) => (m < 60 ? `${nf(m)}p` : m < 1440 ? `${nf(m / 60, 1)}h` : `${nf(m / 1440, 1)}${t('sess.dayUnit')}`)

  const rows = ss.rows.map((r) => {
    const tr = el('tr', { 'data-session': r.session_id, class: scope === r.session_id ? 'is-scoped' : '' }, [
      el('td', { class: 'name' }, [
        el('code', { text: r.session_id.slice(0, 8) }),
        ...(r.active ? [el('span', { class: 'tag tag--in', text: t('sess.running') })] : []),
      ]),
      el('td', { class: 'name', title: r.project_key, text: shortPath(r.project_key) }),
      el('td', { text: fmtWhen(r.last_utc) }),
      el('td', { text: dur(r.duration_min) }),
      el('td', { text: nf(r.requests) }),
      el('td', { text: r.requests > 0 ? nf(r.sidechain_requests / r.requests * 100, 0) + '%' : '—' }),
      el('td', { class: r.credits_known ? '' : 'dash', text: r.credits_known ? nf(r.credits) : '—' }),
      el('td', { text: usd(r.usd) }),
    ])
    const btn = el('button', { class: 'btn', type: 'button', text: t('sess.inspect') })
    btn.onclick = () => setScope(r.session_id)
    tr.append(el('td', {}, btn))
    return tr
  })

  root.append(
    el('div', { class: 'page-head' }, [
      el('h1', { text: t('sess.title') }),
      el('p', { class: 'sub', text: t('sess.sub') }),
    ]),
    el('div', { class: 'row', style: 'margin-top:0' }, [
      el('div', { class: 'seg', 'data-testid': 'sess-filter', role: 'group' }, [
        fbtn('all', t('sess.all'), ss.total),
        fbtn('active', t('sess.activeOnly'), ss.active_count),
      ]),
      el('span', { class: 'muted', style: 'font-size:13px', text: `${t('sess.activeDef')} ${ss.active_within_min} ${t('common.minutes')}` }),
    ]),
    ...(stale !== null && stale > 20 ? [el('div', { class: 'state state--error', 'data-testid': 'sess-stale' }, [
      el('b', { text: t('sess.staleTitle') }),
      el('span', { text: `${t('sess.staleBody')} ${nf(stale)} ${t('common.minutes')}.` }),
    ])] : []),
    ss.rows.length === 0
      ? el('div', { class: 'state', 'data-testid': 'sess-empty' }, [
          el('b', { text: t('sess.emptyTitle') }), el('span', { text: t('sess.emptyBody') })])
      : el('div', { class: 'tablewrap' }, el('table', { 'data-testid': 'session-table' }, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: t('sess.id') }), el('th', { text: t('an.project') }),
            el('th', { text: t('sess.last') }), el('th', { text: t('sess.duration') }),
            el('th', { text: t('common.requests') }), el('th', { text: t('an.subagentShare') }),
            el('th', { text: 'Credits' }), el('th', { text: t('an.usd') }), el('th', { text: '' }),
          ])),
          el('tbody', {}, rows),
        ])),
    ...(ss.shown < (filter === 'active' ? ss.active_count : ss.total)
      ? [el('p', { class: 'muted colnote', text: `${t('sess.showing')} ${nf(ss.shown)}/${nf(filter === 'active' ? ss.active_count : ss.total)}` })]
      : []),
  )
}

// ── trang 4: Tóm tắt ────────────────────────────────────────────────────────────
// Một bảng gom đủ: đứng ở đâu, tiêu vào đâu, lãng phí chỗ nào, làm việc kiểu gì.
// Mục đích là chụp một phát gửi đi được, không phải bấm qua bốn tab để ghép lại.
async function pageSummary(root) {
  const [now, bmAll, find, act, ins] = await Promise.all([
    api('/api/now'), api('/api/by-model' + sq('period=all')), api('/api/findings' + sq()),
    api('/api/activity' + sq('days=365')), api('/api/insight'),
  ])

  const row = (k, v, note) => el('tr', {}, [
    el('td', { class: 'name', text: k }),
    el('td', { text: v }),
    el('td', { class: 'muted', text: note ?? '' }),
  ])
  const block = (title, rows, tag) => [
    el('div', { class: 'h2row' }, [el('h2', { text: title }), ...(tag ? [tag] : [])]),
    el('div', { class: 'tablewrap' }, el('table', { class: 'sumtable' }, el('tbody', {}, rows))),
  ]

  const lim = now.limits
  const days = act.lanes.length
  const totalReq = act.lanes.reduce((s, l) => s + l.requests, 0)
  const busiest = act.lanes.reduce((a, b) => (b.credits > (a?.credits ?? -1) ? b : a), null)
  const bursts = act.lanes.reduce((s, l) => s + l.fragments.length, 0)
  const known = bmAll.rows.filter((r) => r.credits_known)
  const top = known[0]
  const usdAll = bmAll.rows.reduce((s, r) => s + r.usd, 0)

  const d = ins.deterministic?.value ?? null
  const f = ins.friction

  root.append(
    el('div', { class: 'page-head', 'data-testid': 'summary-page' }, [
      el('h1', { text: t('sum.title') }),
      el('p', { class: 'sub', text: t('sum.sub') }),
    ]),

    ...block(t('sum.where'), [
      row(t('dash.fiveHour'), lim ? `${nf(lim.five_hour_pct)}%` : '—',
        lim ? `${t('dash.resetIn')} ${nf(Math.max(0, (lim.five_hour_reset * 1000 - Date.now()) / 60000))} ${t('common.minutes')}` : ''),
      row(t('dash.sevenDay'), lim ? `${nf(lim.seven_day_pct)}%` : '—', t('dash.sevenDayNote')),
      row(t('dash.plan'), (now.plan.tier ?? '—').replace(/^default_claude_/, ''), `${now.plan.mode} · ${now.credits_source}`),
      row(t('dash.ceiling'), now.plan.ceiling === null ? '—' : `${nf(now.plan.ceiling)} credits`, ''),
    ], provTag({ provenance: 'deterministic' })),

    ...block(t('sum.spend'), [
      ...(now.cycle ? [
        row(t('dash.cycleCost'), usd(now.cycle.cycle_cost), `${now.cycle.days_elapsed}/${now.cycle.days_total} ${t('common.days')}`),
        row(t('dash.burn'), usd(now.cycle.cycle_cost / Math.max(1, now.cycle.days_elapsed)) + '/d', `${t('dash.burnNote')} ${now.cycle.days_elapsed} ${t('common.days')}`),
      ] : []),
      row(t('sum.usdAllTime'), usd(usdAll), t('sum.usdNote')),
      row(t('sum.topModel'), top ? top.model : '—',
        top ? `${nf(top.share_pct ?? 0, 1)}% ${t('sum.ofAllCredits')}` : ''),
      row(t('sum.modelCount'), String(bmAll.rows.length), t('sum.modelCountNote')),
    ], provTag({ provenance: 'deterministic' })),

    ...block(t('sum.work'), [
      row(t('sum.daysActive'), nf(days), t('sum.daysNote')),
      row(t('sum.totalReq'), nf(totalReq), ''),
      row(t('sum.bursts'), nf(bursts), `${t('an.fragGap')} ${act.idle_gap_min} ${t('common.minutes')}`),
      row(t('sum.busiest'), busiest ? busiest.day : '—',
        busiest ? `${nf(busiest.requests)} ${t('common.requests')} · ${nf(busiest.credits)} credits` : ''),
      ...(d ? [
        row(t('sum.sessions'), nf(d.sessions), t('sum.sessionsNote')),
        row(t('in.toolErrors'), nf(d.tool_errors), ''),
        row(t('in.interruptions'), nf(d.interruptions), ''),
        row(t('in.wouldPrompt'), nf(d.would_prompt), t('sum.wouldPromptNote')),
        row(t('in.destructive'), nf(d.destructive_commands), ''),
        ...(d.top_tools?.length ? [row(t('sum.topTool'), d.top_tools[0][0],
          `${nf(d.top_tools[0][1])} ${t('common.times')}`)] : []),
      ] : []),
    ], provTag({ provenance: 'deterministic' })),

    ...(f?.value ? block(t('sum.friction'),
      Object.entries(f.value).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([k, n]) => row(t(`fr.${k}`) === `fr.${k}` ? k : t(`fr.${k}`), nf(n), '')),
      provTag(f)) : []),

    ...block(t('sum.waste'),
      find.findings.length
        ? find.findings.map((x) => row(
            `${x.rank}. ${t(`find.${x.id}`)}`,
            x.damage.usd !== undefined ? usd(x.damage.usd) : `${nf(x.damage.credits)} credits`,
            `${t(`sev.${x.severity}`)} · ${t(`find.verb.${x.damage_kind}`)}`))
        : [row(t('state.noFindingsTitle'), '—', '')],
      provTag({ provenance: 'deterministic' })),

    el('p', { class: 'muted colnote', style: 'margin-top:24px', text: t('sum.foot') }),
  )
}

// ── điều hướng ──────────────────────────────────────────────────────────────────
const PAGES = { dashboard: pageDashboard, analytics: pageAnalytics, sessions: pageSessions, insight: pageInsight, summary: pageSummary }

// Khoá thế hệ: bấm tab nhanh làm nhiều render chạy chồng nhau; không có khoá thì lần
// render CŨ về sau có thể ghi đè lần MỚI (e2e bắt được dưới dạng flaky).
let renderGen = 0

function paintScopeBar(info) {
  // Luôn nói rõ đang xem phạm vi nào, và luôn có đường thoát. Một bộ lọc dính mà
  // không nhìn thấy là cách chắc chắn nhất để người đọc tin nhầm con số.
  const bar = $('#scopebar')
  const sc = getScope()
  bar.replaceChildren()
  if (sc === 'all') { bar.hidden = true; return }
  bar.hidden = false
  const label = sc === 'active' ? t('scope.activeOnly') : `${t('scope.oneSession')} ${sc.slice(0, 8)}`
  const clear = el('button', { class: 'btn', type: 'button', 'data-testid': 'scope-clear', text: t('scope.clear') })
  clear.onclick = () => setScope('all')
  bar.append(
    el('span', { class: 'tag tag--on', text: t('scope.viewing') }),
    el('span', { class: 'scopelabel', text: label }),
    ...(info ? [el('span', { class: 'muted', text: info })] : []),
    clear,
  )
}

async function render() {
  paintScopeBar()
  const gen = ++renderGen
  const page = (location.hash.slice(1) || 'dashboard')
  const fn = PAGES[page] ?? pageDashboard
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.page === page))
  const root = $('#app')
  root.replaceChildren(el('p', { class: 'muted', text: t('common.loading') }))
  try {
    const frag = document.createDocumentFragment()
    await fn(frag)
    if (gen !== renderGen) return          // đã có render mới hơn ⇒ bỏ kết quả cũ
    root.replaceChildren(frag)
  } catch (e) {
    if (gen !== renderGen) return
    root.replaceChildren(el('div', { class: 'state state--error', 'data-testid': 'error' },
      el('p', { text: String(e.message ?? e) })))
  }
}

// Gắn điều hướng + đổi ngôn ngữ TRƯỚC `await pickLang()`. Gắn sau await để lại một
// khoảng (nạp 3 từ điển) mà nút có mặt nhưng bấm không ăn — người dùng bấm cờ ngay
// khi trang hiện ra thì mất click, và e2e bắt được dưới dạng flaky.
// Uỷ nhiệm ở document nên không phụ thuộc thứ tự dựng DOM.
document.addEventListener('click', (e) => {
  const tab = e.target.closest?.('.tab')
  if (tab) { location.hash = tab.dataset.page; return }
  const lang = e.target.closest?.('.lang')
  if (!lang) return
  L = lang.dataset.lang
  try { localStorage.setItem('tally.lang', L) } catch {}
  document.documentElement.lang = L
  // Từ điển chưa về thì thôi: pickLang() đọc localStorage nên lựa chọn vẫn được tôn trọng.
  if (dicts[L]) { T = dicts[L]; applyStatic(); render() }
})

await pickLang()
applyStatic()
const TOKEN = document.querySelector('meta[name="tally-token"]')?.content ?? ''

$('#consent-no').onclick = () => { $('#consent-status').textContent = ''; $('#consent').close() }
$('#consent-yes').onclick = async () => {
  const st = $('#consent-status')
  const yes = $('#consent-yes')
  yes.disabled = true
  st.textContent = t('insight.running')
  try {
    const r = await fetch('/api/insight/refresh', {
      method: 'POST', headers: { 'x-tally-token': TOKEN },
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? String(r.status))
    st.textContent = t('insight.done')
    $('#consent').close()
    render()
  } catch (e) {
    st.textContent = `${t('insight.failed')}: ${e.message ?? e}`
  } finally {
    yes.disabled = false
  }
}
window.addEventListener('hashchange', render)
await render()
