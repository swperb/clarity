# Clarity theme

A theme for Claude Code Desktop that's built to make long working sessions easier.

```
/plugin install clarity-theme --marketplace swperb/clarity
```

## What it does for you

- **Text you can read all day.** Primary text is 7:1+ contrast on every surface in both
  modes; secondary and muted text clear 4.5:1. Dark mode uses a deep slate instead of pure
  black, which reduces the glow ("halation") around bright text.
- **Status you can't misread.** Danger is a vermillion and success a blue-leaning green.
  They differ in lightness as well as hue, so errors, destructive actions and passing
  checks stay distinct with red-green color blindness.
- **Diffs stay vanilla.** File changes keep the app's standard green and red, which
  everyone already reads at a glance and which pop against Clarity's calm surfaces.
- **Keyboard-friendly.** Turns on the app's high-contrast mode for stronger borders and
  focus rings, so you always know where focus is.
- **Calm structure.** Surfaces are slate-tinted grays a few percent apart: panels, cards
  and menus separate clearly without competing with the conversation.

## Palette

| Role | Seed | Light page / text | Dark page / text |
| --- | --- | --- | --- |
| Accent | `#2563c9` | | |
| Danger | `#d2462b` | | |
| Success | `#12876f` | | |
| Warning | `#b7791f` | | |
| Pro | `#7a4fc4` | | |
| Surfaces | | `#f0f3f7` / `#141a23` | `#12161b` / `#eef2f7` |

The app derives each role's full scale from these seeds, tuning lightness per mode.
Diff and git colors are left as the app's own.

Applies to the desktop and mobile apps; terminals and editors keep their own colors.

## License

MIT
