import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, ThemeSetArgs, Timer } from 'claude-code'

import type { BaseTheme, Collision, Entry, Feature, Features, LoadedFrom, PendingUpdate, Place, SessionState } from '../types'
import {
  byProject,
  collisionKey,
  collisionsFor,
  formatCost,
  formatDuration,
  glance,
  hsl,
  hueOf,
  isUnpaintable,
  layerTint,
  liveEntries,
  needsYou,
  placeOf,
  prunable,
  readClarityInstall,
  relativeTo,
  taskLine,
  tintFor,
} from './lib'
import { factoryDir, installedPluginsFile, ledgerDir, readLedger } from './shared'
import {
  homeClosed,
  homeEnded,
  homePrompt,
  homeStart,
  homeSwitched,
  homeTurnCompleted,
  homeTurnStarted,
  openHome,
  registerHome,
} from './home'

// ── State ───────────────────────────────────────────────────────────────────
// Held by the host for the session, so a hot reload keeps it. Bump a `shape`
// tag when its type changes: values stored under an old tag read as initial.

const ALL_ON: Features = { ledger: true, notify: true, tint: true, radar: true, home: true, updates: true }
const FEATURE_INFO: Record<Feature, string> = {
  ledger: 'Heartbeat: this session shows on the factory floor of every other session',
  notify: 'One native notification when more sessions start waiting on you',
  tint: "Project tint: each project's windows wear their own accent color (desktop and mobile)",
  radar: 'Collision radar: warns when another session in the same repo edits a file this one edited',
  home: 'Home: a briefing of what every session did while you were away; opens itself after you have been idle a while',
  updates: 'Updates: when a newer Clarity is installed, a row above the prompt offers to reload it into this session',
}

const features = atom({ plugin: 'factory', key: 'features' } as const, ALL_ON)
const self = atom({ plugin: 'factory', key: 'self' } as const, null, { shape: 'entry-2' })
const floor = atom({ plugin: 'factory', key: 'floor' } as const, [], { shape: 'floor-2' })
const collisions = atom({ plugin: 'factory', key: 'collisions' } as const, [], { shape: 'collisions-1' })
const dismissed = atom({ plugin: 'factory', key: 'dismissed' } as const, [])
const isPaneOpen = atom({ plugin: 'factory', key: 'isPaneOpen' } as const, false)
const notifiedCount = atom({ plugin: 'factory', key: 'notifiedCount' } as const, null)
/** The theme another plugin set (the person's chosen look), which the tint lays over. */
const baseTheme = atom({ plugin: 'factory', key: 'baseTheme' } as const, null, { shape: 'theme-1' })
/** A Clarity install on disk that this session has not loaded yet. */
const pendingUpdate = atom({ plugin: 'factory', key: 'pendingUpdate' } as const, null, { shape: 'update-1' })
/** The signature of an update the person put off with "later". */
const updateDismissed = atom({ plugin: 'factory', key: 'updateDismissed' } as const, null)
/** The Clarity install this session's code was loaded from, by the module that loaded it. */
const loadedFrom = atom({ plugin: 'factory', key: 'loadedFrom' } as const, null, { shape: 'loaded-1' })

const PANE = 'factory-floor'
const STORE_KEY = 'features'
const HEARTBEAT_MS = 30_000
const PANE_REFRESH_MS = 5_000

// Timers die with the module on a reload; `session.start` runs again and restarts them.
let heartbeat: Timer | undefined
let paneTick: Timer | undefined
/**
 * Names this load of the module. `/reload-plugins` loads the new code, and a
 * new module means a new token: the install it finds then is its own.
 */
const MODULE_TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// ── The ledger on disk ──────────────────────────────────────────────────────

async function writeEntry($: Engine, entry: Entry): Promise<void> {
  await $.fs.write(`${await ledgerDir($)}/${entry.id}.json`, JSON.stringify(entry))
}

async function isOn($: Engine, feature: Feature): Promise<boolean> {
  return (await read($, features))[feature] ?? false
}

// ── This session ────────────────────────────────────────────────────────────

async function findPlace($: Engine): Promise<Place> {
  const cwd = await $.session.cwd()
  const run = (argv: string[]) =>
    $.process
      .run(argv, { cwd, timeoutMs: 5000 })
      .then(r => (r.exitCode === 0 ? r.stdout : undefined))
      .catch(() => undefined)
  const paths = await run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  const branch = paths === undefined ? undefined : await run(['git', 'branch', '--show-current'])
  return placeOf(cwd, paths === undefined ? undefined : `${paths.trim()}\n${branch?.trim() ?? ''}`)
}

/**
 * Updates this session's entry and writes it to the ledger. A changed `state`
 * restarts its clock; every write is a heartbeat.
 */
async function touch($: Engine, patch: Partial<Entry> = {}, place?: Place): Promise<Entry | undefined> {
  if (!(await isOn($, 'ledger'))) {
    return undefined
  }
  const id = await $.session.id()
  const now = await $.clock.now()
  const usage = await $.session.usage().catch(() => undefined)
  const entry = await update($, self, current => {
    // After a /clear the process goes on under a new id: start a fresh entry in the same place.
    const base: Entry =
      current !== null && current.id === id
        ? current
        : {
            v: 1,
            id,
            project: place?.project ?? current?.project ?? 'unknown',
            repo: place?.repo ?? current?.repo ?? '',
            root: place?.root ?? current?.root ?? '',
            branch: place?.branch ?? current?.branch ?? null,
            state: 'idle',
            task: '',
            startedAt: now,
            since: now,
            heartbeatAt: now,
            cost: null,
            context: null,
            files: [],
            limits: [],
          }
    const next: Entry = {
      ...base,
      ...(place ?? {}),
      ...patch,
      heartbeatAt: now,
      cost: usage?.cost?.usd ?? base.cost,
      context: usage?.context.percent ?? base.context,
      limits:
        usage !== undefined && usage.rateLimits.length > 0
          ? usage.rateLimits.map(r => (r.resetsAt === undefined ? { kind: r.kind, percentUsed: r.percentUsed } : { kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
          : base.limits ?? [],
    }
    if (patch.state !== undefined && patch.state !== base.state) {
      next.since = now
    }
    return next
  })
  if (entry !== null) {
    await writeEntry($, entry)
  }
  return entry ?? undefined
}

async function setState($: Engine, state: SessionState, patch: Partial<Entry> = {}): Promise<void> {
  await touch($, { ...patch, state })
  await refresh($)
}

// ── Reading the floor: notifications and collisions ─────────────────────────

/**
 * Re-reads the ledger into `floor`, then lets one session (the live one with the
 * lowest id: the "foreman") raise the batched notification, and checks for
 * collisions with this session's own edits.
 */
async function refresh($: Engine): Promise<void> {
  const entries = await readLedger($)
  await update($, floor, () => entries)
  const now = await $.clock.now()
  const live = liveEntries(entries, now)
  await notifyIfGrown($, live)
  await checkCollisions($, live)
}

async function notifyIfGrown($: Engine, live: Entry[]): Promise<void> {
  const id = await $.session.id()
  const foreman = live.map(e => e.id).sort()[0]
  if (!(await isOn($, 'notify')) || foreman !== id) {
    await update($, notifiedCount, () => null)
    return
  }
  const queue = needsYou(live)
  // Read and write in one step, so two refreshes racing can't both notify.
  let previous: number | null = null
  await update($, notifiedCount, last => {
    previous = last
    return queue.length
  })
  // The first look after becoming foreman sets the baseline; only growth notifies.
  if (previous === null || queue.length <= previous) {
    return
  }
  const title = queue.length === 1 ? '1 session needs you' : `${queue.length} sessions need you`
  const lines = queue.slice(0, 3).map(e => `${e.state === 'failed' ? '✗' : '◆'} ${e.project}${e.task ? `: ${e.task}` : ''}`)
  if (queue.length > 3) {
    lines.push(`…and ${queue.length - 3} more`)
  }
  void $.ui.notify(lines.join('\n'), { title, key: 'needs-you' }).catch(() => undefined)
}

async function checkCollisions($: Engine, live: Entry[]): Promise<void> {
  const me = await read($, self)
  if (!(await isOn($, 'radar')) || me === null) {
    await update($, collisions, () => [])
    return
  }
  const found = collisionsFor(me, live)
  const known = new Set((await read($, collisions)).map(collisionKey))
  const hidden = new Set(await read($, dismissed))
  await update($, collisions, () => found)
  const fresh = found.filter(c => !known.has(collisionKey(c)) && !hidden.has(collisionKey(c)))
  const c = fresh[0]
  if (c !== undefined) {
    const where = c.otherBranch !== null ? ` on ${c.otherBranch}` : ''
    const more = fresh.length > 1 ? ` (and ${fresh.length - 1} more)` : ''
    $.ui.toast(`Factory: another session${where} is also editing ${c.file}${more}`, { timeoutMs: 8000 })
  }
}

// ── Collision radar: what this session edits ────────────────────────────────

async function recordEdit($: Engine, path: string): Promise<void> {
  const me = await read($, self)
  if (me === null) {
    return
  }
  const file = relativeTo(me.root, path)
  await touch($, { files: [file, ...me.files.filter(f => f !== file)].slice(0, 200) })
  await refresh($)
}

// ── Clarity updates ─────────────────────────────────────────────────────────
// An update writes new code to disk, but a running session keeps the code it
// loaded until `/reload-plugins`. Claude Desktop runs that command only when the
// person sends it (a plugin's `$.command.run` is answered "isn't available over a
// remote connection"), so Factory offers it in a row above the prompt instead.

async function checkForUpdate($: Engine): Promise<void> {
  if (!(await isOn($, 'updates'))) {
    await update($, pendingUpdate, () => null)
    return
  }
  const text = await $.fs.read(await installedPluginsFile($)).catch(() => undefined)
  const install = typeof text === 'string' ? readClarityInstall(text) : undefined
  if (install === undefined) {
    return
  }
  const loaded = (await read($, loadedFrom)) as LoadedFrom | null
  if (loaded === null || loaded.token !== MODULE_TOKEN) {
    await update($, loadedFrom, () => ({ token: MODULE_TOKEN, signature: install.signature }))
    // The row this session showed before a reload: say the reload took.
    const before = (await read($, pendingUpdate)) as PendingUpdate | null
    if (before !== null && before.signature === install.signature) {
      $.ui.toast(`Clarity updated${before.version !== null ? ` to ${before.version}` : ''}`, { timeoutMs: 6000 })
    }
    await update($, pendingUpdate, () => null)
    return
  }
  const next: PendingUpdate | null = install.signature === loaded.signature ? null : { version: install.version, signature: install.signature }
  const current = (await read($, pendingUpdate)) as PendingUpdate | null
  if (current?.signature !== next?.signature) {
    await update($, pendingUpdate, () => next)
  }
}

// ── Timers ──────────────────────────────────────────────────────────────────

function startHeartbeat($: Engine): void {
  heartbeat?.cancel()
  heartbeat = $.clock.every(HEARTBEAT_MS, () => {
    void (async () => {
      // Another session may have switched a feature: the store is shared.
      await loadFeatures($)
      await checkForUpdate($).catch(() => undefined)
      await touch($)
      await refresh($)
    })().catch(() => undefined)
  })
}

function startPaneTick($: Engine): void {
  paneTick?.cancel()
  paneTick = $.clock.every(PANE_REFRESH_MS, () => {
    void refresh($).catch(() => undefined)
  })
}

async function loadFeatures($: Engine): Promise<Features> {
  const saved = (await $.store.get(STORE_KEY)) as Partial<Features> | undefined
  return update($, features, () => ({ ...ALL_ON, ...(saved ?? {}) }))
}

async function applyTint($: Engine, project: string): Promise<void> {
  const base = (await read($, baseTheme)) as ThemeSetArgs | null
  if (base !== null) {
    // Another plugin's theme stands: tint its accent, keep everything else.
    await $.theme.set(layerTint(base, project))
    return
  }
  const { look, problems } = tintFor(project)
  if (isUnpaintable(problems)) {
    return // Never send a look Desktop would throw away whole.
  }
  await $.theme.set(look)
}

/** Tint off: hand back the theme the person chose, or the app's own look when there was none. */
async function clearTint($: Engine): Promise<void> {
  const base = (await read($, baseTheme)) as ThemeSetArgs | null
  if (base !== null) {
    await $.theme.set(base)
    return
  }
  await $.theme.clear()
}

/** A call this plugin made itself (its tint), as opposed to another theme plugin's. */
function isOwnCall(plugin: string): boolean {
  return plugin === 'factory'
}

async function openPane($: Engine): Promise<void> {
  await update($, isPaneOpen, () => true)
  await refresh($)
  startPaneTick($)
  await $.ui.open({ id: PANE, title: 'Factory floor' })
}

// ── Register ────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  registerHome(on, options)

  on('session.start', async ($, e, next) => {
    const enabled = await loadFeatures($)
    // A refused name must not throw out of startup: the ledger and tint still run.
    await $.command
      .register({
        name: 'factory',
        description: 'Open the factory floor, or switch a feature: /factory [home | settings | ledger|notify|tint|radar|home|updates on|off]',
      })
      .catch(() => $.ui.log('factory: the /factory command could not be registered'))
    const place = await findPlace($)
    if (enabled.tint) {
      await applyTint($, place.project).catch(() => undefined)
    }
    await touch($, {}, place)
    await checkForUpdate($).catch(() => undefined)
    startHeartbeat($)
    if (await read($, isPaneOpen)) {
      startPaneTick($)
    }
    await homeStart($, e.isInteractive).catch(() => undefined)
    // Tidy the ledger: ended a day ago or silent for a week.
    void (async () => {
      const entries = await readLedger($)
      const old = prunable(entries, await $.clock.now())
      if (old.length > 0) {
        const dir = await ledgerDir($)
        const journals = `${await factoryDir($)}/journal`
        await $.process.run(['rm', '-f', '--', ...old.flatMap(id => [`${dir}/${id}.json`, `${journals}/${id}.json`])], { timeoutMs: 5000 })
      }
      await refresh($)
    })().catch(() => undefined)
    return next(e)
  })

  // ── Other themes ──────────────────────────────────────────────────────────
  // Any theme plugin works with Factory: its look is remembered as the base and
  // the tint is laid over it (accent only), instead of the two replacing each
  // other in whatever order the plugins happen to load.

  on('theme.set', async ($, e, next) => {
    if (isOwnCall(next.origin.plugin)) {
      return next(e)
    }
    const base: ThemeSetArgs = e
    await update($, baseTheme, () => base as BaseTheme)
    const me = await read($, self)
    const { tint } = await read($, features)
    return next(tint && me !== null ? layerTint(base, me.project) : e)
  })

  on('theme.clear', async ($, e, next) => {
    if (!isOwnCall(next.origin.plugin)) {
      await update($, baseTheme, () => null)
    }
    return next(e)
  })

  // ── /factory ──────────────────────────────────────────────────────────────

  on('command.run', { command: 'factory' }, async ($, e) => {
    const [name = '', state = ''] = (e.args ?? '').trim().toLowerCase().split(/\s+/)
    const current = await read($, features)

    if (name === '') {
      await openPane($)
      return { text: 'Opened the factory floor.' }
    }

    if (name === 'home' && state === '') {
      if (!current.home) {
        return { text: 'Home is off. Turn it on with /factory home on.' }
      }
      await openHome($)
      return { text: 'Opened Home.' }
    }

    if (name in current && (state === 'on' || state === 'off')) {
      const feature = name as Feature
      const isOnNow = state === 'on'
      const next: Features = { ...current, [feature]: isOnNow }
      await update($, features, () => next)
      await $.store.set(STORE_KEY, next)
      const me = await read($, self)
      if (feature === 'tint') {
        if (isOnNow && me !== null) {
          await applyTint($, me.project).catch(() => undefined)
        } else if (!isOnNow) {
          await clearTint($).catch(() => undefined)
        }
      }
      if (feature === 'home') {
        await homeSwitched($, isOnNow)
      }
      if (feature === 'updates') {
        await checkForUpdate($).catch(() => undefined)
      }
      if (feature === 'ledger') {
        if (isOnNow) {
          await touch($, {}, me === null ? await findPlace($) : undefined)
          startHeartbeat($)
        } else if (me !== null) {
          // Leave the floor: other sessions stop showing this one at once.
          await writeEntry($, { ...me, state: 'ended', heartbeatAt: await $.clock.now() })
        }
      }
      await refresh($)
      return { text: `Factory ${feature} is ${state}. This sticks across sessions.` }
    }

    const lines = (Object.keys(FEATURE_INFO) as Feature[]).map(
      f => `${current[f] ? '●' : '○'} ${f.padEnd(7)} ${FEATURE_INFO[f]}`,
    )
    return { text: [...lines, '', 'Open the floor with /factory, Home with /home. Switch one with /factory <feature> on|off'].join('\n') }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      paneTick?.cancel()
      paneTick = undefined
      await update($, isPaneOpen, () => false)
    }
    await homeClosed($, e.id)
    return next(e)
  })

  // ── 1. The heartbeat ledger ───────────────────────────────────────────────

  on('prompt.submit', async ($, e, next) => {
    const task = e.command === undefined && e.isMeta !== true ? taskLine(e.text) : ''
    if (task !== '') {
      await touch($, { task }).catch(() => undefined)
    }
    await homePrompt($, e).catch(() => undefined)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const task = taskLine(e.text)
      const patch: Partial<Entry> = task !== '' ? { task } : {}
      await setState($, 'working', patch).catch(() => undefined)
      await homeTurnStarted($).catch(() => undefined)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const state: SessionState =
        e.reason === 'answer' ? 'waiting' : e.reason === 'aborted' ? 'idle' : 'failed'
      // The branch may have moved during the turn.
      const place = await findPlace($).catch(() => undefined)
      await setState($, state, place === undefined ? {} : { branch: place.branch }).catch(() => undefined)
      await homeTurnCompleted($, e)
      // A turn's end is when the person looks at the prompt: a fresh look at the install.
      await checkForUpdate($).catch(() => undefined)
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('cost') || e.changed.includes('context')) {
      await touch($).catch(() => undefined)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A /clear ends this conversation but the process goes on under a new id:
    // keep the timers, and the next write starts a fresh entry.
    if (e.reason !== 'clear') {
      heartbeat?.cancel()
      paneTick?.cancel()
    }
    homeEnded(e.reason === 'clear')
    const me = await read($, self)
    if (me !== null && me.id === e.sessionId && (await isOn($, 'ledger'))) {
      await writeEntry($, { ...me, state: 'ended', heartbeatAt: await $.clock.now() }).catch(() => undefined)
    }
    return next(e)
  })

  // ── 5. Collision radar: record what this session edits ────────────────────

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await recordEdit($, e.file_path).catch(() => undefined)
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await recordEdit($, e.file_path).catch(() => undefined)
    }
    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await recordEdit($, e.notebook_path).catch(() => undefined)
    }
    return ran
  })

  // ── Drawing: the collision row above the prompt ───────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = []

    // A newer Clarity on disk: offer the reload, one press and Enter away.
    const pending = (await isOn($, 'updates')) ? ((await read($, pendingUpdate)) as PendingUpdate | null) : null
    if (pending !== null && pending.signature !== (await read($, updateDismissed))) {
      rows.push(
        <Box key="update" flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text dimColor>↻ Clarity{pending.version !== null ? ` ${pending.version}` : ''} is installed</Text>
          <Button
            key="reload-clarity"
            plain
            onPress={async () => {
              await $.prompt.fill({ text: '/reload-plugins', mode: 'replace' })
              $.ui.toast('Press Enter to load the new Clarity into this session', { timeoutMs: 6000 })
            }}
          >
            Reload
          </Button>
          <Button key="dismiss-update" plain dimColor onPress={() => update($, updateDismissed, () => pending.signature)}>
            later
          </Button>
        </Box>,
      )
    }

    // Collision radar: another session edits a file this one edited.
    if (await isOn($, 'radar')) {
      const hidden = new Set(await read($, dismissed))
      const shown = (await read($, collisions)).filter(c => !hidden.has(collisionKey(c)))
      if (shown.length > 0) {
        const files = [...new Set(shown.map(c => c.file))]
        const first = shown[0]
        const others = new Set(shown.map(c => c.otherId)).size
        rows.push(
          <Box key="collisions" flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Text color="warning">
              ⚠ {files.length === 1 ? files[0] : `${files.length} files`} also edited by{' '}
              {others === 1 ? 'another session' : `${others} other sessions`}
              {others === 1 && first?.otherBranch != null ? <Text dimColor> on {first.otherBranch}</Text> : ''}
            </Text>
            <Button
              key="dismiss-collisions"
              plain
              dimColor
              onPress={() => update($, dismissed, list => [...new Set([...list, ...shown.map(collisionKey)])])}
            >
              dismiss
            </Button>
          </Box>,
        )
      }
    }

    const [only] = rows
    if (only === undefined) {
      return next(e) // All quiet: draw nothing.
    }
    return rows.length === 1 ? only : <Box flexDirection="column">{rows}</Box>
  })

  // ── Drawing: the factory floor pane ───────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const entries = await read($, floor)
    const me = await read($, self)
    const now = await $.clock.now()

    if (e.props.placement === 'widget') {
      return <Text>{glance(entries, now)}</Text>
    }

    const live = liveEntries(entries, now)
    if (live.length === 0) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text dimColor>The floor is quiet.</Text>
          <Text dimColor size="footnote">
            Every Claude Desktop session with Factory shows up here, grouped by project.
          </Text>
        </Box>
      )
    }

    const STATE_COLOR = { working: 'success', waiting: 'warning', failed: 'error', idle: 'subtle', ended: 'subtle' } as const
    const STATE_LABEL = { working: 'working', waiting: 'waiting on you', failed: 'failed', idle: 'idle', ended: 'ended' }
    const queue = needsYou(live)
    const swatch = (project: string) => hsl(hueOf(project), 55, 52)

    const meta = (s: Entry) =>
      [
        formatDuration(now - s.since),
        s.cost !== null ? formatCost(s.cost) : undefined,
        s.context !== null ? `${s.context}% context` : undefined,
      ]
        .filter(Boolean)
        .join(' · ')

    const card = (s: Entry) => (
      <Box key={`card:${s.id}`} flexDirection="column">
        <Text>
          <Text color={STATE_COLOR[s.state]}>● {STATE_LABEL[s.state]}</Text>
          {s.branch !== null ? <Text dimColor>  {s.branch}</Text> : ''}
          {me !== null && s.id === me.id ? <Text dimColor>  (this session)</Text> : ''}
        </Text>
        <Text dimColor={s.task === ''}>{s.task === '' ? 'No prompt yet' : s.task}</Text>
        <Text dimColor size="footnote" tabular>
          {meta(s)}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text weight="semibold">{glance(entries, now)}</Text>

        {queue.length > 0 && (
          <Box flexDirection="column">
            <Text color="warning" weight="semibold">
              Needs you
            </Text>
            {queue.map(s => (
              <Text key={`queue:${s.id}`}>
                <Text color={STATE_COLOR[s.state]}>{s.state === 'failed' ? '✗' : '◆'}</Text> <Text color={swatch(s.project)}>■</Text>{' '}
                {s.project}
                {s.task !== '' ? <Text dimColor> · {s.task}</Text> : ''}
                <Text dimColor tabular>
                  {' '}
                  {s.state === 'failed' ? 'failed' : 'waiting'} {formatDuration(now - s.since)}
                </Text>
              </Text>
            ))}
          </Box>
        )}

        {byProject(live).map(([project, list]) => (
          <Box key={`project:${project}`} flexDirection="column" rowGap={1}>
            <Text weight="semibold">
              <Text color={swatch(project)}>■</Text> {project}
              <Text dimColor> {list.length}</Text>
            </Text>
            {list.map(card)}
          </Box>
        ))}
      </Box>
    )
  })
}
