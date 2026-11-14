// Pure helpers: no `$`, so they are easy to test and reason about.
import type { ThemeSetArgs } from 'claude-code'

import type { Collision, Entry, Place, SessionState } from '../types'
import { makeColors } from './make-colors.js'

export const STALE_MS = 10 * 60 * 1000
const STATES: readonly SessionState[] = ['working', 'waiting', 'idle', 'failed', 'ended']

// ── Reading the ledger ──────────────────────────────────────────────────────

/** An entry read from disk, or undefined when it is not one (half-written, another version). */
export function parseEntry(text: string): Entry | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const e = raw as Partial<Entry> | null
  if (
    e === null ||
    typeof e !== 'object' ||
    e.v !== 1 ||
    typeof e.id !== 'string' ||
    typeof e.project !== 'string' ||
    typeof e.repo !== 'string' ||
    typeof e.heartbeatAt !== 'number' ||
    typeof e.since !== 'number' ||
    !STATES.includes(e.state as SessionState)
  ) {
    return undefined
  }
  return {
    v: 1,
    id: e.id,
    project: e.project,
    repo: e.repo,
    root: typeof e.root === 'string' ? e.root : e.repo,
    branch: typeof e.branch === 'string' ? e.branch : null,
    state: e.state as SessionState,
    task: typeof e.task === 'string' ? e.task : '',
    startedAt: typeof e.startedAt === 'number' ? e.startedAt : e.since,
    since: e.since,
    heartbeatAt: e.heartbeatAt,
    cost: typeof e.cost === 'number' ? e.cost : null,
    context: typeof e.context === 'number' ? e.context : null,
    files: Array.isArray(e.files) ? e.files.filter((f): f is string => typeof f === 'string') : [],
  }
}

/** Entries that are neither ended nor silent for over ten minutes. */
export function liveEntries(entries: readonly Entry[], now: number): Entry[] {
  return entries.filter(e => e.state !== 'ended' && now - e.heartbeatAt <= STALE_MS)
}

/** Waiting on you or failed, longest wait first. */
export function needsYou(live: readonly Entry[]): Entry[] {
  return live.filter(e => e.state === 'waiting' || e.state === 'failed').sort((a, b) => a.since - b.since)
}

/** Projects alphabetically; in each, working first, then by how long it has been in that state. */
export function byProject(live: readonly Entry[]): [string, Entry[]][] {
  const order: Record<SessionState, number> = { failed: 0, waiting: 1, working: 2, idle: 3, ended: 4 }
  const groups = new Map<string, Entry[]>()
  for (const e of live) {
    groups.set(e.project, [...(groups.get(e.project) ?? []), e])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => [name, [...list].sort((a, b) => order[a.state] - order[b.state] || a.since - b.since)])
}

/** Local midnight before `now`. */
export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** What every session alive at some point today has cost, ended ones included. */
export function spendToday(entries: readonly Entry[], now: number): number {
  const midnight = startOfDay(now)
  return entries.filter(e => e.heartbeatAt >= midnight).reduce((sum, e) => sum + (e.cost ?? 0), 0)
}

/** "5 working · 2 need you · $14.20 today" */
export function glance(entries: readonly Entry[], now: number): string {
  const live = liveEntries(entries, now)
  if (live.length === 0) {
    return 'No sessions running'
  }
  const working = live.filter(e => e.state === 'working').length
  const waiting = needsYou(live).length
  const parts = [`${working} working`]
  if (waiting > 0) {
    parts.push(`${waiting} need${waiting === 1 ? 's' : ''} you`)
  } else if (working === 0) {
    parts[0] = `${live.length} idle`
  }
  parts.push(`${formatCost(spendToday(entries, now))} today`)
  return parts.join(' · ')
}

/** The ledger files worth deleting: ended over a day ago, or silent for a week. */
export function prunable(entries: readonly Entry[], now: number): string[] {
  const day = 24 * 60 * 60 * 1000
  return entries
    .filter(e => (e.state === 'ended' && now - e.heartbeatAt > day) || now - e.heartbeatAt > 7 * day)
    .map(e => e.id)
}

// ── Collisions ──────────────────────────────────────────────────────────────

/** Files `self` edited that another live session in the same repo edited too. */
export function collisionsFor(self: Entry, live: readonly Entry[]): Collision[] {
  const mine = new Set(self.files)
  const found: Collision[] = []
  for (const other of live) {
    if (other.id === self.id || other.repo !== self.repo) {
      continue
    }
    for (const file of other.files) {
      if (mine.has(file)) {
        found.push({ file, otherId: other.id, otherBranch: other.branch, otherTask: other.task })
      }
    }
  }
  return found
}

export function collisionKey(c: Collision): string {
  return `${c.otherId}:${c.file}`
}

// ── Places and words ────────────────────────────────────────────────────────

function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * Where a session sits, from `git rev-parse --show-toplevel --path-format=absolute
 * --git-common-dir --abbrev-ref HEAD` output (or none, outside a repo).
 */
export function placeOf(cwd: string, gitOutput: string | undefined): Place {
  const [top, common, head] = (gitOutput ?? '').split('\n').map(s => s.trim())
  if (top === undefined || top === '' || common === undefined || common === '') {
    return { project: basename(cwd), repo: cwd, root: cwd, branch: null }
  }
  // Worktrees share the common dir, so they count as one project and one repo.
  const repoTop = /[\\/]\.git$/.test(common) ? common.replace(/[\\/]\.git$/, '') : top
  return {
    project: basename(repoTop),
    repo: common,
    root: top,
    branch: head === undefined || head === '' || head === 'HEAD' ? null : head,
  }
}

/** The first line of a prompt, trimmed to fit a card. */
export function taskLine(text: string): string {
  const line = text.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}

/** A path relative to `root` when it is inside it. */
export function relativeTo(root: string, path: string): string {
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** "now", "4m", "1h 05m", "2d" */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 1) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 48 * 60) {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  }
  return `${Math.floor(minutes / 1440)}d`
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

// ── Project tint ────────────────────────────────────────────────────────────

/** A stable hue for a name: FNV-1a, folded to 0–359. */
export function hueOf(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 360
}

export function hsl(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
  }
  return `#${[f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * A light and a dark look washed in the project's hue: the accent in full, the
 * grays barely tinted so text stays crisp. No `git` block: diffs keep the app's
 * own green and red.
 */
export function tintFor(project: string): { look: ThemeSetArgs; problems: string[] } {
  const h = hueOf(project)
  const { theme, problems } = makeColors({
    label: `Factory: ${project}`,
    roles: { accent: hsl(h, 60, 45) },
    light: {
      gray: {
        anchors: {
          'surface-0': hsl(h, 28, 94),
          'surface-1': hsl(h, 28, 96.5),
          'surface-2': hsl(h, 28, 98.5),
          'surface-3': hsl(h, 28, 98.5),
          'text-primary': hsl(h, 20, 12),
          'text-secondary': hsl(h, 15, 28),
          'text-muted': hsl(h, 12, 38),
        },
      },
    },
    dark: {
      gray: {
        anchors: {
          'surface-0': hsl(h, 18, 9),
          'surface-1': hsl(h, 16, 12),
          'surface-2': hsl(h, 14, 15),
          'surface-3': hsl(h, 12, 18),
          'text-primary': hsl(h, 20, 93),
          'text-secondary': hsl(h, 12, 78),
          'text-muted': hsl(h, 10, 66),
        },
      },
    },
  })
  return { look: { colors: theme }, problems }
}
