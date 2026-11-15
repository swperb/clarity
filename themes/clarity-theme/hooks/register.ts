import { atom, read, update } from 'claude-code'
import type { Register, ThemeSetArgs } from 'claude-code'

import { clarity } from './palette.js'

const { theme, problems } = clarity()

const LOOK: ThemeSetArgs = { colors: theme }

/** Clarity's own plugins: their theme calls (Factory's project tint) build on a theme, never replace it. */
const SUITE = new Set(['clarity-theme', 'factory', 'workbench', 'studio'])

/** Another theme plugin's name, once one sets a look: Clarity then steps aside for it. */
const deferTo = atom({ plugin: 'clarity-theme', key: 'deferTo' } as const, null)

function isSuite(plugin: string): boolean {
  return plugin === 'engine' || SUITE.has(plugin.split('@')[0] ?? plugin)
}

export const register: Register = on => {
  // Any other theme the person installed wins: Clarity's plugins adapt to it, so
  // Clarity's own palette only fills in when no other theme is in play.
  on('theme.set', async ($, e, next) => {
    const plugin = next.origin.plugin
    if (!isSuite(plugin)) {
      await update($, deferTo, () => plugin)
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    // Surfaces the one kind of problem that would make Desktop ignore the theme.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(`Clarity: ${unpainted}`)
    }

    // Terminals and editors don't draw themes; Desktop and mobile do.
    if ((await read($, deferTo)) === null) {
      await $.theme.set(LOOK)
    }

    return next(e)
  })
}
