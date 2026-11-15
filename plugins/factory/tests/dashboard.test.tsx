import { expect, mock, test } from 'claude-code/testing'

import type { Journal } from '../types'
import { blockBar, bucketsFor, dashboard, dashboardGlance, projectSpendSvg, rangeStart, timelineSvg } from '../hooks/dashboard-lib'
import { startOfDay } from '../hooks/lib'

import { BASE, MIN, NOW, START, composer, entry, world } from './world'

const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MIDNIGHT = startOfDay(NOW)

function journals(): Journal[] {
  return [
    {
      v: 1,
      id: 'a',
      project: 'atlas',
      branch: 'main',
      events: [
        { at: MIDNIGHT - 2 * DAY, kind: 'done', text: 'Two days ago', cost: 4 },
        { at: MIDNIGHT + 30 * MIN, kind: 'done', text: 'Early', cost: 1, files: ['a.ts', 'b.ts'] },
        { at: MIDNIGHT + 40 * MIN, kind: 'commit', text: 'Early commit' },
        { at: MIDNIGHT + 50 * MIN, kind: 'done', text: 'Again', cost: 0.5, files: ['a.ts'] },
      ],
    },
    {
      v: 1,
      id: 'b',
      project: 'harbor',
      branch: null,
      events: [
        { at: MIDNIGHT + 45 * MIN, kind: 'done', text: 'Harbor work', cost: 2 },
        { at: NOW - 5 * MIN, kind: 'question', text: 'Ship it now?' },
      ],
    },
  ]
}

const LIVE = [
  entry({ id: 'a', project: 'atlas', state: 'working', heartbeatAt: NOW - MIN, since: NOW - 3 * MIN, limits: [{ kind: 'five_hour', percentUsed: 82 }, { kind: 'seven_day', percentUsed: 20 }] }),
  entry({ id: 'b', project: 'harbor', state: 'waiting', heartbeatAt: NOW - MIN, since: NOW - 5 * MIN, context: 91 }),
  entry({ id: 'gone', project: 'orchard', state: 'working', heartbeatAt: MIDNIGHT - HOUR }),
]

test("today's numbers: KPIs, projects, triage and sessions come from the ledger and journals", async () => {
  const d = dashboard(journals(), LIVE, 'today', NOW, MIDNIGHT)

  expect(d.from).toBe(MIDNIGHT)
  expect(d.kpis).toEqual({ live: 2, working: 1, needsYou: 1, tasks: 3, spend: 3.5, commits: 1, fullestLimit: { kind: 'five_hour', percentUsed: 82 } })
  // The question harbor asked is the triage item, not a second "your move" for the same session.
  expect(d.needs.map(n => `${n.kind}:${n.project}:${n.text}`)).toEqual(['question:harbor:Ship it now?'])
  // Needing you sorts first; a stale session is no longer live.
  expect(d.projects.map(p => p.project)).toEqual(['harbor', 'atlas'])
  const atlas = d.projects.find(p => p.project === 'atlas')
  expect(atlas).toEqual({ project: 'atlas', live: 1, working: 1, needsYou: 0, tasks: 2, files: 2, commits: 1, spend: 1.5, lastAt: NOW - 3 * MIN })
  expect(d.sessions.map(s => s.id)).toEqual(['b', 'a'])
  expect(d.fullContexts.map(s => s.id)).toEqual(['b'])
  expect(dashboardGlance(d)).toBe('2 live · 1 needs you · 3 done · $3.50 today')
})

test('the week takes in the last seven days, by the day', async () => {
  const d = dashboard(journals(), LIVE, 'week', NOW, MIDNIGHT)
  expect(d.from).toBe(rangeStart('week', MIDNIGHT))
  expect(d.kpis.tasks).toBe(4)
  // atlas's tasks ($5.50) beat its session's $1; harbor's $2 beats $1; orchard's ended session adds its $1.
  expect(d.kpis.spend).toBe(8.5)
  expect(d.untimedSpend).toBe(1)
  expect(d.buckets.length).toBe(7)
  expect(d.buckets.at(-1)?.start).toBe(MIDNIGHT)
  expect(d.buckets.at(-1)?.spend).toBe(3.5)
  expect(d.buckets.at(-3)?.spend).toBe(4)
  expect(d.buckets.at(-1)?.byProject).toEqual({ atlas: 1.5, harbor: 2 })
  expect(dashboardGlance(d)).toContain('this week')
})

test("a session's whole cost counts when its journal holds less; the charts say what they can't place", async () => {
  const pricey = [...LIVE.slice(0, 2), entry({ id: 'c', project: 'orchard', state: 'waiting', heartbeatAt: NOW - MIN, cost: 40, since: NOW - 2 * MIN })]
  const d = dashboard(journals(), pricey, 'today', NOW, MIDNIGHT)
  expect(d.kpis.spend).toBe(43.5)
  expect(d.projects.find(p => p.project === 'orchard')?.spend).toBe(40)
  expect(d.untimedSpend).toBe(40)
  expect(d.buckets.reduce((sum, b) => sum + b.spend, 0)).toBe(3.5)
})

test("today's buckets run by the hour, midnight to now", async () => {
  const b = bucketsFor('today', MIDNIGHT, MIDNIGHT + 2 * HOUR + 10 * MIN)
  expect(b.map(x => x.label)).toEqual(['00', '01', '02'])
  const d = dashboard(journals(), LIVE, 'today', NOW, MIDNIGHT)
  expect(d.buckets[0]).toEqual({ start: MIDNIGHT, label: '00', spend: 3.5, tasks: 3, byProject: { atlas: 1.5, harbor: 2 } })
})

test('charts are whole SVG, escape names, and carry a tooltip per bar', async () => {
  const d = dashboard(journals(), LIVE, 'today', NOW, MIDNIGHT)
  const svg = timelineSvg(d.buckets)
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg).toContain('<title>00: $3.50 · 3 tasks\natlas $1.50\nharbor $2.00</title>')
  expect(svg.length < 131072).toBe(true)

  const odd = projectSpendSvg([{ project: '<x&"y>', live: 0, working: 0, needsYou: 0, tasks: 1, files: 0, commits: 0, spend: 1, lastAt: 0 }])
  expect(odd).toContain('&lt;x&amp;&quot;y&gt;')
  expect(odd.includes('<x&')).toBe(false)
  expect(blockBar(0.5, 4)).toBe('██░░')
  expect(blockBar(2, 4)).toBe('████')
})

test('/overview opens the pane; it draws on every surface, and its widget is one line', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  for (const j of journals()) w.files.set(`${BASE}/journal/${j.id}.json`, JSON.stringify(j))
  for (const e of LIVE) w.files.set(`${BASE}/sessions/${e.id}.json`, JSON.stringify(e))
  await $.session.start(START)

  const ran = await $.command.run({ command: 'overview', args: '', origin: composer, presentation: { isFullscreen: false, columns: 120 } })
  expect(ran.text).toBe('Opened the dashboard.')
  expect(w.opened).toContain('factory-dashboard')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'factory',
      component: 'Pane',
      requestId: 'factory-dashboard',
      surface,
      props: { title: 'Dashboard', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    expect((await ui.find({ type: 'Text', text: /Ship it now\?/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^Need you$/ })) !== undefined).toBe(true)
    // This session's own entry is the freshest limits reading: 31%, not the other session's 82%.
    expect((await ui.find({ type: 'Text', text: /^5-hour used$/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^31%$/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /context 91% full/ })) !== undefined).toBe(true)
    // Desktop draws real charts; the terminal falls back to block bars.
    expect((await ui.find({ type: 'Svg' })) !== undefined).toBe(surface === 'desktop')

    // The range switch redraws with the week's numbers.
    await ui.press({ key: 'range-week' })
    expect((await ui.find({ type: 'Text', text: /^Spend, 7 days$/ })) !== undefined).toBe(true)
    await ui.press({ key: 'range-today' })
    await ui.unmount()
  }

  const widget = await $.ui.mount({
    plugin: 'factory',
    component: 'Pane',
    requestId: 'factory-dashboard',
    surface: 'desktop',
    props: { title: 'Dashboard', isFocused: false, bodyColumns: 30, placement: 'widget', scroll: { offset: 0, bodyRows: 2 }, view: {} },
  })
  // This session is live too.
  expect((await widget.find({ type: 'Text' }))?.text).toBe('3 live · 1 needs you · 3 done · $3.50 today')
  await widget.unmount()
})

test('/factory dashboard opens it too, and an empty floor says so plainly', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start(START)
  const ran = await $.command.run({ command: 'factory', args: 'dashboard', origin: composer, presentation: { isFullscreen: false, columns: 120 } })
  expect(ran.text).toBe('Opened the dashboard.')
  expect(w.opened).toContain('factory-dashboard')
  const ui = await $.ui.mount({
    plugin: 'factory',
    component: 'Pane',
    requestId: 'factory-dashboard',
    surface: 'desktop',
    props: { title: 'Dashboard', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /Nothing is waiting on you/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /No finished tasks yet today/ })) !== undefined).toBe(true)
  await ui.unmount()
})
