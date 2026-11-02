import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import vi from '../web/src/i18n/vi.js'
import zh from '../web/src/i18n/zh.js'
import en from '../web/src/i18n/en.js'

/** AC-10.3: the three dictionaries must share the SAME key set, taken FROM THE SOURCE. */
describe('i18n vi/zh/en', () => {
  it('the three dictionaries share one key set, with nothing missing', () => {
    const keys = Object.keys(vi).sort()
    expect(keys.length).toBeGreaterThan(5)
    expect(Object.keys(zh).sort()).toEqual(keys)
    expect(Object.keys(en).sort()).toEqual(keys)
  })

  it('no dictionary leaves an empty string', () => {
    for (const [name, d] of Object.entries({ vi, zh, en })) {
      for (const [k, v] of Object.entries(d)) expect(v, `${name}.${k}`).not.toBe('')
    }
  })
})

describe('every finding needs a human label (the plain-language UX rule)', () => {
  it('no raw id ever reaches the screen', () => {
    // population FROM THE SOURCE: every id in findings.ts, never a hand-written list
    const src = readFileSync(new URL('../src/engine/findings.ts', import.meta.url), 'utf8')
    const ids = [...src.matchAll(/id: '([A-Z0-9_]+)'/g)].map((m) => m[1]!)
    expect(ids.length).toBeGreaterThan(0)
    for (const lang of ['vi', 'zh', 'en']) {
      const dict = ({ vi, zh, en } as Record<string, Record<string, string>>)[lang]!
      for (const id of ids) {
        expect(dict[`find.${id}`], `${lang} has no label for ${id}`).toBeTruthy()
        expect(dict[`find.${id}`], `${lang}: ${id} is still jargon`).not.toMatch(/^[A-Z_]+$/)
      }
    }
  })
})

describe('the CLI label table must cover everything too, so no second source of truth is forgotten', () => {
  it('every id in findings.ts has a label in cli.ts', () => {
    const dir = new URL('../src/', import.meta.url)
    const ids = [...readFileSync(new URL('engine/findings.ts', dir), 'utf8').matchAll(/id: '([A-Z0-9_]+)'/g)]
      .map((m) => m[1]!)
    const cli = readFileSync(new URL('cli.ts', dir), 'utf8')
    const table = cli.slice(cli.indexOf('const FINDING_LABEL'), cli.indexOf('const DB ='))
    for (const id of ids) expect(table, `cli.ts has no label for ${id}`).toContain(`${id}:`)
  })

  it('every finding declares damage_kind, so a peak is never called a saving', () => {
    const src = readFileSync(new URL('../src/engine/findings.ts', import.meta.url), 'utf8')
    const ids = [...src.matchAll(/id: '([A-Z0-9_]+)'/g)].length
    const kinds = [...src.matchAll(/damage_kind: '(saving|peak|spend)'/g)].length
    // The grid checks ITSELF: the population must match the number of pushes. If the id
    // regex undercounts (real case: [A-Z_]+ missed WASTE_CACHE_1H because of the digit),
    // the grid does not turn red, it just goes QUIET.
    const pushes = [...src.matchAll(/out\.push\(\{/g)].length
    expect(ids, 'the id regex undercounts against the number of out.push calls').toBe(pushes)
    expect(kinds).toBe(ids)
  })
})

describe('every translation key used in app.js really exists in all three dictionaries', () => {
  it('no key leaks to the screen as a key name', () => {
    const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
    // Only literal keys are caught here: t('a.b') and tp('a.b', ...). Dynamic keys such as
    // `read.${id}` cannot be, so they have their own check below.
    // Skip composed keys (`t('an.' + g)`); they are covered by the check right below.
    const keys = new Set([...src.matchAll(/\bt[p]?\('([a-zA-Z][\w.]*)'\s*\)/g)].map((m) => m[1]!)
      .filter((k) => !k.endsWith('.')))
    expect(keys.size).toBeGreaterThan(30)
    const dicts: Record<string, Record<string, string>> = { vi, zh, en }
    const missing: string[] = []
    for (const k of keys) {
      for (const [lang, dict] of Object.entries(dicts)) {
        if (!(k in dict)) missing.push(`${lang}:${k}`)
      }
    }
    expect(missing, 'a missing key means the user sees a bare key name').toEqual([])
  })

  it('COMPOSED keys are complete too: time buckets, periods, severities, verb groups', () => {
    const dicts: Record<string, Record<string, string>> = { vi, zh, en }
    const dynamic = [
      ...['hour', 'day', 'month', 'year'].map((g) => `an.${g}`),
      ...['5h', '24h', '7d', '30d', 'all'].map((p) => `an.period.${p}`),
      ...['high', 'medium', 'low'].map((s) => `sev.${s}`),
      ...['saving', 'peak', 'spend'].map((k) => `find.verb.${k}`),
    ]
    for (const k of dynamic) {
      for (const [lang, dict] of Object.entries(dicts)) {
        expect(dict[k], `${lang} is missing ${k}`).toBeTruthy()
      }
    }
  })

  it('every FINDING has both a title and an ACTION sentence in all three dictionaries', () => {
    const src = readFileSync(new URL('../src/engine/findings.ts', import.meta.url), 'utf8')
    const ids = [...new Set([...src.matchAll(/id: '([A-Z_0-9]+)'/g)].map((m) => m[1]!))]
    expect(ids.length).toBeGreaterThan(3)
    const dicts: Record<string, Record<string, string>> = { vi, zh, en }
    for (const id of ids) {
      for (const [lang, dict] of Object.entries(dicts)) {
        expect(dict[`find.${id}`], `${lang} has no title for ${id}`).toBeTruthy()
        expect(dict[`find.act.${id}`], `${lang} has no ACTION sentence for ${id}`).toBeTruthy()
      }
    }
  })

  it('every reading has a label AND an explanation in all three dictionaries', () => {
    const src = readFileSync(new URL('../src/insight/readings.ts', import.meta.url), 'utf8')
    const ids = [...src.matchAll(/id: '(\w+)',/g)].map((m) => m[1]!)
    expect(ids.length).toBeGreaterThan(5)
    const dicts: Record<string, Record<string, string>> = { vi, zh, en }
    for (const id of ids) {
      for (const [lang, dict] of Object.entries(dicts)) {
        expect(dict[`read.${id}.label`], `${lang} has no label for ${id}`).toBeTruthy()
        expect(dict[`read.${id}.mean`], `${lang} has no EXPLANATION for ${id}`).toBeTruthy()
      }
    }
  })
})

describe('the CSS must carry the names app.js uses', () => {
  it('every class app.js builds has a rule in app.css, because a misnamed class is a silent bug', () => {
    const js = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8')
      + readFileSync(new URL('../web/base.css', import.meta.url), 'utf8')
    const used = new Set<string>()
    for (const m of js.matchAll(/class: '([a-z0-9 _-]+)'/g)) {
      for (const c of m[1]!.split(/\s+/)) if (c) used.add(c)
    }
    expect(used.size).toBeGreaterThan(20)
    // shared layout-only classes, no rule of their own needed
    const ok = new Set(['muted', 'sub', 'num', 'name', 'row', 'wrap', 'lead'])
    // A class with no CSS is not necessarily dead: it may be a test hook. The grid has to
    // read the e2e specs to know, or it pushes whoever fixes it into deleting the very hook
    // another grid depends on. That happened to the heatmap's `.lbl`.
    const e2e = readFileSync(new URL('../e2e/dashboard.spec.ts', import.meta.url), 'utf8')
    const missing = [...used].filter(
      (c) => !ok.has(c) && !css.includes(`.${c}`) && !e2e.includes(`.${c}'`) && !e2e.includes(`.${c}\``),
    )
    expect(missing, 'app.js builds a class that neither the CSS nor the e2e specs know about').toEqual([])
  })
})
