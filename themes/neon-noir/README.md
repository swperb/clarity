# Neon Noir

A night-city theme for Claude Desktop: a rain-slick street after midnight, lit by signs.

Install with the rest of Clarity (`npx github:swperb/clarity`), or on its own in
Claude Desktop: click **+** next to the prompt box → **Plugins** → **Add marketplace**
`swperb/clarity` → add **neon-noir**.

## What it looks like

- **Night surfaces.** The page is a blue-black tinted toward violet, with cards, panels
  and menus a few percent apart, like wet asphalt under different signs. Never pure black.
- **Neon where it means something.** Electric cyan for focus, links and keywords; hot
  magenta for highlights and code literals. Danger stays a neon red, success a neon
  green and warning a signal amber.
- **A skyline in the rain.** Behind the chat, a distant city runs along the top of the
  window: lit windows, a few signs that hum and flicker now and then, and fine rain
  that fades out before the middle of the screen. The app frosts its panels over it, so
  the words never sit on the scene. With reduced motion turned on, it holds still.
- **A day mode too.** The same street in morning haze: pale violet-gray surfaces with
  the signs switched down.

## Readability

- Primary text is 7:1+ contrast on every surface in both modes; muted text clears 4.5:1.
- Diffs keep the app's standard green and red: Neon Noir never sets git colors.
- The scene stays in the top third, away from the conversation and the message box.

## Palette

| Role | Seed |
| --- | --- |
| Accent (electric cyan) | `#14d4f4` |
| Pro (hot magenta) | `#ff2bb4` |
| Danger (neon red) | `#ff3355` |
| Success (neon green) | `#2ee88f` |
| Warning (signal amber) | `#ffb81c` |
| Surfaces, dark | `#0a0913` → `#17152a`, text `#eceeff` |
| Surfaces, light | `#eeecf5` → `#fafafd`, text `#130f26` |

The app derives each role's full scale from these seeds, tuning lightness per mode.

## With the rest of Clarity

Neon Noir counts as "another theme" to Clarity's plugins: the Clarity theme steps aside
for it, and Factory's project tint changes only its accent, keeping its surfaces and
skyline. `/factory tint off` brings Neon Noir back exactly.

Made for Claude Desktop.

## License

MIT
