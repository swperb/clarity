# Factory

One control room for many Claude Code sessions. Run five sessions across three
projects and Factory shows you, from any one of them, which are working, which are
waiting on you, what each costs, and when two of them are about to edit the same file.
It stays quiet until something needs you.

```
/plugin install factory --marketplace swperb/clarity
```

Install it at the user scope so every session joins the floor.

## What you get

**The factory floor** (`/factory`). A pane with one card per live session, grouped by
project: its state (`● working` in green, `● waiting on you` in amber, `● failed` in red,
`● idle` dimmed), branch, the first line of its latest prompt, how long it has been in
that state, its cost and how full its context is. Minimize it in the desktop app and it
becomes a one-line widget: `5 working · 2 need you · $14.20 today`.

**Needs you.** Sessions whose turn ended and are waiting on you, or that failed, sit at
the top of the floor, longest wait first. When that list grows you get **one** native
notification for the whole factory (`2 sessions need you · atlas: review the diff …`),
never one per session: only one session, the "foreman", sends it.

**Project tint.** Each project gets its own accent color, worked out from its folder
name, so you can tell at a glance which window belongs to which project. The same
color marks the project on the floor. The tint touches the accent and washes the
grays very lightly; added and removed lines keep the app's standard green and red.
Desktop and mobile apps only; terminals keep their own colors.

**Collision radar.** Factory remembers which files each session edits. When another
live session in the same repository (worktrees included) has edited a file this session
just edited, you get a toast and a quiet row above the prompt:
`⚠ src/auth.ts also edited by another session on feature/login`, with a **dismiss** button.

## Settings

```
/factory                   # open the factory floor
/factory settings          # list features and whether each is on
/factory tint off          # switch one off (remembered across sessions)
/factory tint on
```

Features: `ledger`, `notify`, `tint`, `radar`. Switching `ledger` off takes this
session off every floor at once; the pane still shows the others.

## How it works

Each session writes a small JSON file to `~/.claude/factory/sessions/<session-id>.json`
(under `$CLAUDE_CONFIG_DIR` if you set one) when you send a prompt, when a turn starts
and ends, when its cost or context changes, and every 30 seconds as a heartbeat. A
session that hasn't written for 10 minutes is treated as gone; a session that ends marks
its file ended. Files from sessions that ended over a day ago, or went silent a week
ago, are deleted the next time a session starts. Nothing leaves your machine.

## Notes

- Only sessions running Factory appear on the floor.
- The floor's cost and context figures are a one-line summary per session. For what they mean and what is filling a session's context, open that session's **Session usage** pane from [Workbench](../workbench) (`/usage-info`).
- "Waiting on you" means the turn ended. A session paused on a permission prompt still shows as working.
- The tint replaces any other color theme (Clarity included) for as long as it's on. Run `/factory tint off` to keep your theme.
- Edits are the ones Claude makes with its file tools. Changes made by shell commands aren't tracked.
- Cost "today" adds up every session that was alive at some point today, including ones that started yesterday.

## License

MIT
