import type { Register, ThemeSetArgs } from 'claude-code'

import { clarity } from './palette.js'

const { theme, problems } = clarity()

const LOOK: ThemeSetArgs = { colors: theme }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Surfaces the one kind of problem that would make Desktop ignore the theme.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(`Clarity: ${unpainted}`)
    }

    // Terminals and editors don't draw themes; Desktop and mobile do.
    await $.theme.set(LOOK)

    return next(e)
  })
}
