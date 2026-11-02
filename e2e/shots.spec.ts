import { test, expect } from '@playwright/test'
const DIR = process.env.SHOT_DIR ?? 'test-results'

// Chờ ĐÚNG thứ cần có trên mỗi trang, không chờ theo đồng hồ. waitForTimeout(700)
// từng chụp đúng chữ "đang tải…" khi trang chậm hơn con số đoán bừa đó.
const READY = { dashboard: 'stat-dash.fiveHour', analytics: 'activity', insight: 'insight-stats', summary: 'summary-page' } as const

test('chụp 4 trang', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tally.lang', 'vi') } catch {} })
  for (const [hash, name] of [['', 'dashboard'], ['#analytics', 'analytics'], ['#insight', 'insight'], ['#summary', 'summary']] as const) {
    await page.goto('/' + hash)
    await expect(page.getByTestId(READY[name])).toBeVisible()
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true })
  }
})
