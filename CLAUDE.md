# Clarity

Clarity is a suite for **Claude Desktop**: a theme (`themes/clarity-theme`) and three
plugins (`plugins/workbench`, `plugins/factory`, `plugins/studio`), published as the
`clarity` plugin marketplace at `swperb/clarity`, with a zero-dependency installer
(`installer/`, run as `npx github:swperb/clarity`).

## Rules

- **Say "Claude Desktop", never "Claude Code"**, in anything a user reads: READMEs,
  manifests, the marketplace, installer messages, in-app text. Clarity is for the desktop
  app only; don't document terminal install routes. The in-app route is
  **+ → Plugins → Add marketplace `swperb/clarity`**. (`from 'claude-code'` imports are
  the plugin API's package name and stay.)
- **Platforms:** macOS and Windows. Linux is on the README roadmap.
- **Never override git/diff colors** in a theme or plugin. Added/removed lines keep the
  app's standard green and red (theme keys `diffAdded` / `diffRemoved`).
- **Every plugin shares one version.** Bump all four `plugin.json` files and
  `package.json` together; `installer/marketplace.test.mjs` fails otherwise.
- **Nothing personal in published media.** Screenshots and video come from the throwaway
  demo project only. Never publish frames showing the sidebar, the account name, typed
  drafts, the slash-command menu (it lists the user's own commands), or Factory's floor
  with other sessions on it.

## Commands

```bash
npm test                                   # installer + marketplace checks (Node 18+)
claude plugin test plugins/workbench       # likewise factory, studio
claude plugin validate --profile directory plugins/workbench   # and each theme/plugin
claude plugin validate .                   # the marketplace
node installer/cli.mjs --list              # what the installer sees; --dry-run to preview
```

CI (`.github/workflows/test.yml`) runs `npm test` on Linux, macOS and Windows, Node 18/20/22.

## Releasing

1. Bump every `plugin.json` and `package.json` to the new version; add a `CHANGELOG.md` entry.
2. Run all the commands above; push to `main`; wait for CI to pass.
3. Tag each plugin and the suite, then publish the release:
   ```bash
   for p in themes/clarity-theme plugins/workbench plugins/factory plugins/studio; do claude plugin tag --push -m "%s: Clarity X.Y.Z" $p; done
   git tag -a vX.Y.Z -m "Clarity X.Y.Z" && git push origin vX.Y.Z
   gh release create vX.Y.Z --title "Clarity X.Y.Z" --notes-file <notes> --verify-tag --latest
   ```
4. Update an installed copy with `npx github:swperb/clarity#vX.Y.Z update --yes`.

## Plugin API lessons (each one shipped a bug once)

- **Gate risky tool calls on `tool.call`, asking with `$.ui.ask`.** A `tool.check` hook
  is never consulted for the model's real tool calls in Desktop sessions, so a guard
  there passes every test and does nothing live. Test guards through `$.tool.call`
  (answer `AskUserQuestion` in the stub), not `$.tool.check`.
- **Register each command separately with `.catch`.** A refused name (a built-in such as
  `/usage`, or another plugin's) throws out of `session.start` and skips the rest of it.
- **A `Button`'s text takes the button's color.** Put colored parts (diff counts) in a
  `Text` beside the button, not inside it.
- **No `Progress` element on this build**: draw bars with block characters.
- **Judge test runs by the runner's summary** (`# fail 1`, `2 failed`), not the shell's
  exit code: `npm test; echo done` exits 0.
- **Strip injected blocks** (`<system-reminder>`, `<cross-session-message …>`, …) before
  showing any prompt text; they carry internal session ids.
- **MCP tools count too**: file and test work may arrive through other servers'
  tools (`path` + `old_string`/`new_string` or `content`, `run_checks`); see
  `classifyMcpTool` in `plugins/workbench/hooks/lib.ts`.
- Unit tests that pass are not proof: check new behavior live in a Desktop session
  before releasing.
