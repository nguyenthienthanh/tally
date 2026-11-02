import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AC-7.1: tool KHÔNG được gửi gì RA NGOÀI.
 * Lưu ý quan trọng: một HTTP server NỘI BỘ (nhận kết nối vào, bind 127.0.0.1) KHÔNG phải
 * gọi mạng ra. Vòng đầu test này cấm cả `node:http` nên bắt oan `src/server/serve.ts`.
 * Nên cổng phải siết đúng chỗ: cấm API CLIENT, cho phép `createServer`.
 * Dân số quét lấy TỪ NGUỒN (readdirSync), không chép tay danh sách file (luật §4).
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

/** Chỉ những tên này được phép import từ `node:http` — toàn bộ là phía NHẬN. */
const HTTP_ALLOWED = new Set(['createServer', 'IncomingMessage', 'ServerResponse', 'Server'])

/** Module chỉ phục vụ việc đi RA — cấm tuyệt đối. */
const FORBIDDEN_MODULES = /from ['"]node:(https|net|tls|dgram|http2)['"]|require\(['"](https?|net|tls)['"]\)/

/**
 * API client gọi ra — cấm.
 * `fetch` tới ĐƯỜNG DẪN TƯƠNG ĐỐI ('/api/...') là gọi cùng origin, tới server nội bộ của
 * chính tool này ⇒ KHÔNG phải đi ra internet, nên được phép. Chỉ cấm URL TUYỆT ĐỐI.
 * Vòng trước cổng cấm mọi `fetch(` nên bắt oan web/app.js.
 */
const FORBIDDEN_CALLS = /\baxios\b|ipapi\.co|XMLHttpRequest|\bhttps?\.(request|get)\s*\(|undici|\bfetch\s*\(\s*[`'"](?:https?:)?\/\/|\bfetch\s*\(\s*[`'"]?\$\{?\s*(?:https?|\/\/)/

describe('không gọi mạng RA NGOÀI (AC-7.1)', () => {
  const files = [...allSourceFiles('src'), ...allSourceFiles('web')]

  it('lưới quét không rỗng mà vẫn xanh', () => {
    expect(files.length).toBeGreaterThan(8)
  })

  it('không file nào import module chỉ dùng để đi ra (https/net/tls/dgram/http2)', () => {
    const bad = files.filter((f) => FORBIDDEN_MODULES.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })

  it('không file nào gọi ra ngoài: axios/http.request/ipapi/fetch URL tuyệt đối', () => {
    const bad = files.filter((f) => FORBIDDEN_CALLS.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })

  it('import từ node:http chỉ được lấy API phía NHẬN (createServer…)', () => {
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

  it('cổng đúng ở đầu DƯƠNG: một file có `fetch(` thì PHẢI bị bắt', () => {
    // Kiểm chính cái lưới — một cổng luôn-báo-sạch là cổng vô dụng.
    expect(FORBIDDEN_CALLS.test('const r = await fetch("https://x.com")')).toBe(true)
    expect(FORBIDDEN_CALLS.test("fetch('//evil.example/x')")).toBe(true)
    expect(FORBIDDEN_CALLS.test('fetch(`https://${host}/x`)')).toBe(true)
    expect(FORBIDDEN_CALLS.test('const r = await fetch(\'https://ipapi.co\')')).toBe(true)
    expect(FORBIDDEN_MODULES.test("import https from 'node:https'")).toBe(true)
    // và PHẢI cho qua: gọi cùng origin tới API nội bộ
    expect(FORBIDDEN_CALLS.test("fetch('/api/now')")).toBe(false)
    expect(FORBIDDEN_CALLS.test('fetch(`/api/buckets?grain=${g}`)')).toBe(false)
    expect(FORBIDDEN_CALLS.test("import { createServer } from 'node:http'")).toBe(false)
  })
})

describe('bảng giá không được để lạc hậu (AC-3.3)', () => {
  it('PRICING_AS_OF mới hơn 90 ngày', async () => {
    const { PRICING_AS_OF } = await import('../src/data/pricing.js')
    const days = (Date.now() - Date.parse(PRICING_AS_OF)) / 86_400_000
    expect(days).toBeLessThan(90)
  })
})
