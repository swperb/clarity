// Home: what every session did while you were away, what held it up, what it
// asked, and what it cost. Each session keeps a small journal; a shared
// presence file says when you were last seen; after a stretch of quiet
// ("hibernation") every session opens the home pane, ready for your return.
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On, PluginOptions, Timer } from 'claude-code'

import type { Feature, Journal, JournalEvent, Presence } from '../types'
import {
  HIBERNATE_CHOICES,
  appendEvent,
  answerGist,
  brief,
  briefWindow,
  dismiss,
  failureLine,
  formatSpan,
  gitWork,
  greeting,
  hibernate,
  hibernateMinutesOf,
  homeGlance,
  isAway,
  parseJournal,
  parsePresence,
  resolveOpen,
  seen,
  toolLine,
  trailingQuestion,
} from './home-lib'
import type { Briefing, BriefItem, NeedItem } from './home-lib'
import { formatCost, formatDuration, hsl, hueOf, startOfDay } from './lib'
import { factoryDir, readLedger } from './shared'

export const HOME_PANE = 'factory-home'
/** The Hibernation row in Factory's settings: `userConfig.hibernate` in the manifest. */
const HIBERNATE_SETTING = 'factory.hibernate'
const TICK_MS = 60_000
const PANE_REFRESH_MS = 5_000
/** Presence is written at most this often while you're active. */
const SEEN_THROTTLE_MS = 15_000
const MIN = 60_000

// The same state Factory's floor keeps (same keys, same shapes): read here, written there.
const features = atom({ plugin: 'factory', key: 'features' } as const, { ledger: true, notify: true, tint: true, radar: true, home: true })
const self = atom({ plugin: 'factory', key: 'self' } as const, null, { shape: 'entry-2' })
const floor = atom({ plugin: 'factory', key: 'floor' } as const, [], { shape: 'floor-2' })

const journal = atom({ plugin: 'factory', key: 'journal' } as const, null, { shape: 'journal-1' })
const turnLog = atom({ plugin: 'factory', key: 'turnLog' } as const, null, { shape: 'turnlog-1' })
const presence = atom({ plugin: 'factory', key: 'presence' } as const, null, { shape: 'presence-1' })
const journals = atom({ plugin: 'factory', key: 'journals' } as const, [], { shape: 'journals-1' })
const isHomeOpen = atom({ plugin: 'factory', key: 'isHomeOpen' } as const, false)
const homeOpenedFor = atom({ plugin: 'factory', key: 'homeOpenedFor' } as const, null)
const homeView = atom({ plugin: 'factory', key: 'homeView' } as const, 'away')

let tick: Timer | undefined
let paneTick: Timer | undefined

async function isOn($: Engine, feature: Feature): Promise<boolean> {
  return (await read($, features))[feature] ?? false
}

// ── Files ───────────────────────────────────────────────────────────────────

async function journalDir($: Engine): Promise<string> {
  return `${await factoryDir($)}/journal`
}

async function presencePath($: Engine): Promise<string> {
  return `${await factoryDir($)}/presence.json`
}

async function readText($: Engine, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) {
    return undefined
  }
  const text = await $.fs.read(path).catch(() => undefined)
  return typeof text === 'string' ? text : undefined
}

async function readPresence($: Engine): Promise<Presence | undefined> {
  const text = await readText($, await presencePath($))
  return text === undefined ? undefined : parsePresence(text)
}

async function writePresence($: Engine, p: Presence): Promise<void> {
  await update($, presence, () => p)
  await $.fs.write(await presencePath($), JSON.stringify(p))
}

async function readJournals($: Engine): Promise<Journal[]> {
  const dir = await journalDir($)
  if (!(await $.fs.exists(dir))) {
    return []
  }
  const names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && /^[\w-]+\.json$/.test(f.name))
  const parsed = await Promise.all(
    names.map(f =>
      $.fs
        .read(`${dir}/${f.name}`)
        .then(text => (typeof text === 'string' ? parseJournal(text) : undefined))
        .catch(() => undefined),
    ),
  )
  return parsed.filter((j): j is Journal => j !== undefined)
}

// ── This session's journal ──────────────────────────────────────────────────

/**
 * Changes this session's journal and writes it out. A session with no ledger
 * entry (the ledger is off) keeps none: Home has nowhere to place it.
 */
async function edit($: Engine, change: (events: JournalEvent[]) => JournalEvent[]): Promise<void> {
  if (!(await isOn($, 'home'))) {
    return
  }
  const me = await read($, self)
  if (me === null) {
    return
  }
  const next = await update($, journal, current => {
    // After a /clear the session goes on under a new id: a new journal.
    const events = current !== null && current.id === me.id ? current.events : []
    const fresh: Journal = { v: 1, id: me.id, project: me.project, branch: me.branch, events: change(events) }
    return fresh
  })
  if (next !== null) {
    await $.fs.write(`${await journalDir($)}/${next.id}.json`, JSON.stringify(next))
  }
}

async function record($: Engine, event: JournalEvent): Promise<void> {
  await edit($, events => appendEvent(events, event))
}

async function now($: Engine): Promise<number> {
  return $.clock.now()
}

/** It is waiting on a permission prompt (heard twice at most: dedupe). */
async function waitingOn($: Engine, text: string): Promise<void> {
  const t = await now($)
  await edit($, events =>
    events.some(x => x.kind === 'blocked' && x.resolvedAt === undefined && t - x.at < 5_000) ? events : appendEvent(events, { at: t, kind: 'blocked', text }),
  ).catch(() => undefined)
}

// ── Presence and hibernation ────────────────────────────────────────────────

// From the plugin's settings. A change there reloads the module, so this is
// always the value in force.
let hibernateAfter = hibernateMinutesOf(undefined)

/** The person did something here. Cheap when called often: writes at most every 15s. */
async function markSeen($: Engine): Promise<void> {
  if (!(await isOn($, 'home'))) {
    return
  }
  const t = await now($)
  const known = await read($, presence)
  if (known !== null && !isAway(known) && t - known.lastSeenAt < SEEN_THROTTLE_MS) {
    return
  }
  // Another session may have hibernated since this one last looked.
  const p = seen((await readPresence($)) ?? known, t)
  await writePresence($, p)
}

/**
 * Every minute: has the person been gone long enough to hibernate? Then open
 * the home pane in this session, once per away stretch, so it's waiting for them.
 */
async function hibernationTick($: Engine): Promise<void> {
  if (!(await isOn($, 'home'))) {
    return
  }
  const t = await now($)
  let p = (await readPresence($)) ?? (await read($, presence)) ?? seen(null, t)
  const minutes = hibernateAfter
  const asleep = minutes > 0 ? hibernate(p, t, minutes * MIN) : undefined
  if (asleep !== undefined) {
    p = asleep
    await writePresence($, p)
  } else {
    await update($, presence, () => p)
  }
  if (isAway(p) && (await read($, homeOpenedFor)) !== p.awaySince) {
    await update($, homeOpenedFor, () => p.awaySince)
    await update($, homeView, () => 'away' as const)
    await openHome($, true).catch(() => undefined)
  }
}

function startTick($: Engine): void {
  tick?.cancel()
  tick = $.clock.every(TICK_MS, () => {
    void hibernationTick($).catch(() => undefined)
  })
}

// ── The pane ────────────────────────────────────────────────────────────────

async function refreshHome($: Engine): Promise<void> {
  const [list, entries, p] = await Promise.all([readJournals($), readLedger($), readPresence($)])
  await update($, journals, () => list)
  await update($, floor, () => entries)
  if (p !== undefined) {
    await update($, presence, () => p)
  }
}

export async function openHome($: Engine, isHibernating = false): Promise<void> {
  await update($, isHomeOpen, () => true)
  await refreshHome($)
  paneTick?.cancel()
  paneTick = $.clock.every(PANE_REFRESH_MS, () => {
    void refreshHome($).catch(() => undefined)
  })
  await $.ui.open({ id: HOME_PANE, title: 'Home', focus: isHibernating ? true : undefined })
}

/** `/factory home on|off`: start or stop journaling and hibernation in this session. */
export async function homeSwitched($: Engine, isNowOn: boolean): Promise<void> {
  if (isNowOn) {
    startTick($)
    await markSeen($)
  } else {
    tick?.cancel()
    paneTick?.cancel()
    await $.ui.close({ id: HOME_PANE }).catch(() => undefined)
  }
}

// ── Called from Factory's own hooks (one hook per event per module) ─────────

export async function homeStart($: Engine, isInteractive: boolean): Promise<void> {
  await $.command
    .register({
      name: 'home',
      description: 'What your sessions did while you were away: /home, /home today, /home hibernate <minutes|off>',
    })
    .catch(() => $.ui.log('factory: the /home command could not be registered; use /factory home'))
  if (await isOn($, 'home')) {
    startTick($)
    if (isInteractive) {
      await markSeen($).catch(() => undefined)
    }
    if (await read($, isHomeOpen)) {
      await openHome($).catch(() => undefined)
    }
  }
}

export async function homeClosed($: Engine, id: string): Promise<void> {
  if (id === HOME_PANE) {
    paneTick?.cancel()
    paneTick = undefined
    await update($, isHomeOpen, () => false)
  }
}

export function homeEnded(isClear: boolean): void {
  if (!isClear) {
    tick?.cancel()
    paneTick?.cancel()
  }
}

/** A prompt went in. One the person sent marks them present and answers what this session asked. */
export async function homePrompt($: Engine, e: { origin: { kind: string }; command?: unknown; isMeta?: true }): Promise<void> {
  const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
  if (!isPerson) {
    return
  }
  await markSeen($).catch(() => undefined)
  if (e.command === undefined && e.isMeta !== true) {
    const t = await now($)
    await edit($, events => resolveOpen(events, ['question', 'blocked'], t)).catch(() => undefined)
  }
}

export async function homeTurnStarted($: Engine): Promise<void> {
  const usage = await $.session.usage().catch(() => undefined)
  const t = await now($)
  await update($, turnLog, () => ({ startedAt: t, costAtStart: usage?.cost?.usd ?? null, files: [] }))
}

/** A main-loop turn ended: write its line, and any question it ended on. */
export async function homeTurnCompleted($: Engine, e: { reason: string; answer: string; durationMs: number }): Promise<void> {
  try {
    const t = await now($)
    const log = await read($, turnLog)
    await update($, turnLog, () => null)
    // A finished turn isn't waiting on a permission any more.
    await edit($, events => resolveOpen(events, ['blocked'], t))
    if (e.reason === 'answer') {
      const usage = await $.session.usage().catch(() => undefined)
      const costNow = usage?.cost?.usd
      const me = await read($, self)
      const event: JournalEvent = { at: t, kind: 'done', text: answerGist(e.answer, me?.task ?? '') }
      if (log !== null && log.files.length > 0) event.files = log.files
      if (log?.costAtStart != null && costNow !== undefined) event.cost = Math.max(0, costNow - log.costAtStart)
      if (e.durationMs > 0) event.durationMs = e.durationMs
      await record($, event)
      const asked = trailingQuestion(e.answer)
      if (asked !== undefined) {
        await record($, { at: t, kind: 'question', text: asked })
      }
    } else if (e.reason === 'error' || e.reason === 'refusal') {
      const words = e.reason === 'refusal' ? 'Declined to go on (refusal)' : 'Stopped on an error'
      // StopFailure may have said exactly what went wrong already.
      await edit($, events => (events.some(x => x.kind === 'failed' && t - x.at < 10_000) ? events : appendEvent(events, { at: t, kind: 'failed', text: words })))
    }
  } catch {
    // The journal is best effort; the turn's result stands.
  }
}

// ── Register: the hooks only Home has ───────────────────────────────────────

export function registerHome(on: On, options: PluginOptions): void {
  hibernateAfter = hibernateMinutesOf(options.hibernate)

  on('command.run', { command: 'home' }, async ($, e) => {
    const [word = '', value = ''] = (e.args ?? '').trim().toLowerCase().split(/\s+/)
    if (!(await isOn($, 'home'))) {
      return { text: 'Home is off. Turn it on with /factory home on.' }
    }
    if (word === 'hibernate') {
      if (value === '') {
        return {
          text:
            (hibernateAfter === 0 ? 'Hibernation is off.' : `Home opens itself after ${hibernateAfter} minutes without you.`) +
            " Change it in Factory's settings (Open Home after you've been away), or with /home hibernate <minutes|off>.",
        }
      }
      if (!(HIBERNATE_CHOICES as readonly string[]).includes(value)) {
        return { text: `Choose one of: ${HIBERNATE_CHOICES.join(', ')}. For example /home hibernate 30, or /home hibernate off.` }
      }
      // The same row as Factory's settings, so the two never disagree.
      const set = await $.config.set({ key: HIBERNATE_SETTING, value }).catch(() => ({ deny: 'unavailable' }))
      if ('deny' in set && set.deny !== undefined) {
        return { text: "Couldn't change it from here. Change it in Factory's settings: Open Home after you've been away." }
      }
      return {
        text:
          value === 'off'
            ? 'Hibernation is off. Open Home yourself with /home.'
            : `Home now opens itself after ${value} minutes without you, in every session.`,
      }
    }
    await markSeen($)
    await update($, homeView, () => (word === 'today' ? ('today' as const) : ('away' as const)))
    await openHome($)
    return { text: 'Opened Home.' }
  })

  // ── Presence: anything the person does ───────────────────────────────────

  // Typing in the prompt box counts; it never waits on the write.
  on('prompt.edit', ($, e, next) => {
    void markSeen($).catch(() => undefined)
    return next(e)
  })

  on('ui.press', { plugin: 'factory' }, ($, e, next) => {
    void markSeen($).catch(() => undefined)
    return next(e)
  })

  // ── The journal: why turns stopped ───────────────────────────────────────

  on('classic.StopFailure', async ($, e, next) => {
    try {
      const t = await now($)
      const words = failureLine(e.error)
      await edit($, events => {
        const recent = events.findIndex(x => x.kind === 'failed' && t - x.at < 10_000)
        return recent >= 0 ? events.map((x, i) => (i === recent ? { ...x, text: words } : x)) : appendEvent(events, { at: t, kind: 'failed', text: words })
      })
    } catch {
      // Best effort.
    }
    return next(e)
  })

  // ── What held it up: permissions it waited on ────────────────────────────

  on('classic.PermissionRequest', async ($, e, next) => {
    const me = await read($, self)
    await waitingOn($, `Needs permission: ${toolLine(e.tool_name, e.tool_input, me?.root ?? '')}`)
    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') {
      await waitingOn($, `Needs permission: ${e.message.replace(/^Claude needs your permission to use /, '')}`)
    }
    return next(e)
  })

  // ── Tool calls: questions, edits, git work, denials ──────────────────────

  on('tool.call', async ($, e, next) => {
    let askedAt: number | undefined
    if (e.tool === 'AskUserQuestion') {
      askedAt = await now($)
      const at = askedAt
      const text = e.questions.map(q => q.question).join(' · ')
      await record($, { at, kind: 'question', text: text === '' ? 'Asked you a question' : text }).catch(() => undefined)
    }
    const ran = await next(e)
    try {
      const t = await now($)
      // It ran (or was refused): whatever permission it waited on is settled.
      await edit($, events =>
        resolveOpen(events, ['blocked'], t).map(x => (askedAt !== undefined && x.at === askedAt && x.kind === 'question' && x.resolvedAt === undefined ? { ...x, resolvedAt: t } : x)),
      )
      if (ran.deny !== undefined) {
        const me = await read($, self)
        await record($, { at: t, kind: 'blocked', text: `Denied: ${toolLine(e.tool, e, me?.root ?? '')}`, resolvedAt: t })
        return ran
      }
      if (ran.isError === true) {
        return ran
      }
      if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') {
        const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
        const me = await read($, self)
        const root = me?.root ?? ''
        const base = root.endsWith('/') ? root : `${root}/`
        const file = root !== '' && path.startsWith(base) ? path.slice(base.length) : path
        await update($, turnLog, log => (log === null ? log : { ...log, files: [...new Set([...log.files, file])].slice(0, 100) }))
      } else if (e.tool === 'Bash') {
        const work = gitWork(e.command)
        if (work !== undefined) {
          await record($, { at: t, kind: work.kind, text: work.text })
        }
      }
    } catch {
      // Best effort.
    }
    return ran
  })

  // ── Drawing ──────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: HOME_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await now($)
    const p = await read($, presence)
    const view = await read($, homeView)
    const window = briefWindow(p, t, view, startOfDay(t))
    const b = brief(await read($, journals), await read($, floor), window.from, t)
    const awayMs = p?.awaySince != null ? (p.backAt ?? t) - p.awaySince : 0

    if (e.props.placement === 'widget') {
      return <Text>{homeGlance(b, window.isAway, awayMs)}</Text>
    }

    const swatch = (project: string) => hsl(hueOf(project), 55, 52)
    const clock = (at: number) => {
      const d = new Date(at)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const project = (name: string) => (
      <Text>
        <Text color={swatch(name)}>■</Text> {name}
      </Text>
    )

    const NEED_MARK = { question: '?', blocked: '⏸', failed: '✗', waiting: '◆' } as const
    const NEED_COLOR = { question: 'warning', blocked: 'warning', failed: 'error', waiting: 'warning' } as const
    const needRow = (n: NeedItem) => (
      <Text key={`need:${n.key}`}>
        <Text color={NEED_COLOR[n.kind]}>{NEED_MARK[n.kind]}</Text> {project(n.project)} <Text>{n.text}</Text>
        <Text dimColor tabular>
          {' '}
          {formatDuration(t - n.since)}
        </Text>
      </Text>
    )

    const doneRow = (i: BriefItem) => {
      const bits = [clock(i.at)]
      if (i.event.files !== undefined && i.event.files.length > 0) bits.push(`${i.event.files.length} file${i.event.files.length === 1 ? '' : 's'}`)
      if (i.event.durationMs !== undefined && i.event.durationMs >= MIN) bits.push(formatDuration(i.event.durationMs))
      return (
        <Text key={`done:${i.id}:${i.at}`}>
          <Text color="success">✓</Text> {i.event.text}
          <Text dimColor tabular> {bits.join(' · ')}</Text>
        </Text>
      )
    }

    const gitRow = (i: BriefItem) => (
      <Text key={`git:${i.id}:${i.at}`}>
        <Text color="accent">⎇</Text> {i.event.kind === 'commit' ? `Committed “${i.event.text}”` : i.event.text}
        <Text dimColor tabular> {clock(i.at)}</Text>
      </Text>
    )

    const heldRow = (i: BriefItem) => {
      const waited = i.event.resolvedAt !== undefined && i.event.resolvedAt > i.at ? ` · waited ${formatDuration(i.event.resolvedAt - i.at)}` : ''
      return (
        <Text key={`held:${i.id}:${i.at}`}>
          <Text color={i.event.kind === 'failed' ? 'error' : 'warning'}>{i.event.kind === 'failed' ? '✗' : '⏸'}</Text> {project(i.project)} {i.event.text}
          <Text dimColor tabular>
            {' '}
            {clock(i.at)}
            {waited}
          </Text>
        </Text>
      )
    }

    const s = b.stats
    const summary = [
      `${s.turns} task${s.turns === 1 ? '' : 's'} finished`,
      b.projects.length > 0 ? `across ${b.projects.length} project${b.projects.length === 1 ? '' : 's'}` : '',
      s.files > 0 ? `${s.files} file${s.files === 1 ? '' : 's'} changed` : '',
      s.commits > 0 ? `${s.commits} commit${s.commits === 1 ? '' : 's'}` : '',
      s.pushes > 0 ? `${s.pushes} push${s.pushes === 1 ? '' : 'es'}` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    const limitName: Record<string, string> = { five_hour: '5-hour window', seven_day: '7-day window', spend_limit: 'Spend limit' }
    const bar = (pct: number, width = 16) => {
      const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)
      return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
    }
    const resets = (iso: string | undefined) => {
      const at = iso === undefined ? NaN : Date.parse(iso)
      return Number.isNaN(at) ? '' : ` · resets in ${formatDuration(at - t)}`
    }
    const spendToday = (await read($, floor)).filter(x => x.heartbeatAt >= startOfDay(t)).reduce((sum, x) => sum + (x.cost ?? 0), 0)

    const isQuiet = s.turns === 0 && b.needs.length === 0 && b.working.length === 0 && b.heldUp.length === 0 && s.commits === 0

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Text weight="semibold">{window.isAway ? `${greeting(t)}. Welcome back.` : `${greeting(t)}.`}</Text>
          <Text dimColor>{window.label}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {window.isAway && (
              <Button key="home-dismiss" onPress={() => dismissBriefing($)}>
                Got it
              </Button>
            )}
            <Button key="home-view" plain dimColor onPress={() => update($, homeView, v => (v === 'away' ? ('today' as const) : ('away' as const)))}>
              {view === 'away' ? 'Show all of today' : p?.awaySince != null ? 'Show while I was away' : 'Show since last briefing'}
            </Button>
          </Box>
        </Box>

        {isQuiet ? (
          <Text dimColor>All quiet. Nothing ran and nothing is waiting on you.</Text>
        ) : (
          <Text>{summary}</Text>
        )}

        {b.needs.length > 0 && (
          <Box flexDirection="column">
            <Text color="warning" weight="semibold">
              Needs you · {b.needs.length}
            </Text>
            {b.needs.slice(0, 12).map(needRow)}
            {b.needs.length > 12 && <Text dimColor>…and {b.needs.length - 12} more</Text>}
          </Box>
        )}

        {b.projects.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            <Text weight="semibold">What got done</Text>
            {b.projects.map(g => {
              const recent = g.done.slice(-6)
              return (
                <Box key={`proj:${g.project}`} flexDirection="column">
                  <Text weight="semibold">
                    {project(g.project)}
                    <Text dimColor>
                      {' '}
                      {g.done.length} task{g.done.length === 1 ? '' : 's'}
                    </Text>
                  </Text>
                  {g.done.length > recent.length && <Text dimColor>…{g.done.length - recent.length} earlier</Text>}
                  {recent.map(doneRow)}
                  {g.git.slice(-4).map(gitRow)}
                </Box>
              )
            })}
          </Box>
        )}

        {b.heldUp.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">What held it up</Text>
            {b.heldUp.slice(-8).map(heldRow)}
          </Box>
        )}

        {b.working.length > 0 && (
          <Box flexDirection="column">
            <Text weight="semibold">Still working</Text>
            {b.working.map(w => (
              <Text key={`work:${w.id}`}>
                <Text color="success">●</Text> {project(w.project)} {w.task === '' ? 'Working' : w.task}
                <Text dimColor tabular> {formatDuration(t - w.since)}</Text>
              </Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Text weight="semibold">Usage</Text>
          <Text tabular>
            {formatCost(s.spend)} {window.isAway ? 'while you were away' : 'in this window'}
            <Text dimColor>
              {' '}
              · {formatCost(spendToday)} today{s.worked >= MIN ? ` · ${formatSpan(s.worked)} of Claude time` : ''}
            </Text>
          </Text>
          {b.limits.map(r => (
            <Text key={`limit:${r.kind}`} tabular>
              <Text color={r.percentUsed >= 90 ? 'error' : r.percentUsed >= 75 ? 'warning' : 'subtle'}>{bar(r.percentUsed)}</Text> {limitName[r.kind] ?? r.kind}{' '}
              {r.percentUsed}%<Text dimColor>{resets(r.resetsAt)}</Text>
            </Text>
          ))}
          {b.fullContexts.map(x => (
            <Text key={`ctx:${x.id}`}>
              <Text color="warning">⚠</Text> {project(x.project)} context {x.context}% full
              <Text dimColor> · compact or start fresh</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}

async function dismissBriefing($: Engine): Promise<void> {
  const t = await now($)
  const p = dismiss((await readPresence($)) ?? (await read($, presence)), t)
  await writePresence($, p)
  await update($, homeView, () => 'away' as const)
}

export type { Briefing }
