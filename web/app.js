// tally UI: no dependencies, no outbound calls (it only fetches this localhost server)
const LANGS = ['vi', 'zh', 'en']
const dicts = {}
let L = 'vi', T = {}

const t = (k) => T[k] ?? k
/** Interpolate {params} into a translation. A missing param keeps its braces, so the gap is visible. */
/** The translation if there is one, otherwise the fallback, for strings the engine produced. */
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
// Long paths overflow the table and nobody reads them. Keep the last two meaningful
// segments; the full path stays in the title attribute so it can still be looked up.
const shortPath = (p) => {
  if (!p || p.startsWith('project-')) return p
  const parts = p.split('/').filter(Boolean)
  const tail = parts.slice(-2).join('/')
  return parts.length > 2 ? '…/' + tail : tail
}
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`
/** What a missing value looks like. Never a 0, and never an em dash in copy. */
const NO_VALUE = 'n/a'

/**
 * "Missing" is NOT "zero".
 *
 * An earlier version returned 0 for undefined, so one mistyped field name (`input_tokens`
 * while the API returned `input`) became a whole table of very convincing zeroes. Now it
 * renders the unknown mark instead.
 */
const nf = (x, d = 0) => (x === undefined || x === null || Number.isNaN(x)
  ? NO_VALUE
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


// -- view scope ----------------------------------------------------------------
// 'all', 'active' or <session_id>. Every page reads it from HERE and attaches it to every
// API call, so two pages never report two numbers for the same thing.
const getScope = () => localStorage.getItem('tally.scope') || 'all'
const setScope = (v) => { try { localStorage.setItem('tally.scope', v) } catch {} ; render() }
const sq = (extra = '') => {
  const sc = getScope()
  const q = sc === 'all' ? '' : `scope=${encodeURIComponent(sc)}`
  return [extra, q].filter(Boolean).join('&') ? '?' + [extra, q].filter(Boolean).join('&') : ''
}

// -- provenance labels (DD-13b, DD-17) -------------------------------------------
const provTag = (agg) => {
  const det = agg.provenance === 'deterministic'
  const label = det ? t('in.measured') : t('in.inferred')
  const sample = det ? '' : ` · ${t('in.sample')} ${agg.sample_size}/${agg.population}`
  return el('span', { class: `tag ${det ? 'det tag--in' : 'llm tag--out'}`, text: label + sample })
}

/**
 * ONE measurement in a row, not a card.
 *
 * The console theme forbids "a page of equal little boxes", which was exactly the old
 * problem: every page opened with four identical cards and nothing mattered more than
 * anything else.
 */
const stat = (key, value, sub) => el('div', { class: 'fact', 'data-testid': `stat-${key}` }, [
  el('span', { class: 'n', html: value }),
  el('span', { class: 'l', text: sub ? `${t(key)} · ${sub}` : t(key) }),
])

/**
 * The lead reading, the signature of this tool. Exactly one per page, set large.
 * Cool blue when it is an instrument's measurement, amber when it belongs to a person.
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

// Figures speak in plain language, not key=value. UX rule: no bare jargon.
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
    // The rank comes from the engine; the UI never invents a priority.
    el('span', { class: 'rank', text: String(f.rank ?? '') }),
    el('div', { class: 'body' }, [
      el('div', { class: 'ftitle' }, [
        el('b', { text: t(`find.${f.id}`) }),
        ...(f.severity === 'high' ? [el('span', { class: 'tag tag--on', text: t('sev.high') })] : []),
      ]),
      // The action sentence goes through i18n; the engine keeps the English one for the CLI.
      el('p', { class: 'fnote', text: tOr(`find.act.${f.id}`, f.action) }),
      ...(sub ? [el('p', { class: 'fnote', text: sub })] : []),
    ]),
    el('div', { class: 'amount' }, [
      el('div', { class: 'v', text: dmg }),
      // The verb follows damage_kind: calling a PEAK "could save" makes the reader think
      // they are losing that much money.
      el('div', { class: 'k', text: t(`find.verb.${f.damage_kind}`) }),
    ]),
  ])
}

// -- page 1: Dashboard -----------------------------------------------------------
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
        stat('dash.ceiling', now.plan.ceiling === null ? NO_VALUE : `${nf(now.plan.ceiling)}`,
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

// -- page 2: Analytics -----------------------------------------------------------
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
      el('td', { class: r.credits_known ? '' : 'dash', text: r.credits_known ? nf(r.credits_period) : NO_VALUE }),
      el('td', { class: r.share_pct === null ? 'dash' : '', text: r.share_pct === null ? NO_VALUE : nf(r.share_pct, 1) + '%' }),
      ...(bm.is_five_hour ? [el('td', { class: r.pct_of_ceiling === null ? 'dash' : '', text: r.pct_of_ceiling === null ? NO_VALUE : nf(r.pct_of_ceiling, 2) + '%' })] : []),
      el('td', { class: r.credits_known ? '' : 'dash', text: r.credits_known ? nf(r.credits_lifetime) : NO_VALUE }),
      el('td', { text: usd(r.usd) }),
    ]))),
  ])

  const sel = el('select', { 'data-testid': 'grain-select' },
    ['hour', 'day', 'month', 'year'].map((g) =>
      el('option', { value: g, text: t('an.' + g), ...(g === grain ? { selected: 'selected' } : {}) })))
  sel.onchange = () => { localStorage.setItem('tally.grain', sel.value); render() }

  // The period for the model table. Hard-wiring five hours is why the table once showed
  // all zeroes: only one model may have run in the last five hours even though a whole
  // week used several.
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

  // -- SIGNATURE: the activity log ---------------------------------------------
  // A week by weekday grid, like GitHub: one glance shows a year, where it was dense and
  // where it rested. Clicking a day opens the RHYTHM INSIDE that day, where each fragment
  // is a real burst of work, placed at its hour and as wide as it lasted. The grid gives
  // the picture, the fragments give the story.
  const DOW = { vi: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], zh: ['日', '一', '二', '三', '四', '五', '六'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }[L]
  const MON = { vi: 'Th', zh: '月', en: '' }[L]

  const byDay = new Map(act.lanes.map((l) => [l.day, l]))
  const dayMax = Math.max(1, ...act.lanes.map((l) => l.credits))
  // A log scale: one peak day a hundred times the usual would push every other day down
  // to level 1 on a linear scale, which is exactly the bug the fragment scale hit.
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

  // The day detail opens on click and starts closed: nobody needs it immediately.
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
        // A peak several times heavier than the calibrated window is an EXTRAPOLATION and
        // must say so. And when no fit succeeded at all the figure is even less certain,
        // so that case carries the label too.
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
    // Say what each column means right where the reader meets it. The lifetime column was
    // misread before, because its name did not explain itself.
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
        el('td', { text: r.usd > 0 ? nf(r.sidechain_usd / r.usd * 100, 0) + '%' : NO_VALUE }),
      ]))),
    ]),
    el('h2', { text: t('an.heatmap') }),
    el('div', { class: 'panel' }, heat),
  )
}

// -- page 3: Insight -------------------------------------------------------------
// NOT a list of tool names. Each item is a number that means something, with ONE sentence
// saying what it means. The raw name lists go to the bottom, folded away for whoever wants them.
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
    if (r.kind === 'ratio') return nf(r.value, 1) + 'x'
    if (r.kind === 'text') return r.text
    return nf(r.value)
  }

  // One reading: a large number, a label, and an explanation. No sentence, no reading.
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
    // The first block keeps the old `insight-stats` hook so the test contract survives a
    // rewrite of the page.
    const attrs = { class: 'readings', ...(firstSection ? { 'data-testid': 'insight-stats' } : {}) }
    firstSection = false
    return [
      el('div', { class: 'h2row' }, [el('h2', { text: title }), ...(tag ? [tag] : [])]),
      el('div', attrs, kids),
    ]
  }

  // Raw lists: useful when looking something up, but not what the page opens with.
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

    // -- Who is actually typing ------------------------------------------------
    // This block must come BEFORE any other tool figure: if more than half the calls come
    // from subagents, the ratios below stop being about the reader's habits.
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
      // One table for the three lanes, measured with the same ruler. Without a comparison
      // there is no way to tell a person's habit from a machine's work.
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
          el('td', { class: 'num weak', text: l.exec > 0 ? nf(l.probe_pct, 0) + '%' : NO_VALUE }),
          el('td', { class: 'num weak', text: l.reads > 0 ? nf(l.image_pct, 0) + '%' : NO_VALUE }),
          el('td', { class: 'num weak', text: l.read_per_write === null ? NO_VALUE : nf(l.read_per_write, 1) }),
          el('td', { class: 'muted', style: 'font-size:13px',
            text: (l.top_projects ?? []).slice(0, 2).map((p) => p.key).join(', ') || NO_VALUE }),
        ]))),
      ])),
      el('p', { class: 'muted colnote', text: t('bh.laneNote') }),
    ] : []),

    // -- Shell commands: what they are for ---------------------------------------
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

    // -- What it leans on from outside -------------------------------------------
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
        // Bare counts cannot be compared. 10 out of a 10-session sample is CONSTANT;
        // 10 out of 400 is rare. The percentage has to be shown too.
        const entries = Object.entries(fr.value).sort((a, b) => b[1] - a[1]).slice(0, 6)
        // The denominator is the TOTAL NUMBER OF SNAGS, not the session count: one session
        // can snag several times, so dividing by the sample size prints "100% 10/10", which
        // reads as "every session was blocked" when the truth is only "this is the most
        // common kind of snag".
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

  // -- What Claude says about the figures above ---------------------------------
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
      // The cost has to say which part was MEASURED. Showing a tidy number that was never
      // measured is making a promise with someone else's quota.
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

// -- page: Sessions --------------------------------------------------------------
// The 5-hour window only answers "am I about to hit the ceiling". Sessions answer "what is
// burning it", "what has that one cost so far", "what did I do yesterday". That is the unit
// people think in.
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
      el('td', { text: r.requests > 0 ? nf(r.sidechain_requests / r.requests * 100, 0) + '%' : NO_VALUE }),
      el('td', { class: r.credits_known ? '' : 'dash', text: r.credits_known ? nf(r.credits) : NO_VALUE }),
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

// -- page 4: Summary -------------------------------------------------------------
// One table with everything: where you stand, where it went, what is wasted, how you work.
// The point is a single screenshot you can send, not clicking through four tabs to assemble one.
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
      row(t('dash.fiveHour'), lim ? `${nf(lim.five_hour_pct)}%` : NO_VALUE,
        lim ? `${t('dash.resetIn')} ${nf(Math.max(0, (lim.five_hour_reset * 1000 - Date.now()) / 60000))} ${t('common.minutes')}` : ''),
      row(t('dash.sevenDay'), lim ? `${nf(lim.seven_day_pct)}%` : NO_VALUE, t('dash.sevenDayNote')),
      row(t('dash.plan'), (now.plan.tier ?? NO_VALUE).replace(/^default_claude_/, ''), `${now.plan.mode} · ${now.credits_source}`),
      row(t('dash.ceiling'), now.plan.ceiling === null ? NO_VALUE : `${nf(now.plan.ceiling)} credits`, ''),
    ], provTag({ provenance: 'deterministic' })),

    ...block(t('sum.spend'), [
      ...(now.cycle ? [
        row(t('dash.cycleCost'), usd(now.cycle.cycle_cost), `${now.cycle.days_elapsed}/${now.cycle.days_total} ${t('common.days')}`),
        row(t('dash.burn'), usd(now.cycle.cycle_cost / Math.max(1, now.cycle.days_elapsed)) + '/d', `${t('dash.burnNote')} ${now.cycle.days_elapsed} ${t('common.days')}`),
      ] : []),
      row(t('sum.usdAllTime'), usd(usdAll), t('sum.usdNote')),
      row(t('sum.topModel'), top ? top.model : NO_VALUE,
        top ? `${nf(top.share_pct ?? 0, 1)}% ${t('sum.ofAllCredits')}` : ''),
      row(t('sum.modelCount'), String(bmAll.rows.length), t('sum.modelCountNote')),
    ], provTag({ provenance: 'deterministic' })),

    ...block(t('sum.work'), [
      row(t('sum.daysActive'), nf(days), t('sum.daysNote')),
      row(t('sum.totalReq'), nf(totalReq), ''),
      row(t('sum.bursts'), nf(bursts), `${t('an.fragGap')} ${act.idle_gap_min} ${t('common.minutes')}`),
      row(t('sum.busiest'), busiest ? busiest.day : NO_VALUE,
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
        : [row(t('state.noFindingsTitle'), NO_VALUE, '')],
      provTag({ provenance: 'deterministic' })),

    el('p', { class: 'muted colnote', style: 'margin-top:24px', text: t('sum.foot') }),
  )
}

// -- navigation ------------------------------------------------------------------
const PAGES = { dashboard: pageDashboard, analytics: pageAnalytics, sessions: pageSessions, insight: pageInsight, summary: pageSummary }

// A generation lock: fast tab clicks overlap renders, and without the lock an OLDER render
// can finish last and overwrite a NEWER one (the e2e suite caught this as flakiness).
let renderGen = 0

function paintScopeBar(info) {
  // Always say which scope is in view, and always offer a way out. A sticky filter nobody
  // can see is the surest way to make a reader trust the wrong number.
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
    if (gen !== renderGen) return          // a newer render started, drop this stale result
    root.replaceChildren(frag)
  } catch (e) {
    if (gen !== renderGen) return
    root.replaceChildren(el('div', { class: 'state state--error', 'data-testid': 'error' },
      el('p', { text: String(e.message ?? e) })))
  }
}

// Wire navigation and language switching BEFORE `await pickLang()`. Wiring after the await
// leaves a gap (three dictionaries loading) where the buttons exist but clicks do nothing, so
// anyone clicking a flag the moment the page appears loses the click. The e2e suite caught
// that as flakiness. Delegating on document keeps it independent of DOM build order.
document.addEventListener('click', (e) => {
  const tab = e.target.closest?.('.tab')
  if (tab) { location.hash = tab.dataset.page; return }
  const lang = e.target.closest?.('.lang')
  if (!lang) return
  L = lang.dataset.lang
  try { localStorage.setItem('tally.lang', L) } catch {}
  document.documentElement.lang = L
  // If a dictionary has not arrived yet, fine: pickLang() reads localStorage, so the choice still holds.
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
