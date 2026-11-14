// Clarity: a theme tuned for long working sessions.
//
// Design rules, in priority order:
// 1. Words first: primary text is 7:1+ on every surface, muted text 4.5:1+.
// 2. Status you can't miss, even with color-vision deficiency: danger is a
//    vermillion and success a blue-leaning green, so they differ in hue AND
//    lightness (safe for deuteranopia/protanopia); diffs follow the same split.
// 3. Calm surfaces: slate-tinted grays a few percent apart, no pure black or
//    white, so panels separate without shouting and dark mode doesn't halate.
// 4. Keyboard-first: contrast 'more' gives stronger borders and focus rings.
import { makeColors } from './make-colors.js'

export function clarity() {
  return makeColors({
    label: 'Clarity',
    id: 'clarity',
    contrast: 'more',
    roles: {
      accent: '#2563c9', // focus, links, keywords: a confident blue
      danger: '#d2462b', // vermillion: reads as "stop" for every color vision
      success: '#12876f', // bluish green: separable from danger by hue and lightness
      warning: '#b7791f', // amber
      pro: '#7a4fc4', // violet
    },
    light: {
      gray: {
        anchors: {
          'surface-0': '#f0f3f7',
          'surface-1': '#f5f7fa',
          'surface-2': '#fbfcfd',
          'text-primary': '#141a23',
          'text-secondary': '#384252',
          'text-muted': '#55606f',
        },
      },
      git: {
        added: '#12876f',
        removed: '#b5361d',
        modified: '#2563c9',
        merged: '#7a4fc4',
        closed: '#b5361d',
        conflicting: '#94600f',
        draft: '#55606f',
      },
    },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#12161b',
          'surface-1': '#171b21',
          'surface-2': '#1b2027',
          'surface-3': '#1e242b',
          'text-primary': '#eef2f7',
          'text-secondary': '#c3cbd6',
          'text-muted': '#a3adbb',
        },
      },
      git: {
        added: '#5fd6b6',
        removed: '#ff8f78',
        modified: '#8fb6ff',
        merged: '#c0a6ff',
        closed: '#ff8f78',
        conflicting: '#f2bb63',
        draft: '#b3bcc8',
      },
    },
  })
}
