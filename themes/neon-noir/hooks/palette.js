// Neon Noir: a megacity after midnight, all neon and chrome.
//
// Design rules, in priority order:
// 1. Words first: primary text is 7:1+ on every surface, muted text 4.5:1+.
//    The noise lives in the backdrop; the panels the words sit on stay dark.
// 2. Hazard-yellow lead: focus, links and keywords in a sharp yellow; electric
//    cyan for pro and code literals. Status keeps its meaning: danger a neon
//    red, success an acid green, warning a burnt orange (apart from the yellow).
// 3. Blue-steel night surfaces a few percent apart, never pure black.
// 4. Dark only: this city has no daytime.
// Diff and git colors stay the app's own standard green and red.
import { makeColors } from './make-colors.js'

export function neonNoir() {
  return makeColors({
    label: 'Neon Noir',
    id: 'neon-noir',
    only: 'dark',
    roles: {
      accent: '#f7e017', // hazard yellow
      danger: '#ff3b4a', // neon red
      success: '#2dff9a', // acid green
      warning: '#ff8a1f', // burnt orange
      pro: '#00f0ff', // electric cyan
    },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#08090e',
          'surface-1': '#0d0f16',
          'surface-2': '#11141d',
          'surface-3': '#151925',
          'text-primary': '#eef3f6',
          'text-secondary': '#c2cad6',
          'text-muted': '#9ca7b6',
        },
      },
    },
  })
}
