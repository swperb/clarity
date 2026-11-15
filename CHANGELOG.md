# Changelog

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

First public release of Clarity for Claude Code.

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
