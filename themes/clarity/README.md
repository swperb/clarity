# Clarity

A theme for Claude Code Desktop that's built to make long working sessions easier.

```
/plugin install clarity --marketplace swperb/claude-code-themes
```

## What it does for you

- **Text you can read all day.** Primary text is 7:1+ contrast on every surface in both
  modes; secondary and muted text clear 4.5:1. Dark mode uses a deep slate instead of pure
  black, which reduces the glow ("halation") around bright text.
- **Status you can't misread.** Danger is a vermillion and success a blue-leaning green.
  They differ in lightness as well as hue, so errors, destructive actions and passing
  checks stay distinct with red-green color blindness.
- **Diffs that scan fast.** Added, removed, modified, merged and conflicting each get
  their own hue and clear the app's text-contrast bar in dark mode, so you can review a
  change without squinting.
- **Keyboard-friendly.** Turns on the app's high-contrast mode for stronger borders and
  focus rings, so you always know where focus is.
- **Calm structure.** Surfaces are slate-tinted grays a few percent apart: panels, cards
  and menus separate clearly without competing with the conversation.

## Palette

| Role | Light | Dark (diffs) |
| --- | --- | --- |
| Accent | `#2563c9` | `#8fb6ff` |
| Danger | `#d2462b` | `#ff8f78` |
| Success | `#12876f` | `#5fd6b6` |
| Warning | `#b7791f` | `#f2bb63` |
| Pro | `#7a4fc4` | `#c0a6ff` |
| Page | `#f0f3f7` | `#12161b` |
| Text | `#141a23` | `#eef2f7` |

The app derives each role's full scale from these seeds, tuning lightness per mode.

Applies to the desktop and mobile apps; terminals and editors keep their own colors.

## License

MIT
