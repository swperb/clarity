import { expect, mock, test } from 'claude-code/testing'

import type { Journal, Presence } from '../types'
import {
  answerGist,
  brief,
  briefWindow,
  dismiss,
  gitWork,
  hibernate,
  homeGlance,
  isAway,
  parseJournal,
  parsePresence,
  seen,
  toolLine,
  trailingQuestion,
} from '../hooks/home-lib'
import { parseEntry } from '../hooks/lib'

import { BASE, MIN, NOW, START, composer, entry, world } from './world'
import type { World } from './world'

// ── Words ───────────────────────────────────────────────────────────────────

test('a finished turn reads as its first plain sentence', async () => {
  expect(answerGist('## Done\n\nI added **discount codes** to the cart. Tests pass.')).toBe('Done')
  expect(answerGist('I added **discount codes** to `cart.ts`. Tests pass.')).toBe('I added discount codes to cart.ts.')
  expect(answerGist('```ts\nconst a = 1\n```\nFixed the [login bug](http://x).')).toBe('Fixed the login bug.')
  expect(answerGist('', 'fix the login')).toBe('fix the login')
  expect(answerGist('x'.repeat(300)).length).toBe(140)
})

test('only a question the answer ends on counts', async () => {
  expect(trailingQuestion('I migrated the users table.\n\nShould I also migrate the old tokens?')).toBe('Should I also migrate the old tokens?')
  expect(trailingQuestion('Why did it fail? A missing env var. Fixed it.')).toBe(undefined)
  expect(trailingQuestion('All done.')).toBe(undefined)
  expect(trailingQuestion('Done. Want me to open a PR?')).toBe('Want me to open a PR?')
})

test('git work is read from the shell command', async () => {
  expect(gitWork('git add -A && git commit -m "Add discount codes"')).toEqual({ kind: 'commit', text: 'Add discount codes' })
  expect(gitWork("git commit -m 'Fix login'")).toEqual({ kind: 'commit', text: 'Fix login' })
  expect(gitWork('git commit -m "$(cat <<\'EOF\'\nShip the release\n\nBody\nEOF\n)"')).toEqual({ kind: 'commit', text: 'Ship the release' })
  expect(gitWork('git push -u origin feature/cart')).toEqual({ kind: 'push', text: 'Pushed origin feature/cart' })
  expect(gitWork('git status')).toBe(undefined)
  expect(gitWork('npm test')).toBe(undefined)
})

test('a tool call reads as one short line', async () => {
  expect(toolLine('Bash', { command: 'git push --force\nmore' })).toBe('Bash: git push --force')
  expect(toolLine('Edit', { file_path: '/code/atlas/src/a.ts' }, '/code/atlas')).toBe('Edit src/a.ts')
  expect(toolLine('mcp__github__create_pull_request', {})).toBe('github: create_pull_request')
})

// ── Presence ────────────────────────────────────────────────────────────────

test('twenty quiet minutes start an away stretch from when you were last seen', async () => {
  const here = seen(null, NOW)
  expect(isAway(here)).toBe(false)
  expect(hibernate(here, NOW + 19 * MIN, 20 * MIN)).toBe(undefined)
  const away = hibernate(here, NOW + 20 * MIN, 20 * MIN)
  expect(away?.awaySince).toBe(NOW)
  expect(isAway(away)).toBe(true)
  // Already away: nothing more to do.
  expect(hibernate(away, NOW + 90 * MIN, 20 * MIN)).toBe(undefined)

  const back = seen(away, NOW + 75 * MIN)
  expect(isAway(back)).toBe(false)
  expect(back.backAt).toBe(NOW + 75 * MIN)
  expect(back.awaySince).toBe(NOW)

  // Came back, never dismissed, left again: the new stretch starts fresh.
  const again = hibernate(seen(back, NOW + 100 * MIN), NOW + 125 * MIN, 20 * MIN)
  expect(again?.awaySince).toBe(NOW + 100 * MIN)

  const read = dismiss(back, NOW + 80 * MIN)
  expect(read.awaySince).toBe(null)
  expect(read.briefedAt).toBe(NOW + 80 * MIN)
})

test('the briefing covers the away stretch, else since the last one, else today', async () => {
  const midnight = NOW - 10 * 60 * MIN
  const away: Presence = { v: 1, lastSeenAt: NOW - 60 * MIN, awaySince: NOW - 72 * MIN, backAt: null, briefedAt: null }
  expect(briefWindow(away, NOW, 'away', midnight)).toEqual({ from: NOW - 72 * MIN, until: NOW, label: 'While you were away · 1h 12m', isAway: true })
  const briefed: Presence = { ...away, awaySince: null, briefedAt: NOW - 3 * 60 * MIN }
  expect(briefWindow(briefed, NOW, 'away', midnight).label).toBe('Since your last briefing · 3h 00m')
  expect(briefWindow(briefed, NOW, 'today', midnight)).toEqual({ from: midnight, until: NOW, label: 'Today', isAway: false })
  expect(briefWindow(null, NOW, 'away', midnight).label).toBe('Today')
})

test('files from older versions and junk are refused', async () => {
  expect(parsePresence('{"v":1,"lastSeenAt":5}')?.awaySince).toBe(null)
  expect(parsePresence('nope')).toBe(undefined)
  expect(parseJournal('{"v":1,"id":"a","project":"p","events":[{"at":1,"kind":"done","text":"t"},{"at":2,"kind":"dance","text":"x"}]}')?.events.length).toBe(1)
  expect(parseEntry(JSON.stringify({ ...entry({}), limits: undefined }))?.limits).toEqual([])
})

// ── The briefing ────────────────────────────────────────────────────────────

test('the briefing gathers work, open questions, holdups and usage across projects', async () => {
  const from = NOW - 60 * MIN
  const journals: Journal[] = [
    {
      v: 1,
      id: 'a',
      project: 'atlas',
      branch: 'main',
      events: [
        { at: from - MIN, kind: 'done', text: 'Before you left', cost: 5 },
        { at: from + 5 * MIN, kind: 'done', text: 'Added discount codes.', files: ['src/cart.ts', 'src/code.ts'], cost: 1.5, durationMs: 4 * MIN },
        { at: from + 6 * MIN, kind: 'commit', text: 'Add discount codes' },
        { at: from + 7 * MIN, kind: 'blocked', text: 'Needs permission: Bash: git push', resolvedAt: from + 30 * MIN },
        // Settled at once (an automatic decision): nobody waited, so it held nothing up.
        { at: from + 8 * MIN, kind: 'blocked', text: 'Needs permission: Bash: ls', resolvedAt: from + 8 * MIN + 3 },
        { at: from + 40 * MIN, kind: 'question', text: 'Should I also migrate the old tokens?' },
      ],
    },
    {
      v: 1,
      id: 'b',
      project: 'harbor',
      branch: null,
      events: [
        { at: from + 10 * MIN, kind: 'failed', text: "Hit the plan's usage limit" },
        { at: from + 20 * MIN, kind: 'blocked', text: 'Needs permission: Edit src/x.ts' },
      ],
    },
    // A session that is gone: its open question can't be answered any more.
    { v: 1, id: 'gone', project: 'beacon', branch: null, events: [{ at: from + MIN, kind: 'question', text: 'Ghost?' }] },
  ]
  const entries = [
    entry({ id: 'a', state: 'waiting', since: from + 40 * MIN, context: 85, limits: [{ kind: 'five_hour', percentUsed: 52 }] }),
    entry({ id: 'b', project: 'harbor', state: 'working', heartbeatAt: NOW - 2 * MIN, limits: [{ kind: 'five_hour', percentUsed: 40 }] }),
    entry({ id: 'c', project: 'orchard', state: 'waiting', task: 'ship it', since: from + 50 * MIN }),
  ]
  const b = brief(journals, entries, from, NOW)

  expect(b.stats.turns).toBe(1)
  expect(b.stats.files).toBe(2)
  expect(b.stats.commits).toBe(1)
  expect(b.stats.spend).toBe(1.5)
  expect(b.projects.map(p => p.project)).toEqual(['atlas'])
  expect(b.needs.map(n => `${n.kind}:${n.project}`)).toEqual(['question:atlas', 'blocked:harbor', 'waiting:orchard'])
  expect(b.heldUp.map(i => i.event.text)).toEqual(['Needs permission: Bash: git push', "Hit the plan's usage limit"])
  expect(b.working.map(e => e.id)).toEqual(['b'])
  expect(b.limits).toEqual([{ kind: 'five_hour', percentUsed: 52 }])
  expect(b.fullContexts.map(e => e.id)).toEqual(['a'])
  expect(homeGlance(b, true, 72 * MIN)).toBe('Away 1h 12m · 1 done · 3 need you · 1 working')
})

// ── The engine ──────────────────────────────────────────────────────────────


function journalOf(w: World, id = 'me'): Journal | undefined {
  return parseJournal(w.files.get(`${BASE}/journal/${id}.json`) ?? '')
}

function presenceOf(w: World): Presence | undefined {
  return parsePresence(w.files.get(`${BASE}/presence.json`) ?? '')
}


test('each turn leaves a line in the journal: what it did, files, cost, and its question', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start(START)

  await $.turn.start({ text: 'add discount codes', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/code/atlas/src/cart.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/code/atlas/src/codes.ts', content: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -am "Add discount codes"' })
  await clock.advance(3 * MIN)
  w.usd = 0.75
  await $.turn.complete({
    answer: 'Added discount codes to the cart.\n\nShould I also add them to checkout?',
    durationMs: 3 * MIN,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })

  const events = journalOf(w)?.events ?? []
  expect(events.map(e => e.kind)).toEqual(['commit', 'done', 'question'])
  const done = events.find(e => e.kind === 'done')
  expect(done?.text).toBe('Added discount codes to the cart.')
  expect(done?.files).toEqual(['src/cart.ts', 'src/codes.ts'])
  expect(done?.cost).toBe(0.25)
  expect(events[0]?.text).toBe('Add discount codes')
  expect(journalOf(w)?.project).toBe('atlas')

  // Your next prompt answers the question.
  await $.prompt.submit({ text: 'yes please', origin: composer, wait: false })
  expect(journalOf(w)?.events.find(e => e.kind === 'question')?.resolvedAt).toBe(NOW + 3 * MIN)
})

test('an AskUserQuestion stays open until answered; a permission wait clears when the tool runs', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files = new Map<string, string>()
  let duringAsk: Journal | undefined
  // Answers the dialog: by then the question is in the journal, still open.
  on('tool.call', { tool: 'AskUserQuestion' }, () => ((duringAsk = parseJournal(files.get(`${BASE}/journal/me.json`) ?? '')), { result: {} }))
  const w = world(on)
  w.files = files
  await $.session.start(START)

  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which database?', header: 'DB', options: [], multiSelect: false }] })
  expect(duringAsk?.events.map(e => `${e.kind}:${e.text}:${e.resolvedAt ?? 'open'}`)).toEqual(['question:Which database?:open'])
  expect(journalOf(w)?.events[0]?.resolvedAt).toBe(NOW)

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push --force' } } as never)
  expect(journalOf(w)?.events.at(-1)).toEqual({ at: NOW, kind: 'blocked', text: 'Needs permission: Bash: git push --force' })
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(journalOf(w)?.events.find(e => e.kind === 'blocked')?.resolvedAt).toBe(NOW)
})

test('a rate limit reads plainly, once', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.classic.StopFailure({ error: 'rate_limit' } as never)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't1', reason: 'error' })
  expect(journalOf(w)?.events.map(e => `${e.kind}:${e.text}`)).toEqual(["failed:Hit the plan's usage limit"])
})

test('after twenty quiet minutes Home opens itself, and Got it ends the briefing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start(START)
  expect(presenceOf(w)?.lastSeenAt).toBe(NOW)
  expect(w.opened).toEqual([])

  await clock.advance(19 * MIN)
  expect(w.opened).toEqual([])
  await clock.advance(MIN)
  expect(w.opened).toEqual(['factory-home'])
  expect(presenceOf(w)?.awaySince).toBe(NOW)

  // Still away: not opened again.
  await clock.advance(30 * MIN)
  expect(w.opened).toEqual(['factory-home'])

  // Back: typing marks you present.
  await $.prompt.submit({ text: 'what happened?', origin: composer, wait: false })
  expect(presenceOf(w)?.backAt).toBe(NOW + 50 * MIN)

  const ui = await $.ui.mount({
    plugin: 'factory',
    component: 'Pane',
    requestId: 'factory-home',
    surface: 'desktop',
    props: { title: 'Home', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /While you were away · 50m/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /31%/ })) !== undefined).toBe(true)
  await ui.press({ key: 'home-dismiss' })
  expect(presenceOf(w)?.awaySince).toBe(null)
  expect(presenceOf(w)?.briefedAt).toBe(NOW + 50 * MIN)
  expect((await ui.find({ type: 'Text', text: /Since your last briefing/ })) !== undefined).toBe(true)
  await ui.unmount()
})

const homeCmd = (args: string) => ({ command: 'home', args, origin: composer, presentation: { isFullscreen: false, columns: 120 } }) as const

test('the wait comes from Factory\'s settings', { options: { hibernate: '45' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start(START)
  await clock.advance(44 * MIN)
  expect(w.opened).toEqual([])
  await clock.advance(MIN)
  expect(w.opened).toEqual(['factory-home'])
  expect((await $.command.run(homeCmd('hibernate'))).text).toContain('after 45 minutes')
})

test('hibernation set to off never opens Home by itself', { options: { hibernate: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start(START)
  await clock.advance(6 * 60 * MIN)
  expect(w.opened).toEqual([])
  expect(presenceOf(w)?.awaySince).toBe(null)
  expect((await $.command.run(homeCmd('hibernate'))).text).toContain('Hibernation is off')
  // /home still opens it on request.
  await $.command.run(homeCmd(''))
  expect(w.opened).toEqual(['factory-home'])
})

test('/home hibernate changes the same setting, and only to a listed choice', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on)
  const set: unknown[] = []
  on('config.set', (_, e) => (set.push([e.key, e.value]), { value: e.value }))
  await $.session.start(START)

  expect((await $.command.run(homeCmd('hibernate 30'))).text).toContain('30 minutes')
  expect((await $.command.run(homeCmd('hibernate off'))).text).toContain('Hibernation is off')
  expect(set).toEqual([
    ['factory.hibernate', '30'],
    ['factory.hibernate', 'off'],
  ])
  expect((await $.command.run(homeCmd('hibernate 25'))).text).toContain('Choose one of: off, 10, 15, 20, 30')
  expect(set.length).toBe(2)
})

test('the pane draws on every surface, and its widget is one line', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  w.files.set(
    `${BASE}/journal/other.json`,
    JSON.stringify({ v: 1, id: 'other', project: 'harbor', branch: 'main', events: [{ at: NOW - MIN, kind: 'done', text: 'Shipped the release.', files: ['a.ts'] }] }),
  )
  w.files.set(`${BASE}/sessions/other.json`, JSON.stringify(entry({ id: 'other', project: 'harbor', state: 'waiting', task: 'ship', since: NOW - MIN, heartbeatAt: NOW })))
  await $.session.start(START)
  await $.command.run({ command: 'home', args: 'today', origin: composer, presentation: { isFullscreen: false, columns: 120 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'factory',
      component: 'Pane',
      requestId: 'factory-home',
      surface,
      props: { title: 'Home', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect((await ui.find({ type: 'Text', text: /Shipped the release/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Needs you · 1/ })) !== undefined).toBe(true)
    await ui.unmount()
  }
  const widget = await $.ui.mount({
    plugin: 'factory',
    component: 'Pane',
    requestId: 'factory-home',
    surface: 'desktop',
    props: { title: 'Home', isFocused: false, bodyColumns: 30, placement: 'widget', scroll: { offset: 0, bodyRows: 2 }, view: {} },
  })
  expect((await widget.find({ type: 'Text' }))?.text).toBe('1 done · 1 needs you')
  await widget.unmount()
})
