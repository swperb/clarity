// Neon Noir: a rain-slick city at night, lit by signs.
//
// Design rules, in priority order:
// 1. Words first: primary text is 7:1+ on every surface, muted text 4.5:1+.
//    The neon lives in the accents; the page itself stays a quiet blue-black.
// 2. Neon on accent and pro: electric cyan for focus, links and keywords, hot
//    magenta for pro and code literals. Status keeps its meaning: danger is a
//    neon red, success a neon green, warning a signal amber.
// 3. Night surfaces: blue-black tinted toward violet, a few percent apart, so
//    panels read as wet asphalt under different signs, never pure black.
// 4. Day mode is the same street in morning haze: pale violet-gray paper with
//    the same signs, switched off a little.
// Diff and git colors stay the app's own standard green and red.
import { makeColors } from './make-colors.js'

export function neonNoir() {
  return makeColors({
    label: 'Neon Noir',
    id: 'neon-noir',
    roles: {
      accent: '#14d4f4', // electric cyan
      danger: '#ff3355', // neon red
      success: '#2ee88f', // neon green
      warning: '#ffb81c', // signal amber
      pro: '#ff2bb4', // hot magenta
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#eeecf5',
          'surface-1': '#f4f3f9',
          'surface-2': '#fafafd',
          'text-primary': '#130f26',
          'text-secondary': '#36304f',
          'text-muted': '#544d6e',
        },
      },
    },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#0a0913',
          'surface-1': '#0f0d1b',
          'surface-2': '#131123',
          'surface-3': '#17152a',
          'text-primary': '#eceeff',
          'text-secondary': '#c4c5e4',
          'text-muted': '#a09fc6',
        },
      },
    },
  })
}
