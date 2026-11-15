# Factory

One control room for many Claude Desktop sessions. Run five sessions across three
projects and Factory shows you, from any one of them, which are working, which are
waiting on you, what each costs, and when two of them are about to edit the same file.
It stays quiet until something needs you, and when you come back from lunch or a meeting,
**Home** tells you what happened while you were gone.

Install with the rest of Clarity (`npx github:swperb/clarity`), or on its own in
Claude Desktop: click **+** next to the prompt box → **Plugins** → **Add marketplace**
`swperb/clarity` → add **factory**.

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
color marks the project on the floor. Added and removed lines keep the app's standard
green and red.

The tint works with whatever theme you use. With a theme plugin installed (Clarity's or
anyone else's), Factory lays the project's accent over that theme and keeps its surfaces,
text, status colors, backdrop and diff colors. The accent is refitted to the theme's own
grays so it stays readable. If the theme can't take the accent without losing contrast,
your theme shows as it is. With no theme plugin, the tint washes the app's grays lightly
in the project's hue as well.

**Collision radar.** Factory remembers which files each session edits. When another
live session in the same repository (worktrees included) has edited a file this session
just edited, you get a toast and a quiet row above the prompt:
`⚠ src/auth.ts also edited by another session on feature/login`, with a **dismiss** button.

**Home** (`/home`). Your briefing across every session and project, for when you've been
away:

- **Needs you:** questions Claude asked you (by the question dialog, or an answer that
  ends on a question), a permission prompt it's waiting on, and sessions that finished
  or failed. Questions first, longest wait first.
- **What got done:** each finished task in one line, grouped by project, with the files it
  changed, how long it ran and the commits and pushes it made.
- **What held it up:** permission prompts it sat on (and for how long), usage limits it
  hit, errors that stopped it.
- **Still working:** what's running now, and for how long.
- **Usage:** what was spent while you were away and today, your plan's 5-hour and 7-day
  windows with when they reset, and sessions whose context is nearly full.

Press **Got it** when you've read it; the next briefing starts from there. **Show all of
today** widens the view. Minimized in the desktop app, Home is one line:
`Away 1h 12m · 6 done · 2 need you · 1 working`.

**Hibernation.** After 20 minutes with no sign of you in any session (no typing, prompts
or presses), Factory marks you away and every open session brings up Home, so it's
waiting when you return. The first thing you do anywhere marks you back.

The wait is a setting: **Open Home after you've been away**, in Factory's plugin settings
in Claude Desktop. Pick 10, 15, 20 (the default), 30, 45, 60, 90 or 120 minutes, or
**off** so Home only opens when you ask for it. Every session follows the same setting.

**Updates.** After you update Clarity (`npx github:swperb/clarity update`), every open
session notices within a minute and shows a quiet row above the prompt:
`↻ Clarity 1.1.0 is installed`, with **Reload** and **later**. **Reload** puts
`/reload-plugins` in the prompt box; press Enter and that session switches to the new
version, with no need to quit Claude Desktop. A toast confirms it. Claude Desktop only
runs `/reload-plugins` when you send it, so Factory can't reload a session by itself.

## Settings

```
/factory                   # open the factory floor
/home                      # open Home: since you left (or since your last briefing)
/home today                # Home, for all of today
/home hibernate            # show the hibernation setting
/home hibernate 30         # the same setting, from the prompt: open Home after 30 quiet minutes
/home hibernate off        # never open Home by itself
/factory settings          # list features and whether each is on
/factory tint off          # switch one off (remembered across sessions)
/factory tint on
```

Features: `ledger`, `notify`, `tint`, `radar`, `home`, `updates`. If another plugin already has
`/home`, use `/factory home`. Switching `ledger` off takes this
session off every floor at once; the pane still shows the others.

## How it works

Each session writes a small JSON file to `~/.claude/factory/sessions/<session-id>.json`
(under `$CLAUDE_CONFIG_DIR` if you set one) when you send a prompt, when a turn starts
and ends, when its cost or context changes, and every 30 seconds as a heartbeat. A
session that hasn't written for 10 minutes is treated as gone; a session that ends marks
its file ended. Files from sessions that ended over a day ago, or went silent a week
ago, are deleted the next time a session starts. Nothing leaves your machine.

For Home, each session also keeps a journal, `~/.claude/factory/journal/<session-id>.json`:
one line per finished turn (the first sentence of Claude's answer, the files it edited,
what it cost), the questions it asked, the permission prompts it waited on, errors, and
the commit messages and pushes it ran. A journal keeps a week and 300 lines at most. One
shared file, `~/.claude/factory/presence.json`, holds when you were last active and when
you were last away. Neither holds what you typed.

For updates, Factory reads `~/.claude/plugins/installed_plugins.json` when a session
starts, after each turn and with every heartbeat, and compares the `@clarity` entries'
versions and commits with the ones the session loaded.

## Notes

- Only sessions running Factory appear on the floor.
- The floor's cost and context figures are a one-line summary per session. For what they mean and what is filling a session's context, open that session's **Session usage** pane from [Workbench](../workbench) (`/usage-info`).
- "Waiting on you" means the turn ended. A session paused on a permission prompt still shows as working.
- `/factory tint off` puts your theme back exactly as it was. With no theme plugin, it returns the app's own look.
- Edits are the ones Claude makes with its file tools. Changes made by shell commands aren't tracked.
- Home counts you as present when you type, send a prompt or press something in a
  Factory pane. Reading without touching anything for 20 minutes counts as away; raise the
  wait in Factory's settings (or `/home hibernate <minutes>`) if that's too soon for you.
- A session that has ended drops off Home's "Needs you": nobody can answer it any more.
- Cost "today" adds up every session that was alive at some point today, including ones that started yesterday.

## License

MIT
