/**
 * Record the demo walkthrough that the README embeds.
 *
 * Narration drives the edit: each scene dwells for exactly as long as its voice line
 * (`/tmp/tally-video/vo-NN.mp3`, probed by scripts/make-demo.sh) plus a short pad, so the
 * audio track can be concatenated with the same pads and muxed on without drift.
 *
 * Captions are injected INTO the page rather than burned in by ffmpeg afterwards. The page
 * knows exactly when a scroll lands; a timestamp guessed outside the browser does not.
 *
 * Usage: node scripts/make-demo.mjs <port> <scene-durations-json> <out-dir>
 */
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [port, timingsPath, outDir] = process.argv.slice(2)
const timings = JSON.parse(readFileSync(timingsPath, 'utf8'))
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The schedule is absolute, not a chain of sleeps.
 *
 * A page load or a smooth scroll takes a few hundred milliseconds of its own, and a chain of
 * relative sleeps hands every one of them to the next scene. The voice track knows nothing
 * about that drift, so by the closing card the words land a second late. `until` absorbs the
 * overhead inside the scene it happened in: each scene ends at its planned mark.
 */
let t0 = 0
const until = (ms) => sleep(Math.max(0, t0 + ms - Date.now()))

const OVERLAY = `
#demo-cap {
  position: fixed; left: 48px; right: 48px; bottom: 28px; z-index: 9999;
  background: var(--color-paper-3); color: var(--color-ink);
  border-left: 3px solid var(--color-accent); padding: 14px 20px;
  font-family: var(--font-body); font-size: 19px; line-height: 1.4; max-width: 64%;
  opacity: 0; transition: opacity 220ms var(--ease-out);
}
#demo-cap.on { opacity: 1 }
#demo-tag {
  position: fixed; right: 20px; bottom: 20px; z-index: 9999;
  font-family: var(--font-outlier); font-size: 13px; color: var(--color-muted);
  letter-spacing: 0.02em;
}
#demo-card {
  position: fixed; inset: 0; z-index: 10000; background: var(--color-paper);
  display: grid; align-content: center; justify-items: start; padding: 0 120px;
  opacity: 0; transition: opacity 260ms var(--ease-out); pointer-events: none;
}
#demo-card.on { opacity: 1 }
#demo-card .mark { font-family: var(--font-display); font-size: 108px; font-weight: 500;
  letter-spacing: -0.03em; color: var(--color-ink); line-height: 1 }
#demo-card .mark b { color: var(--color-accent); font-weight: 500 }
#demo-card .sub { font-size: 26px; color: var(--color-ink-2); margin-top: 20px; max-width: 24ch }
#demo-card .url { font-family: var(--font-outlier); font-size: 20px; color: var(--color-cool);
  margin-top: 36px }
`

/** One instrument's mark: the four strokes of a tally, the fifth crossing them. */
const MARK = '<span class="mark">tal<b>l</b>y</span>'

async function run() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
  })
  const page = await ctx.newPage()
  await page.addInitScript(() => { try { localStorage.setItem('tally.lang', 'en') } catch {} })
  await page.goto(base + '/')
  await page.addStyleTag({ content: OVERLAY })
  await page.evaluate(() => {
    const cap = document.createElement('div'); cap.id = 'demo-cap'
    const card = document.createElement('div'); card.id = 'demo-card'
    const tag = document.createElement('div'); tag.id = 'demo-tag'
    tag.textContent = 'synthetic demo data'
    document.body.append(cap, card, tag)
  })

  const caption = (t) => page.evaluate((t) => {
    const el = document.getElementById('demo-cap')
    el.textContent = t; el.classList.toggle('on', Boolean(t))
  }, t)
  const card = (html) => page.evaluate((html) => {
    const el = document.getElementById('demo-card')
    el.innerHTML = html ?? ''; el.classList.toggle('on', Boolean(html))
  }, html)
  const ready = (id) => page.getByTestId(id).waitFor({ state: 'visible', timeout: 15000 })
  const scrollTo = (y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y)

  // Scene 1: the title card, over the real page already loaded behind it.
  await ready('stat-dash.fiveHour')
  await card(`${MARK}<span class="sub">What your Claude Code plan is actually spent on.</span>`)
  t0 = Date.now()
  const mark = {}
  let acc = 0
  for (const k of ['01', '02', '03', '04', '05', '06']) { acc += timings[k] * 1000; mark[k] = acc }
  await until(mark['01'])

  // Scene 2: the dashboard reading, then the model table under it.
  await card(null)
  await caption('Where you stand: the 5-hour window, the credits behind it, the plan ceiling.')
  await until(mark['01'] + timings['02'] * 0.55 * 1000)
  await scrollTo(560)
  await until(mark['02'])

  // Scene 3: analytics, from the model table down to the activity grid.
  await page.goto(base + '/#analytics')
  await ready('activity')
  await caption('Every model, its share of the plan, and the cost in dollars.')
  await until(mark['02'] + timings['03'] * 0.4 * 1000)
  await scrollTo(700)
  await until(mark['02'] + timings['03'] * 0.7 * 1000)
  await caption('Each fragment is one burst of work, at the hour it happened.')
  await scrollTo(1240)
  await until(mark['03'])

  // Scene 4: the three lanes. This is the page the product exists for.
  await page.goto(base + '/#insight')
  await ready('insight-stats')
  await caption('Who was actually typing: you, a subagent, or a headless job.')
  await scrollTo(1560)
  await until(mark['03'] + timings['04'] * 0.45 * 1000)
  await caption('Read against write, probing against doing, images against code.')
  await scrollTo(2130)
  await until(mark['04'])

  // Scene 5: the summary, findings priced in credits.
  await page.goto(base + '/#summary')
  await ready('summary-page')
  await caption('Every finding, priced in credits, the expensive one first.')
  await until(mark['04'] + timings['05'] * 0.5 * 1000)
  await scrollTo(640)
  await until(mark['05'])

  // Scene 6: the closing card.
  await caption(null)
  await card(`${MARK}<span class="sub">Local. No account, no upload.</span><span class="url">github.com/nguyenthienthanh/tally</span>`)
  await until(mark['06'])

  await ctx.close()
  await browser.close()
}

run().then(() => console.log('[demo] recorded into', outDir))
