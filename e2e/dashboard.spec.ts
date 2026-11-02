import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Headless Chromium reports locale en-US, so the UI would pick 'en'. The Vietnamese
  // assertions below need the language set EXPLICITLY to be deterministic; auto detection
  // has its own test further down.
  // Only set it when nothing is stored: overwriting on every navigation would erase the
  // user's own choice and wrongly fail the "choice survives a reload" test.
  await page.addInitScript(() => {
    try { if (!localStorage.getItem('tally.lang')) localStorage.setItem('tally.lang', 'vi') } catch { /* ignore */ }
  })
  const errs: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  ;(page as unknown as { __errs: string[] }).__errs = errs
})

const noConsoleErrors = (page: unknown): void => {
  expect((page as { __errs: string[] }).__errs).toEqual([])
}

test('Dashboard shows the 5h and 7d limits, the plan and the ceiling, with no console errors', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'true')
  const app = page.getByTestId('app')
  await expect(app).toContainText('Hạn mức 5 giờ')
  await expect(app).toContainText('Hạn mức 7 ngày')
  await expect(app).toContainText('max_20x')          // the plan read from ~/.claude.json
  await expect(app).toContainText('200.000')          // the 5h ceiling, formatted vi-VN
  noConsoleErrors(page)
})

test('tabs navigate between pages, and every tab has text next to its icon (never a bare icon)', async ({ page }) => {
  await page.goto('/')
  for (const [tab, marker] of [
    ['tab-analytics', 'Theo model'],
    ['tab-insight', 'Bạn dùng Claude thế nào'],
    ['tab-dashboard', 'Bạn đang ở đâu'],
  ] as const) {
    await page.getByTestId(tab).click()
    await expect(page.getByTestId('app')).toContainText(marker)
    await expect(page.getByTestId(tab)).toHaveAttribute('aria-selected', 'true')
  }
  for (const t of ['tab-dashboard', 'tab-analytics', 'tab-insight']) {
    const txt = (await page.getByTestId(t).innerText()).trim()
    expect(txt.replace(/[▣▤◍]/g, '').trim().length).toBeGreaterThan(2)
  }
  noConsoleErrors(page)
})

test('Analytics: the model table carries credits, % of ceiling and USD, from real data', async ({ page }) => {
  await page.goto('/#analytics')
  const tbl = page.getByTestId('model-table')
  await expect(tbl).toBeVisible()
  await expect(tbl).toContainText('claude-')
  const rows = tbl.locator('tbody tr')
  expect(await rows.count()).toBeGreaterThan(0)
  // Six cells: model, credits in period, share of use, % of ceiling, lifetime total, USD.
  // Credits and % of ceiling must describe the same window; the lifetime total is its OWN
  // column and may not sit next to % of ceiling without saying it covers a different range.
  const cells = await rows.first().locator('td').allInnerTexts()
  expect(cells).toHaveLength(6)
  expect(cells[2], 'share of use').toMatch(/(%|n\/a)$/)
  expect(cells[3], '% of the 5h ceiling').toMatch(/(%|n\/a)$/)
  expect(cells[5], 'USD').toMatch(/^\$/)
  noConsoleErrors(page)
})

test('Analytics: switching hour, day, month and year all render', async ({ page }) => {
  await page.goto('/#analytics')
  const sel = page.getByTestId('grain-select')
  for (const g of ['hour', 'month', 'year', 'day']) {
    await sel.selectOption(g)
    // The per-day bar strip was REPLACED by the fragmented activity log. Assert on the new
    // object, and assert harder than the old one did.
    await expect(page.getByTestId('activity')).toBeVisible()
    await expect(sel).toHaveValue(g)
  }
  noConsoleErrors(page)
})

test('Analytics: the heatmap has 7 rows of one label plus 24 cells', async ({ page }) => {
  await page.goto('/#analytics')
  const heat = page.getByTestId('heatmap')
  await expect(heat).toBeVisible()
  expect(await heat.locator('.cell').count()).toBe(7 * 24)
  expect(await heat.locator('.lbl').count()).toBe(7)
  noConsoleErrors(page)
})

test('Insight: figures carry a PROVENANCE label and a sample size (DD-13b, DD-17)', async ({ page }) => {
  await page.goto('/#insight')
  const app = page.getByTestId('app')
  await expect(app).toContainText('Đo được')          // the deterministic label
  await expect(app).toContainText('Claude suy luận')  // the model-inferred label
  await expect(app).toContainText('cỡ mẫu')           // the sample size is mandatory
  const llm = app.locator('.tag.llm').first()
  await expect(llm).toContainText(/cỡ mẫu \d+\/\d+/)  // shaped sample/population
  noConsoleErrors(page)
})

test('Insight: the re-analyse button MUST ask first and state credits, % of ceiling and seconds', async ({ page }) => {
  await page.goto('/#insight')
  await expect(page.getByTestId('consent-dialog')).not.toBeVisible()
  await page.getByTestId('insight-analyze').click()
  const dlg = page.getByTestId('consent-dialog')
  await expect(dlg).toBeVisible()
  // The dialog is split in two: what it does in #consent-body, the price in #consent-cost.
  // The contract is that the DIALOG says all four things, not that any one element does, so
  // asserting on the whole dialog lets the layout move while the promise stays guarded.
  const body = await dlg.innerText()
  expect(body).toContain('claude -p')
  expect(body).toMatch(/\d+ credits/)
  expect(body).toMatch(/% trần 5 giờ/)
  expect(body).toMatch(/\d+ giây/)
  expect(body).toContain('không rời khỏi máy')
  await page.getByTestId('consent-no').click()
  await expect(dlg).not.toBeVisible()
  noConsoleErrors(page)
})

test('i18n: switching flags vi to zh to en changes the content and keeps the manual choice', async ({ page }) => {
  await page.goto('/')
  await page.locator('.flag[data-lang="vi"]').click()
  await page.locator('.flag[data-lang="zh"]').click()
  await expect(page.getByTestId('app')).toContainText('5 小时额度')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
  await page.locator('.flag[data-lang="en"]').click()
  await expect(page.getByTestId('app')).toContainText('5-hour limit')
  // reload: the MANUAL choice is not overwritten
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('.flag[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true')
  noConsoleErrors(page)
})

test('i18n: the consent dialog follows the selected language too', async ({ page }) => {
  await page.goto('/')
  await page.locator('.flag[data-lang="en"]').click()
  await page.getByTestId('tab-insight').click()
  await page.getByTestId('insight-analyze').click()
  // innerText() reads ONCE and does not auto-wait, exactly like .count(). An auto-waiting
  // assertion is both more correct and stricter: it still fails on wrong content, it just
  // stops failing because of timing.
  const dlg = page.getByTestId('consent-dialog')
  await expect(dlg).toContainText('your own plan quota')
  await expect(dlg).toContainText(/5-hour ceiling/)
})

test('privacy: the page requests no host other than itself', async ({ page }) => {
  const outbound: string[] = []
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') outbound.push(route.request().url())
    return route.continue()
  })
  await page.goto('/')
  await page.getByTestId('tab-analytics').click()
  await page.getByTestId('tab-insight').click()
  await page.waitForTimeout(400)
  expect(outbound).toEqual([])
})

test('the API is GET only, POST is refused with 405', async ({ request }) => {
  const r = await request.post('/api/now')
  expect(r.status()).toBe(405)
})

test('the API returns the right shape and the plan ceiling is readable', async ({ request }) => {
  const now = await (await request.get('/api/now')).json()
  expect(now.plan.tier).toBe('default_claude_max_20x')
  expect(now.plan.ceiling).toBe(200000)
  expect(now.plan.credits_source).toBe('live')
  const bm = await (await request.get('/api/by-model')).json()
  expect(bm.events).toBeGreaterThan(1000)
  expect(bm.rows.length).toBeGreaterThan(0)
  const bad = await request.get('/api/buckets?grain=khong-hop-le')
  expect(bad.status()).toBe(400)
})


test('i18n: with nothing stored the language is detected from navigator.language', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'zh-CN' })
  const p = await ctx.newPage()
  await p.goto('http://127.0.0.1:7788/')
  await expect(p.locator('html')).toHaveAttribute('lang', 'zh')
  await ctx.close()

  const ctx2 = await browser.newContext({ locale: 'vi-VN' })
  const p2 = await ctx2.newPage()
  await p2.goto('http://127.0.0.1:7788/')
  await expect(p2.locator('html')).toHaveAttribute('lang', 'vi')
  await ctx2.close()
})

test('the % of the 5h ceiling must be SANE: computed over the 5h window, not over all time', async ({ request }) => {
  const bm = await (await request.get('/api/by-model')).json()
  // Before the fix this column read 10,853%, because lifetime credits were divided by the 5h ceiling.
  for (const r of bm.rows) {
    if (r.pct_of_ceiling === null) continue
    expect(r.pct_of_ceiling, `${r.model} is over 100% of the 5h ceiling`).toBeLessThanOrEqual(100)
  }
  const total = bm.rows.reduce((s: number, r: { pct_of_ceiling: number | null }) => s + (r.pct_of_ceiling ?? 0), 0)
  expect(total).toBeLessThanOrEqual(100)
  // and it must use the CALIBRATED hypothesis, not a hard-wired 'all'
  expect(bm.hypothesis).toBe(bm.calibration.hypothesis)
  expect(bm.window.events).toBeLessThanOrEqual(bm.events)
})

test('the 5h peak is the same ORDER OF MAGNITUDE as the ceiling (guards the 200x inflation bug)', async ({ request }) => {
  const bk = await (await request.get('/api/buckets?grain=day')).json()
  expect(bk.ceiling).toBe(200000)
  // This guards the "hypothesis 'all'" bug class, which once produced 4,165,944, or 20x the
  // ceiling. It does NOT assert peak <= ceiling: a genuinely heavy window can exceed it, and
  // then the estimate is an EXTRAPOLATION. See the test below.
  expect(bk.peak_5h).toBeLessThan(bk.ceiling * 10)
})

test('a peak far above the calibrated level MUST be marked as an extrapolation', async ({ request }) => {
  const fd = await (await request.get('/api/findings')).json()
  const ceil = fd.findings.find((f: { id: string }) => f.id === 'CEILING_RISK')
  if (!ceil || !fd.calibration?.fitted_on_credits) test.skip()
  if (ceil.metric.peak_credits > fd.calibration.fitted_on_credits * 3) {
    expect(ceil.metric.extrapolated).toBeTruthy()
  }
})

test('the credit hypothesis has ONE source: findings must use the calibrated one', async ({ request }) => {
  const [bm, bk, fd] = await Promise.all([
    (await request.get('/api/by-model')).json(),
    (await request.get('/api/buckets?grain=day')).json(),
    (await request.get('/api/findings')).json(),
  ])
  // Before the fix, findings.ts hard-coded 'all' and inflated the damage by about 200x.
  expect(fd.hypothesis).toBe(bm.calibration.hypothesis)
  expect(bk.hypothesis).toBe(bm.calibration.hypothesis)
})

test('calibration reaches real accuracy on this machine\'s data', async ({ request }) => {
  const bm = await (await request.get('/api/by-model')).json()
  const c = bm.calibration
  // 'stale_index' is a VALID outcome: the index is older than the limit snapshot, so nothing may be committed to.
  if (c.status !== 'calibrated') {
    expect(['low_signal', 'no_data', 'stale_index', 'no_ceiling', 'poor_fit']).toContain(c.status)
    if (c.status === 'poor_fit') expect(c.error_pct).not.toBeNull()
    else expect(c.error_pct).toBeNull()
    return
  }
  // either inside the quantisation band of an integer pct, or off by less than 10%
  expect(c.within_quantization || Math.abs(c.error_pct) < 10).toBe(true)
})

test('rapid successive tab clicks: the final content MUST match the final tab (render race guard)', async ({ page }) => {
  await page.goto('/')
  // no await between clicks, which forces several renders to overlap
  await page.getByTestId('tab-analytics').click()
  await page.getByTestId('tab-insight').click()
  await page.getByTestId('tab-analytics').click()
  await page.getByTestId('tab-insight').click()
  await expect(page.getByTestId('app')).toContainText('Bạn dùng Claude thế nào')
  await expect(page.getByTestId('app')).not.toContainText('Theo model')
  await expect(page.getByTestId('tab-insight')).toHaveAttribute('aria-selected', 'true')
})

test('an uncertain 5h peak MUST carry its label on screen, not only in the JSON', async ({ page, request }) => {
  const bk = await (await request.get('/api/buckets?grain=day')).json()
  const fd = await (await request.get('/api/findings')).json()
  await page.goto('/#analytics')
  // Two reasons make the peak uncertain, and BOTH must show the label: the peak is many
  // times heavier than the fitted window, OR no fit ever succeeded. Guarding only the first
  // misses exactly the most doubtful case.
  const unsure = bk.peak_extrapolated || fd.calibration.status !== 'calibrated'
  if (unsure) {
    await expect(page.getByTestId('peak-extrapolated')).toBeVisible()
  } else {
    await expect(page.getByTestId('peak-extrapolated')).toHaveCount(0)
  }
})

test.describe('the write route: /api/insight/refresh', () => {
  test('GET is refused with 405, because this is a POST route', async ({ request }) => {
    expect((await request.get('/api/insight/refresh')).status()).toBe(405)
  })

  test('POST without a token gives 401 and runs nothing', async ({ request }) => {
    const r = await request.post('/api/insight/refresh')
    expect(r.status()).toBe(401)
  })

  test('POST with a wrong token gives 401', async ({ request }) => {
    const r = await request.post('/api/insight/refresh', { headers: { 'x-tally-token': 'bay-gio-doan-bua' } })
    expect(r.status()).toBe(401)
  })

  test('the token is embedded only in the locally served page, and dry_run verifies it without spending quota', async ({ page, request }) => {
    await page.goto('/')
    const tok = await page.locator('meta[name="tally-token"]').getAttribute('content')
    expect(tok).toMatch(/^[0-9a-f-]{36}$/)
    // dry_run passes the token gate but spawns no claude
    const r = await request.post('/api/insight/refresh?dry_run=1', { headers: { 'x-tally-token': tok! } })
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.dry_run).toBe(true)
    expect(j.measured.credits).toBeGreaterThan(0)
    expect(j.pct_of_ceiling).toBeGreaterThan(0)
  })

  test('every server start mints a NEW token, never a constant in the source', async ({ page }) => {
    await page.goto('/')
    const a = await page.locator('meta[name="tally-token"]').getAttribute('content')
    expect(a).toBeTruthy()
    // the token must not live in any static file
    const js = await (await page.request.get('/app.js')).text()
    expect(js).not.toContain(a!)
  })

  test('there is no other write path: POST to the read endpoints still gives 405', async ({ request }) => {
    for (const ep of ['/api/now', '/api/by-model', '/api/findings', '/api/insight']) {
      expect((await request.post(ep)).status(), ep).toBe(405)
    }
  })
})

test('Analytics: the per-project table carries the subagent share', async ({ page }) => {
  await page.goto('/#analytics')
  const tbl = page.getByTestId('project-table')
  await expect(tbl).toBeVisible()
  expect(await tbl.locator('tbody tr').count()).toBeGreaterThan(0)
  const cells = await tbl.locator('tbody tr').first().locator('td').allInnerTexts()
  expect(cells).toHaveLength(4)
  expect(cells[2]).toMatch(/^\$/)
  expect(cells[3]).toMatch(/(%|n\/a)$/)
})

test('without --redact nothing is anonymised (the gate is right at the negative end)', async ({ page }) => {
  await page.goto('/#analytics')
  await expect(page.getByTestId('project-table')).toBeVisible()
  await expect(page.getByTestId('redacted-tag')).toHaveCount(0)
})

test('the "open the original report" button really opens it, and is not href="#"', async ({ page, request }) => {
  await page.goto('/#insight')
  const btn = page.getByTestId('open-report')
  if (await btn.count() === 0) return   // this machine has never run /insights
  const href = await btn.getAttribute('href')
  expect(href, 'href="#" would wipe the hash and throw the user back to the dashboard').not.toBe('#')
  const r = await request.get(href!)
  expect(r.status()).toBe(200)
  expect((await r.text()).toLowerCase()).toContain('<html')
})

test('an unreadable ceiling renders the unknown mark, never a 0', async ({ page }) => {
  await page.route('**/api/now', async (route) => {
    const r = await route.fetch()
    const j = await r.json()
    j.plan.ceiling = null
    await route.fulfill({ json: j })
  })
  await page.goto('/#dashboard')
  const card = page.getByTestId('stat-dash.ceiling')
  await expect(card).toBeVisible()
  await expect(card).toContainText('n/a')
  await expect(card).not.toContainText(/\b0\b\s*credits/)
})

test('a PEAK figure is never called a saving anywhere (the web must match the CLI)', async ({ page, request }) => {
  const fd = await (await request.get('/api/findings')).json()
  const peak = fd.findings.find((f) => f.damage_kind === 'peak')
  await page.goto('/#dashboard')
  if (!peak) { expect(fd.findings.every((f) => f.damage_kind)).toBe(true); return }
  const card = page.getByTestId(`finding-${peak.id}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText('đỉnh đo được')
  await expect(card).not.toContainText('tiết kiệm')
})

test('every finding the API returns declares damage_kind', async ({ request }) => {
  const fd = await (await request.get('/api/findings')).json()
  expect(fd.findings.length).toBeGreaterThan(0)
  for (const f of fd.findings) {
    expect(['saving', 'peak', 'spend'], `${f.id} has no damage_kind`).toContain(f.damage_kind)
  }
})

test.describe('signature: the fragmented activity log', () => {
  test('every fragment sits inside its lane (0 to 100%) and has a visible width', async ({ page }) => {
    await page.goto('/#analytics')
    const frags = page.getByTestId('day-detail').locator('.frag')
    await expect(frags.first()).toBeVisible()   // count() does not auto-wait
    const n = await frags.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < Math.min(n, 40); i += 1) {
      const st = await frags.nth(i).getAttribute('style')
      const left = Number(/left:([\d.]+)%/.exec(st)![1])
      const width = Number(/width:([\d.]+)%/.exec(st)![1])
      expect(left, 'the fragment spills outside the day').toBeGreaterThanOrEqual(0)
      expect(left + width, 'the fragment runs past 24 hours').toBeLessThanOrEqual(100.01)
      expect(width, 'the fragment is too thin to see').toBeGreaterThan(0)
    }
  })

  test('fragments match the API figures and are not decoration', async ({ page, request }) => {
    const act = await (await request.get('/api/activity?days=365')).json()
    await page.goto('/#analytics')
    await expect(page.getByTestId('day-detail').locator('.frag').first()).toBeVisible()
    const drawn = await page.getByTestId('day-detail').locator('.frag').count()
    // The detail shows the NEWEST day, so compare against that day's fragment count.
    const last = act.lanes[act.lanes.length - 1]
    expect(drawn).toBe(last.fragments.length)
  })

  test('intensity uses ONE hue: a 1 to 5 scale on a single colour', async ({ page, request }) => {
    const act = await (await request.get('/api/activity?days=365')).json()
    await page.goto('/#analytics')
    await expect(page.getByTestId('day-detail').locator('.frag').first()).toBeVisible()

    // Open the day with the MOST fragments, not the newest one. A day that just started may
    // hold a single burst, and then "every fragment at one level" is CORRECT. Asserting on
    // the newest day buys a test that breaks depending on the hour it runs.
    const busiest = [...act.lanes].sort(
      (a: { fragments: unknown[] }, b: { fragments: unknown[] }) => b.fragments.length - a.fragments.length)[0]
    expect(busiest.fragments.length, 'no day has more than one burst, so the data is too thin to say anything about the scale')
      .toBeGreaterThan(1)
    await page.locator(`.ghcell[data-day="${busiest.day}"]`).click()
    await expect(page.getByTestId('day-detail').locator('.frag')).toHaveCount(busiest.fragments.length)

    const idx = await page.getByTestId('day-detail').locator('.frag').evaluateAll(
      (els) => [...new Set(els.map((e) => e.dataset.i))].sort())
    for (const i of idx) expect(['1', '2', '3', '4', '5']).toContain(i)
    // The scale must ACTUALLY distinguish: a scale where every fragment sits at one level is dead.
    expect(idx.length, 'every fragment at one level makes the intensity scale useless').toBeGreaterThan(1)
  })

  test('flag buttons carry TEXT, not a bare icon', async ({ page }) => {
    await page.goto('/')
    for (const l of ['vi', 'zh', 'en']) {
      const txt = await page.locator(`.flag[data-lang="${l}"]`).innerText()
      expect(txt.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\s]/gu, '').length,
        `the ${l} button is icon only`).toBeGreaterThan(1)
    }
  })
})

test('clicking a flag the instant the page appears still registers (handlers are wired before the await)', async ({ page }) => {
  // No waiting at all: click while app.js is still loading the three dictionaries.
  await page.goto('/', { waitUntil: 'commit' })
  await page.locator('.flag[data-lang="en"]').click()
  await expect(page.locator('.flag[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('app')).toContainText('Where you stand')
  // and the choice must be stored, not evaporate
  expect(await page.evaluate(() => localStorage.getItem('tally.lang'))).toBe('en')
})

test('a poor fit MUST warn on screen, not only inside the JSON', async ({ page, request }) => {
  const bm = await (await request.get('/api/by-model')).json()
  await page.goto('/#analytics')
  await expect(page.getByTestId('model-table')).toBeVisible()
  if (bm.calibration.status === 'calibrated') {
    await expect(page.getByTestId('cal-warn')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('cal-warn')).toBeVisible()
  }
})

test('changing the period changes the figures: another model at 0% is the window, not a bug', async ({ page }) => {
  await page.goto('/#analytics')
  const picker = page.getByTestId('period-picker')
  await expect(picker).toBeVisible()
  await picker.locator('[data-period="5h"]').click()
  await expect(page.getByTestId('model-table')).toBeVisible()
  const five = await page.getByTestId('model-table').locator('tbody tr').count()
  await picker.locator('[data-period="all"]').click()
  await expect(picker.locator('[data-period="all"]')).toHaveAttribute('aria-pressed', 'true')
  const all = await page.getByTestId('model-table').locator('tbody tr').count()
  expect(all).toBeGreaterThanOrEqual(five)
  // under "all" the % of ceiling column disappears, because it means nothing outside the 5h window
  const heads = await page.getByTestId('model-table').locator('thead th').allInnerTexts()
  expect(heads.some((h) => /trần|ceiling|额度占比/i.test(h))).toBe(false)
})

test.describe('the grid-style activity chart', () => {
  test('the grid has cells, levels stay within 0 to 5, and no cell falls outside the data range', async ({ page, request }) => {
    const act = await (await request.get('/api/activity?days=365')).json()
    await page.goto('/#analytics')
    const cells = page.getByTestId('activity').locator('.ghcell[data-day]')
    await expect(cells.first()).toBeVisible()
    const n = await cells.count()
    expect(n).toBeGreaterThan(act.lanes.length)      // empty days sit in between
    const steps = await cells.evaluateAll((els) => [...new Set(els.map((e) => e.dataset.i))])
    for (const s of steps) expect(Number(s)).toBeGreaterThanOrEqual(0)
    for (const s of steps) expect(Number(s)).toBeLessThanOrEqual(5)
    expect(steps.length, 'every cell at one level means a dead scale').toBeGreaterThan(1)
  })

  test('clicking a day opens the rhythm inside that day', async ({ page }) => {
    await page.goto('/#analytics')
    const active = page.getByTestId('activity').locator('.ghcell[data-day]:not([aria-disabled])')
    await expect(active.first()).toBeVisible()
    await active.last().click()
    const detail = page.getByTestId('day-detail')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.frag').first()).toBeVisible()
  })
})

test.describe('the Summary page', () => {
  test('all five blocks are present and every one carries a provenance label', async ({ page }) => {
    await page.goto('/#summary')
    await expect(page.getByTestId('summary-page')).toBeVisible()
    const app = page.getByTestId('app')
    for (const h of ['Đang ở đâu', 'Tiêu vào đâu', 'Làm việc kiểu gì', 'Lãng phí chỗ nào']) {
      await expect(app).toContainText(h)
    }
    expect(await app.locator('.tag--in, .tag--out').count()).toBeGreaterThan(2)
  })

  test('model-inferred blocks MUST carry a sample size, measured ones must not', async ({ page }) => {
    await page.goto('/#summary')
    await expect(page.getByTestId('summary-page')).toBeVisible()
    const llm = page.getByTestId('app').locator('.tag.llm').first()
    if (await llm.count()) await expect(llm).toContainText(/cỡ mẫu \d+\/\d+/)
    await expect(page.getByTestId('app').locator('.tag.det').first()).not.toContainText(/cỡ mẫu/)
  })
})

test('the dashboard shows EVERY finding, numbered from 1 with no gaps', async ({ page, request }) => {
  const fd = await (await request.get('/api/findings')).json()
  await page.goto('/#dashboard')
  const list = page.getByTestId('findings-list')
  await expect(list).toBeVisible()
  expect(await list.locator('.finding').count()).toBe(fd.findings.length)
  const ranks = await list.locator('.finding .rank').allInnerTexts()
  expect(ranks.map(Number)).toEqual(fd.findings.map((_, i) => i + 1))
})

test.describe('Insight: analysis, not a list of names', () => {
  test('every figure carries ONE explanatory sentence, and without one the figure is not shown', async ({ page }) => {
    await page.goto('/#insight')
    const readings = page.locator('.reading')
    await expect(readings.first()).toBeVisible()
    const n = await readings.count()
    expect(n).toBeGreaterThan(5)
    for (let i = 0; i < n; i += 1) {
      const r = readings.nth(i)
      await expect(r.locator('.rval'), `reading ${i} has no figure`).toHaveCount(1)
      await expect(r.locator('.rlabel'), `reading ${i} has no label`).toHaveCount(1)
      const mean = (await r.locator('.rmean').innerText()).trim()
      expect(mean.length, `reading ${i} has a figure but no explanation`).toBeGreaterThan(10)
    }
  })

  test('no i18n key leaks to the screen as a key name', async ({ page }) => {
    for (const hash of ['', '#analytics', '#sessions', '#insight', '#summary']) {
      await page.goto('/' + hash)
      await expect(page.getByTestId('app')).not.toBeEmpty()
      const txt = await page.getByTestId('app').innerText()
      const leaked = txt.match(/\b(an|in|read|sum|sess|dash|find|sev|fr|frm|scope|state|common)\.[a-zA-Z][\w.]*/g)
      expect(leaked, `${hash || '/'} leaked a translation key`).toBeNull()
    }
  })

  test('raw name lists are FOLDED AWAY instead of hitting the reader', async ({ page }) => {
    await page.goto('/#insight')
    const raw = page.locator('details.raw')
    await expect(raw.first()).toBeVisible()      // count() does not auto-wait
    const n = await raw.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i += 1) {
      expect(await raw.nth(i).evaluate((d) => d.open), 'the raw list must start closed').toBe(false)
    }
  })
})

test.describe('session scope', () => {
  test('the active filter changes the session count, and the definition is stated', async ({ page, request }) => {
    const all = await (await request.get('/api/sessions?scope=all&limit=5')).json()
    await page.goto('/#sessions')
    await expect(page.getByTestId('session-table')).toBeVisible()
    await expect(page.getByTestId('app')).toContainText(String(all.active_within_min))
    await page.getByTestId('sess-filter').locator('[data-filter="active"]').click()
    await expect(page.getByTestId('sess-filter').locator('[data-filter="active"]'))
      .toHaveAttribute('aria-pressed', 'true')
  })

  test('picking one session shows the scope bar and offers a way out', async ({ page }) => {
    await page.goto('/#sessions')
    await expect(page.getByTestId('session-table')).toBeVisible()
    await page.getByTestId('session-table').locator('tbody tr').first()
      .getByRole('button').click()
    const bar = page.getByTestId('scopebar')
    await expect(bar).toBeVisible()
    await page.getByTestId('scope-clear').click()
    await expect(bar).toBeHidden()
  })

  test('filtering to one session MUST shrink the figures, it is not decoration', async ({ page, request }) => {
    const ss = await (await request.get('/api/sessions?scope=all&limit=3')).json()
    const one = ss.rows[0].session_id
    const all = await (await request.get('/api/by-model?period=all')).json()
    const scoped = await (await request.get(`/api/by-model?period=all&scope=${one}`)).json()
    expect(scoped.events).toBeLessThan(all.events)
    expect(scoped.events).toBe(ss.rows[0].requests)
  })
})

test('the over-time table MUST match the API: a table of zeroes is a table that lies', async ({ page, request }) => {
  const api = await (await request.get('/api/buckets?grain=day')).json()
  await page.goto('/#analytics')
  const table = page.getByTestId('time-table')
  await expect(table.locator('tbody tr').first()).toBeVisible()
  // The API returns oldest to newest and the table renders newest first, so match BY DAY, never by position.
  const cells = await table.locator('tbody tr').first().locator('td').allInnerTexts()
  const day = cells[0]!.trim()
  const row = api.rows.find((r: { key: string }) => r.key === day)
  expect(row, `the API has no day ${day}`).toBeTruthy()
  expect(row.output, 'the underlying data must have tokens, otherwise this test means nothing').toBeGreaterThan(0)
  const digits = (s: string) => s.replace(/[^\d]/g, '')
  expect(cells.some((c) => digits(c) === String(row.events)), 'the request count is missing').toBe(true)
  expect(cells.some((c) => digits(c) === String(row.output)), 'the output column does not match the API').toBe(true)
  // and there must be no fake "0" cell caused by reading the wrong field name
  expect(cells.filter((c) => c.trim() === '0').length, 'a suspicious 0 cell').toBe(0)
})

test.describe('behaviour analysis', () => {
  test('the "who is actually typing" block comes BEFORE any other tool ratio', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    expect(bh.total).toBeGreaterThan(0)
    await page.goto('/#insight')
    const app = page.getByTestId('app')
    await expect(app).toContainText(String(Math.round(bh.not_hand_driven_pct)))
    const txt = await app.innerText()
    // the subagent warning has to appear before the shell command table, or the reader
    // takes subagent behaviour for their own
    expect(txt.indexOf('gõ')).toBeLessThan(txt.indexOf('Lệnh shell'))
  })

  test('the three-lane table has all three rows, and the percentages match the API', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    expect(bh.lanes).toHaveLength(3)
    await page.goto('/#insight')
    const table = page.getByTestId('lane-table')
    await expect(table.getByTestId('lane-hand')).toBeVisible()
    await expect(table.getByTestId('lane-job')).toBeVisible()
    await expect(table.getByTestId('lane-sub')).toBeVisible()
    const job = bh.lanes.find((l: { lane: string }) => l.lane === 'job')
    // The page renders numbers in Vietnamese, where the decimal separator is a comma.
    await expect(table.getByTestId('lane-job')).toContainText(job.pct.toFixed(1).replace('.', ','))
  })

  test('the unattended-runs warning comes before the shell command table', async ({ page }) => {
    await page.goto('/#insight')
    const app = page.getByTestId('app')
    await expect(app.getByTestId('lane-table')).toBeVisible()
    const txt = await app.innerText()
    expect(txt.indexOf('Máy tự chạy')).toBeGreaterThan(-1)
    expect(txt.indexOf('Máy tự chạy')).toBeLessThan(txt.indexOf('Lệnh shell'))
  })

  test('verb groups: the percentages never exceed 100 and match the API', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    const sum = bh.by_verb_group.reduce((s: number, g: { pct: number }) => s + g.pct, 0)
    expect(sum).toBeLessThanOrEqual(100.5)
    await page.goto('/#insight')
    await expect(page.getByTestId('verb-group-table')).toBeVisible()
    const rows = await page.getByTestId('verb-group-table').locator('tbody tr').count()
    expect(rows).toBe(bh.by_verb_group.length)
  })

  test('an MCP server from a plugin is marked differently from a self-installed one', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    await page.goto('/#insight')
    const table = page.getByTestId('mcp-table')
    await expect(table.locator('tbody tr').first()).toBeVisible()
    expect(await table.locator('tbody tr').count()).toBe(bh.mcp.length)
    if (bh.mcp.some((m: { from_plugin: boolean }) => m.from_plugin)) {
      await expect(table.locator('.tag--on').first()).toBeVisible()
    }
  })

  test('friction shows a percentage AND a count, and never exceeds 100%', async ({ page }) => {
    await page.goto('/#insight')
    const cards = page.locator('[data-testid^="friction-"]')
    if (await cards.count() === 0) test.skip()
    await expect(cards.first()).toBeVisible()
    for (let i = 0; i < await cards.count(); i += 1) {
      const val = await cards.nth(i).locator('.rval').innerText()
      const n = Number(val.replace(/[^\d]/g, ''))
      expect(n, `${val} is over 100%`).toBeLessThanOrEqual(100)
      await expect(cards.nth(i).locator('.tag'), 'the count next to the percentage is missing').toContainText('/')
    }
  })
})

test.describe('asking Claude to explain', () => {
  test('the dialog asks for LANGUAGE and DEPTH before running, and states the price', async ({ page }) => {
    await page.goto('/#insight')
    await page.getByTestId('insight-analyze').click()
    const dlg = page.getByTestId('consent-dialog')
    await expect(dlg).toBeVisible()
    await expect(page.getByTestId('ex-lang')).toBeVisible()
    await expect(page.getByTestId('ex-depth')).toBeVisible()
    await expect(page.getByTestId('consent-cost')).toContainText(/credits/)
    // changing the depth has to change the figure, it is not a decorative label
    const a = await page.getByTestId('consent-cost').innerText()
    await page.getByTestId('ex-depth').locator('[data-exdepth="full"]').click()
    await expect(page.getByTestId('consent-cost')).not.toHaveText(a)
  })

  test('GET gives 405 and POST without a token gives 401: the second write route follows the same rules', async ({ request }) => {
    expect((await request.get('/api/explain/run')).status()).toBe(405)
    expect((await request.post('/api/explain/run')).status()).toBe(401)
  })

  test('a dry run reports the price without spending anything', async ({ page, request }) => {
    await page.goto('/')
    const token = await page.locator('meta[name="tally-token"]').getAttribute('content')
    const r = await request.post('/api/explain/run?lang=zh&depth=full&dry_run=1', {
      headers: { 'x-tally-token': token! },
    })
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.dry_run).toBe(true)
    expect(j.lang).toBe('zh')
    expect(j.depth).toBe('full')
    expect(j.prompt_chars).toBeGreaterThan(100)
  })
})
