// The dashboard's numbers: pure functions over the ledger (every session's
// entry) and the journals (what each session did), so the pane only draws.
import type { Entry, Journal, Limit } from '../types'
import { brief } from './home-lib'
import type { NeedItem } from './home-lib'
import { formatCost, hsl, hueOf, liveEntries } from './lib'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** today: since midnight, by the hour. week: the last seven days, by the day. */
export type Range = 'today' | 'week'

export type Bucket = {
  start: number
  /** `09` for an hour, `Mon` for a day. */
  label: string
  spend: number
  tasks: number
  /** Spend by project, for the stacked bars. */
  byProject: Record<string, number>
}

export type ProjectRow = {
  project: string
  /** Live sessions in it now, by state. */
  live: number
  working: number
  needsYou: number
  /** In the range. */
  tasks: number
  files: number
  commits: number
  spend: number
  /** The last time anything happened in it. */
  lastAt: number
}

export type Dashboard = {
  range: Range
  from: number
  kpis: {
    live: number
    working: number
    needsYou: number
    tasks: number
    /** Every session alive in the range, at its whole cost (as Home's "today"), or its tasks' costs where larger. */
    spend: number
    commits: number
    /** The fullest rate-limit window, or null when no session has read one. */
    fullestLimit: Limit | null
  }
  /** Spend the charts can't place in time: sessions' cost from before their journals, or a turn still running. */
  untimedSpend: number
  needs: NeedItem[]
  projects: ProjectRow[]
  buckets: Bucket[]
  /** Live sessions, the ones needing you first, then working, then the rest. */
  sessions: Entry[]
  limits: Limit[]
  fullContexts: Entry[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Where a range starts: midnight today, or midnight six days ago. */
export function rangeStart(range: Range, midnight: number): number {
  return range === 'today' ? midnight : midnight - 6 * DAY
}

/** Empty buckets covering the range: today's hours up to now, or seven days. */
export function bucketsFor(range: Range, midnight: number, now: number): Bucket[] {
  const out: Bucket[] = []
  if (range === 'today') {
    for (let start = midnight; start <= now; start += HOUR) {
      out.push({ start, label: String(new Date(start).getHours()).padStart(2, '0'), spend: 0, tasks: 0, byProject: {} })
    }
  } else {
    for (let i = 6; i >= 0; i -= 1) {
      // Step by calendar day, so a clock change doesn't shift the labels.
      const d = new Date(midnight)
      d.setDate(d.getDate() - i)
      out.push({ start: d.getTime(), label: DAY_NAMES[d.getDay()] ?? '', spend: 0, tasks: 0, byProject: {} })
    }
  }
  return out
}

export function dashboard(journals: readonly Journal[], entries: readonly Entry[], range: Range, now: number, midnight: number): Dashboard {
  const from = rangeStart(range, midnight)
  const b = brief(journals, entries, from, now)
  const live = liveEntries(entries, now)
  const needIds = new Set(b.needs.map(n => n.key.split(':')[0]))

  const buckets = bucketsFor(range, midnight, now)
  const rows = new Map<string, ProjectRow & { fileSet: Set<string> }>()
  const row = (project: string) => {
    let r = rows.get(project)
    if (r === undefined) {
      r = { project, live: 0, working: 0, needsYou: 0, tasks: 0, files: 0, commits: 0, spend: 0, lastAt: 0, fileSet: new Set() }
      rows.set(project, r)
    }
    return r
  }

  for (const e of live) {
    const r = row(e.project)
    r.live += 1
    if (e.state === 'working') r.working += 1
    if (needIds.has(e.id)) r.needsYou += 1
    r.lastAt = Math.max(r.lastAt, e.since)
  }

  let tasks = 0
  let commits = 0
  /** Spend the journals place in time, task by task. */
  let timed = 0
  for (const j of journals) {
    for (const ev of j.events) {
      if (ev.at < from || ev.at > now) continue
      const r = row(j.project)
      r.lastAt = Math.max(r.lastAt, ev.at)
      if (ev.kind === 'done') {
        const cost = ev.cost ?? 0
        r.tasks += 1
        r.spend += cost
        for (const f of ev.files ?? []) r.fileSet.add(f)
        tasks += 1
        timed += cost
        const bucket = [...buckets].reverse().find(x => x.start <= ev.at)
        if (bucket !== undefined) {
          bucket.tasks += 1
          bucket.spend += cost
          bucket.byProject[j.project] = (bucket.byProject[j.project] ?? 0) + cost
        }
      } else if (ev.kind === 'commit') {
        r.commits += 1
        commits += 1
      }
    }
  }

  // The journals start when Factory 1.1 loaded, and a turn still running has
  // logged nothing; the ledger holds each session's whole cost. A project's
  // spend is whichever is larger: the ledger's sessions alive in the range, or
  // its tasks' costs (a session ended and pruned from the ledger).
  const ledgerSpend = new Map<string, number>()
  for (const e of entries) {
    if (e.heartbeatAt >= from && e.cost !== null) {
      row(e.project)
      ledgerSpend.set(e.project, (ledgerSpend.get(e.project) ?? 0) + e.cost)
    }
  }
  for (const r of rows.values()) {
    r.spend = Math.max(r.spend, ledgerSpend.get(r.project) ?? 0)
  }
  const spend = [...rows.values()].reduce((sum, r) => sum + r.spend, 0)

  const projects: ProjectRow[] = [...rows.values()]
    .map(({ fileSet, ...r }) => ({ ...r, files: fileSet.size }))
    .sort((a, c) => c.needsYou - a.needsYou || c.working - a.working || c.spend - a.spend || c.tasks - a.tasks || a.project.localeCompare(c.project))

  const order = (e: Entry) => (needIds.has(e.id) ? 0 : e.state === 'working' ? 1 : e.state === 'failed' ? 0 : 2)
  const sessions = [...live].sort((a, c) => order(a) - order(c) || a.project.localeCompare(c.project) || a.since - c.since)

  const fullestLimit = b.limits.reduce<Limit | null>((m, l) => (m === null || l.percentUsed > m.percentUsed ? l : m), null)

  return {
    range,
    from,
    kpis: {
      live: live.length,
      working: live.filter(e => e.state === 'working').length,
      needsYou: b.needs.length,
      tasks,
      spend,
      commits,
      fullestLimit,
    },
    untimedSpend: Math.max(0, spend - timed),
    needs: b.needs,
    projects,
    buckets,
    sessions,
    limits: b.limits,
    fullContexts: b.fullContexts,
  }
}

/** The minimized widget's one line. */
export function dashboardGlance(d: Dashboard): string {
  const parts = [`${d.kpis.live} live`]
  if (d.kpis.needsYou > 0) parts.push(`${d.kpis.needsYou} need${d.kpis.needsYou === 1 ? 's' : ''} you`)
  parts.push(`${d.kpis.tasks} done`, `${formatCost(d.kpis.spend)} ${d.range === 'today' ? 'today' : 'this week'}`)
  return parts.join(' · ')
}

// ── Charts ──────────────────────────────────────────────────────────────────
// Drawn as SVG strings. The surface paints them as an isolated image, so no
// theme token reaches them: mid-tone colors read on light and dark, and the
// text follows the app's color scheme by media query.

export function projectColor(project: string): string {
  return hsl(hueOf(project), 55, 52)
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const STYLE = '<style>text{font:11px -apple-system,system-ui,sans-serif;fill:#6b7280}.grid{stroke:#9ca3af;stroke-opacity:.25}@media (prefers-color-scheme:dark){text{fill:#9ca3af}}</style>'

/**
 * Spend per bucket as bars stacked by project, the task count as a line over
 * them; each bar's tooltip says the bucket's spend, tasks and projects.
 */
export function timelineSvg(buckets: readonly Bucket[], width = 560, height = 180): string {
  const padL = 44
  const padR = 28
  const padT = 10
  const padB = 22
  const plotW = width - padL - padR
  const plotH = height - padT - padB
  const maxSpend = Math.max(0.01, ...buckets.map(x => x.spend))
  const maxTasks = Math.max(1, ...buckets.map(x => x.tasks))
  const slot = plotW / Math.max(1, buckets.length)
  const barW = Math.max(2, Math.min(36, slot * 0.7))

  const parts: string[] = [STYLE]
  for (const f of [0, 0.5, 1]) {
    const gy = padT + plotH - f * plotH
    parts.push(`<line class="grid" x1="${padL}" x2="${width - padR}" y1="${gy}" y2="${gy}"/>`)
    parts.push(`<text x="${padL - 6}" y="${gy + 4}" text-anchor="end">${esc(formatCost(maxSpend * f))}</text>`)
  }
  const every = Math.max(1, Math.ceil(buckets.length / 12))
  buckets.forEach((bk, i) => {
    const x = padL + i * slot + (slot - barW) / 2
    let top = padT + plotH
    const projects = Object.entries(bk.byProject).filter(([, v]) => v > 0).sort(([a], [c]) => a.localeCompare(c))
    const tip = esc(
      [`${bk.label}: ${formatCost(bk.spend)} · ${bk.tasks} task${bk.tasks === 1 ? '' : 's'}`, ...projects.map(([p, v]) => `${p} ${formatCost(v)}`)].join('\n'),
    )
    parts.push(`<g><title>${tip}</title>`)
    // An invisible full-height target, so the tooltip shows over empty buckets too.
    parts.push(`<rect x="${x}" y="${padT}" width="${barW}" height="${plotH}" fill="transparent"/>`)
    for (const [p, v] of projects) {
      const h = (v / maxSpend) * plotH
      top -= h
      parts.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" rx="2" fill="${projectColor(p)}"/>`)
    }
    parts.push('</g>')
    if (i % every === 0) {
      parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(bk.label)}</text>`)
    }
  })
  // Tasks as a line on its own scale (right axis).
  const pts = buckets.map((bk, i) => `${(padL + i * slot + slot / 2).toFixed(1)},${(padT + plotH - (bk.tasks / maxTasks) * plotH).toFixed(1)}`)
  if (buckets.length > 1) {
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="3 3"/>`)
  }
  parts.push(`<text x="${width - padR + 6}" y="${padT + 4}">${maxTasks}</text>`)
  parts.push(`<text x="${width - padR + 6}" y="${padT + plotH + 4}">0</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`
}

/** Spend by project, one horizontal bar each, biggest first. */
export function projectSpendSvg(projects: readonly ProjectRow[], width = 560): string {
  const shown = projects.filter(p => p.spend > 0).sort((a, c) => c.spend - a.spend).slice(0, 8)
  const rowH = 22
  const labelW = 120
  const valueW = 64
  const height = Math.max(rowH, shown.length * rowH)
  const max = Math.max(0.01, ...shown.map(p => p.spend))
  const barMax = width - labelW - valueW
  const parts: string[] = [STYLE]
  shown.forEach((p, i) => {
    const y = i * rowH
    const w = Math.max(2, (p.spend / max) * barMax)
    const name = p.project.length > 18 ? `${p.project.slice(0, 17)}…` : p.project
    parts.push(`<g><title>${esc(`${p.project}: ${formatCost(p.spend)} · ${p.tasks} task${p.tasks === 1 ? '' : 's'}`)}</title>`)
    parts.push(`<text x="0" y="${y + 15}">${esc(name)}</text>`)
    parts.push(`<rect x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="${rowH - 8}" rx="3" fill="${projectColor(p.project)}"/>`)
    parts.push(`<text x="${(labelW + w + 6).toFixed(1)}" y="${y + 15}">${esc(formatCost(p.spend))}</text>`)
    parts.push('</g>')
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`
}

/** A bar of block characters, for surfaces that draw no SVG and for the limit rows. */
export function blockBar(fraction: number, width = 16): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}
