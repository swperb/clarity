// Home: pure helpers for the journal, presence and the briefing. No `$`.
import type { Entry, Journal, JournalEvent, JournalKind, Limit, Presence } from '../types'
import { liveEntries, needsYou } from './lib'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const KINDS: readonly JournalKind[] = ['done', 'question', 'blocked', 'failed', 'commit', 'push']

/** How many events a journal keeps, and for how long. */
export const JOURNAL_MAX = 300
export const JOURNAL_DAYS = 7

export const DEFAULT_HIBERNATE_MINUTES = 20
/** The Hibernation setting's choices, as the manifest's `userConfig.hibernate.options` lists them. */
export const HIBERNATE_CHOICES = ['off', '10', '15', '20', '30', '45', '60', '90', '120'] as const

/** The setting's value as minutes; 0 is off. Anything unknown reads as the default. */
export function hibernateMinutesOf(setting: unknown): number {
  if (setting === 'off') {
    return 0
  }
  return typeof setting === 'string' && (HIBERNATE_CHOICES as readonly string[]).includes(setting) ? Number(setting) : DEFAULT_HIBERNATE_MINUTES
}

// ── Reading files ───────────────────────────────────────────────────────────

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(text)
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function parseEvent(raw: unknown): JournalEvent | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined
  }
  const e = raw as Partial<JournalEvent>
  if (typeof e.at !== 'number' || typeof e.text !== 'string' || !KINDS.includes(e.kind as JournalKind)) {
    return undefined
  }
  const out: JournalEvent = { at: e.at, kind: e.kind as JournalKind, text: e.text }
  if (typeof e.resolvedAt === 'number') out.resolvedAt = e.resolvedAt
  if (Array.isArray(e.files)) out.files = e.files.filter((f): f is string => typeof f === 'string')
  if (typeof e.cost === 'number') out.cost = e.cost
  if (typeof e.durationMs === 'number') out.durationMs = e.durationMs
  return out
}

/** A journal read from disk, or undefined when it is not one. */
export function parseJournal(text: string): Journal | undefined {
  const j = parseJson(text)
  if (j === undefined || j.v !== 1 || typeof j.id !== 'string' || typeof j.project !== 'string' || !Array.isArray(j.events)) {
    return undefined
  }
  return {
    v: 1,
    id: j.id,
    project: j.project,
    branch: typeof j.branch === 'string' ? j.branch : null,
    events: j.events.map(parseEvent).filter((e): e is JournalEvent => e !== undefined),
  }
}

export function parsePresence(text: string): Presence | undefined {
  const p = parseJson(text)
  if (p === undefined || p.v !== 1 || typeof p.lastSeenAt !== 'number') {
    return undefined
  }
  const num = (x: unknown) => (typeof x === 'number' ? x : null)
  return { v: 1, lastSeenAt: p.lastSeenAt, awaySince: num(p.awaySince), backAt: num(p.backAt), briefedAt: num(p.briefedAt) }
}

// ── Writing the journal ─────────────────────────────────────────────────────

/** The list with `event` added, a week at most and JOURNAL_MAX events at most. */
export function appendEvent(events: readonly JournalEvent[], event: JournalEvent): JournalEvent[] {
  const cutoff = event.at - JOURNAL_DAYS * DAY
  return [...events.filter(e => e.at >= cutoff), event].slice(-JOURNAL_MAX)
}

/** Marks open events of these kinds resolved at `now`. */
export function resolveOpen(events: readonly JournalEvent[], kinds: readonly JournalKind[], now: number): JournalEvent[] {
  return events.map(e => (kinds.includes(e.kind) && e.resolvedAt === undefined ? { ...e, resolvedAt: now } : e))
}

// ── Words: turning an answer or a tool call into one line ───────────────────

function clip(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** Markdown down to plain words: no code fences, headings, emphasis or link targets. */
function plain(text: string): string[] {
  return text
    .replace(/```[\s\S]*?(```|$)/g, '')
    .split('\n')
    .map(l =>
      l
        .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\|/g, ' ')
        .trim(),
    )
    .filter(l => l !== '' && !/^[-=:\s]+$/.test(l))
}

/**
 * What a finished turn did, in one line: the answer's first sentence, plain.
 * Falls back to the task when the answer has no words.
 */
export function answerGist(answer: string, task = ''): string {
  const first = plain(answer)[0]
  if (first === undefined) {
    return task === '' ? 'Finished a turn' : clip(task, 140)
  }
  const sentence = first.match(/^.+?[.!?](\s|$)/)?.[0]?.trim() ?? first
  return clip(sentence, 140)
}

/**
 * The question an answer ends on, if it ends on one: the last sentence of its
 * last lines, when it ends with "?". Questions buried mid-answer don't count.
 */
export function trailingQuestion(answer: string): string | undefined {
  const lines = plain(answer)
  const last = lines[lines.length - 1]
  if (last === undefined || !last.endsWith('?')) {
    return undefined
  }
  const sentences = last.match(/[^.!?]+[.!?]+/g) ?? [last]
  return clip((sentences[sentences.length - 1] ?? last).trim(), 160)
}

/** "Bash: git push --force", "Edit src/auth.ts", "github: create_pull_request" */
export function toolLine(tool: string, input: unknown, root = ''): string {
  const i = (input ?? {}) as Record<string, unknown>
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) {
    return `${mcp[1]}: ${mcp[2]}`
  }
  const path = [i.file_path, i.notebook_path, i.path].find((p): p is string => typeof p === 'string')
  if (path !== undefined) {
    const base = root.endsWith('/') ? root : `${root}/`
    return `${tool} ${root !== '' && path.startsWith(base) ? path.slice(base.length) : path}`
  }
  if (typeof i.command === 'string') {
    return clip(`${tool}: ${i.command.split('\n')[0]?.trim() ?? ''}`, 120)
  }
  if (typeof i.url === 'string') {
    return clip(`${tool} ${i.url}`, 120)
  }
  return tool
}

/** The git work a shell command did: a commit (with its message) or a push. */
export function gitWork(command: string): { kind: 'commit' | 'push'; text: string } | undefined {
  if (/\bgit\b[^|;&]*\bcommit\b/.test(command)) {
    const message = /(?:\s-[a-zA-Z]*m|--message)[= ]\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(command)
    const first = (message?.[1] ?? message?.[2] ?? message?.[3] ?? '').replace(/\\n/g, '\n').split('\n')[0]?.trim()
    // A heredoc message (-m "$(cat <<EOF ...)") reads as its first real line.
    const heredoc = /<<-?\s*'?EOF'?\s*\n([^\n]+)/.exec(command)?.[1]?.trim()
    const text = first !== undefined && first !== '' && !first.startsWith('$(') ? first : heredoc ?? 'Committed'
    return { kind: 'commit', text: clip(text, 120) }
  }
  const push = /\bgit\b[^|;&]*\bpush\b(.*)/.exec(command)
  if (push) {
    const args = (push[1] ?? '').split(/[|;&]/)[0]?.trim().split(/\s+/).filter(a => a !== '' && !a.startsWith('-')) ?? []
    return { kind: 'push', text: args.length > 0 ? `Pushed ${args.join(' ')}` : 'Pushed' }
  }
  return undefined
}

/** A StopFailure error, said plainly. */
export function failureLine(error: string): string {
  const words: Record<string, string> = {
    rate_limit: "Hit the plan's usage limit",
    overloaded: 'The API was overloaded',
    billing_error: 'A billing problem stopped it',
    authentication_failed: 'Signed out: authentication failed',
    max_output_tokens: 'Ran out of output room mid-answer',
    server_error: 'An API server error stopped it',
  }
  return words[error] ?? `Stopped on an error (${error.replace(/_/g, ' ')})`
}

// ── Presence and hibernation ────────────────────────────────────────────────

export function isAway(p: Presence | null | undefined): boolean {
  return p != null && p.awaySince !== null && p.backAt === null
}

/** The person did something: they are here. */
export function seen(p: Presence | null | undefined, now: number): Presence {
  const base: Presence = p ?? { v: 1, lastSeenAt: now, awaySince: null, backAt: null, briefedAt: null }
  return { ...base, lastSeenAt: now, backAt: isAway(base) ? now : base.backAt }
}

/**
 * The hibernation tick: when nobody has been seen for `afterMs`, start an away
 * stretch from the moment they were last seen. A briefing they came back to and
 * never dismissed is replaced, so it never counts time they were here.
 */
export function hibernate(p: Presence | null | undefined, now: number, afterMs: number): Presence | undefined {
  if (p == null || isAway(p) || now - p.lastSeenAt < afterMs) {
    return undefined
  }
  return { ...p, awaySince: p.lastSeenAt, backAt: null }
}

/** "Got it": the briefing is read; the next one starts from here. */
export function dismiss(p: Presence | null | undefined, now: number): Presence {
  return { ...(p ?? { v: 1, lastSeenAt: now, awaySince: null, backAt: null }), awaySince: null, backAt: null, briefedAt: now }
}

export type BriefWindow = { from: number; until: number; label: string; isAway: boolean }

/**
 * What the briefing covers: the away stretch while there is one (until now, or
 * until they came back), else since the last briefing, else today.
 */
export function briefWindow(p: Presence | null | undefined, now: number, view: 'away' | 'today', midnight: number): BriefWindow {
  if (view === 'away' && p != null && p.awaySince !== null) {
    const until = p.backAt ?? now
    return { from: p.awaySince, until: now, label: `While you were away · ${formatSpan(until - p.awaySince)}`, isAway: true }
  }
  if (view === 'away' && p != null && p.briefedAt !== null && p.briefedAt > midnight) {
    return { from: p.briefedAt, until: now, label: `Since your last briefing · ${formatSpan(now - p.briefedAt)}`, isAway: false }
  }
  return { from: midnight, until: now, label: 'Today', isAway: false }
}

function formatSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN))
  if (m < 60) return `${m}m`
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(m / 1440)}d`
}

// ── The briefing ────────────────────────────────────────────────────────────

export type BriefItem = { id: string; project: string; branch: string | null; at: number; event: JournalEvent }

export type NeedItem = {
  key: string
  project: string
  /** question: it asked you something. blocked: waiting on a permission. waiting: done, your move. failed: stopped on an error. */
  kind: 'question' | 'blocked' | 'waiting' | 'failed'
  text: string
  since: number
}

export type Briefing = {
  /** Projects that saw any work in the window, busiest first. */
  projects: { project: string; done: BriefItem[]; git: BriefItem[] }[]
  needs: NeedItem[]
  /** What held it up in the window and has since cleared. */
  heldUp: BriefItem[]
  /** Sessions still working now. */
  working: Entry[]
  stats: { turns: number; files: number; commits: number; pushes: number; spend: number; sessions: number; worked: number }
  /** The freshest rate-limit reading any session has. */
  limits: Limit[]
  /** Live sessions whose context is 80% full or more. */
  fullContexts: Entry[]
}

/**
 * Everything the home pane shows, from every session's journal and the ledger.
 * Open questions and blocks of sessions that are gone are dropped: nobody can
 * answer them any more.
 */
export function brief(journals: readonly Journal[], entries: readonly Entry[], from: number, now: number): Briefing {
  const live = liveEntries(entries, now)
  const liveIds = new Set(live.map(e => e.id))
  const items: BriefItem[] = []
  for (const j of journals) {
    for (const event of j.events) {
      items.push({ id: j.id, project: j.project, branch: j.branch, at: event.at, event })
    }
  }
  const inWindow = items.filter(i => i.at >= from && i.at <= now).sort((a, b) => a.at - b.at)

  const needs: NeedItem[] = []
  const covered = new Set<string>()
  for (const i of items) {
    const { kind, resolvedAt, text } = i.event
    if ((kind === 'question' || kind === 'blocked') && resolvedAt === undefined && liveIds.has(i.id)) {
      needs.push({ key: `${i.id}:${i.at}`, project: i.project, kind, text, since: i.at })
      covered.add(i.id)
    }
  }
  for (const e of needsYou(live)) {
    if (!covered.has(e.id)) {
      const kind = e.state === 'failed' ? 'failed' : 'waiting'
      needs.push({ key: `${e.id}:${kind}`, project: e.project, kind, text: e.task === '' ? 'Finished its turn' : e.task, since: e.since })
    }
  }
  const order = { question: 0, blocked: 1, failed: 2, waiting: 3 }
  needs.sort((a, b) => order[a.kind] - order[b.kind] || a.since - b.since)

  const byProject = new Map<string, { project: string; done: BriefItem[]; git: BriefItem[] }>()
  const group = (p: string) => {
    const g = byProject.get(p) ?? { project: p, done: [], git: [] }
    byProject.set(p, g)
    return g
  }
  const files = new Set<string>()
  const sessions = new Set<string>()
  let spend = 0
  for (const i of inWindow) {
    sessions.add(i.id)
    if (i.event.kind === 'done') {
      group(i.project).done.push(i)
      for (const f of i.event.files ?? []) files.add(`${i.project}/${f}`)
      spend += i.event.cost ?? 0
    } else if (i.event.kind === 'commit' || i.event.kind === 'push') {
      group(i.project).git.push(i)
    }
  }
  const projects = [...byProject.values()].sort((a, b) => b.done.length + b.git.length - (a.done.length + a.git.length) || a.project.localeCompare(b.project))

  const heldUp = inWindow.filter(i => (i.event.kind === 'blocked' && i.event.resolvedAt !== undefined) || i.event.kind === 'failed')

  const freshest = [...entries].filter(e => e.limits.length > 0).sort((a, b) => b.heartbeatAt - a.heartbeatAt)[0]

  return {
    projects,
    needs,
    heldUp,
    working: live.filter(e => e.state === 'working'),
    stats: {
      turns: inWindow.filter(i => i.event.kind === 'done').length,
      files: files.size,
      commits: inWindow.filter(i => i.event.kind === 'commit').length,
      pushes: inWindow.filter(i => i.event.kind === 'push').length,
      spend,
      sessions: sessions.size,
      worked: inWindow.filter(i => i.event.kind === 'done').reduce((ms, i) => ms + (i.event.durationMs ?? 0), 0),
    },
    limits: freshest?.limits ?? [],
    fullContexts: live.filter(e => (e.context ?? 0) >= 80),
  }
}

/** The home widget's line: "Away 1h 12m · 4 done · 2 need you" */
export function homeGlance(b: Briefing, isAwayView: boolean, awayMs: number): string {
  const parts: string[] = []
  if (isAwayView) parts.push(`Away ${formatSpan(awayMs)}`)
  parts.push(`${b.stats.turns} done`)
  if (b.needs.length > 0) parts.push(`${b.needs.length} need${b.needs.length === 1 ? 's' : ''} you`)
  if (b.working.length > 0) parts.push(`${b.working.length} working`)
  return parts.join(' · ')
}

/** "good morning", "good afternoon", "good evening" by the local hour. */
export function greeting(now: number): string {
  const h = new Date(now).getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export { formatSpan }
