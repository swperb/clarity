# Changelog

## Unreleased

- **Factory: updates reach open sessions without quitting Claude Desktop.** After
  `npx github:swperb/clarity update`, every open session notices the new version within
  a minute and shows a quiet row above the prompt, `↻ Clarity X is installed`. Press
  **Reload** and then Enter to run `/reload-plugins` in that session. A toast confirms
  the switch, and **later** hides the row until the next update. Switch it off with
  `/factory updates off`. Claude Desktop only runs `/reload-plugins` when you send it, so
  a session can't reload itself.

## 1.1.0 (2026-11-15)

- **Factory: Home, a briefing for when you come back.** `/home` opens a pane that
  covers every session in every project: what got done (each finished task in a line,
  with files changed and commits), what still needs you (questions Claude asked, a
  permission it's waiting on, sessions waiting or failed), what held it up while you
  were gone (permission waits and how long they lasted, usage limits, errors), what's
  still running, and usage (spend while you were away and today, your plan's limit
  windows, sessions whose context is nearly full). **Got it** ends the briefing; the next
  one starts from there.
- **Hibernation.** After 20 minutes with no sign of you (no typing, prompts or presses in
  any session), Factory marks you away and every session opens Home, so it's the first
  thing you see when you're back. The wait is a Factory setting, **Open Home after
  you've been away**: 10 to 120 minutes, or **off**. `/home hibernate <minutes|off>`
  changes the same setting from the prompt. Switch the whole feature with
  `/factory home on|off`.
- Factory writes two more small local files for this: a journal per session
  (`~/.claude/factory/journal/`) and when you were last active
  (`~/.claude/factory/presence.json`). Nothing leaves your machine.
- **Clarity works with any theme.** Install another theme plugin and Clarity adapts to it:
  - Factory's project tint is laid over your theme instead of replacing it. Only the
    accent changes, refitted to your theme's grays; surfaces, text, backdrop and diff
    colors stay yours.
  - `/factory tint off` restores your theme instead of clearing every theme.
  - The Clarity theme steps aside when another theme plugin sets a look.
  - Workbench and Studio already draw with the app's meaning-based colors, so they
    follow any theme unchanged.
- **New theme: Neon Noir.** Hazard yellow, electric cyan and neon red on blue-steel
  black, with a quiet megacity behind the chat: angular holographic billboards, falling
  data streams, slow traffic, searchlights and a red grid floor, under faint scanlines.
  No text in the scene. Dark only, 7:1 primary text, standard diff colors. It counts as
  "another theme" to the rest of Clarity, so it doubles as the live check of the above.
- **Installer:** a first run and `--all` check every plugin and the Clarity theme, not
  every theme; pick Neon Noir in the picker or with `--only`.
- **Needs Claude Desktop's engine 2.1.321 or later** for Factory and both themes, which
  now use the app's theme events. They say so in `engines`, so an older app keeps the
  version that works there instead of loading a Factory that can't start.

## 1.0.3 (2026-11-15)

- **Factory no longer shows the app's internal text.** A session's task line could show
  wrapper blocks the app adds to a conversation (reminders, messages relayed from other
  sessions, with their internal ids). It now shows only what you typed; a relayed
  message reads "Message from another session".
- **Factory's "needs you" stays meaningful.** A session that finished its turn counts as
  needing you for 30 minutes, then settles into idle; failed sessions always count.
- Clarity is presented as made for **Claude Desktop**, with the in-app install route.
- A new launch video and screenshots, filmed live with 1.0.2's working guard.

## 1.0.2 (2026-11-15)

- **Workbench's risky-command guard now actually stops risky commands.** In 1.0.0 and
  1.0.1 it hooked a permission step that real sessions never route to plugins, so it
  never fired outside the tests. It now asks you directly, before the command runs
  ("Workbench: this command force-pushes… Run it?", with **Don't run it** / **Run it
  anyway**). A saved "always allow" or a permissive mode can't wave a risky command
  through, and with nobody to ask (a headless run) the command is refused. Verified live.
- The guard ignores the text of here-documents (file contents, script input), so
  writing a README that mentions `git reset --hard` doesn't ask; it now also catches
  sweeping deletes inside quoted strings like `bash -c "rm -rf ~"`.

## 1.0.1 (2026-11-14)

- **Installer works on Windows.** `claude` is a `.cmd` shim there, which Node only starts
  through the shell, so 1.0.0 failed on its first command. CI now runs on Linux, macOS
  and Windows (Node 18, 20, 22), starting a real `claude.cmd` from a path with a space.
- **Workbench:** the per-file `+added −removed` counts in the Changed files pane show in
  the standard diff green and red (they were drawn in the row's button color).
- **Launch video** has an original score.

## 1.0.0 (2026-11-14)

First public release of Clarity for Claude Desktop.

**Install everything:** `npx github:swperb/clarity` opens a picker with every theme and
plugin checked. `config` changes your picks later, `update` brings everything up to date,
and `uninstall` removes it all. Installs made under the earlier `claude-code-themes` name
move over automatically.

### Clarity theme
- 7:1 text contrast on every surface, colorblind-safe status colors, stronger focus rings.
- Leaves diff colors as the app's standard green and red.

### Workbench
- Attention band: failing or recovered tests (read from the runner's own summary, so a
  failure inside `npm test; echo done` still shows), uncommitted and unpushed work, and
  a filling context window, with commit and compact shortcuts.
- Risky-command guard: asks before force-pushes, hard resets, sweeping deletes, dropped
  tables, `curl | sh`, package publishes, infrastructure teardown and more.
- Changed-files pane with exact line counts; click a file to mention it.
- Usage chip that opens a plain-language explanation of time, cost, context and limits.
- Tracks file and test tools from other MCP servers, not only the built-ins.

### Factory
- A floor pane of every session across your projects, grouped by project.
- A needs-you queue with one batched notification.
- A per-project color tint, so you always know which project a window belongs to.
- A radar that warns when two sessions edit the same file.

### Studio
- A soft IDE beside the chat: file tree, live viewer and activity strip that follow what
  Claude reads, edits, searches and runs, including through MCP tools.
