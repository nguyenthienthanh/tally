/**
 * Bóc SỰ THẬT SUY RA được từ một tool call — không giữ chuỗi thô.
 *
 * Riêng tư: hàm này nhận input đầy đủ của tool call nhưng chỉ trả về thứ đã rút
 * gọn (tên tool, động từ lệnh, đuôi file, đường dẫn đã cắt). Chuỗi lệnh và nội
 * dung file KHÔNG BAO GIỜ ra khỏi đây. Đọc lúc làm việc là thoáng qua; index thì
 * nằm lại trên đĩa, nên thứ nằm lại phải là thứ tối thiểu.
 */

export type ToolKind = 'read' | 'write' | 'exec' | 'mcp' | 'agent' | 'ask' | 'other'

export interface ToolFact {
  tool: string
  kind: ToolKind
  /** Bash: động từ thật. MCP: tên server. Skill/Agent: tên được gọi. Còn lại: null. */
  verb: string | null
  /** Đường dẫn đã rút gọn, hoặc null. */
  target: string | null
  /** Đuôi file không có dấu chấm, hoặc null. */
  ext: string | null
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'WebFetch', 'WebSearch', 'ToolSearch'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])
const AGENT_TOOLS = new Set(['Agent', 'Task', 'Skill', 'Workflow', 'SendMessage'])

/**
 * Vỏ bọc: những từ đứng đầu một đoạn lệnh nhưng KHÔNG phải việc đang làm.
 *
 * `cd ~/x && pnpm build` là một lệnh build, không phải một lệnh cd. Đếm thô thì
 * `cd` chiếm hơn một nửa và che mất mọi thứ khác — đã đo thấy đúng như vậy.
 */
/** Vỏ NUỐT đoạn: tham số của nó không bao giờ là một lệnh (`cd src && ls`). */
const SWALLOW = new Set([
  'cd', 'set', 'export', 'source', '.', 'unset', 'local', 'readonly',
  'for', 'while', 'until', 'case', 'if', 'elif', 'function', 'fi', 'done', 'esac',
])
/** Vỏ ỦY QUYỀN: lệnh thật là từ NGAY SAU nó (`env python3`, `sudo pnpm`). */
// `do ls` và `then ls` là LỆNH ls — xếp chúng vào nhóm nuốt là đánh mất lệnh thật.
const DELEGATE = new Set(['env', 'sudo', 'time', 'nohup', 'exec', 'command', 'xargs', 'nice', 'do', 'then', 'else'])

/** Ký tự mở đầu không phải tên lệnh: ngoặc con shell, chuyển hướng, biến. */
const NOT_A_VERB = /^[({<>$"'`\-|&;[\]]/

/**
 * Động từ thật của một lệnh shell, theo thứ tự xuất hiện, không trùng lặp.
 *
 * Cắt theo `&&` `||` `;` `|` và lấy từ đầu mỗi đoạn, bỏ lớp vỏ và tiền tố biến
 * môi trường (`FOO=bar cmd`). Trả rỗng khi không nhận ra gì — "không biết" khác
 * "là cd".
 */
/**
 * Vứt ruột heredoc trước khi cắt đoạn.
 *
 * `python3 <<'TAG' ... TAG` nhét cả một chương trình vào giữa lệnh shell. Cắt theo
 * xuống dòng mà không gỡ phần này thì `import`, `const`, `for`, `PYEOF` đều bị đếm
 * như lệnh — đã đo thấy đúng như vậy.
 */
export function stripHeredocs(command: string): string {
  const lines = command.split('\n')
  const out: string[] = []
  let tag: string | null = null
  for (const line of lines) {
    if (tag !== null) {
      if (line.trim() === tag) tag = null
      continue
    }
    out.push(line)
    const m = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (m) tag = m[2] ?? null
  }
  return out.join('\n')
}

/**
 * Vứt ruột chuỗi trích dẫn.
 *
 * `python3 -c "import json; print(1)"` mang cả một chương trình trong một chuỗi.
 * Cắt đoạn mà không gỡ thì `import` và `print` bị đếm như lệnh.
 */
export function stripQuoted(command: string): string {
  let out = ''
  let q: string | null = null
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!
    if (q) {
      if (ch === '\\') { i += 1; continue }
      if (ch === q) { q = null; out += ch }
      continue
    }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue }
    out += ch
  }
  return out
}

export function bashVerbs(rawCommand: string, max = 6): string[] {
  const command = stripQuoted(stripHeredocs(rawCommand))
  if (!command) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const seg of command.split(/\|\||&&|[;|\n]/)) {
    let s = seg.trim()
    if (!s) continue
    // bỏ tiền tố gán biến môi trường: FOO=bar BAZ=qux cmd
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) {
      const sp = s.indexOf(' ')
      if (sp < 0) { s = ''; break }
      s = s.slice(sp + 1).trim()
    }
    if (!s || NOT_A_VERB.test(s)) continue
    // Đi qua các lớp vỏ ỦY QUYỀN cho tới lệnh thật; gặp vỏ NUỐT thì bỏ cả đoạn.
    let v = ''
    for (const raw of s.split(/\s+/)) {
      let w = raw
      if (w.includes('/')) w = w.slice(w.lastIndexOf('/') + 1)  // ./node_modules/.bin/vitest -> vitest
      w = w.replace(/["'`]/g, '')
      if (!w || w.startsWith('-')) continue                      // cờ không phải lệnh
      if (!/^[a-zA-Z][\w.-]*$/.test(w)) { v = ''; break }
      if (SWALLOW.has(w)) { v = ''; break }
      if (DELEGATE.has(w)) continue
      v = w
      break
    }
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= max) break
  }
  return out
}

/** Đuôi file, không dấu chấm, chữ thường. null khi không có hoặc quá dài. */
export function fileExt(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  if (i <= 0 || i === base.length - 1) return null
  const ext = base.slice(i + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null
}

/**
 * Đường dẫn rút gọn: ba đoạn cuối là đủ để nhận ra file mà không mang theo cả cây
 * thư mục của máy.
 */
export function shortTarget(path: string): string | null {
  if (!path || typeof path !== 'string') return null
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return null
  return parts.slice(-3).join('/')
}

/** Xếp loại một tool call và bóc phần suy ra được. */
export function toolFact(name: string, input: Record<string, unknown> | undefined): ToolFact {
  const inp = input ?? {}
  const pathOf = (): string | null => {
    for (const k of ['file_path', 'path', 'notebook_path']) {
      const v = inp[k]
      if (typeof v === 'string' && v) return v
    }
    return null
  }

  if (name.startsWith('mcp__')) {
    // mcp__<server>__<tool> — server là thứ đáng đếm, nó nói anh đang dựa vào cái gì.
    const server = name.split('__')[1] ?? null
    return { tool: name, kind: 'mcp', verb: server, target: null, ext: null }
  }

  if (name === 'Bash') {
    const cmd = typeof inp['command'] === 'string' ? (inp['command'] as string) : ''
    const verbs = bashVerbs(cmd)
    return { tool: 'Bash', kind: 'exec', verb: verbs[0] ?? null, target: null, ext: null }
  }

  if (AGENT_TOOLS.has(name)) {
    // 'to' bị loại: nó là ID agent (chuỗi băm), không phải tên ai đọc được.
    const v = ['skill', 'subagent_type', 'name'].map((k) => inp[k]).find((x) => typeof x === 'string')
    return { tool: name, kind: 'agent', verb: (v as string) ?? null, target: null, ext: null }
  }

  if (READ_TOOLS.has(name) || WRITE_TOOLS.has(name)) {
    const p = pathOf()
    return {
      tool: name,
      kind: READ_TOOLS.has(name) ? 'read' : 'write',
      verb: null,
      target: p ? shortTarget(p) : null,
      ext: p ? fileExt(p) : null,
    }
  }

  if (ASK_TOOLS.has(name)) return { tool: name, kind: 'ask', verb: null, target: null, ext: null }
  return { tool: name, kind: 'other', verb: null, target: null, ext: null }
}

/** MỌI động từ của một lệnh Bash — dùng khi muốn đếm cả chuỗi lệnh nối nhau. */
export function allBashVerbs(input: Record<string, unknown> | undefined): string[] {
  const cmd = typeof input?.['command'] === 'string' ? (input['command'] as string) : ''
  return bashVerbs(cmd)
}
