# Workbench

Quiet productivity for Claude Desktop. Workbench stays out of the way until something
needs you, then says so plainly. It pairs with the [Clarity](../../themes/clarity) theme
but works with any theme.

Install with the rest of Clarity (`npx github:swperb/clarity`), or on its own in
Claude Desktop: click **+** next to the prompt box → **Plugins** → **Add marketplace**
`swperb/clarity` → add **workbench**.

## What you get

**Attention band** (above the prompt). It shows up only when it has something to say:
- `✗ Tests failing · cargo test` in red the moment a test run fails, `✓ Tests passing` once it's fixed.
  Detects npm/pnpm/yarn/bun, jest, vitest, pytest, cargo, go, make, gradle, maven, dotnet, swift, rspec, mix, deno and more.
  It reads the runner's own summary (`# fail 1`, `2 failed`, `test result: FAILED`), so a failing run inside
  a longer command like `npm test; echo done` still shows as failing.
- `● 7 uncommitted  ↑ 2 unpushed on main`, refreshed after every turn, with a **commit…** shortcut.
- `◔ Context 82% full` once the context window passes 60%, with a **compact…** shortcut from 75%.

**Risky-command guard.** Before Claude runs a command that's hard to undo, Workbench asks
you directly what to do (**Don't run it** or **Run it anyway**) and says why it's risky.
It asks before any permission rule is consulted, so a saved "always allow" or a
permissive mode (auto, bypass) can't wave it through; with nobody to ask, the command is
refused. It covers force-pushes, hard resets, `git clean -f`, discarding all edits,
deleting unmerged branches, sweeping `rm -rf` (root, home, `.`, `*`, also inside
`bash -c "…"`), dropping database tables, `curl … | sh`, publishing packages,
`terraform destroy`, `kubectl delete`, deleting a GitHub repo and more. Everyday commands
like `rm -rf node_modules` or `git push --force-with-lease` pass through untouched, and
text inside here-documents (a file being written) is treated as data.

**Changed-files pane.** Every file Claude edits this session, newest first, with exact
`+added −removed` line counts in the standard diff colors and a `new` tag for created files.
Click a file to mention it in your next message; **Review all** drafts a review request
for every changed file. Opens itself on the first edit; reopen with `/changes`.

**Usage chip, explained.** `⏱ 23m · $1.42 · 41% context ⓘ` sits at the right of the band.
Click it (or run `/usage-info`) for the **Session usage** pane, which says what each figure means
in plain words:
- **Time:** how long the session has been open.
- **Cost:** the session's total at API prices (what `/cost` shows) and the hourly rate.
  On a subscription it's a measure of your usage, not a separate bill.
- **Context:** how full Claude's working memory is, what's filling it (conversation,
  files read, tools, memory files), what happens when it fills (compaction), and
  **Compact…** / **Full breakdown** buttons.
- **Plan limits:** your 5-hour and 7-day usage windows and when each resets.

## Settings

```
/workbench                 # list features and whether each is on
/workbench guard off       # switch one off (remembered across sessions)
/workbench guard on
```

Features: `band`, `guard`, `changes`, `usage`, and `status` (a plain status-line copy of the
usage figures, off by default because a status line can't be clicked).

## Notes

- Made for Claude Desktop.
- The guard adds a question; it never removes one. If your settings already deny a command, it stays denied.
- Changed files and test runs are tracked from Claude's built-in tools **and** from other MCP servers' file and
  test tools (any tool taking a `path` with `old_string`/`new_string` or `content`, or a `run_checks`-style test tool).
  Changes made by arbitrary shell commands aren't tracked.

## License

MIT
