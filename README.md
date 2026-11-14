# Claude Code Themes

Themes for the Claude Code desktop and mobile apps, built for getting work done:
legible text, status colors you can't misread, and surfaces that stay calm over a
long session. Every theme here is a small Claude Code plugin, installable in one line.

| Theme | What it's for |
| --- | --- |
| [**Clarity**](themes/clarity) | High legibility, colorblind-safe status colors, standard diff colors, strong keyboard focus rings. Light and dark. |

## Companion plugins

| Plugin | What it's for |
| --- | --- |
| [**Workbench**](plugins/workbench) | An attention band for failing tests, uncommitted work and a filling context window; a guard that asks before hard-to-undo commands; a changed-files pane; a time/cost status line. |
| [**Factory**](plugins/factory) | One control room for many sessions across many projects: a factory-floor pane, a needs-you queue with one batched notification, a per-project color tint, and a radar for two sessions editing the same file. |

Install them the same way: `/plugin install workbench --marketplace swperb/claude-code-themes`.

## Install a theme

At the prompt of a Claude Code terminal session:

```
/plugin install clarity --marketplace swperb/claude-code-themes
```

Answer `y` to add the marketplace, then pick a scope (user scope applies it everywhere).

From a shell:

```bash
claude plugin install clarity --marketplace swperb/claude-code-themes
```

In the desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace**
with `swperb/claude-code-themes` → **Add plugin**.

The theme applies to new sessions in the desktop and mobile apps. Terminals and
editors keep their own colors. To go back to the default look, uninstall or disable the plugin.

## What every theme here must do

Looking good is the easy part. A theme in this repo also has to:

1. **Keep words readable.** Primary text at 7:1 contrast or better on every surface;
   muted text at 4.5:1 or better.
2. **Keep meaning.** Danger reads as red, success as green, warning as amber, and they
   stay distinguishable for people with color-vision deficiency (differ in lightness,
   not just hue).
3. **Leave diffs alone.** Added/removed lines keep the app's standard green and red:
   everyone reads them instantly, so a theme doesn't override `git` colors.
4. **Work in both light and dark**, unless the idea only makes sense in one.
5. **Not trip the app's own checks.** `makeColors` reports contrast problems; no line
   may start with `Desktop won't paint`, or the app ignores the theme.

## Add a theme

1. Copy `themes/clarity` to `themes/<your-theme>` and rename it in its `.claude-plugin/plugin.json`.
2. Edit the colors in `hooks/palette.js`. Leave `make-colors.js` as it is.
3. Check contrast: `node -e "import('./themes/<your-theme>/hooks/palette.js').then(m => console.log(m.clarity().problems.join('\n')))"`
4. Validate: `claude plugin validate themes/<your-theme>`
5. Add an entry to `.claude-plugin/marketplace.json` and a row to the table above.

## License

MIT
