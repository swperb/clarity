// Pure helpers: no `$`, so they are easy to test and reason about.
import type { GitState } from '../types'

// ── Risky shell commands ────────────────────────────────────────────────────
// Each rule returns a plain-English reason that the permission dialog shows.
// The bar is "hard or impossible to undo", not "unusual": a guard that cries
// wolf gets switched off.

const RULES: readonly (readonly [RegExp, string])[] = [
  [/\bgit\s+push\b[^;&|]*\s(--force(?!-with-lease)|-f\b|--mirror)/, 'force-pushes, which can overwrite commits on the remote'],
  [/\bgit\s+push\b[^;&|]*\s(--delete|-d)\b/, 'deletes a branch on the remote'],
  [/\bgit\s+reset\b[^;&|]*\s--hard\b/, 'throws away uncommitted changes for good'],
  [/\bgit\s+clean\b[^;&|]*\s-[a-zA-Z]*f/, 'deletes untracked files for good'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$|;|&)/, 'throws away every uncommitted edit in this folder'],
  [/\bgit\s+branch\b[^;&|]*\s-D\b/, 'deletes a branch even if it was never merged'],
  [/\bgit\s+stash\s+(drop|clear)\b/, 'deletes stashed work for good'],
  [/\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, 'drops database data'],
  [/\b(mkfs(\.\w+)?|diskutil\s+(erase\w*|partitionDisk))\b|\bdd\b[^;&|]*\bof=\/dev\//, 'erases a disk'],
  [/\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, 'runs a script straight from the internet'],
  [/\b(npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bgh\s+release\s+create\b/, 'publishes a release for everyone to download'],
  [/\bterraform\s+(destroy|apply\b[^;&|]*-auto-approve)|\bkubectl\s+delete\b|\bhelm\s+(uninstall|delete)\b/, 'changes live infrastructure'],
  [/\bgh\s+repo\s+delete\b/, 'deletes a GitHub repository'],
  [/\bdocker\s+(system\s+prune\b[^;&|]*-a|volume\s+(rm|prune)\b)/, 'deletes Docker volumes or images'],
  [/\bchmod\s+-R\s+0?777\b/, 'makes files writable by everyone'],
]

const SHALLOW_TARGETS = new Set(['/', '/*', '~', '~/', '~/*', '$HOME', '${HOME}', '*', '.', './', './*', '..', '../', '../*'])

/** True when an `rm` target is a root, home, the current folder, or one level below root/home. */
function isSweepingTarget(target: string): boolean {
  const t = target.replace(/^["']|["']$/g, '')
  if (SHALLOW_TARGETS.has(t)) {
    return true
  }
  if (/^\/[^/]+\/?$/.test(t)) {
    return true // /usr, /etc
  }
  if (/^\/(Users|home)\/[^/]+\/?$/.test(t)) {
    return true // someone's home
  }
  return /^(~|\$HOME|\$\{HOME\})\/[^/*]+\/?$/.test(t) // ~/Documents
}

function rmReason(command: string): string | undefined {
  for (const segment of command.split(/;|&&|\|\||\||\n/)) {
    const words = segment.trim().split(/\s+/).filter(w => w !== 'sudo')
    if (words[0] !== 'rm') {
      continue
    }
    const flags = words.filter(w => w.startsWith('-'))
    const isRecursive = flags.some(f => f === '--recursive' || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)))
    if (isRecursive && words.slice(1).filter(w => !w.startsWith('-')).some(isSweepingTarget)) {
      return 'recursively deletes a whole folder tree (root, home, or everything here)'
    }
  }
  return undefined
}

/** Why a command is risky, in a phrase that follows "This command …", or undefined. */
export function riskOf(command: string): string | undefined {
  const rm = rmReason(command)
  if (rm !== undefined) {
    return rm
  }
  for (const [pattern, reason] of RULES) {
    if (pattern.test(command)) {
      return reason
    }
  }
  return undefined
}

// ── Test runs ───────────────────────────────────────────────────────────────

const TEST_RUNNER =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(npx\s+|bunx\s+)?(jest|vitest|mocha|ava)\b|\bplaywright\s+test\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bcargo\s+(test|nextest)\b|\bgo\s+test\b|\bmake\s+(test|check)\b|\bgradlew?\s+test\b|\bmvn\s+test\b|\bdotnet\s+test\b|\bswift\s+test\b|\bxcodebuild\b[^;&|]*\btest\b|\brspec\b|\bmix\s+test\b|\bctest\b|\bclaude\s+plugin\s+test\b|\bdeno\s+test\b/

/** The test command inside a shell command, shortened for display, or undefined. */
export function testCommandOf(command: string): string | undefined {
  const match = TEST_RUNNER.exec(command)
  return match === null ? undefined : match[0].replace(/\s+/g, ' ').trim()
}

// ── Git ─────────────────────────────────────────────────────────────────────

/** Parses `git status --porcelain=v1 --branch`. */
export function parseGitStatus(stdout: string): GitState {
  const [head = '', ...rest] = stdout.split('\n')
  const branchMatch = /^## (?:No commits yet on )?([^.\s]+)/.exec(head)
  const ahead = /ahead (\d+)/.exec(head)
  const behind = /behind (\d+)/.exec(head)
  return {
    branch: branchMatch?.[1] ?? 'HEAD',
    dirty: rest.filter(line => line.trim() !== '').length,
    ahead: ahead === null ? 0 : Number(ahead[1]),
    behind: behind === null ? 0 : Number(behind[1]),
  }
}

// ── Diffs ───────────────────────────────────────────────────────────────────

type Hunk = { lines: readonly string[] }

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

/** A path relative to the session folder when it is inside it. */
export function relativeTo(cwd: string, path: string): string {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** "23m", "1h 05m". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** "56k", "1.2M", "820". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 1000) {
    return `${Math.round(n / 1000)}k`
  }
  return String(n)
}

/** "in 2h 10m" until an ISO timestamp, from `now` in milliseconds. */
export function untilReset(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) {
    return 'soon'
  }
  const ms = at - now
  if (ms <= 0) {
    return 'now'
  }
  const minutes = Math.ceil(ms / 60000)
  if (minutes < 60) {
    return `in ${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return `in ${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  }
  return `in ${Math.round(hours / 24)} days`
}

// ── Test outcomes ───────────────────────────────────────────────────────────
// A shell's exit code belongs to its LAST command, so `npm test; ls` exits 0
// even when the tests failed. Read the runner's own summary first.

const FAILED =
  /^# fail [1-9]|\b[1-9]\d* (failed|failing|failures?)\b|^FAILED\b|test result: FAILED|Tests?:\s+[1-9]\d* failed|\bERR_ASSERTION\b|^not ok \d/im
const PASSED = /^# fail 0\b|\b0 (failed|failures)\b|test result: ok|Tests?:\s+\d+ passed(?!.*failed)|\b\d+ passed\b|^ok \d/im

/** Whether the test runner is the last command in the line, so the exit code is its own. */
export function isTestLast(command: string): boolean {
  const segments = command.split(/;|&&|\|\||\n/).map(s => s.trim()).filter(Boolean)
  const last = segments[segments.length - 1] ?? ''
  return testCommandOf(last.split('|')[0] ?? '') !== undefined
}

/** pass / fail from the output, else from the exit code when it's the runner's own; undefined if unknown. */
export function testOutcome(output: string | undefined, isError: boolean, isExitCodeTheRunners: boolean): 'pass' | 'fail' | undefined {
  const text = output ?? ''
  if (FAILED.test(text)) {
    return 'fail'
  }
  if (PASSED.test(text)) {
    return 'pass'
  }
  return isExitCodeTheRunners ? (isError ? 'fail' : 'pass') : undefined
}

// ── Tools from any MCP server ───────────────────────────────────────────────
// Recognised by name and input shape, so file and test tools from servers
// other than the built-ins (an editor bridge, a job runner) still count.

export type McpTouch =
  | { kind: 'edit'; path: string; adds: number; dels: number }
  | { kind: 'write'; path: string; adds: number }
  | { kind: 'checks'; label: string }
  | { kind: 'shell'; command: string }

const lines = (s: unknown): number => (typeof s === 'string' && s !== '' ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0)

export function classifyMcpTool(tool: string, input: Record<string, unknown>): McpTouch | undefined {
  if (!tool.startsWith('mcp__')) {
    return undefined
  }
  const short = tool.split('__').pop()?.toLowerCase() ?? ''
  const path = [input.path, input.file_path, input.filePath].find((p): p is string => typeof p === 'string')
  if (path !== undefined && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return { kind: 'edit', path, adds: lines(input.new_string), dels: lines(input.old_string) }
  }
  if (path !== undefined && typeof input.content === 'string' && /write|create|save|put/.test(short)) {
    return { kind: 'write', path, adds: lines(input.content) }
  }
  if (typeof input.command === 'string' && /bash|shell|exec|run|terminal/.test(short)) {
    return { kind: 'shell', command: input.command }
  }
  if (/(^|_)(run_?)?(checks?|tests?)$/.test(short)) {
    return { kind: 'checks', label: short.replace(/_/g, ' ') }
  }
  return undefined
}
