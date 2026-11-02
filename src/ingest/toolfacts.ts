/**
 * Derive facts from a tool call. Raw strings are never kept.
 *
 * Privacy: these functions receive the full tool input but return only reduced values
 * (tool name, shell verb, file extension, shortened path). Command strings and file
 * contents NEVER leave this file. Reading during a session is momentary; the index
 * stays on disk, so what stays has to be the minimum.
 */

export type ToolKind = 'read' | 'write' | 'exec' | 'mcp' | 'agent' | 'ask' | 'other'

export interface ToolFact {
  tool: string
  kind: ToolKind
  /** Bash: the real verb. MCP: the server name. Skill or Agent: the name invoked. Otherwise null. */
  verb: string | null
  /** The shortened path, or null. */
  target: string | null
  /** The file extension without the dot, or null. */
  ext: string | null
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'WebFetch', 'WebSearch', 'ToolSearch'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])
const AGENT_TOOLS = new Set(['Agent', 'Task', 'Skill', 'Workflow', 'SendMessage'])

/**
 * Wrappers: words that open a command segment but are NOT the work being done.
 *
 * `cd ~/x && pnpm build` is a build, not a `cd`. Counting naively puts `cd` above half
 * of everything and hides the real work. That was measured, not assumed.
 */
/** Wrappers that SWALLOW the segment: their argument is never a command (`cd src && ls`). */
const SWALLOW = new Set([
  'cd', 'set', 'export', 'source', '.', 'unset', 'local', 'readonly',
  'for', 'while', 'until', 'case', 'if', 'elif', 'function', 'fi', 'done', 'esac',
])
/** Wrappers that DELEGATE: the real command is the very next word (`env python3`, `sudo pnpm`). */
// `do ls` and `then ls` ARE calls to ls. Swallowing them loses the real command.
const DELEGATE = new Set(['env', 'sudo', 'time', 'nohup', 'exec', 'command', 'xargs', 'nice', 'do', 'then', 'else'])

/** Opening characters that cannot start a command name: subshells, redirections, variables. */
const NOT_A_VERB = /^[({<>$"'`\-|&;[\]]/

/**
 * Strip heredoc bodies before splitting into segments.
 *
 * `python3 <<'TAG' ... TAG` buries a whole program inside a shell command. Splitting on
 * newlines without removing it counts `import`, `const`, `for` and `PYEOF` as commands.
 * That was measured, not assumed.
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
 * Strip quoted bodies.
 *
 * `python3 -c "import json; print(1)"` carries a whole program inside one string.
 * Splitting segments without removing it counts `import` and `print` as commands.
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
    // drop leading environment assignments: FOO=bar BAZ=qux cmd
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) {
      const sp = s.indexOf(' ')
      if (sp < 0) { s = ''; break }
      s = s.slice(sp + 1).trim()
    }
    if (!s || NOT_A_VERB.test(s)) continue
    // Walk through DELEGATE wrappers to the real command; a SWALLOW wrapper drops the segment.
    let v = ''
    for (const raw of s.split(/\s+/)) {
      let w = raw
      if (w.includes('/')) w = w.slice(w.lastIndexOf('/') + 1)  // ./node_modules/.bin/vitest -> vitest
      w = w.replace(/["'`]/g, '')
      if (!w || w.startsWith('-')) continue                      // a flag is not a command
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

/** The file extension, no dot, lower case. null when absent or implausibly long. */
export function fileExt(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  if (i <= 0 || i === base.length - 1) return null
  const ext = base.slice(i + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null
}

/**
 * Shortened path: the last three segments are enough to recognise a file without
 * carrying the whole directory tree of someone's machine.
 */
export function shortTarget(path: string): string | null {
  if (!path || typeof path !== 'string') return null
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return null
  return parts.slice(-3).join('/')
}

/** Classify a tool call and derive what can be derived. */
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
    // mcp__<server>__<tool>: the server is what is worth counting, it says what you depend on.
    const server = name.split('__')[1] ?? null
    return { tool: name, kind: 'mcp', verb: server, target: null, ext: null }
  }

  if (name === 'Bash') {
    const cmd = typeof inp['command'] === 'string' ? (inp['command'] as string) : ''
    const verbs = bashVerbs(cmd)
    return { tool: 'Bash', kind: 'exec', verb: verbs[0] ?? null, target: null, ext: null }
  }

  if (AGENT_TOOLS.has(name)) {
    // 'to' is excluded: it is an agent id (a hash), not a name anyone can read.
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

/** EVERY verb in one Bash command, for counting a whole chain rather than its head. */
export function allBashVerbs(input: Record<string, unknown> | undefined): string[] {
  const cmd = typeof input?.['command'] === 'string' ? (input['command'] as string) : ''
  return bashVerbs(cmd)
}
