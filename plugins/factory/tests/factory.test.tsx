import type { On, ThemeColors, ThemeSetArgs } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Entry } from '../types'
import { makeColors } from '../hooks/make-colors.js'
import {
  collisionsFor,
  glance,
  hueOf,
  isUnpaintable,
  layerTint,
  liveEntries,
  needsYou,
  parseEntry,
  placeOf,
  prunable,
  readClarityInstall,
  taskLine,
  tintFor,
} from '../hooks/lib'

const NOW = 1_800_000_000_000
const MIN = 60_000
const DIR = '/home/me/.claude/factory/sessions'

function entry(over: Partial<Entry>): Entry {
  return {
    v: 1,
    id: 'x',
    project: 'atlas',
    repo: '/code/atlas/.git',
    root: '/code/atlas',
    branch: 'main',
    state: 'working',
    task: '',
    startedAt: NOW - 30 * MIN,
    since: NOW - 5 * MIN,
    heartbeatAt: NOW - MIN,
    cost: 1,
    context: 20,
    files: [],
    limits: [],
    ...over,
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

test('parseEntry reads a good entry and refuses junk', async () => {
  expect(parseEntry(JSON.stringify(entry({ id: 'a' })))?.id).toBe('a')
  expect(parseEntry('{"v":1,"id":')).toBe(undefined)
  expect(parseEntry(JSON.stringify({ ...entry({}), state: 'dancing' }))).toBe(undefined)
  expect(parseEntry(JSON.stringify({ ...entry({}), v: 2 }))).toBe(undefined)
})

test('stale and ended sessions are gone; the queue is longest wait first', async () => {
  const all = [
    entry({ id: 'live', state: 'working' }),
    entry({ id: 'stale', heartbeatAt: NOW - 11 * MIN }),
    entry({ id: 'ended', state: 'ended' }),
    entry({ id: 'new-wait', state: 'waiting', since: NOW - 2 * MIN }),
    entry({ id: 'old-fail', state: 'failed', since: NOW - 20 * MIN }),
  ]
  const live = liveEntries(all, NOW)
  expect(live.map(e => e.id)).toEqual(['live', 'new-wait', 'old-fail'])
  expect(needsYou(live).map(e => e.id)).toEqual(['old-fail', 'new-wait'])
})

test('the glance line counts working, waiting and spend', async () => {
  const all = [
    entry({ id: 'a', state: 'working', cost: 10 }),
    entry({ id: 'b', state: 'waiting', cost: 4.2 }),
    entry({ id: 'c', state: 'waiting', cost: 0 }),
  ]
  expect(glance(all, NOW)).toBe('1 working · 2 need you · $14.20 today')
  expect(glance([], NOW)).toBe('No sessions running')
})

test('old ledger files are pruned, recent ones kept', async () => {
  const all = [
    entry({ id: 'ended-old', state: 'ended', heartbeatAt: NOW - 2 * 24 * 60 * MIN }),
    entry({ id: 'ended-new', state: 'ended', heartbeatAt: NOW - MIN }),
    entry({ id: 'silent-week', heartbeatAt: NOW - 8 * 24 * 60 * MIN }),
  ]
  expect(prunable(all, NOW)).toEqual(['ended-old', 'silent-week'])
})

test('worktrees of one repo share a project; a plain folder is its own', async () => {
  const main = placeOf('/code/atlas/src', '/code/atlas\n/code/atlas/.git\nmain')
  const tree = placeOf('/code/atlas-wt/fix', '/code/atlas-wt/fix\n/code/atlas/.git\nfix-login')
  expect(main.project).toBe('atlas')
  expect(tree.project).toBe('atlas')
  expect(tree.repo).toBe(main.repo)
  expect(tree.branch).toBe('fix-login')
  expect(placeOf('/tmp/notes', undefined)).toEqual({ project: 'notes', repo: '/tmp/notes', root: '/tmp/notes', branch: null })
})

test('a task is the first non-empty line, kept short', async () => {
  expect(taskLine('\n  fix the login bug\nmore detail')).toBe('fix the login bug')
  expect(taskLine('x'.repeat(200)).length).toBe(120)
})

test('collisions need the same repo and the same file', async () => {
  const me = entry({ id: 'me', files: ['src/a.ts', 'src/b.ts'] })
  const live = [
    me,
    entry({ id: 'twin', files: ['src/a.ts'], branch: 'feature' }),
    entry({ id: 'elsewhere', repo: '/code/other/.git', files: ['src/b.ts'] }),
  ]
  expect(collisionsFor(me, live)).toEqual([{ file: 'src/a.ts', otherId: 'twin', otherBranch: 'feature', otherTask: '' }])
})

test('the tint is stable per project, paints, and leaves diff colors alone', async () => {
  expect(hueOf('atlas')).toBe(hueOf('atlas'))
  expect(hueOf('atlas') === hueOf('harbor')).toBe(false)
  for (const name of ['atlas', 'harbor', 'Orchard', 'Beacon', 'a', '']) {
    const { look, problems } = tintFor(name)
    expect(problems.some(p => p.startsWith("Desktop won't paint"))).toBe(false)
    expect(/git/i.test(JSON.stringify(Object.keys(look.colors ?? {})))).toBe(false)
  }
})

// Someone else's theme, made the way any theme plugin makes one.
const OTHER = makeColors({
  label: 'Paper',
  id: 'paper',
  roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
  light: { gray: { anchors: { 'surface-0': '#efe6d3', 'surface-1': '#f4ecdc', 'surface-2': '#faf5e9', 'text-primary': '#2a241d', 'text-muted': '#6a5f50' } } },
  dark: { gray: { anchors: { 'surface-0': '#1f1a15', 'surface-1': '#28221b', 'surface-2': '#312a22', 'surface-3': '#3a3229', 'text-primary': '#f0e7d7', 'text-muted': '#aca08d' } } },
}).theme

function changedKeys(a: ThemeColors, b: ThemeColors): string[] {
  const out: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    for (const [k, v] of Object.entries(a.inputs[mode] ?? {})) {
      if (b.inputs[mode]?.[k] !== v) {
        out.push(k)
      }
    }
  }
  return [...new Set(out)]
}

test("the tint over another theme changes its accent alone and keeps its look", async () => {
  for (const name of ['atlas', 'harbor', 'Orchard', '']) {
    const base: ThemeSetArgs = { colors: OTHER, backdrop: { color: 'surface-0' } }
    const out = layerTint(base, name)
    expect(out.backdrop).toEqual(base.backdrop)
    expect(out.colors?.label).toBe('Paper')
    const changed = changedKeys(OTHER, out.colors as ThemeColors)
    expect(changed.length > 0).toBe(true)
    expect(changed.every(k => k.startsWith('role-accent-'))).toBe(true)
    expect(Object.keys(out.colors?.inputs.light ?? {}).length).toBe(Object.keys(OTHER.inputs.light ?? {}).length)
  }
})

test('a one-mode theme stays one-mode; a backdrop alone gets the full wash', async () => {
  const dark = makeColors({ label: 'Night', only: 'dark', dark: { gray: { anchors: { 'surface-0': '#101418', 'text-primary': '#e8ecf0' } } } }).theme
  const out = layerTint({ colors: dark }, 'atlas')
  expect(out.colors?.inputs.light).toBe(undefined)
  expect(out.colors?.inputs.dark !== undefined).toBe(true)

  const scene = layerTint({ backdrop: { scene: 'tide' } }, 'atlas')
  expect(scene.backdrop).toEqual({ scene: 'tide' })
  expect(scene.colors?.label).toBe('Factory: atlas')
})

test('a theme the tint cannot fit comes back untouched', async () => {
  const odd: ThemeSetArgs = { colors: { v: 1, label: 'Odd', inputs: { light: { 'gray-0': '#zzzzzz' } as never } } }
  expect(layerTint(odd, 'atlas')).toEqual(odd)
  expect(isUnpaintable(["Desktop won't paint this theme: x"])).toBe(true)
})

// ── The engine, with an in-memory ledger ────────────────────────────────────

/**
 * Stands in for the app beneath the plugins, recording each look that reaches it.
 * From engine 2.1.321 `$.theme` is core and a test answers its events; older test
 * kits have no `$.theme`, so one is also added for them (the newer kit skips that).
 */
function themes(on: On, record: (look: ThemeSetArgs | 'cleared') => void): void {
  on('theme.set', (_, e) => (record(e), { value: { isDrawn: true, requestId: 'theme' } }))
  on('theme.clear', () => (record('cleared'), { value: { isDrawn: false, reason: 'cleared' } }))
  on('engine.create', async (_, e, next) => ({
    ...(await next(e)),
    theme: {
      set: async (look: ThemeSetArgs) => (record(look), { isDrawn: true as const, requestId: 'theme' }),
      clear: async () => (record('cleared'), { isDrawn: false as const, reason: 'cleared' }),
    },
  }))
}

type World = { files: Map<string, string>; notes: string[]; toasts: string[]; themes: (ThemeSetArgs | 'cleared')[]; store: Map<string, unknown> }

function world(on: On, id = 'me', cwd = '/code/atlas', isCommandRefused = false): World {
  const w: World = { files: new Map(), notes: [], toasts: [], themes: [], store: new Map() }
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: id }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000, percent: 12 }, rateLimits: [], cost: { usd: 0.5 } } }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ deny: 'no timers in tests' }))
  on('process.run', (_, e) => ({
    value:
      e.argv[1] === 'rev-parse'
        ? { exitCode: 0, stdout: `${cwd}\n${cwd}/.git\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.exists', (_, e) => ({ value: [...w.files.keys()].some(p => p.startsWith(e.path)) }))
  on('fs.list', (_, e) => ({
    value: [...w.files.keys()]
      .filter(p => p.startsWith(`${e.path}/`))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })),
  }))
  on('fs.read', (_, e) => ({ value: w.files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => (w.files.set(e.path, e.text), { value: undefined }))
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('command.register', () => (isCommandRefused ? { deny: 'a command of that name exists' } : { value: { command: 'factory' } }))
  on('ui.notify', (_, e) => (w.notes.push(`${e.title ?? ''}|${e.text}`), { value: { isSent: true, channel: 'client' } }))
  on('ui.toast', (_, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  themes(on, look => w.themes.push(look))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  return w
}

function seed(w: World, e: Entry): void {
  w.files.set(`${DIR}/${e.id}.json`, JSON.stringify(e))
}

function mine(w: World, id = 'me'): Entry | undefined {
  return parseEntry(w.files.get(`${DIR}/${id}.json`) ?? '')
}

function factory(args: string) {
  return { command: 'factory', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
}

const START = { cwd: '/code/atlas', surface: 'desktop', isInteractive: true } as const

test('the ledger follows a session from start to end', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(mine(w)?.project).toBe('atlas')
  expect(mine(w)?.state).toBe('idle')
  expect(mine(w)?.branch).toBe('main')

  await $.turn.start({ text: 'fix the login bug\nplease', turnId: 't1' })
  expect(mine(w)?.state).toBe('working')
  expect(mine(w)?.task).toBe('fix the login bug')
  expect(mine(w)?.cost).toBe(0.5)
  expect(mine(w)?.context).toBe(12)

  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(mine(w)?.state).toBe('waiting')

  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't2', reason: 'error' })
  expect(mine(w)?.state).toBe('failed')

  await $.session.end({ reason: 'other', sessionId: 'me', resume: { id: 'me' } } as never)
  expect(mine(w)?.state).toBe('ended')
})

test('a refused /factory command does not stop the ledger', async ($, on) => {
  const w = world(on, 'me', '/code/atlas', true)
  await $.session.start(START)
  expect(mine(w)?.state).toBe('idle')
  expect(mine(w)?.project).toBe('atlas')
})

test('the pane puts sessions that need you on top, grouped by project', async ($, on) => {
  const w = world(on)
  seed(w, entry({ id: 'b-wait', project: 'harbor', repo: '/code/harbor/.git', state: 'waiting', task: 'ship the release', since: NOW - 14 * MIN }))
  seed(w, entry({ id: 'c-old', state: 'working', heartbeatAt: NOW - 30 * MIN, task: 'long gone' }))
  await $.session.start(START)
  await $.command.run(factory(''))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'factory',
      component: 'Pane',
      requestId: 'factory-floor',
      surface,
      props: { title: 'Factory floor', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect((await ui.find({ type: 'Text', text: /Needs you/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /waiting 14m/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /this session/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /long gone/ })) === undefined).toBe(true)
    await ui.unmount()
  }

  const widget = await $.ui.mount({
    plugin: 'factory',
    component: 'Pane',
    requestId: 'factory-floor',
    surface: 'desktop',
    props: { title: 'Factory floor', isFocused: false, bodyColumns: 30, placement: 'widget', scroll: { offset: 0, bodyRows: 2 }, view: {} },
  })
  expect((await widget.find({ type: 'Text' }))?.text).toBe('0 working · 1 needs you · $2.50 today')
  await widget.unmount()
})

test('one batched notification when the queue grows, none when it does not', async ($, on) => {
  const w = world(on, 'a-me') // the lowest id: this session is the foreman
  seed(w, entry({ id: 'b', state: 'working' }))
  await $.session.start(START)
  await $.command.run(factory('')) // a refresh: sets the baseline
  expect(w.notes).toEqual([])

  seed(w, entry({ id: 'b', state: 'waiting', task: 'review the diff' }))
  seed(w, entry({ id: 'c', state: 'failed', project: 'beacon' }))
  await $.command.run(factory(''))
  expect(w.notes.length).toBe(1)
  expect(w.notes[0]).toContain('2 sessions need you')
  expect(w.notes[0]).toContain('atlas: review the diff')

  await $.command.run(factory(''))
  expect(w.notes).toEqual([w.notes[0]])
})

test('a session that is not the foreman stays silent', async ($, on) => {
  const w = world(on, 'z-me')
  seed(w, entry({ id: 'a-other', state: 'working' }))
  await $.session.start(START)
  await $.command.run(factory(''))
  seed(w, entry({ id: 'b', state: 'waiting' }))
  await $.command.run(factory(''))
  expect(w.notes).toEqual([])
})

test('the radar warns once when another session edited the same file', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  seed(w, entry({ id: 'twin', repo: '/code/atlas/.git', branch: 'feature', files: ['src/auth.ts'] }))
  await $.session.start(START)

  await $.tool.call({ tool: 'Edit', file_path: '/code/atlas/src/auth.ts', old_string: 'a', new_string: 'b' })
  expect(mine(w)?.files).toEqual(['src/auth.ts'])
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('src/auth.ts')
  expect(w.toasts[0]).toContain('feature')

  await $.tool.call({ tool: 'Edit', file_path: '/code/atlas/src/auth.ts', old_string: 'b', new_string: 'c' })
  expect(w.toasts.length).toBe(1)

  const band = await $.ui.mount({
    plugin: 'factory',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect((await band.find({ type: 'Text', text: /also edited by another session/ })) !== undefined).toBe(true)
  await band.press({ key: 'dismiss-collisions' })
  expect((await band.find({ type: 'Text', text: /engine/ })) !== undefined).toBe(true)
  await band.unmount()
})

test('features switch off and stay off; tint off clears the look', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const reply = await $.command.run(factory('tint off'))
  expect(reply.text).toContain('tint is off')
  expect((w.store.get('features') as { tint: boolean }).tint).toBe(false)

  await $.command.run(factory('ledger off'))
  expect(mine(w)?.state).toBe('ended')

  const list = await $.command.run(factory('settings'))
  expect(list.text).toContain('○ tint')
  expect(list.text).toContain('● radar')
})

test('a value an earlier version stored is declined', async ($, on) => {
  world(on)
  on('state.get', (_, e) => ({ value: e.key === 'floor' ? { value: [{ id: 1 }], version: 1 } : { value: undefined, version: 0 } }))
  const ui = await $.ui.mount({
    plugin: 'factory',
    component: 'Pane',
    requestId: 'factory-floor',
    surface: 'desktop',
    props: { title: 'Factory floor', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /floor is quiet/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('the task never shows the app\'s injected blocks or their ids', async () => {
  // The exact shapes that leaked into the floor during a live take.
  expect(taskLine('<system-reminder>\nLinked sessions now: a = local_123 (idle)\n</system-reminder>\n\nRun git push --force origin main'))
    .toBe('Run git push --force origin main')
  expect(taskLine('<system-reminder>\nLinked sessions now: a = local_123\n</system-reminder>')).toBe('')
  const relayed = '<cross-session-message from="local_f86c0397-299c" from-name="Some other session">\nPlease rebase.\n</cross-session-message>'
  expect(taskLine(relayed)).toBe('Message from another session')
  expect(taskLine(relayed)).not.toContain('local_')
  expect(taskLine('<local-command-caveat>Caveat</local-command-caveat>\n<command-name>/factory</command-name>')).toBe('')
  expect(taskLine('Add discount codes to the cart')).toBe('Add discount codes to the cart')
})

test('a session that finished long ago settles into idle instead of needing you', async () => {
  const base = { project: 'p', branch: 'main', task: 't', startedAt: 0, heartbeatAt: NOW, cost: 0, context: 0 }
  const fresh = entry({ ...base, id: 'fresh', state: 'waiting', since: NOW - 5 * 60_000 })
  const old = entry({ ...base, id: 'old', state: 'waiting', since: NOW - 23 * 3_600_000 })
  const failed = entry({ ...base, id: 'failed', state: 'failed', since: NOW - 23 * 3_600_000 })
  const live = liveEntries([fresh, old, failed], NOW)
  expect(needsYou(live).map(e => e.id)).toEqual(['failed', 'fresh'])
  expect(live.find(e => e.id === 'old')?.state).toBe('idle')
})

/**
 * Another theme plugin set its look earlier in the session, so Factory holds it
 * as the base. (The test kit gives no hook a `$.theme` to play that plugin with,
 * so the remembered base is seeded the way the engine would hand it back.)
 */
function chose(on: On, look: ThemeSetArgs): void {
  let stored: unknown = { shape: 'theme-1', value: look }
  let version = 1
  on('state.get', async (_, e, next) =>
    e.plugin === 'factory' && e.key === 'baseTheme' ? { value: { value: stored, version } } : next(e),
  )
  on('state.set', async (_, e, next) => {
    if (e.plugin === 'factory' && e.key === 'baseTheme') {
      stored = e.value
      version += 1
      return { value: { isSet: true as const, version } }
    }
    return next(e)
  })
}

test('another plugin\'s theme is tinted, not replaced; tint off hands it back', async ($, on) => {
  const w = world(on)
  const chosen: ThemeSetArgs = { colors: OTHER, backdrop: { color: 'surface-0' } }
  chose(on, chosen)
  await $.session.start(START)
  const shown = w.themes.at(-1) as ThemeSetArgs
  expect(shown.colors?.label).toBe('Paper')
  expect(shown.backdrop).toEqual(chosen.backdrop)
  const changed = changedKeys(OTHER, shown.colors as ThemeColors)
  expect(changed.length > 0 && changed.every(k => k.startsWith('role-accent-'))).toBe(true)

  await $.command.run(factory('tint off'))
  expect(w.themes.at(-1)).toEqual(chosen)

  await $.command.run(factory('tint on'))
  const again = changedKeys(OTHER, (w.themes.at(-1) as ThemeSetArgs).colors as ThemeColors)
  expect(again.length > 0 && again.every(k => k.startsWith('role-accent-'))).toBe(true)
})

test('with no other theme, tint on paints the project wash and tint off clears it', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect((w.themes.at(-1) as ThemeSetArgs).colors?.label).toBe('Factory: atlas')
  await $.command.run(factory('tint off'))
  expect(w.themes.at(-1)).toBe('cleared')
})

// ── Clarity updates ─────────────────────────────────────────────────────────

const INSTALLED = '/home/me/.claude/plugins/installed_plugins.json'

function installed(version: string, sha: string, extra: Record<string, unknown> = {}): string {
  const one = (name: string) => [
    { scope: 'user', installPath: `/home/me/.claude/plugins/cache/clarity/${name}/${version}`, version, gitCommitSha: sha },
  ]
  return JSON.stringify({
    version: 2,
    plugins: { 'clarity-theme@clarity': one('clarity-theme'), 'factory@clarity': one('factory'), ...extra },
  })
}

test('the Clarity install is read from installed_plugins.json, other marketplaces ignored', async () => {
  const a = readClarityInstall(installed('1.0.3', 'aaa'))
  expect(a?.version).toBe('1.0.3')
  // Same version, new commit: still new code on disk.
  expect(readClarityInstall(installed('1.0.3', 'bbb'))?.signature === a?.signature).toBe(false)
  // Another marketplace's plugin changing is not a Clarity update.
  const other = installed('1.0.3', 'aaa', { 'tool@elsewhere': [{ version: '9.9.9', gitCommitSha: 'zzz' }] })
  expect(readClarityInstall(other)?.signature).toBe(a?.signature)
  expect(readClarityInstall(JSON.stringify({ version: 2, plugins: { 'tool@elsewhere': [] } }))).toBe(undefined)
  expect(readClarityInstall('{"plugins":')).toBe(undefined)
  expect(readClarityInstall('')).toBe(undefined)
})

const BAND = {
  plugin: 'factory',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

function engineBand(on: On): string[] {
  const fills: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.fill', (_, e) => (fills.push(e.text), { isFilled: true }))
  return fills
}

const ANSWER = { answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('a newer Clarity on disk offers /reload-plugins above the prompt', async ($, on) => {
  const w = world(on)
  const fills = engineBand(on)
  w.files.set(INSTALLED, installed('1.0.3', 'aaa'))
  await $.session.start(START)

  // What this session loaded: nothing to offer.
  let band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /is installed/ })) === undefined).toBe(true)
  await band.unmount()

  // An update lands while the session runs; the next turn's end sees it.
  w.files.set(INSTALLED, installed('1.1.0', 'bbb'))
  await $.turn.complete(ANSWER)
  band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /Clarity 1\.1\.0 is installed/ })) !== undefined).toBe(true)
  await band.press({ key: 'reload-clarity' })
  expect(fills).toEqual(['/reload-plugins'])
  expect(w.toasts.some(t => t.includes('Press Enter'))).toBe(true)

  // "later" puts this update away; a further one shows again.
  await band.press({ key: 'dismiss-update' })
  expect((await band.find({ type: 'Text', text: /engine/ })) !== undefined).toBe(true)
  await band.unmount()
  w.files.set(INSTALLED, installed('1.1.1', 'ccc'))
  await $.turn.complete(ANSWER)
  band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /Clarity 1\.1\.1 is installed/ })) !== undefined).toBe(true)
  await band.unmount()
})

test('/factory updates off hides the offer and stays off', async ($, on) => {
  const w = world(on)
  engineBand(on)
  w.files.set(INSTALLED, installed('1.0.3', 'aaa'))
  await $.session.start(START)
  w.files.set(INSTALLED, installed('1.1.0', 'bbb'))
  await $.turn.complete(ANSWER)

  const reply = await $.command.run(factory('updates off'))
  expect(reply.text).toContain('updates is off')
  expect((w.store.get('features') as { updates: boolean }).updates).toBe(false)
  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /is installed/ })) === undefined).toBe(true)
  await band.unmount()

  const list = await $.command.run(factory('settings'))
  expect(list.text).toContain('○ updates')
})

test('the update row and the collision radar share the band', async ($, on) => {
  const w = world(on)
  engineBand(on)
  on('tool.call', () => ({ result: {} }))
  w.files.set(INSTALLED, installed('1.0.3', 'aaa'))
  seed(w, entry({ id: 'twin', repo: '/code/atlas/.git', branch: 'feature', files: ['src/auth.ts'] }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Edit', file_path: '/code/atlas/src/auth.ts', old_string: 'a', new_string: 'b' })
  w.files.set(INSTALLED, installed('1.1.0', 'bbb'))
  await $.turn.complete(ANSWER)

  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /Clarity 1\.1\.0 is installed/ })) !== undefined).toBe(true)
  expect((await band.find({ type: 'Text', text: /also edited by another session/ })) !== undefined).toBe(true)
  await band.unmount()
})
