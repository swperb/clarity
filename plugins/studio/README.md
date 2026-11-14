# Studio

A soft IDE beside the chat. Studio shows the session's folder as a file tree and
follows what Claude is doing, live: the file it's reading, the change it just made,
the search it ran, the command and whether it passed. It never edits anything
itself, and it stays quiet: no toasts, no sounds, the app's own diff colors.

```
/plugin install studio --marketplace swperb/claude-code-themes
```

## What you get

**Session header.** The folder name, its git branch, the model, and one live line:
`● Claude is reading src/cart.js`, `● Claude is running npm test`, or `○ Idle`.

**File tree** of the session folder. Folders open on click and load as you open
them; `.git`, `node_modules`, `dist`, `build`, `.next`, `target` and `__pycache__`
stay hidden. Each file says what Claude did to it this session:
- the file Claude is touching right now in the accent color,
- `+5 −2` on files it edited, in the standard diff colors,
- a dim `·` on files it only read.

A closed folder with edits inside shows a dim `•`.

**Live viewer**, with **Follow** on by default:
- a **Read** shows the file at the range Claude read, line numbers included;
- an **Edit**, **Write** or **NotebookEdit** shows the change as a diff (a new file shows its content);
- a **Grep** or **Glob** shows the query and the matched files, each a row you can open;
- a **Bash** call shows the command, `✓ exit 0` or `✗ exit 1`, and the end of its output.

Click a file in the tree and the viewer pins to it, pausing Follow; press **Follow**
to pick back up at Claude's latest touch. **@ Mention** puts `@path ` into your prompt.

**Activity strip.** The last eight touches, newest first: `Read src/cart.js L10–40`,
`Edited test/cart.test.js +5 −0`, `Ran npm test ✗`. Click one to see it again.

**Layout.** Two columns (tree | viewer) when the pane is 100 columns wide or more,
otherwise stacked with **Files** and **Viewer** tabs. Minimized to a widget in the
desktop app it's one glance line: `Editing src/cart.js +5 −0`.

## Opening it

`/studio` opens it anywhere. In the desktop app, and in a fullscreen terminal where
panes dock beside the chat, Studio also opens itself the first time Claude touches a
file. It never opens itself on a terminal's main screen, where a pane would cover the
chat. Close it and it stays closed until you run `/studio` again.

```
/studio              # open the pane
/studio auto off     # never open by itself (remembered across sessions)
/studio auto on
```

## Notes

- Studio reads files only to show them, through Claude Code's own file API, and only when you click.
- Edit counts come from Claude's file tools. Changes made by shell commands aren't counted, though the tree refreshes after every turn so new files show.
- Large files show their first 1,500 lines; binary files and files over 2 MB aren't shown.
- Pairs well with [Workbench](../workbench) and the [Clarity](../../themes/clarity) theme; works with any theme.

## License

MIT
