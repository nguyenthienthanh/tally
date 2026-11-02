import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AC-7.1: the tool must send NOTHING OUT.
 * One important distinction: a LOCAL HTTP server (accepting connections, bound to
 * 127.0.0.1) is not an outbound call. The first version of this test banned `node:http`
 * outright and wrongly flagged `src/server/serve.ts`. So the gate has to be narrow: ban
 * the CLIENT APIs, allow `createServer`.
 * The population comes FROM THE SOURCE (readdirSync), never a hand-written file list
 * (house rule section 4).
 */
function allSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) allSourceFiles(p, acc)
    else if (/\.(ts|tsx|js)$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** Only these names may be imported from `node:http`, and all of them are server side. */
const HTTP_ALLOWED = new Set(['createServer', 'IncomingMessage', 'ServerResponse', 'Server'])

/** Modules that exist only to reach out. Banned outright. */
const FORBIDDEN_MODULES = /from ['"]node:(https|net|tls|dgram|http2)['"]|require\(['"](https?|net|tls)['"]\)/

/**
 * Outbound client APIs: banned.
 * A `fetch` to a RELATIVE PATH ('/api/...') is a same-origin call to this tool's own local
 * server, so it never reaches the internet and is allowed. Only ABSOLUTE URLs are banned.
 * An earlier version banned every `fetch(` and wrongly flagged web/app.js.
 */
const FORBIDDEN_CALLS = /\baxios\b|ipapi\.co|XMLHttpRequest|\bhttps?\.(request|get)\s*\(|undici|\bfetch\s*\(\s*[`'"](?:https?:)?\/\/|\bfetch\s*\(\s*[`'"]?\$\{?\s*(?:https?|\/\/)/

describe('no outbound network calls (AC-7.1)', () => {
  const files = [...allSourceFiles('src'), ...allSourceFiles('web')]

  it('the scan grid is not empty while still passing', () => {
    expect(files.length).toBeGreaterThan(8)
  })

  it('no file imports a purely outbound module (https, net, tls, dgram, http2)', () => {
    const bad = files.filter((f) => FORBIDDEN_MODULES.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })

  it('no file reaches out: axios, http.request, ipapi, or fetch with an absolute URL', () => {
    const bad = files.filter((f) => FORBIDDEN_CALLS.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })

  it('imports from node:http may only take server-side APIs (createServer and friends)', () => {
    const bad: string[] = []
    for (const f of files) {
      const s = readFileSync(f, 'utf8')
      for (const m of s.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]node:http['"]/g)) {
        const names = (m[1] ?? '').split(',')
          .map((x) => x.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0] ?? '')
          .filter(Boolean)
        if (names.some((x) => !HTTP_ALLOWED.has(x))) bad.push(`${f}: ${names.join(',')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the gate is right at the POSITIVE end: a file containing `fetch(` MUST be caught', () => {
    // Test the grid itself: a gate that always reports clean is a useless gate.
    expect(FORBIDDEN_CALLS.test('const r = await fetch("https://x.com")')).toBe(true)
    expect(FORBIDDEN_CALLS.test("fetch('//evil.example/x')")).toBe(true)
    expect(FORBIDDEN_CALLS.test('fetch(`https://${host}/x`)')).toBe(true)
    expect(FORBIDDEN_CALLS.test('const r = await fetch(\'https://ipapi.co\')')).toBe(true)
    expect(FORBIDDEN_MODULES.test("import https from 'node:https'")).toBe(true)
    // and it MUST let this through: a same-origin call to the local API
    expect(FORBIDDEN_CALLS.test("fetch('/api/now')")).toBe(false)
    expect(FORBIDDEN_CALLS.test('fetch(`/api/buckets?grain=${g}`)')).toBe(false)
    expect(FORBIDDEN_CALLS.test("import { createServer } from 'node:http'")).toBe(false)
  })
})

describe('the price table must not go stale (AC-3.3)', () => {
  it('PRICING_AS_OF is newer than 90 days', async () => {
    const { PRICING_AS_OF } = await import('../src/data/pricing.js')
    const days = (Date.now() - Date.parse(PRICING_AS_OF)) / 86_400_000
    expect(days).toBeLessThan(90)
  })
})
