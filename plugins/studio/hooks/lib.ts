// Pure helpers: no `$`, so they are easy to test and reason about.
import type { Entry, FileMark } from '../types'

// ── Paths ───────────────────────────────────────────────────────────────────

/** A path relative to the session folder when it is inside it. */
export function relativeTo(cwd: string, path: string): string {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  if (path === cwd) {
    return '.'
  }
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** The absolute path for a path the pane holds (relative to the folder, or already absolute). */
export function absoluteIn(cwd: string, path: string): string {
  if (path.startsWith('/')) {
    return path
  }
  return path === '.' ? cwd : `${cwd.replace(/\/$/, '')}/${path}`
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

// ── The tree ────────────────────────────────────────────────────────────────

const HIDDEN = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target', '__pycache__', '.DS_Store'])

export function isHidden(name: string): boolean {
  return HIDDEN.has(name)
}

/** Folders first, then files, each by name; hidden names dropped. */
export function tidyListing(entries: readonly Entry[]): Entry[] {
  return entries
    .filter(e => !isHidden(e.name))
    .map(e => ({ name: e.name, kind: e.kind, size: e.size }))
    .sort((a, b) => {
      const ad = a.kind === 'dir' ? 0 : 1
      const bd = b.kind === 'dir' ? 0 : 1
      return ad !== bd ? ad - bd : a.name.localeCompare(b.name)
    })
}

export type TreeRow = { path: string; name: string; kind: Entry['kind']; depth: number; isOpen: boolean; isLoaded: boolean }

/**
 * The visible rows of the tree: `listings` is keyed by folder path relative
 * to the session folder (`.` for the root), `expanded` the folders open.
 */
export function flattenTree(
  listings: Readonly<Record<string, readonly Entry[]>>,
  expanded: readonly string[],
  limit = 500,
): TreeRow[] {
  const open = new Set(expanded)
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number): void => {
    for (const entry of listings[dir] ?? []) {
      if (rows.length >= limit) {
        return
      }
      const path = dir === '.' ? entry.name : `${dir}/${entry.name}`
      const isOpen = entry.kind === 'dir' && open.has(path)
      rows.push({ path, name: entry.name, kind: entry.kind, depth, isOpen, isLoaded: listings[path] !== undefined })
      if (isOpen) {
        walk(path, depth + 1)
      }
    }
  }
  walk('.', 0)
  return rows
}

/** True when some file under `dir` has a mark of the given kind. */
export function hasMarkedChild(marks: Readonly<Record<string, FileMark>>, dir: string, kind: 'isEdited' | 'isRead'): boolean {
  const prefix = `${dir}/`
  return Object.entries(marks).some(([path, mark]) => mark[kind] && path.startsWith(prefix))
}

// ── Languages ───────────────────────────────────────────────────────────────

const LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', m: 'objective-c', mm: 'objective-c', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
  cs: 'csharp', fs: 'fsharp', php: 'php', scala: 'scala', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  hs: 'haskell', lua: 'lua', r: 'r', jl: 'julia', dart: 'dart', zig: 'zig', nim: 'nim',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish', ps1: 'powershell',
  json: 'json', jsonc: 'jsonc', json5: 'json5', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  xml: 'xml', html: 'html', htm: 'html', svg: 'xml', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  md: 'markdown', mdx: 'mdx', sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'proto',
  tf: 'hcl', hcl: 'hcl', dockerfile: 'dockerfile', makefile: 'makefile', ipynb: 'json',
}

const NAMED: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'makefile', gemfile: 'ruby', rakefile: 'ruby', '.bashrc': 'bash', '.zshrc': 'bash',
}

/** A highlighter language for a file, from its name or extension; undefined draws plain text. */
export function languageOf(path: string): string | undefined {
  const name = basename(path).toLowerCase()
  if (NAMED[name] !== undefined) {
    return NAMED[name]
  }
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? undefined : LANGUAGES[name.slice(dot + 1)]
}

// ── Diffs ───────────────────────────────────────────────────────────────────

export type Hunk = { oldStart?: number; oldLines?: number; newStart?: number; newLines?: number; lines: readonly string[] }

/** Added and removed line counts from a structured patch. */
export function countPatch(hunks: readonly Hunk[] | undefined): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const hunk of hunks ?? []) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        adds += 1
      } else if (line.startsWith('-')) {
        dels += 1
      }
    }
  }
  return { adds, dels }
}

/** Unified-diff text from a structured patch, as `Code format="diff"` reads it. */
export function patchToDiff(hunks: readonly Hunk[] | undefined): string {
  const parts: string[] = []
  for (const hunk of hunks ?? []) {
    const lines = hunk.lines.filter(l => !l.startsWith('\\'))
    const oldLines = hunk.oldLines ?? lines.filter(l => !l.startsWith('+')).length
    const newLines = hunk.newLines ?? lines.filter(l => !l.startsWith('-')).length
    parts.push(`@@ -${hunk.oldStart ?? 1},${oldLines} +${hunk.newStart ?? 1},${newLines} @@`)
    for (const line of lines) {
      parts.push(line === '' ? ' ' : line)
    }
  }
  return parts.join('\n')
}

// ── Text ────────────────────────────────────────────────────────────────────

/** At most `maxLines` lines and `maxChars` characters from the start, with a note when cut. */
export function clip(text: string, maxLines = 1500, maxChars = 60000): { text: string; note?: string } {
  const lines = text.split('\n')
  let out = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : text
  if (out.length > maxChars) {
    out = out.slice(0, maxChars)
    out = out.slice(0, Math.max(0, out.lastIndexOf('\n')))
  }
  if (out.length === text.length) {
    return { text }
  }
  const shown = out === '' ? 0 : out.split('\n').length
  return { text: out, note: `First ${shown} of ${lines.length} lines` }
}

/** The last `n` lines of a text. */
export function tail(text: string, n = 40): string {
  const lines = text.replace(/\s+$/, '').split('\n')
  return lines.slice(-n).join('\n')
}

/** True when text looks binary (a NUL in the first few KB). */
export function looksBinary(text: string): boolean {
  return text.slice(0, 8000).includes('\u0000')
}

// ── Tool results ────────────────────────────────────────────────────────────

/** Files a Grep or Glob result names: its `filenames`, else the lines of its text that look like paths. */
export function searchFiles(result: unknown, text: string | undefined): string[] {
  const r = (result ?? {}) as { filenames?: unknown }
  if (Array.isArray(r.filenames)) {
    return r.filenames.filter((f): f is string => typeof f === 'string')
  }
  const seen = new Set<string>()
  for (const line of (text ?? '').split('\n')) {
    const m = /^([^\s:][^:]*?\.[A-Za-z0-9]+|[^\s:]+\/[^\s:]+)(?::\d+)?(?::|$)/.exec(line.trim())
    if (m?.[1] !== undefined && !/^(Found|No files)/.test(line)) {
      seen.add(m[1])
    }
  }
  return [...seen]
}

/** "exit 0", "exit 2", "interrupted", or "failed". */
export function bashStatus(isError: boolean, result: unknown, text: string | undefined): string {
  const r = (result ?? {}) as { interrupted?: unknown }
  if (r.interrupted === true) {
    return 'interrupted'
  }
  if (!isError) {
    return 'exit 0'
  }
  const m = /Exit code (\d+)/i.exec(String(text ?? (typeof result === 'string' ? result : '')))
  return m === null ? 'failed' : `exit ${m[1]}`
}

/** The output of a Bash result for the viewer: stdout then stderr, or the error text. */
export function bashOutput(result: unknown, text: string | undefined): string {
  const r = (result ?? {}) as { stdout?: unknown; stderr?: unknown }
  const parts = [r.stdout, r.stderr].filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  if (parts.length > 0) {
    return parts.join('\n')
  }
  return typeof result === 'string' ? result : (text ?? '')
}

/** A short, one-line command for labels. */
export function shortCommand(command: string, max = 60): string {
  const line = command.trim().split('\n')[0] ?? ''
  const one = line.length < command.trim().length ? `${line} …` : line
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

// ── Git ─────────────────────────────────────────────────────────────────────

/** The branch from `git status --porcelain=v1 --branch`. */
export function branchOf(stdout: string): string | null {
  const head = stdout.split('\n')[0] ?? ''
  if (head.startsWith('## HEAD (no branch)')) {
    return 'detached'
  }
  const m = /^## (?:No commits yet on |Initial commit on )?([^.\s]+(?:\.(?!\.)[^.\s]+)*)/.exec(head)
  return m?.[1] ?? null
}

/** "claude-opus-5-5" → "Opus 5.5"; anything else as given. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id)
  if (m === null || m[1] === undefined) {
    return id
  }
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return m[3] === undefined || m[3].length > 2 ? `${family} ${m[2]}` : `${family} ${m[2]}.${m[3]}`
}

// ── MCP tools ───────────────────────────────────────────────────────────────
// Work routed through an MCP server (`mcp__<server>__<tool>`) is recognised by
// its input's shape, as Workbench does, plus reads. Its results carry no
// structured patch, so a change is rebuilt from the input.

export type McpTouch =
  | { kind: 'read'; path: string; more: number }
  | { kind: 'edit'; path: string; oldText: string; newText: string; adds: number; dels: number }
  | { kind: 'write'; path: string; content: string; adds: number }
  | { kind: 'shell'; command: string }
  | { kind: 'checks'; label: string }

/** Lines in a text, a trailing newline not counted as one more. */
export function lineCount(s: string): number {
  return s === '' ? 0 : s.split('\n').length - (s.endsWith('\n') ? 1 : 0)
}

export function classifyMcpTool(tool: string, input: Readonly<Record<string, unknown>>): McpTouch | undefined {
  if (!tool.startsWith('mcp__')) {
    return undefined
  }
  const short = tool.split('__').pop()?.toLowerCase() ?? ''
  const path = [input.path, input.file_path, input.filePath].find((p): p is string => typeof p === 'string')
  if (path !== undefined && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return {
      kind: 'edit', path, oldText: input.old_string, newText: input.new_string,
      adds: lineCount(input.new_string), dels: lineCount(input.old_string),
    }
  }
  if (path !== undefined && typeof input.content === 'string' && /write|create|save|put/.test(short)) {
    return { kind: 'write', path, content: input.content, adds: lineCount(input.content) }
  }
  if (typeof input.command === 'string' && /bash|shell|exec|run|terminal/.test(short)) {
    return { kind: 'shell', command: input.command }
  }
  if (/(^|_)(run_?)?(checks?|tests?)$/.test(short)) {
    return { kind: 'checks', label: short.replace(/_/g, ' ') }
  }
  if (/read|view|open|cat/.test(short)) {
    const paths = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === 'string') : []
    const first = path ?? paths[0]
    if (first !== undefined) {
      return { kind: 'read', path: first, more: Math.max(0, paths.length - (path === undefined ? 1 : 0)) }
    }
  }
  return undefined
}

/** A one-hunk diff replacing `oldText` with `newText` at line `at`. */
export function replacementDiff(oldText: string, newText: string, at = 1): string {
  const strip = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s)
  const olds = oldText === '' ? [] : strip(oldText).split('\n')
  const news = newText === '' ? [] : strip(newText).split('\n')
  return [`@@ -${at},${olds.length} +${at},${news.length} @@`, ...olds.map(l => `-${l}`), ...news.map(l => `+${l}`)].join('\n')
}

/** The 1-based line where `needle` starts in `text`, or undefined. */
export function lineOf(text: string, needle: string): number | undefined {
  const i = needle === '' ? -1 : text.indexOf(needle)
  return i < 0 ? undefined : text.slice(0, i).split('\n').length
}

/** The readable text of an MCP result: its text blocks, else the text the model read. */
export function mcpText(result: unknown, text: string | undefined): string {
  if (typeof result === 'string') {
    return result
  }
  const content = (result as { content?: unknown } | null)?.content
  if (Array.isArray(content)) {
    const parts = content
      .map(b => (b !== null && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? (b as { text?: unknown }).text : undefined))
      .filter((t): t is string => typeof t === 'string')
    if (parts.length > 0) {
      return parts.join('\n')
    }
  }
  return text ?? ''
}
