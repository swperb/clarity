# Workbench

Quiet productivity for Claude Code. Workbench stays out of the way until something
needs you, then says so plainly. It pairs with the [Clarity](../../themes/clarity) theme
but works with any theme.

```
/plugin install workbench --marketplace swperb/claude-code-themes
```

## What you get

**Attention band** (above the prompt). It shows up only when it has something to say:
- `✗ Tests failing · cargo test` in red the moment a test run fails, `✓ Tests passing` once it's fixed.
  Detects npm/pnpm/yarn/bun, jest, vitest, pytest, cargo, go, make, gradle, maven, dotnet, swift, rspec, mix, deno and more.
- `● 7 uncommitted  ↑ 2 unpushed on main`, refreshed after every turn, with a **commit…** shortcut.
- `◔ Context 82% full` once the context window passes 60%, with a **compact…** shortcut from 75%.

**Risky-command guard.** Before Claude runs a command that's hard to undo, you get a
permission prompt that says what it does. This happens even in auto mode:
force-pushes, `git reset --hard`, `git clean -f`, discarding all edits, deleting unmerged
branches, sweeping `rm -rf` (root, home, `.`, `*`), dropping database tables,
`curl … | sh`, publishing packages, `terraform destroy`, `kubectl delete`, deleting a
GitHub repo and more. Everyday commands like `rm -rf node_modules` or
`git push --force-with-lease` pass through untouched.

**Changed-files pane.** Every file Claude edits this session, newest first, with exact
`+added −removed` line counts in the standard diff colors and a `new` tag for created files.
Click a file to mention it in your next message; **Review all** drafts a review request
for every changed file. Opens itself on the first edit; reopen with `/changes`.

**Status line.** `⏱ 23m · $1.42 · 41% context`: session time, cost and context use at a glance.

## Settings

```
/workbench                 # list features and whether each is on
/workbench guard off       # switch one off (remembered across sessions)
/workbench guard on
```

Features: `band`, `guard`, `changes`, `status`.

## Notes

- The band, pane and status line draw in the desktop app and in the terminal.
- The guard adds a prompt; it never removes one. If your settings already deny a command, it stays denied.
- Changed files are the ones Claude edits with its file tools. Changes made by shell commands aren't tracked.

## License

MIT
