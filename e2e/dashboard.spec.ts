import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Chromium headless báo locale en-US, nên UI tự chọn 'en'. Các khẳng định tiếng Việt
  // phải đặt ngôn ngữ TƯỜNG MINH mới xác định; việc tự nhận diện có test riêng ở dưới.
  // Chỉ đặt khi CHƯA có — nếu ghi đè mỗi lần điều hướng thì chính test sẽ xoá
  // lựa chọn tay của người dùng và làm test "giữ lựa chọn sau reload" đỏ oan.
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

test('Tổng quan: hiện hạn mức 5h/7d, gói, trần — và không lỗi console', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'true')
  const app = page.getByTestId('app')
  await expect(app).toContainText('Hạn mức 5 giờ')
  await expect(app).toContainText('Hạn mức 7 ngày')
  await expect(app).toContainText('max_20x')          // gói đọc từ ~/.claude.json
  await expect(app).toContainText('200.000')          // trần 5h, định dạng vi-VN
  noConsoleErrors(page)
})

test('điều hướng 3 trang bằng tab, mỗi tab có chữ kèm icon (không icon trần)', async ({ page }) => {
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

test('Phân tích: bảng model có credits + % trần + USD, dữ liệu thật', async ({ page }) => {
  await page.goto('/#analytics')
  const tbl = page.getByTestId('model-table')
  await expect(tbl).toBeVisible()
  await expect(tbl).toContainText('claude-')
  const rows = tbl.locator('tbody tr')
  expect(await rows.count()).toBeGreaterThan(0)
  // 5 ô: model · credits 5h · % trần · credits trọn đời · USD.
  // Credits 5h và % trần phải cùng một cửa sổ; credits trọn đời là cột RIÊNG,
  // không được đặt cạnh % trần mà không nói nó thuộc cửa sổ khác.
  // 5h: model · credits khoảng · phần trăm dùng · % trần · tổng · USD = 6 ô.
  const cells = await rows.first().locator('td').allInnerTexts()
  expect(cells).toHaveLength(6)
  expect(cells[2], 'phần trăm dùng').toMatch(/(%|—)$/)
  expect(cells[3], '% trần 5h').toMatch(/(%|—)$/)
  expect(cells[5], 'USD').toMatch(/^\$/)
  noConsoleErrors(page)
})

test('Phân tích: đổi mức thời gian giờ/ngày/tháng/năm đều render', async ({ page }) => {
  await page.goto('/#analytics')
  const sel = page.getByTestId('grain-select')
  for (const g of ['hour', 'month', 'year', 'day']) {
    await sel.selectOption(g)
    // Dải cột theo ngày đã được THAY bằng nhật ký phân mảnh (yêu cầu của người dùng,
    // ghi trong stamp). Kiểm đối tượng mới, và kiểm chặt hơn cái cũ.
    await expect(page.getByTestId('activity')).toBeVisible()
    await expect(sel).toHaveValue(g)
  }
  noConsoleErrors(page)
})

test('Phân tích: heatmap có 7 hàng × (1 nhãn + 24 ô)', async ({ page }) => {
  await page.goto('/#analytics')
  const heat = page.getByTestId('heatmap')
  await expect(heat).toBeVisible()
  expect(await heat.locator('.cell').count()).toBe(7 * 24)
  expect(await heat.locator('.lbl').count()).toBe(7)
  noConsoleErrors(page)
})

test('Insight: số liệu có NHÃN NGUỒN và cỡ mẫu (DD-13b, DD-17)', async ({ page }) => {
  await page.goto('/#insight')
  const app = page.getByTestId('app')
  await expect(app).toContainText('Đo được')          // nhãn tất định
  await expect(app).toContainText('Claude suy luận')  // nhãn LLM
  await expect(app).toContainText('cỡ mẫu')           // cỡ mẫu bắt buộc
  const llm = app.locator('.tag.llm').first()
  await expect(llm).toContainText(/cỡ mẫu \d+\/\d+/)  // dạng mẫu/dân số
  noConsoleErrors(page)
})

test('Insight: bấm Phân tích lại PHẢI hỏi trước, nêu credits + % trần + giây', async ({ page }) => {
  await page.goto('/#insight')
  await expect(page.getByTestId('consent-dialog')).not.toBeVisible()
  await page.getByTestId('insight-analyze').click()
  const dlg = page.getByTestId('consent-dialog')
  await expect(dlg).toBeVisible()
  // Hộp thoại giờ chia làm hai thẻ: việc gì ở #consent-body, giá ở #consent-cost.
  // Ràng buộc là HỘP THOẠI phải nói đủ bốn thứ, không phải một thẻ cụ thể nào —
  // kiểm cả hộp thì layout đổi được mà lời hứa vẫn bị canh.
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

test('i18n: đổi cờ vi → zh → en đổi được nội dung và giữ lựa chọn tay', async ({ page }) => {
  await page.goto('/')
  await page.locator('.flag[data-lang="vi"]').click()
  await page.locator('.flag[data-lang="zh"]').click()
  await expect(page.getByTestId('app')).toContainText('5 小时额度')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
  await page.locator('.flag[data-lang="en"]').click()
  await expect(page.getByTestId('app')).toContainText('5-hour limit')
  // tải lại: lựa chọn TAY không bị ghi đè
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('.flag[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true')
  noConsoleErrors(page)
})

test('i18n: hộp xin phép cũng theo ngôn ngữ đang chọn', async ({ page }) => {
  await page.goto('/')
  await page.locator('.flag[data-lang="en"]').click()
  await page.getByTestId('tab-insight').click()
  await page.getByTestId('insight-analyze').click()
  // innerText() đọc MỘT LẦN, không tự chờ — y như .count(). Khẳng định tự chờ
  // vừa đúng hơn vừa chặt hơn: nó vẫn đỏ nếu nội dung sai, chỉ thôi đỏ vì chậm.
  const dlg = page.getByTestId('consent-dialog')
  await expect(dlg).toContainText('your own plan quota')
  await expect(dlg).toContainText(/5-hour ceiling/)
})

test('riêng tư: trang KHÔNG gọi ra bất kỳ host nào ngoài chính nó', async ({ page }) => {
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

test('API chỉ GET — POST bị chặn 405', async ({ request }) => {
  const r = await request.post('/api/now')
  expect(r.status()).toBe(405)
})

test('API trả đúng hình dạng và trần gói đọc được', async ({ request }) => {
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


test('i18n: không có lựa chọn đã lưu ⇒ tự nhận từ navigator.language', async ({ browser }) => {
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

test('% trần 5h phải HỢP LÝ: tính trên cửa sổ 5 giờ, không phải toàn thời gian', async ({ request }) => {
  const bm = await (await request.get('/api/by-model')).json()
  // Trước khi sửa, cột này ra 10.853% vì chia credits toàn thời gian cho trần 5 giờ.
  for (const r of bm.rows) {
    if (r.pct_of_ceiling === null) continue
    expect(r.pct_of_ceiling, `${r.model} vượt 100% trần 5h`).toBeLessThanOrEqual(100)
  }
  const total = bm.rows.reduce((s: number, r: { pct_of_ceiling: number | null }) => s + (r.pct_of_ceiling ?? 0), 0)
  expect(total).toBeLessThanOrEqual(100)
  // và phải dùng giả thuyết ĐÃ HIỆU CHUẨN, không phải 'all' cứng
  expect(bm.hypothesis).toBe(bm.calibration.hypothesis)
  expect(bm.window.events).toBeLessThanOrEqual(bm.events)
})

test('đỉnh cửa sổ 5h cùng BẬC ĐỘ LỚN với trần (chặn lỗi phóng đại ~200 lần)', async ({ request }) => {
  const bk = await (await request.get('/api/buckets?grain=day')).json()
  expect(bk.ceiling).toBe(200000)
  // Đây là cổng chống lớp bug "dùng giả thuyết 'all'" (từng cho 4.165.944 = 20x trần).
  // KHÔNG phải khẳng định đỉnh ≤ trần: một cửa sổ nặng thật sự có thể vượt, và khi đó
  // ước lượng là NGOẠI SUY — xem test dưới.
  expect(bk.peak_5h).toBeLessThan(bk.ceiling * 10)
})

test('đỉnh vượt xa mức đã hiệu chuẩn PHẢI được đánh dấu là ngoại suy', async ({ request }) => {
  const fd = await (await request.get('/api/findings')).json()
  const ceil = fd.findings.find((f: { id: string }) => f.id === 'CEILING_RISK')
  if (!ceil || !fd.calibration?.fitted_on_credits) test.skip()
  if (ceil.metric.peak_credits > fd.calibration.fitted_on_credits * 3) {
    expect(ceil.metric.extrapolated).toBeTruthy()
  }
})

test('giả thuyết credits chỉ có MỘT nguồn: findings phải dùng đúng cái đã hiệu chuẩn', async ({ request }) => {
  const [bm, bk, fd] = await Promise.all([
    (await request.get('/api/by-model')).json(),
    (await request.get('/api/buckets?grain=day')).json(),
    (await request.get('/api/findings')).json(),
  ])
  // Trước khi sửa, findings.ts hardcode 'all' nên damage phóng đại ~200 lần.
  expect(fd.hypothesis).toBe(bm.calibration.hypothesis)
  expect(bk.hypothesis).toBe(bm.calibration.hypothesis)
})

test('hiệu chuẩn đạt được độ chính xác thật trên dữ liệu máy này', async ({ request }) => {
  const bm = await (await request.get('/api/by-model')).json()
  const c = bm.calibration
  // 'stale_index' là kết quả HỢP LỆ: index cũ hơn mốc chụp hạn mức ⇒ không được chốt.
  if (c.status !== 'calibrated') {
    expect(['low_signal', 'no_data', 'stale_index', 'no_ceiling', 'poor_fit']).toContain(c.status)
    if (c.status === 'poor_fit') expect(c.error_pct).not.toBeNull()
    else expect(c.error_pct).toBeNull()
    return
  }
  // nằm trong dải lượng tử hoá của một pct nguyên, hoặc lệch dưới 10%
  expect(c.within_quantization || Math.abs(c.error_pct) < 10).toBe(true)
})

test('bấm tab liên tiếp rất nhanh: nội dung cuối PHẢI khớp tab cuối (chống đua render)', async ({ page }) => {
  await page.goto('/')
  // không await giữa các lần bấm — ép nhiều render chạy chồng nhau
  await page.getByTestId('tab-analytics').click()
  await page.getByTestId('tab-insight').click()
  await page.getByTestId('tab-analytics').click()
  await page.getByTestId('tab-insight').click()
  await expect(page.getByTestId('app')).toContainText('Bạn dùng Claude thế nào')
  await expect(page.getByTestId('app')).not.toContainText('Theo model')
  await expect(page.getByTestId('tab-insight')).toHaveAttribute('aria-selected', 'true')
})

test('đỉnh 5h KHÔNG chắc chắn PHẢI mang nhãn trên màn hình, không chỉ trong JSON', async ({ page, request }) => {
  const bk = await (await request.get('/api/buckets?grain=day')).json()
  const fd = await (await request.get('/api/findings')).json()
  await page.goto('/#analytics')
  // Hai lý do khiến con số đỉnh không chắc, và CẢ HAI đều phải hiện nhãn: đỉnh
  // nặng hơn nhiều lần cửa sổ đã khớp, HOẶC chưa khớp được lần nào. Chỉ canh vế
  // đầu là bỏ lọt đúng trường hợp con số đáng ngờ nhất.
  const unsure = bk.peak_extrapolated || fd.calibration.status !== 'calibrated'
  if (unsure) {
    await expect(page.getByTestId('peak-extrapolated')).toBeVisible()
  } else {
    await expect(page.getByTestId('peak-extrapolated')).toHaveCount(0)
  }
})

test.describe('đường GHI duy nhất: /api/insight/refresh', () => {
  test('GET bị từ chối 405 — đây là đường POST', async ({ request }) => {
    expect((await request.get('/api/insight/refresh')).status()).toBe(405)
  })

  test('POST KHÔNG có token ⇒ 401, không chạy gì', async ({ request }) => {
    const r = await request.post('/api/insight/refresh')
    expect(r.status()).toBe(401)
  })

  test('POST sai token ⇒ 401', async ({ request }) => {
    const r = await request.post('/api/insight/refresh', { headers: { 'x-tally-token': 'bay-gio-doan-bua' } })
    expect(r.status()).toBe(401)
  })

  test('token chỉ nhúng trong trang phục vụ tại chỗ, và dry_run xác thực được mà KHÔNG tốn quota', async ({ page, request }) => {
    await page.goto('/')
    const tok = await page.locator('meta[name="tally-token"]').getAttribute('content')
    expect(tok).toMatch(/^[0-9a-f-]{36}$/)
    // dry_run: qua được cổng token nhưng KHÔNG spawn claude
    const r = await request.post('/api/insight/refresh?dry_run=1', { headers: { 'x-tally-token': tok! } })
    expect(r.status()).toBe(200)
    const j = await r.json()
    expect(j.dry_run).toBe(true)
    expect(j.measured.credits).toBeGreaterThan(0)
    expect(j.pct_of_ceiling).toBeGreaterThan(0)
  })

  test('mỗi lần khởi động server sinh token MỚI (không phải hằng số trong mã)', async ({ page }) => {
    await page.goto('/')
    const a = await page.locator('meta[name="tally-token"]').getAttribute('content')
    expect(a).toBeTruthy()
    // token không được nằm trong file tĩnh nào
    const js = await (await page.request.get('/app.js')).text()
    expect(js).not.toContain(a!)
  })

  test('không còn đường ghi nào khác: POST tới các endpoint đọc vẫn 405', async ({ request }) => {
    for (const ep of ['/api/now', '/api/by-model', '/api/findings', '/api/insight']) {
      expect((await request.post(ep)).status(), ep).toBe(405)
    }
  })
})

test('Phân tích: bảng theo dự án có phần subagent', async ({ page }) => {
  await page.goto('/#analytics')
  const tbl = page.getByTestId('project-table')
  await expect(tbl).toBeVisible()
  expect(await tbl.locator('tbody tr').count()).toBeGreaterThan(0)
  const cells = await tbl.locator('tbody tr').first().locator('td').allInnerTexts()
  expect(cells).toHaveLength(4)
  expect(cells[2]).toMatch(/^\$/)
  expect(cells[3]).toMatch(/(%|—)$/)
})

test('không bật --redact ⇒ KHÔNG gắn nhãn ẩn danh (cổng đúng ở đầu âm)', async ({ page }) => {
  await page.goto('/#analytics')
  await expect(page.getByTestId('project-table')).toBeVisible()
  await expect(page.getByTestId('redacted-tag')).toHaveCount(0)
})

test('nút "Mở báo cáo gốc" phải MỞ ĐƯỢC báo cáo, không phải href="#"', async ({ page, request }) => {
  await page.goto('/#insight')
  const btn = page.getByTestId('open-report')
  if (await btn.count() === 0) return   // máy chưa chạy /insights bao giờ
  const href = await btn.getAttribute('href')
  expect(href, 'href="#" sẽ xoá hash và ném người dùng về trang Tổng quan').not.toBe('#')
  const r = await request.get(href!)
  expect(r.status()).toBe(200)
  expect((await r.text()).toLowerCase()).toContain('<html')
})

test('không đọc được trần ⇒ thẻ trần hiện "—", KHÔNG hiện 0', async ({ page }) => {
  await page.route('**/api/now', async (route) => {
    const r = await route.fetch()
    const j = await r.json()
    j.plan.ceiling = null
    await route.fulfill({ json: j })
  })
  await page.goto('/#dashboard')
  const card = page.getByTestId('stat-dash.ceiling')
  await expect(card).toBeVisible()
  await expect(card).toContainText('—')
  await expect(card).not.toContainText(/\b0\b\s*credits/)
})

test('con số ĐỈNH không được gọi là "tiết kiệm" ở BẤT KỲ đâu (web phải khớp CLI)', async ({ page, request }) => {
  const fd = await (await request.get('/api/findings')).json()
  const peak = fd.findings.find((f) => f.damage_kind === 'peak')
  await page.goto('/#dashboard')
  if (!peak) { expect(fd.findings.every((f) => f.damage_kind)).toBe(true); return }
  const card = page.getByTestId(`finding-${peak.id}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText('đỉnh đo được')
  await expect(card).not.toContainText('tiết kiệm')
})

test('mọi phát hiện API trả về đều khai damage_kind', async ({ request }) => {
  const fd = await (await request.get('/api/findings')).json()
  expect(fd.findings.length).toBeGreaterThan(0)
  for (const f of fd.findings) {
    expect(['saving', 'peak', 'spend'], `${f.id} thiếu damage_kind`).toContain(f.damage_kind)
  }
})

test.describe('signature: nhật ký hoạt động dạng mảnh', () => {
  test('mỗi mảnh nằm ĐÚNG trong làn (0–100%) và có bề rộng nhìn thấy được', async ({ page }) => {
    await page.goto('/#analytics')
    const frags = page.getByTestId('day-detail').locator('.frag')
    await expect(frags.first()).toBeVisible()   // count() KHÔNG tự chờ
    const n = await frags.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < Math.min(n, 40); i += 1) {
      const st = await frags.nth(i).getAttribute('style')
      const left = Number(/left:([\d.]+)%/.exec(st)![1])
      const width = Number(/width:([\d.]+)%/.exec(st)![1])
      expect(left, 'mảnh tràn ra ngoài ngày').toBeGreaterThanOrEqual(0)
      expect(left + width, 'mảnh vượt quá 24 giờ').toBeLessThanOrEqual(100.01)
      expect(width, 'mảnh mỏng tới mức vô hình').toBeGreaterThan(0)
    }
  })

  test('mảnh khớp đúng số liệu API, không phải hình vẽ trang trí', async ({ page, request }) => {
    const act = await (await request.get('/api/activity?days=365')).json()
    await page.goto('/#analytics')
    await expect(page.getByTestId('day-detail').locator('.frag').first()).toBeVisible()
    const drawn = await page.getByTestId('day-detail').locator('.frag').count()
    // Chi tiết hiện NGÀY GẦN NHẤT ⇒ so với số mảnh của đúng ngày đó.
    const last = act.lanes[act.lanes.length - 1]
    expect(drawn).toBe(last.fragments.length)
  })

  test('cường độ chỉ dùng MỘT sắc: thang 1–5 trên cùng một hue', async ({ page }) => {
    await page.goto('/#analytics')
    await expect(page.getByTestId('day-detail').locator('.frag').first()).toBeVisible()
    const idx = await page.getByTestId('day-detail').locator('.frag').evaluateAll(
      (els) => [...new Set(els.map((e) => e.dataset.i))].sort())
    for (const i of idx) expect(['1', '2', '3', '4', '5']).toContain(i)
    // Thang phải THỰC SỰ phân biệt: một thang mà mọi mảnh cùng một bậc là thang chết.
    expect(idx.length, 'mọi mảnh cùng một bậc ⇒ thang cường độ vô dụng').toBeGreaterThan(1)
  })

  test('nút cờ có CHỮ, không phải icon trần', async ({ page }) => {
    await page.goto('/')
    for (const l of ['vi', 'zh', 'en']) {
      const txt = await page.locator(`.flag[data-lang="${l}"]`).innerText()
      expect(txt.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\s]/gu, '').length,
        `nút ${l} chỉ có biểu tượng`).toBeGreaterThan(1)
    }
  })
})

test('bấm cờ NGAY khi trang vừa hiện vẫn ăn (handler phải gắn trước await)', async ({ page }) => {
  // Không chờ gì cả: bấm ngay trong khoảng app.js còn đang nạp 3 từ điển.
  await page.goto('/', { waitUntil: 'commit' })
  await page.locator('.flag[data-lang="en"]').click()
  await expect(page.locator('.flag[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('app')).toContainText('Where you stand')
  // và lựa chọn phải được ghi lại, không bốc hơi
  expect(await page.evaluate(() => localStorage.getItem('tally.lang'))).toBe('en')
})

test('khớp kém PHẢI hiện cảnh báo trên màn hình, không chỉ nằm trong JSON', async ({ page, request }) => {
  const bm = await (await request.get('/api/by-model')).json()
  await page.goto('/#analytics')
  await expect(page.getByTestId('model-table')).toBeVisible()
  if (bm.calibration.status === 'calibrated') {
    await expect(page.getByTestId('cal-warn')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('cal-warn')).toBeVisible()
  }
})

test('đổi khoảng xem đổi được số liệu — model khác 0% chỉ vì cửa sổ, không phải lỗi', async ({ page }) => {
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
  // ở "tất cả" thì cột % trần biến mất vì nó vô nghĩa ngoài cửa sổ 5 giờ
  const heads = await page.getByTestId('model-table').locator('thead th').allInnerTexts()
  expect(heads.some((h) => /trần|ceiling|额度占比/i.test(h))).toBe(false)
})

test.describe('biểu đồ hoạt động kiểu lưới', () => {
  test('lưới có ô, bậc nằm trong 0–5, và không ô nào nằm ngoài vùng đã có dữ liệu', async ({ page, request }) => {
    const act = await (await request.get('/api/activity?days=365')).json()
    await page.goto('/#analytics')
    const cells = page.getByTestId('activity').locator('.ghcell[data-day]')
    await expect(cells.first()).toBeVisible()
    const n = await cells.count()
    expect(n).toBeGreaterThan(act.lanes.length)      // có cả ngày trống xen giữa
    const steps = await cells.evaluateAll((els) => [...new Set(els.map((e) => e.dataset.i))])
    for (const s of steps) expect(Number(s)).toBeGreaterThanOrEqual(0)
    for (const s of steps) expect(Number(s)).toBeLessThanOrEqual(5)
    expect(steps.length, 'mọi ô cùng một bậc ⇒ thang chết').toBeGreaterThan(1)
  })

  test('bấm một ngày mở được nhịp trong ngày đó', async ({ page }) => {
    await page.goto('/#analytics')
    const active = page.getByTestId('activity').locator('.ghcell[data-day]:not([aria-disabled])')
    await expect(active.first()).toBeVisible()
    await active.last().click()
    const detail = page.getByTestId('day-detail')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.frag').first()).toBeVisible()
  })
})

test.describe('trang Tóm tắt', () => {
  test('có đủ năm khối và mọi khối đều mang nhãn nguồn', async ({ page }) => {
    await page.goto('/#summary')
    await expect(page.getByTestId('summary-page')).toBeVisible()
    const app = page.getByTestId('app')
    for (const h of ['Đang ở đâu', 'Tiêu vào đâu', 'Làm việc kiểu gì', 'Lãng phí chỗ nào']) {
      await expect(app).toContainText(h)
    }
    expect(await app.locator('.tag--in, .tag--out').count()).toBeGreaterThan(2)
  })

  test('phần Claude suy luận PHẢI kèm cỡ mẫu, phần đo được thì không', async ({ page }) => {
    await page.goto('/#summary')
    await expect(page.getByTestId('summary-page')).toBeVisible()
    const llm = page.getByTestId('app').locator('.tag.llm').first()
    if (await llm.count()) await expect(llm).toContainText(/cỡ mẫu \d+\/\d+/)
    await expect(page.getByTestId('app').locator('.tag.det').first()).not.toContainText(/cỡ mẫu/)
  })
})

test('Tổng quan hiện ĐỦ phát hiện, đánh số ưu tiên liên tục từ 1', async ({ page, request }) => {
  const fd = await (await request.get('/api/findings')).json()
  await page.goto('/#dashboard')
  const list = page.getByTestId('findings-list')
  await expect(list).toBeVisible()
  expect(await list.locator('.finding').count()).toBe(fd.findings.length)
  const ranks = await list.locator('.finding .rank').allInnerTexts()
  expect(ranks.map(Number)).toEqual(fd.findings.map((_, i) => i + 1))
})

test.describe('Thói quen dùng: phân tích, không phải danh sách tên', () => {
  test('mỗi con số đều kèm MỘT CÂU giải thích, không có câu thì không hiện số', async ({ page }) => {
    await page.goto('/#insight')
    const readings = page.locator('.reading')
    await expect(readings.first()).toBeVisible()
    const n = await readings.count()
    expect(n).toBeGreaterThan(5)
    for (let i = 0; i < n; i += 1) {
      const r = readings.nth(i)
      await expect(r.locator('.rval'), `thẻ ${i} thiếu con số`).toHaveCount(1)
      await expect(r.locator('.rlabel'), `thẻ ${i} thiếu nhãn`).toHaveCount(1)
      const mean = (await r.locator('.rmean').innerText()).trim()
      expect(mean.length, `thẻ ${i} có số mà không có câu giải thích`).toBeGreaterThan(10)
    }
  })

  test('không khoá i18n nào lọt ra màn hình dưới dạng tên khoá', async ({ page }) => {
    for (const hash of ['', '#analytics', '#sessions', '#insight', '#summary']) {
      await page.goto('/' + hash)
      await expect(page.getByTestId('app')).not.toBeEmpty()
      const txt = await page.getByTestId('app').innerText()
      const leaked = txt.match(/\b(an|in|read|sum|sess|dash|find|sev|fr|frm|scope|state|common)\.[a-zA-Z][\w.]*/g)
      expect(leaked, `${hash || '/'} lộ khoá dịch`).toBeNull()
    }
  })

  test('danh sách tên thô bị GẬP LẠI, không đập vào mắt', async ({ page }) => {
    await page.goto('/#insight')
    const raw = page.locator('details.raw')
    await expect(raw.first()).toBeVisible()      // count() KHÔNG tự chờ
    const n = await raw.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i += 1) {
      expect(await raw.nth(i).evaluate((d) => d.open), 'danh sách thô phải đóng sẵn').toBe(false)
    }
  })
})

test.describe('phạm vi theo phiên', () => {
  test('lọc "đang chạy" đổi được số phiên, và định nghĩa được nói rõ', async ({ page, request }) => {
    const all = await (await request.get('/api/sessions?scope=all&limit=5')).json()
    await page.goto('/#sessions')
    await expect(page.getByTestId('session-table')).toBeVisible()
    await expect(page.getByTestId('app')).toContainText(String(all.active_within_min))
    await page.getByTestId('sess-filter').locator('[data-filter="active"]').click()
    await expect(page.getByTestId('sess-filter').locator('[data-filter="active"]'))
      .toHaveAttribute('aria-pressed', 'true')
  })

  test('chọn một phiên thì thanh phạm vi hiện ra và thoát được', async ({ page }) => {
    await page.goto('/#sessions')
    await expect(page.getByTestId('session-table')).toBeVisible()
    await page.getByTestId('session-table').locator('tbody tr').first()
      .getByRole('button').click()
    const bar = page.getByTestId('scopebar')
    await expect(bar).toBeVisible()
    await page.getByTestId('scope-clear').click()
    await expect(bar).toBeHidden()
  })

  test('lọc một phiên PHẢI làm số liệu nhỏ lại, không phải trang trí', async ({ page, request }) => {
    const ss = await (await request.get('/api/sessions?scope=all&limit=3')).json()
    const one = ss.rows[0].session_id
    const all = await (await request.get('/api/by-model?period=all')).json()
    const scoped = await (await request.get(`/api/by-model?period=all&scope=${one}`)).json()
    expect(scoped.events).toBeLessThan(all.events)
    expect(scoped.events).toBe(ss.rows[0].requests)
  })
})

test('bảng theo thời gian PHẢI khớp số API — bảng toàn số 0 là bảng nói dối', async ({ page, request }) => {
  const api = await (await request.get('/api/buckets?grain=day')).json()
  await page.goto('/#analytics')
  const table = page.getByTestId('time-table')
  await expect(table.locator('tbody tr').first()).toBeVisible()
  // API trả cũ→mới, bảng hiện mới→cũ: khớp theo NGÀY, đừng khớp theo vị trí.
  const cells = await table.locator('tbody tr').first().locator('td').allInnerTexts()
  const day = cells[0]!.trim()
  const row = api.rows.find((r: { key: string }) => r.key === day)
  expect(row, `API không có ngày ${day}`).toBeTruthy()
  expect(row.output, 'dữ liệu nền phải có token, nếu không thì test này vô nghĩa').toBeGreaterThan(0)
  const digits = (s: string) => s.replace(/[^\d]/g, '')
  expect(cells.some((c) => digits(c) === String(row.events)), 'thiếu số request').toBe(true)
  expect(cells.some((c) => digits(c) === String(row.output)), 'cột output không khớp API').toBe(true)
  // và không được có ô "0" giả do đọc sai tên trường
  expect(cells.filter((c) => c.trim() === '0').length, 'ô 0 đáng ngờ').toBe(0)
})

test.describe('phân tích hành vi', () => {
  test('khối "ai thật sự đang gõ" đứng TRƯỚC các tỉ lệ tool khác', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    expect(bh.total).toBeGreaterThan(0)
    await page.goto('/#insight')
    const app = page.getByTestId('app')
    await expect(app).toContainText(String(Math.round(bh.not_hand_driven_pct)))
    const txt = await app.innerText()
    // cảnh báo subagent phải xuất hiện trước bảng lệnh shell, kẻo người đọc quy
    // hành vi của subagent cho chính mình
    expect(txt.indexOf('gõ')).toBeLessThan(txt.indexOf('Lệnh shell'))
  })

  test('bảng ba làn: đủ ba dòng, và phần trăm khớp API', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    expect(bh.lanes).toHaveLength(3)
    await page.goto('/#insight')
    const table = page.getByTestId('lane-table')
    await expect(table.getByTestId('lane-hand')).toBeVisible()
    await expect(table.getByTestId('lane-job')).toBeVisible()
    await expect(table.getByTestId('lane-sub')).toBeVisible()
    const job = bh.lanes.find((l: { lane: string }) => l.lane === 'job')
    // Trang hiện số theo tiếng Việt: dấu thập phân là dấu phẩy.
    await expect(table.getByTestId('lane-job')).toContainText(job.pct.toFixed(1).replace('.', ','))
  })

  test('cảnh báo "máy tự chạy" phải đứng trước bảng lệnh shell', async ({ page }) => {
    await page.goto('/#insight')
    const app = page.getByTestId('app')
    await expect(app.getByTestId('lane-table')).toBeVisible()
    const txt = await app.innerText()
    expect(txt.indexOf('Máy tự chạy')).toBeGreaterThan(-1)
    expect(txt.indexOf('Máy tự chạy')).toBeLessThan(txt.indexOf('Lệnh shell'))
  })

  test('nhóm lệnh: phần trăm cộng lại không vượt 100 và khớp API', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    const sum = bh.by_verb_group.reduce((s: number, g: { pct: number }) => s + g.pct, 0)
    expect(sum).toBeLessThanOrEqual(100.5)
    await page.goto('/#insight')
    await expect(page.getByTestId('verb-group-table')).toBeVisible()
    const rows = await page.getByTestId('verb-group-table').locator('tbody tr').count()
    expect(rows).toBe(bh.by_verb_group.length)
  })

  test('MCP đến từ plugin được đánh dấu khác với MCP tự cài', async ({ page, request }) => {
    const bh = await (await request.get('/api/behaviour')).json()
    await page.goto('/#insight')
    const table = page.getByTestId('mcp-table')
    await expect(table.locator('tbody tr').first()).toBeVisible()
    expect(await table.locator('tbody tr').count()).toBe(bh.mcp.length)
    if (bh.mcp.some((m: { from_plugin: boolean }) => m.from_plugin)) {
      await expect(table.locator('.tag--on').first()).toBeVisible()
    }
  })

  test('"hay vướng" hiện % VÀ số, và % không bao giờ vượt 100', async ({ page }) => {
    await page.goto('/#insight')
    const cards = page.locator('[data-testid^="friction-"]')
    if (await cards.count() === 0) test.skip()
    await expect(cards.first()).toBeVisible()
    for (let i = 0; i < await cards.count(); i += 1) {
      const val = await cards.nth(i).locator('.rval').innerText()
      const n = Number(val.replace(/[^\d]/g, ''))
      expect(n, `${val} vượt 100%`).toBeLessThanOrEqual(100)
      await expect(cards.nth(i).locator('.tag'), 'thiếu số đếm kèm %').toContainText('/')
    }
  })
})

test.describe('nhờ Claude giải thích', () => {
  test('hộp thoại hỏi NGÔN NGỮ và MỨC trước khi chạy, và nói rõ giá', async ({ page }) => {
    await page.goto('/#insight')
    await page.getByTestId('insight-analyze').click()
    const dlg = page.getByTestId('consent-dialog')
    await expect(dlg).toBeVisible()
    await expect(page.getByTestId('ex-lang')).toBeVisible()
    await expect(page.getByTestId('ex-depth')).toBeVisible()
    await expect(page.getByTestId('consent-cost')).toContainText(/credits/)
    // đổi mức phải đổi con số, không phải nhãn trang trí
    const a = await page.getByTestId('consent-cost').innerText()
    await page.getByTestId('ex-depth').locator('[data-exdepth="full"]').click()
    await expect(page.getByTestId('consent-cost')).not.toHaveText(a)
  })

  test('GET bị chặn 405, POST không token 401 — đường ghi thứ hai cùng luật', async ({ request }) => {
    expect((await request.get('/api/explain/run')).status()).toBe(405)
    expect((await request.post('/api/explain/run')).status()).toBe(401)
  })

  test('thử khô cho biết giá mà KHÔNG tiêu một đồng nào', async ({ page, request }) => {
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
