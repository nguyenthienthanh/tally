import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import vi from '../web/src/i18n/vi.js'
import zh from '../web/src/i18n/zh.js'
import en from '../web/src/i18n/en.js'

/** AC-10.3: ba từ điển phải CÙNG tập khoá. Khoá lấy TỪ NGUỒN, không chép tay. */
describe('i18n vi/zh/en', () => {
  it('ba từ điển có cùng tập khoá, không khoá nào thiếu', () => {
    const keys = Object.keys(vi).sort()
    expect(keys.length).toBeGreaterThan(5)
    expect(Object.keys(zh).sort()).toEqual(keys)
    expect(Object.keys(en).sort()).toEqual(keys)
  })

  it('không từ điển nào để chuỗi rỗng', () => {
    for (const [name, d] of Object.entries({ vi, zh, en })) {
      for (const [k, v] of Object.entries(d)) expect(v, `${name}.${k}`).not.toBe('')
    }
  })
})

describe('mọi phát hiện phải có nhãn tiếng người (luật UX 12 tuổi)', () => {
  it('không id nào hiện trần ra màn hình', () => {
    // dân số lấy TỪ NGUỒN: mọi id trong findings.ts, không chép tay
    const src = readFileSync(new URL('../src/engine/findings.ts', import.meta.url), 'utf8')
    const ids = [...src.matchAll(/id: '([A-Z0-9_]+)'/g)].map((m) => m[1]!)
    expect(ids.length).toBeGreaterThan(0)
    for (const lang of ['vi', 'zh', 'en']) {
      const dict = ({ vi, zh, en } as Record<string, Record<string, string>>)[lang]!
      for (const id of ids) {
        expect(dict[`find.${id}`], `${lang} thiếu nhãn cho ${id}`).toBeTruthy()
        expect(dict[`find.${id}`], `${lang}: ${id} vẫn là jargon`).not.toMatch(/^[A-Z_]+$/)
      }
    }
  })
})

describe('bảng nhãn của CLI cũng phải phủ đủ (không nguồn sự thật thứ hai bị bỏ quên)', () => {
  it('mọi id trong findings.ts đều có nhãn trong cli.ts', () => {
    const dir = new URL('../src/', import.meta.url)
    const ids = [...readFileSync(new URL('engine/findings.ts', dir), 'utf8').matchAll(/id: '([A-Z0-9_]+)'/g)]
      .map((m) => m[1]!)
    const cli = readFileSync(new URL('cli.ts', dir), 'utf8')
    const table = cli.slice(cli.indexOf('const FINDING_VI'), cli.indexOf('const DB ='))
    for (const id of ids) expect(table, `cli.ts thiếu nhãn cho ${id}`).toContain(`${id}:`)
  })

  it('mọi phát hiện phải khai damage_kind (số đỉnh không được gọi là tiết kiệm)', () => {
    const src = readFileSync(new URL('../src/engine/findings.ts', import.meta.url), 'utf8')
    const ids = [...src.matchAll(/id: '([A-Z0-9_]+)'/g)].length
    const kinds = [...src.matchAll(/damage_kind: '(saving|peak|spend)'/g)].length
    // Lưới TỰ KIỂM: dân số phải khớp số lần đẩy phát hiện ra. Nếu regex id đếm hụt
    // (ca thật: [A-Z_]+ bỏ sót WASTE_CACHE_1H vì có chữ số), lưới không đỏ — nó chỉ IM.
    const pushes = [...src.matchAll(/out\.push\(\{/g)].length
    expect(ids, 'regex id đếm hụt so với số out.push').toBe(pushes)
    expect(kinds).toBe(ids)
  })
})

describe('mọi khoá dịch dùng trong app.js phải CÓ THẬT ở cả ba từ điển', () => {
  it('không khoá nào lọt ra màn hình dưới dạng tên khoá', () => {
    const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
    // chỉ bắt khoá hằng — t('a.b') / tp('a.b', …). Khoá dựng động (`read.${id}`)
    // không bắt được ở đây, nên có kiểm riêng bên dưới.
    // Bỏ qua khoá ghép động (`t('an.' + g)`) — phần đó có kiểm riêng ngay dưới.
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
    expect(missing, 'khoá thiếu ⇒ người dùng thấy tên khoá trần').toEqual([])
  })

  it('khoá GHÉP ĐỘNG cũng phải đủ: mức thời gian, khoảng xem, mức nghiêm trọng, động từ', () => {
    const dicts: Record<string, Record<string, string>> = { vi, zh, en }
    const dynamic = [
      ...['hour', 'day', 'month', 'year'].map((g) => `an.${g}`),
      ...['5h', '24h', '7d', '30d', 'all'].map((p) => `an.period.${p}`),
      ...['high', 'medium', 'low'].map((s) => `sev.${s}`),
      ...['saving', 'peak', 'spend'].map((k) => `find.verb.${k}`),
    ]
    for (const k of dynamic) {
      for (const [lang, dict] of Object.entries(dicts)) {
        expect(dict[k], `${lang} thiếu ${k}`).toBeTruthy()
      }
    }
  })

  it('mọi PHÁT HIỆN có cả tiêu đề lẫn CÂU HÀNH ĐỘNG ở cả ba từ điển', () => {
    const src = readFileSync(new URL('../src/engine/findings.ts', import.meta.url), 'utf8')
    const ids = [...new Set([...src.matchAll(/id: '([A-Z_0-9]+)'/g)].map((m) => m[1]!))]
    expect(ids.length).toBeGreaterThan(3)
    const dicts: Record<string, Record<string, string>> = { vi, zh, en }
    for (const id of ids) {
      for (const [lang, dict] of Object.entries(dicts)) {
        expect(dict[`find.${id}`], `${lang} thiếu tiêu đề ${id}`).toBeTruthy()
        expect(dict[`find.act.${id}`], `${lang} thiếu CÂU HÀNH ĐỘNG ${id}`).toBeTruthy()
      }
    }
  })

  it('mọi điều đọc ra đều có nhãn VÀ câu giải thích ở cả ba từ điển', () => {
    const src = readFileSync(new URL('../src/insight/readings.ts', import.meta.url), 'utf8')
    const ids = [...src.matchAll(/id: '(\w+)',/g)].map((m) => m[1]!)
    expect(ids.length).toBeGreaterThan(5)
    const dicts: Record<string, Record<string, string>> = { vi, zh, en }
    for (const id of ids) {
      for (const [lang, dict] of Object.entries(dicts)) {
        expect(dict[`read.${id}.label`], `${lang} thiếu nhãn ${id}`).toBeTruthy()
        expect(dict[`read.${id}.mean`], `${lang} thiếu CÂU GIẢI THÍCH ${id}`).toBeTruthy()
      }
    }
  })
})

describe('CSS phải mang đúng tên app.js dùng', () => {
  it('mọi class app.js dựng đều có luật trong app.css — đặt sai tên là bug im lặng', () => {
    const js = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8')
      + readFileSync(new URL('../web/base.css', import.meta.url), 'utf8')
    const used = new Set<string>()
    for (const m of js.matchAll(/class: '([a-z0-9 _-]+)'/g)) {
      for (const c of m[1]!.split(/\s+/)) if (c) used.add(c)
    }
    expect(used.size).toBeGreaterThan(20)
    // class thuần bố cục dùng chung, không cần luật riêng
    const ok = new Set(['muted', 'sub', 'num', 'name', 'row', 'wrap', 'lead'])
    // Một class KHÔNG có CSS chưa chắc là chết: nó có thể là test hook. Lưới phải
    // tự đọc e2e để biết, kẻo nó đẩy người sửa đi xoá đúng cái hook đang giữ lưới
    // khác — đã xảy ra với `.lbl` của heatmap.
    const e2e = readFileSync(new URL('../e2e/dashboard.spec.ts', import.meta.url), 'utf8')
    const missing = [...used].filter(
      (c) => !ok.has(c) && !css.includes(`.${c}`) && !e2e.includes(`.${c}'`) && !e2e.includes(`.${c}\``),
    )
    expect(missing, 'app.js dựng class mà CSS không có và e2e cũng không dùng').toEqual([])
  })
})
