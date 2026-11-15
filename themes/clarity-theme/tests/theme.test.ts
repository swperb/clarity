import type { On, ThemeSetArgs } from 'claude-code'
import { expect, test } from 'claude-code/testing'

type World = { looks: ThemeSetArgs[]; deferTo: string[] }

const START = { cwd: '/code/atlas', surface: 'desktop', isInteractive: true } as const

/** The engine around the theme: the app beneath the plugins, recording each look, and its stored state. */
function world(on: On, deferTo: string | null = null): World {
  const w: World = { looks: [], deferTo: [] }
  // Engines from 2.1.321 have `$.theme` and a test answers its events; older test kits
  // have none, so one is also added for them (a newer kit skips that hook).
  on('theme.set', (_, e) => (w.looks.push(e), { value: { isDrawn: true, requestId: 'theme' } }))
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
  on('engine.create', async (_, e, next) => ({
    ...(await next(e)),
    theme: {
      set: async (look: ThemeSetArgs) => (w.looks.push(look), { isDrawn: true as const, requestId: 'theme' }),
      clear: async () => ({ isDrawn: false as const, reason: 'cleared' }),
    },
  }))
  on('state.get', async (_, e, next) =>
    e.key === 'deferTo' ? { value: { value: deferTo ?? undefined, version: deferTo === null ? 0 : 1 } } : next(e),
  )
  on('state.set', async (_, e, next) => {
    if (e.key === 'deferTo') {
      w.deferTo.push(String(e.value))
    }
    return next(e)
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return w
}

test('with no other theme, Clarity paints its own and does not step aside for itself', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(w.looks.length).toBe(1)
  expect(w.looks[0]?.colors?.id).toBe('clarity')
  expect(w.deferTo).toEqual([])
})

test("once another plugin's theme is in use, Clarity leaves it standing", async ($, on) => {
  const w = world(on, 'paper-theme')
  await $.session.start(START)
  expect(w.looks).toEqual([])
})
