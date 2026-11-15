import type { Register, ThemeSetArgs } from 'claude-code'

import { neonNoir } from './palette.js'
import { SCENE } from './scene.js'

const { theme, problems } = neonNoir()

/** The scene's name; Factory's tint re-sets the look with it, so match on this, not on who set it. */
export const SCENE_NAME = 'neon-noir-street'

/** Panels frost a little more than the default so the rain never reaches the words. */
export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 20, opacity: 0.7 } },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Surfaces the one kind of problem that would make Desktop ignore the theme.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(`Neon Noir: ${unpainted}`)
    }

    // Terminals and editors don't draw themes; Desktop and mobile do.
    await $.theme.set(LOOK)

    return next(e)
  })

  // The skyline in the rain, along the top of the window: away from the words in
  // the middle and the message box at the foot.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.props.scene !== SCENE_NAME || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENE} alt="A distant city skyline at night, neon signs humming in light rain" isInteractive />
  })
}
