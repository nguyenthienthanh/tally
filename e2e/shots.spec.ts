import { test, expect } from '@playwright/test'
const DIR = process.env.SHOT_DIR ?? 'test-results'

// Wait for the RIGHT thing on each page, never on the clock. waitForTimeout(700) once
// captured the word "loading" when the page was slower than that guess.
const READY = { dashboard: 'stat-dash.fiveHour', analytics: 'activity', insight: 'insight-stats', summary: 'summary-page' } as const

test('capture the four pages', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tally.lang', 'vi') } catch {} })
  for (const [hash, name] of [['', 'dashboard'], ['#analytics', 'analytics'], ['#insight', 'insight'], ['#summary', 'summary']] as const) {
    await page.goto('/' + hash)
    await expect(page.getByTestId(READY[name])).toBeVisible()
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true })
  }
})
