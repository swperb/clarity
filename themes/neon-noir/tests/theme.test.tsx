import type { On, ThemeSetArgs } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { checkColors, makeColors } from '../hooks/make-colors.js'
import { neonNoir } from '../hooks/palette.js'
import { SCENE } from '../hooks/scene.js'

type World = { looks: ThemeSetArgs[]; toasts: string[] }

const START = { cwd: '/code/atlas', surface: 'desktop', isInteractive: true } as const

/** The engine around the theme: the app beneath the plugins, recording each look it is sent. */
function world(on: On): World {
  const w: World = { looks: [], toasts: [] }
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
  on('ui.toast', (_, e) => (w.toasts.push(e.text), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return w
}

function backdrop(scene: string, plugin: string, surface: 'desktop' | 'mobile' | 'terminal' = 'desktop') {
  return {
    plugin: 'neon-noir',
    component: 'Backdrop',
    requestId: 'backdrop',
    surface,
    props: { scene, plugin, glass: { blur: 20, opacity: 0.7 } },
  } as const
}

test('session start paints Neon Noir, colors and scene in one set, with nothing to warn about', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(w.looks.length).toBe(1)
  expect(w.looks[0]?.colors?.id).toBe('neon-noir')
  expect(w.looks[0]?.backdrop).toEqual({ scene: 'neon-noir-street', glass: { blur: 20, opacity: 0.7 } })
  expect(w.toasts).toEqual([])
})

test('the palette paints in both modes, keeps the words readable and leaves git colors alone', async () => {
  const { theme, problems } = neonNoir()
  expect(problems.filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
  expect(checkColors(theme).filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
  // No contrast complaint about any text tier: primary, secondary or muted.
  expect(problems.filter(line => /^text-(primary|secondary|muted)\b/.test(line))).toEqual([])
  // Git and diff colors stay the app's own: the same as a palette that names no git colors.
  const plain = makeColors({
    label: 'plain',
    light: { gray: { anchors: { 'surface-0': '#f0f0f0', 'text-primary': '#111111' } } },
    dark: { gray: { anchors: { 'surface-0': '#101418', 'text-primary': '#eeeeee' } } },
  }).theme
  for (const mode of ['light', 'dark'] as const) {
    const ours = theme.inputs[mode] ?? {}
    const app = plain.inputs[mode] ?? {}
    expect(Object.keys(ours).length > 50).toBe(true)
    for (const key of Object.keys(ours).filter(k => k.includes('git'))) {
      expect([key, ours[key]]).toEqual([key, app[key]])
    }
  }
})

test('the scene draws on desktop and mobile, also once Factory has re-set the look with its tint', async ($, on) => {
  world(on)
  for (const [surface, setBy] of [['desktop', 'neon-noir'], ['mobile', 'neon-noir'], ['desktop', 'factory']] as const) {
    const ui = await $.ui.mount(backdrop('neon-noir-street', setBy, surface))
    const svg = await ui.find({ type: 'Svg' })
    expect(svg !== undefined).toBe(true)
    expect(String(svg?.props.source).startsWith('<svg')).toBe(true)
    await ui.unmount()
  }
})

test("another theme's scene is left to its own plugin", async ($, on) => {
  world(on)
  // Stands for the engine's own drawing beneath the plugins.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(backdrop('lagoon', 'paper-theme'))
  expect((await ui.find({ type: 'Svg' })) === undefined).toBe(true)
  await ui.unmount()
})

test('the scene fits the limit, stays calm and runs no script', async () => {
  expect(SCENE.length < 131072).toBe(true)
  expect(SCENE.includes('preserveAspectRatio="xMidYMin slice"')).toBe(true)
  expect(SCENE.includes('prefers-reduced-motion')).toBe(true)
  expect(SCENE.includes('prefers-color-scheme:light')).toBe(true)
  expect(/<script|on[a-z]+=|href="http/i.test(SCENE)).toBe(false)
})
