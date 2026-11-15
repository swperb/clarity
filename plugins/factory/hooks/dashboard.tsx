// The dashboard: one pane over every project and session. KPI tiles, the
// triage queue, spend and tasks over time, a projects table, every live
// session, and the plan's usage. Read from the same ledger and journals as
// the floor and Home; it writes nothing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On, Timer } from 'claude-code'

import { blockBar, dashboard, dashboardGlance, projectColor, projectSpendSvg, timelineSvg } from './dashboard-lib'
import type { Dashboard, ProjectRow } from './dashboard-lib'
import type { NeedItem } from './home-lib'
import { openHome, readJournals } from './home'
import { formatCost, formatDuration, startOfDay } from './lib'
import { readLedger } from './shared'
import type { Entry } from '../types'

export const DASHBOARD_PANE = 'factory-dashboard'
const REFRESH_MS = 5_000

// Shared with the floor and Home (same keys, same shapes).
const floor = atom({ plugin: 'factory', key: 'floor' } as const, [], { shape: 'floor-2' })
const journals = atom({ plugin: 'factory', key: 'journals' } as const, [], { shape: 'journals-1' })
const self = atom({ plugin: 'factory', key: 'self' } as const, null, { shape: 'entry-2' })
// The dashboard's own.
const isDashboardOpen = atom({ plugin: 'factory', key: 'isDashboardOpen' } as const, false)
const dashboardRange = atom({ plugin: 'factory', key: 'dashboardRange' } as const, 'today')

let paneTick: Timer | undefined

async function refreshDashboard($: Engine): Promise<void> {
  const [list, entries] = await Promise.all([readJournals($), readLedger($)])
  await update($, journals, () => list)
  await update($, floor, () => entries)
}

export async function openDashboard($: Engine): Promise<void> {
  await update($, isDashboardOpen, () => true)
  await refreshDashboard($)
  paneTick?.cancel()
  paneTick = $.clock.every(REFRESH_MS, () => {
    void refreshDashboard($).catch(() => undefined)
  })
  await $.ui.open({ id: DASHBOARD_PANE, title: 'Dashboard', focus: true })
}

// ── Called from Factory's own hooks ─────────────────────────────────────────

export async function dashboardStart($: Engine): Promise<void> {
  await $.command
    .register({ name: 'overview', description: 'Every project and session at a glance: triage, spend, tasks and usage' })
    .catch(() => $.ui.log('factory: the /overview command could not be registered; use /factory dashboard'))
  if (await read($, isDashboardOpen)) {
    await openDashboard($).catch(() => undefined)
  }
}

export async function dashboardClosed($: Engine, id: string): Promise<void> {
  if (id === DASHBOARD_PANE) {
    paneTick?.cancel()
    paneTick = undefined
    await update($, isDashboardOpen, () => false)
  }
}

export function dashboardEnded(isClear: boolean): void {
  if (!isClear) {
    paneTick?.cancel()
  }
}

// ── Register ────────────────────────────────────────────────────────────────

export function registerDashboard(on: On): void {
  on('command.run', { command: 'overview' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLowerCase()
    if (word === 'week' || word === 'today') {
      await update($, dashboardRange, () => word)
    }
    await openDashboard($)
    return { text: 'Opened the dashboard.' }
  })

  on('ui.render', { component: 'Pane', requestId: DASHBOARD_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const now = await $.clock.now()
    const range = await read($, dashboardRange)
    const d = dashboard(await read($, journals), await read($, floor), range, now, startOfDay(now))
    const me = await read($, self)

    if (e.props.placement === 'widget') {
      return <Text>{dashboardGlance(d)}</Text>
    }

    const swatch = (project: string) => <Text color={projectColor(project)}>■</Text>
    const section = (title: string, extra?: string) => (
      <Text weight="semibold">
        {title}
        {extra !== undefined && <Text dimColor> {extra}</Text>}
      </Text>
    )

    // ── KPI tiles ──
    const tile = (key: string, label: string, value: string, color?: 'warning' | 'success' | 'error') => (
      <Box key={`kpi:${key}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={14}>
        <Text dimColor size="caption">
          {label}
        </Text>
        <Text size="title" weight="semibold" tabular color={color}>
          {value}
        </Text>
      </Box>
    )
    const k = d.kpis
    const limit = k.fullestLimit
    const limitName: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'Spend limit' }
    const tiles = [
      tile('live', 'Live sessions', String(k.live)),
      tile('needs', 'Need you', String(k.needsYou), k.needsYou > 0 ? 'warning' : undefined),
      tile('working', 'Working', String(k.working), k.working > 0 ? 'success' : undefined),
      tile('tasks', range === 'today' ? 'Tasks today' : 'Tasks, 7 days', String(k.tasks)),
      tile('spend', range === 'today' ? 'Spend today' : 'Spend, 7 days', formatCost(k.spend)),
      tile('commits', 'Commits', String(k.commits)),
    ]
    if (limit !== null) {
      tiles.push(
        tile(
          'limit',
          `${limitName[limit.kind] ?? limit.kind} used`,
          `${limit.percentUsed}%`,
          limit.percentUsed >= 90 ? 'error' : limit.percentUsed >= 75 ? 'warning' : undefined,
        ),
      )
    }

    // ── Triage ──
    const NEED_MARK = { question: '?', blocked: '⏸', failed: '✗', waiting: '◆' } as const
    const NEED_WORD = { question: 'asked you', blocked: 'needs permission', failed: 'failed', waiting: 'your move' } as const
    const needRow = (n: NeedItem) => (
      <Text key={`need:${n.key}`}>
        <Text color={n.kind === 'failed' ? 'error' : 'warning'}>{NEED_MARK[n.kind]}</Text> {swatch(n.project)} {n.project}
        <Text dimColor> · {NEED_WORD[n.kind]} · </Text>
        {n.text}
        <Text dimColor tabular> {formatDuration(now - n.since)}</Text>
      </Text>
    )

    // ── Charts ──
    const hasActivity = d.buckets.some(b => b.spend > 0 || b.tasks > 0)
    const timeline =
      Svg !== undefined ? (
        <Svg
          key="timeline"
          source={timelineSvg(d.buckets)}
          alt={`Spend and tasks ${range === 'today' ? 'by hour today' : 'by day this week'}: ${d.buckets
            .filter(b => b.spend > 0 || b.tasks > 0)
            .map(b => `${b.label} ${formatCost(b.spend)}, ${b.tasks} tasks`)
            .join('; ')}`}
          isInteractive
        />
      ) : (
        <Box key="timeline" flexDirection="column">
          {d.buckets
            .filter(b => b.spend > 0 || b.tasks > 0)
            .map(b => (
              <Text key={`b:${b.start}`} tabular>
                {b.label.padEnd(4)}
                <Text color="accent">{blockBar(b.spend / Math.max(0.01, ...d.buckets.map(x => x.spend)), 20)}</Text> {formatCost(b.spend)}
                <Text dimColor> · {b.tasks}</Text>
              </Text>
            ))}
        </Box>
      )
    const spenders = d.projects.filter(p => p.spend > 0)
    const byProjectChart =
      Svg !== undefined ? (
        <Svg key="by-project" source={projectSpendSvg(d.projects)} alt={spenders.map(p => `${p.project} ${formatCost(p.spend)}`).join('; ')} isInteractive />
      ) : (
        <Box key="by-project" flexDirection="column">
          {spenders.map(p => (
            <Text key={`ps:${p.project}`} tabular>
              {swatch(p.project)} {p.project.padEnd(16).slice(0, 16)} {blockBar(p.spend / Math.max(0.01, ...spenders.map(x => x.spend)), 16)}{' '}
              {formatCost(p.spend)}
            </Text>
          ))}
        </Box>
      )

    // ── Tables ──
    const COL = { name: 22, n: 8, money: 10 }
    const cell = (text: string, width: number, opts: { dim?: boolean; color?: 'warning' | 'success'; right?: boolean } = {}) => (
      <Box width={width} flexShrink={0} justifyContent={opts.right === true ? 'flex-end' : 'flex-start'}>
        <Text dimColor={opts.dim} color={opts.color} tabular wrap="truncate">
          {text}
        </Text>
      </Box>
    )
    const projectHeader = (
      <Box key="ph" flexDirection="row" columnGap={1}>
        {cell('Project', COL.name, { dim: true })}
        {cell('Live', COL.n, { dim: true, right: true })}
        {cell('Need you', COL.n + 2, { dim: true, right: true })}
        {cell('Tasks', COL.n, { dim: true, right: true })}
        {cell('Files', COL.n, { dim: true, right: true })}
        {cell('Commits', COL.n + 1, { dim: true, right: true })}
        {cell('Spend', COL.money, { dim: true, right: true })}
        {cell('Last', COL.n + 2, { dim: true, right: true })}
      </Box>
    )
    const projectRow = (p: ProjectRow) => (
      <Box key={`pr:${p.project}`} flexDirection="row" columnGap={1}>
        <Box width={COL.name} flexShrink={0}>
          <Text wrap="truncate">
            {swatch(p.project)} {p.project}
          </Text>
        </Box>
        {cell(String(p.live), COL.n, { right: true, dim: p.live === 0 })}
        {cell(String(p.needsYou), COL.n + 2, { right: true, dim: p.needsYou === 0, color: p.needsYou > 0 ? 'warning' : undefined })}
        {cell(String(p.tasks), COL.n, { right: true, dim: p.tasks === 0 })}
        {cell(String(p.files), COL.n, { right: true, dim: p.files === 0 })}
        {cell(String(p.commits), COL.n + 1, { right: true, dim: p.commits === 0 })}
        {cell(formatCost(p.spend), COL.money, { right: true, dim: p.spend === 0 })}
        {cell(p.lastAt === 0 ? '—' : now - p.lastAt < 60_000 ? 'just now' : `${formatDuration(now - p.lastAt)} ago`, COL.n + 2, { right: true, dim: true })}
      </Box>
    )

    const STATE_COLOR = { working: 'success', waiting: 'warning', failed: 'error', idle: 'subtle', ended: 'subtle' } as const
    const STATE_LABEL = { working: 'working', waiting: 'waiting', failed: 'failed', idle: 'idle', ended: 'ended' }
    const sessionRow = (s: Entry) => (
      <Box key={`s:${s.id}`} flexDirection="row" columnGap={1}>
        <Box width={11} flexShrink={0}>
          <Text color={STATE_COLOR[s.state]}>● {STATE_LABEL[s.state]}</Text>
        </Box>
        <Box width={COL.name} flexShrink={0}>
          <Text wrap="truncate">
            {swatch(s.project)} {s.project}
            {s.branch !== null && <Text dimColor> {s.branch}</Text>}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={20}>
          <Text wrap="truncate" dimColor={s.task === ''}>
            {s.task === '' ? 'No prompt yet' : s.task}
            {me !== null && me.id === s.id && <Text dimColor> (this session)</Text>}
          </Text>
        </Box>
        {cell(formatDuration(now - s.since), COL.n, { right: true, dim: true })}
        {cell(s.cost !== null ? formatCost(s.cost) : '—', COL.money, { right: true, dim: true })}
        {cell(s.context !== null ? `${s.context}%` : '—', 6, { right: true, dim: s.context === null || s.context < 80, color: s.context !== null && s.context >= 80 ? 'warning' : undefined })}
      </Box>
    )

    const resets = (iso: string | undefined) => {
      const at = iso === undefined ? NaN : Date.parse(iso)
      return Number.isNaN(at) ? '' : ` · resets in ${formatDuration(at - now)}`
    }

    return (
      <Box flexDirection="column" rowGap={2}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
          <Text size="heading" weight="semibold">
            ⌂ Dashboard
          </Text>
          <Button key="range-today" plain dimColor={range !== 'today'} onPress={() => update($, dashboardRange, () => 'today' as const)}>
            Today
          </Button>
          <Button key="range-week" plain dimColor={range !== 'week'} onPress={() => update($, dashboardRange, () => 'week' as const)}>
            7 days
          </Button>
          <Button key="open-home" plain dimColor onPress={() => openHome($)}>
            Briefing
          </Button>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {tiles}
        </Box>

        <Box flexDirection="column">
          {section('Triage', d.needs.length > 0 ? String(d.needs.length) : undefined)}
          {d.needs.length === 0 ? <Text dimColor>Nothing is waiting on you.</Text> : d.needs.slice(0, 10).map(needRow)}
          {d.needs.length > 10 && <Text dimColor>…and {d.needs.length - 10} more</Text>}
        </Box>

        <Box flexDirection="column" rowGap={1}>
          {section(range === 'today' ? 'Spend and tasks by hour' : 'Spend and tasks by day', 'bars: spend per finished task, by project · dashed: tasks')}
          {hasActivity ? timeline : <Text dimColor>No finished tasks {range === 'today' ? 'yet today' : 'this week'}.</Text>}
          {d.untimedSpend >= 0.01 && (
            <Text dimColor size="footnote">
              {formatCost(d.untimedSpend)} of the spend has no task time: work from before Factory 1.1's journals, or a turn still running.
            </Text>
          )}
        </Box>

        {spenders.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            {section('Spend by project')}
            {byProjectChart}
          </Box>
        )}

        <Box flexDirection="column">
          {section('Projects', String(d.projects.length))}
          {d.projects.length === 0 ? (
            <Text dimColor>No project has a live session or finished work {range === 'today' ? 'today' : 'this week'}.</Text>
          ) : (
            [projectHeader, ...d.projects.map(projectRow)]
          )}
        </Box>

        <Box flexDirection="column">
          {section('Sessions', `${d.sessions.length} live`)}
          {d.sessions.length === 0 ? <Text dimColor>No sessions running.</Text> : d.sessions.map(sessionRow)}
        </Box>

        <Box flexDirection="column">
          {section('Usage')}
          {d.limits.length === 0 && <Text dimColor>No session has read the plan's limits yet.</Text>}
          {d.limits.map(r => (
            <Text key={`limit:${r.kind}`} tabular>
              <Text color={r.percentUsed >= 90 ? 'error' : r.percentUsed >= 75 ? 'warning' : 'subtle'}>{blockBar(r.percentUsed / 100)}</Text>{' '}
              {limitName[r.kind] ?? r.kind} window {r.percentUsed}%<Text dimColor>{resets(r.resetsAt)}</Text>
            </Text>
          ))}
          {d.fullContexts.map(x => (
            <Text key={`ctx:${x.id}`}>
              <Text color="warning">⚠</Text> {swatch(x.project)} {x.project} context {x.context}% full
              <Text dimColor> · compact or start fresh</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}

export type { Dashboard }
