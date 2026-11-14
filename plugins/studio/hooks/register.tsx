import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, ToolCallResult } from 'claude-code'

import type { Active, Entry, FileMark, SessionInfo, Tab, Touch, View } from '../types'
import {
  absoluteIn,
  basename,
  bashOutput,
  bashStatus,
  branchOf,
  clip,
  countPatch,
  flattenTree,
  hasMarkedChild,
  languageOf,
  looksBinary,
  modelName,
  patchToDiff,
  relativeTo,
  searchFiles,
  shortCommand,
  tail,
  tidyListing,
} from './lib'
import type { Hunk, TreeRow } from './lib'

// ── State ───────────────────────────────────────────────────────────────────
// Held by the host for the session, so a hot reload keeps it. Bump a `shape`
// tag when its type changes: values stored under an old tag read as initial.

const info = atom({ plugin: 'studio', key: 'info' } as const, null, { shape: 'info-1' })
const active = atom({ plugin: 'studio', key: 'active' } as const, [], { shape: 'active-1' })
const touches = atom({ plugin: 'studio', key: 'touches' } as const, [], { shape: 'touches-1' })
const marks = atom({ plugin: 'studio', key: 'marks' } as const, {}, { shape: 'marks-1' })
const listings = atom({ plugin: 'studio', key: 'listings' } as const, {}, { shape: 'listings-1' })
const expanded = atom({ plugin: 'studio', key: 'expanded' } as const, [], { shape: 'expanded-1' })
const view = atom({ plugin: 'studio', key: 'view' } as const, null, { shape: 'view-1' })
const isFollowing = atom({ plugin: 'studio', key: 'isFollowing' } as const, true)
const tab = atom({ plugin: 'studio', key: 'tab' } as const, 'files' as Tab)
const canDock = atom({ plugin: 'studio', key: 'canDock' } as const, false)
const isOpened = atom({ plugin: 'studio', key: 'isOpened' } as const, false)
const isAutoOpen = atom({ plugin: 'studio', key: 'isAutoOpen' } as const, true)

const PANE = 'studio'
const TITLE = 'Studio'
const AUTO_KEY = 'autoOpen'
const KEEP_TOUCHES = 12
const SHOW_TOUCHES = 8
const WIDE = 100

const KIND: Record<string, Touch['kind']> = {
  Read: 'read',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Grep: 'search',
  Glob: 'search',
  Bash: 'run',
}

type Input = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// ── Effects ─────────────────────────────────────────────────────────────────

async function cwdOf($: Engine): Promise<string> {
  return (await read($, info))?.cwd ?? (await $.session.cwd())
}

async function refreshInfo($: Engine): Promise<void> {
  const cwd = await $.session.cwd()
  let branch: string | null = null
  try {
    const run = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 5000 })
    branch = run.exitCode === 0 ? branchOf(run.stdout) : null
  } catch {
    branch = null
  }
  let model: string | null = null
  try {
    model = await $.session.model()
  } catch {
    model = null
  }
  const next: SessionInfo = { cwd, folder: basename(cwd), branch, model }
  await update($, info, () => next)
}

/** Lists one folder (relative to the session folder; `.` is the root) into state. */
async function loadDir($: Engine, dir: string): Promise<void> {
  const cwd = await cwdOf($)
  let entries: Entry[]
  try {
    entries = tidyListing(await $.fs.list(absoluteIn(cwd, dir)))
  } catch {
    entries = []
  }
  await update($, listings, all => ({ ...all, [dir]: entries }))
}

/** Lists again every folder already listed, so new and deleted files show. */
async function refreshListings($: Engine): Promise<void> {
  const loaded = Object.keys(await read($, listings))
  const dirs = loaded.length === 0 ? ['.'] : loaded
  for (const dir of dirs) {
    await loadDir($, dir)
  }
}

async function openPane($: Engine): Promise<boolean> {
  if ((await read($, listings))['.'] === undefined) {
    await loadDir($, '.')
  }
  await update($, isOpened, () => true)
  const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })
  return isPlaced
}

/** Opens the pane unasked, once, and only where the surface docks it beside the chat. */
async function maybeAutoOpen($: Engine): Promise<void> {
  if ((await read($, isOpened)) || !(await read($, isAutoOpen)) || !(await read($, canDock))) {
    return
  }
  await openPane($)
}

/** Pins the viewer to a file from the tree or a search hit, pausing Follow. */
async function pinFile($: Engine, path: string): Promise<void> {
  const cwd = await cwdOf($)
  const shown: View = await fileView($, cwd, path)
  await update($, view, () => shown)
  await update($, isFollowing, () => false)
  await update($, tab, () => 'viewer')
}

async function fileView($: Engine, cwd: string, path: string): Promise<View> {
  const abs = absoluteIn(cwd, path)
  try {
    const stat = await $.fs.stat(abs)
    if (stat.kind !== 'file') {
      return { kind: 'note', path, text: 'Not a file.' }
    }
    if (stat.size > 2_000_000) {
      return { kind: 'note', path, text: `Too large to show here (${Math.round(stat.size / 1e6)} MB).` }
    }
    const text = await $.fs.read(abs)
    if (looksBinary(text)) {
      return { kind: 'note', path, text: 'A binary file.' }
    }
    const cut = clip(text)
    return { kind: 'file', path, source: cut.text, startLine: 1, ...(cut.note === undefined ? {} : { note: cut.note }) }
  } catch {
    return { kind: 'note', path, text: 'Could not read this file.' }
  }
}

async function follow($: Engine): Promise<void> {
  const latest = (await read($, touches))[0]
  await update($, isFollowing, () => true)
  if (latest !== undefined) {
    await update($, view, () => latest.view)
  }
}

async function showTouch($: Engine, touch: Touch): Promise<void> {
  await update($, view, () => touch.view)
  await update($, isFollowing, () => false)
  await update($, tab, () => 'viewer')
}

async function mention($: Engine, path: string): Promise<void> {
  await $.prompt.fill({ text: `@${path} `, mode: 'insert' })
}

// ── Recording what Claude does ──────────────────────────────────────────────

function activeOf(tool: string, input: Input, cwd: string, id: string): Active {
  const file = str(input.file_path) ?? str(input.notebook_path)
  const path = file === undefined ? undefined : relativeTo(cwd, file)
  switch (KIND[tool]) {
    case 'read':
      return { id, verb: 'Reading', path, label: path ?? '' }
    case 'edit':
      return { id, verb: 'Editing', path, label: path ?? '' }
    case 'search':
      return { id, verb: 'Searching', label: `for “${str(input.pattern) ?? ''}”` }
    default:
      return { id, verb: 'Running', label: shortCommand(str(input.command) ?? '') }
  }
}

async function markFile($: Engine, path: string, change: Partial<FileMark> & { adds?: number; dels?: number }): Promise<void> {
  await update($, marks, all => {
    const old = all[path] ?? { adds: 0, dels: 0, isEdited: false, isRead: false }
    return {
      ...all,
      [path]: {
        adds: old.adds + (change.adds ?? 0),
        dels: old.dels + (change.dels ?? 0),
        isEdited: old.isEdited || change.isEdited === true,
        isRead: old.isRead || change.isRead === true,
      },
    }
  })
}

type Ran = ToolCallResult

/** What one finished call adds to the activity strip, or undefined to leave it out. */
async function touchOf($: Engine, tool: string, input: Input, ran: Ran, cwd: string, id: string): Promise<Touch | undefined> {
  if (ran.deny !== undefined) {
    return undefined
  }
  const at = await $.clock.now()
  const isError = ran.isError === true
  const file = str(input.file_path) ?? str(input.notebook_path)
  const path = file === undefined ? undefined : relativeTo(cwd, file)

  if (tool === 'Read' && path !== undefined) {
    if (isError) {
      return undefined
    }
    const r = (ran.result ?? {}) as { type?: string; file?: { content?: unknown; startLine?: unknown } }
    const offset = typeof input.offset === 'number' ? input.offset : undefined
    const limit = typeof input.limit === 'number' ? input.limit : undefined
    const first = offset ?? 1
    const range = limit !== undefined ? ` L${first}–${first + limit - 1}` : offset !== undefined ? ` from L${first}` : ''
    let shown: View
    if (r.type === 'text' && typeof r.file?.content === 'string') {
      const cut = clip(r.file.content, 800, 30000)
      const startLine = typeof r.file.startLine === 'number' ? r.file.startLine : (offset ?? 1)
      shown = { kind: 'file', path, source: cut.text, startLine, ...(cut.note === undefined ? {} : { note: cut.note }) }
    } else {
      shown = { kind: 'note', path, text: r.type === undefined ? 'Read.' : `Read as ${r.type}.` }
    }
    await markFile($, path, { isRead: true })
    return { id, kind: 'read', label: `Read ${path}${range}`, path, at, view: shown }
  }

  if ((tool === 'Edit' || tool === 'Write') && path !== undefined) {
    if (isError) {
      return undefined
    }
    const r = (ran.result ?? {}) as { type?: string; structuredPatch?: Hunk[]; content?: unknown }
    const isCreate = r.type === 'create'
    if (isCreate) {
      const content = typeof r.content === 'string' ? r.content : (str(input.content) ?? '')
      const adds = content === '' ? 0 : content.replace(/\n$/, '').split('\n').length
      await markFile($, path, { isEdited: true, adds })
      return {
        id, kind: 'edit', label: `Created ${path}`, path, adds, dels: 0, at,
        view: { kind: 'created', path, source: clip(content, 800, 30000).text, adds },
      }
    }
    const { adds, dels } = countPatch(r.structuredPatch)
    await markFile($, path, { isEdited: true, adds, dels })
    const diff = patchToDiff(r.structuredPatch)
    return {
      id, kind: 'edit', label: `Edited ${path}`, path, adds, dels, at,
      view: diff === '' ? { kind: 'note', path, text: 'No line changes.' } : { kind: 'diff', path, source: clip(diff, 1500, 40000).text, adds, dels },
    }
  }

  if (tool === 'NotebookEdit' && path !== undefined) {
    if (isError) {
      return undefined
    }
    await markFile($, path, { isEdited: true })
    const source = str(input.new_source) ?? ''
    const mode = str(input.edit_mode) ?? 'replace'
    return {
      id, kind: 'edit', label: `Edited ${path}`, path, at,
      view: mode === 'delete' ? { kind: 'note', path, text: 'Deleted a cell.' } : { kind: 'file', path, source: clip(source, 800, 30000).text, note: `Notebook cell (${mode})` },
    }
  }

  if (tool === 'Grep' || tool === 'Glob') {
    const query = str(input.pattern) ?? ''
    const where = str(input.glob) ?? (str(input.path) === undefined ? undefined : relativeTo(cwd, str(input.path) ?? ''))
    const files = isError ? [] : searchFiles(ran.result, ran.text).map(f => relativeTo(cwd, f)).slice(0, 200)
    const verb = tool === 'Grep' ? 'Searched' : 'Listed'
    return {
      id, kind: 'search', label: `${verb} “${query}” · ${files.length} ${files.length === 1 ? 'file' : 'files'}`, at, isOk: !isError,
      view: { kind: 'search', tool, query, ...(where === undefined ? {} : { where }), files },
    }
  }

  if (tool === 'Bash') {
    const command = str(input.command) ?? ''
    const status = bashStatus(isError, ran.result, ran.text)
    const isOk = !isError
    return {
      id, kind: 'run', label: `Ran ${shortCommand(command, 48)} ${isOk ? '✓' : '✗'}`, isOk, at,
      view: { kind: 'bash', command, isOk, status, output: tail(bashOutput(ran.result, ran.text), 60) },
    }
  }
  return undefined
}

async function record($: Engine, touch: Touch): Promise<void> {
  await update($, touches, list => [touch, ...list.filter(t => t.id !== touch.id)].slice(0, KEEP_TOUCHES))
  if (await read($, isFollowing)) {
    await update($, view, () => touch.view)
  }
}

// ── Register ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get(AUTO_KEY).catch(() => undefined)
    await update($, isAutoOpen, () => saved !== false)
    if (e.surface === 'desktop') {
      await update($, canDock, () => true)
    }
    // A refused name must not skip the rest of startup.
    await $.command
      .register({
        name: 'studio',
        description: 'Open Studio, a file tree and live viewer that follows Claude: /studio [auto on|off]',
      })
      .catch(() => undefined)
    await refreshInfo($).catch(() => undefined)
    await loadDir($, '.').catch(() => undefined)
    return next(e)
  })

  // A pane opened unasked is a sidebar only where the surface docks one.
  on('session.attach', async ($, e, next) => {
    if (e.surface === 'desktop' || e.viewport?.isFullscreen === true) {
      await update($, canDock, () => true).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'studio' }, async ($, e) => {
    const [word = '', state = ''] = (e.args ?? '').trim().toLowerCase().split(/\s+/)
    if (word === 'auto' && (state === 'on' || state === 'off')) {
      await update($, isAutoOpen, () => state === 'on')
      await $.store.set(AUTO_KEY, state === 'on')
      return {
        text: state === 'on'
          ? 'Studio opens itself beside the chat when Claude first touches a file (where the app docks panes).'
          : 'Studio stays closed until you run /studio. This sticks across sessions.',
      }
    }
    await refreshInfo($).catch(() => undefined)
    const isPlaced = await openPane($)
    return { text: isPlaced ? 'Opened Studio.' : 'Studio is open; it shows where the app has room for a pane.' }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (KIND[tool] === undefined) {
      return next(e)
    }
    const input = e as unknown as Input
    const cwd = await cwdOf($).catch(() => '')
    const id = e.tool_use_id ?? `${tool}:${await $.clock.now().catch(() => 0)}`

    await update($, active, list => [...list, activeOf(tool, input, cwd, id)]).catch(() => undefined)
    let ran: Ran
    try {
      ran = await next(e)
    } finally {
      await update($, active, list => list.filter(a => a.id !== id)).catch(() => undefined)
    }

    try {
      const touch = await touchOf($, tool, input, ran, cwd, id)
      if (touch !== undefined) {
        await record($, touch)
        if (touch.kind === 'edit' && touch.label.startsWith('Created') && touch.path !== undefined) {
          const parent = touch.path.includes('/') ? touch.path.slice(0, touch.path.lastIndexOf('/')) : '.'
          if ((await read($, listings))[parent] !== undefined) {
            await loadDir($, parent)
          }
        }
        if (touch.kind !== 'run' || touch.isOk === true) {
          await maybeAutoOpen($)
        }
      }
    } catch {
      // Bookkeeping never gets in the way of the tool's own result.
    }
    return ran
  }).catch(($, e, next) => next(e)) // Studio only watches: if it fails, the call goes on as if it were not here.

  on('turn.complete', async ($, e, next) => {
    await refreshInfo($).catch(() => undefined)
    if (await read($, isOpened).catch(() => false)) {
      await refreshListings($).catch(() => undefined)
    }
    return next(e)
  })

  // ── Drawing ───────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const [session, running, recent, marked, lists, open, shown, following, current] = await Promise.all([
      read($, info),
      read($, active),
      read($, touches),
      read($, marks),
      read($, listings),
      read($, expanded),
      read($, view),
      read($, isFollowing),
      read($, tab),
    ])
    const now = running[running.length - 1]

    // ── Widget: one glance line ─────────────────────────────────────────────
    if (e.props.placement === 'widget') {
      if (now !== undefined) {
        const m = now.path === undefined ? undefined : marked[now.path]
        return (
          <Text wrap="truncate-end">
            <Text color="suggestion">{now.verb}</Text> {now.label}
            {m !== undefined && m.isEdited ? (
              <Text> <Text color="diffAdded">+{m.adds}</Text> <Text color="diffRemoved">−{m.dels}</Text></Text>
            ) : ''}
          </Text>
        )
      }
      const last = recent[0]
      return (
        <Text wrap="truncate-end" dimColor={last === undefined}>
          {last === undefined ? `Studio · ${session?.folder ?? ''}` : last.label}
          {last?.adds !== undefined ? (
            <Text> <Text color="diffAdded">+{last.adds}</Text> <Text color="diffRemoved">−{last.dels ?? 0}</Text></Text>
          ) : ''}
        </Text>
      )
    }

    const cols = e.props.bodyColumns
    const isWide = cols >= WIDE
    const touching = new Set(running.map(a => a.path).filter((p): p is string => p !== undefined))

    // ── Header ──────────────────────────────────────────────────────────────
    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          <Text weight="semibold">{session?.folder ?? 'Studio'}</Text>
          {session?.branch ? <Text dimColor>⎇ {session.branch}</Text> : ''}
          {session?.model ? <Text dimColor>{modelName(session.model)}</Text> : ''}
        </Box>
        {now !== undefined ? (
          <Text wrap="truncate-end">
            <Text color="suggestion">● Claude is {now.verb.toLowerCase()}</Text> {now.label}
            {running.length > 1 ? <Text dimColor> +{running.length - 1} more</Text> : ''}
          </Text>
        ) : (
          <Text dimColor>○ Idle</Text>
        )}
      </Box>
    )

    // ── Tree ────────────────────────────────────────────────────────────────
    const rows: TreeRow[] = flattenTree(lists, open, 400)
    const treeRow = (row: TreeRow) => {
      const indent = '  '.repeat(row.depth)
      if (row.kind === 'dir') {
        const isBusy = [...touching].some(p => p.startsWith(`${row.path}/`))
        const hasEdits = !row.isOpen && hasMarkedChild(marked, row.path, 'isEdited')
        return (
          <Button
            key={`tree:${row.path}`}
            plain
            onPress={async () => {
              if (row.isOpen) {
                await update($, expanded, list => list.filter(p => p !== row.path))
                return
              }
              if (!row.isLoaded) {
                await loadDir($, row.path)
              }
              await update($, expanded, list => [...list.filter(p => p !== row.path), row.path])
            }}
          >
            {indent}
            <Text dimColor>{row.isOpen ? '▾ ' : '▸ '}</Text>
            {isBusy && !row.isOpen ? <Text color="suggestion">{row.name}/</Text> : `${row.name}/`}
            {hasEdits ? <Text dimColor> •</Text> : ''}
          </Button>
        )
      }
      const mark = marked[row.path]
      const isBusy = touching.has(row.path)
      return (
        <Button key={`tree:${row.path}`} plain onPress={() => pinFile($, row.path)}>
          {indent}
          {'  '}
          {isBusy ? <Text color="suggestion" bold>{row.name}</Text> : row.name}
          {mark?.isEdited ? (
            <Text>
              {' '}
              <Text color="diffAdded" tabular>+{mark.adds}</Text> <Text color="diffRemoved" tabular>−{mark.dels}</Text>
            </Text>
          ) : mark?.isRead ? (
            <Text dimColor> ·</Text>
          ) : (
            ''
          )}
        </Button>
      )
    }
    const tree = (
      <Box flexDirection="column">
        {lists['.'] === undefined ? <Text dimColor>Loading…</Text> : rows.length === 0 ? <Text dimColor>An empty folder.</Text> : ''}
        {rows.map(treeRow)}
        {rows.length >= 400 ? <Text dimColor>…more not shown; collapse a folder.</Text> : ''}
      </Box>
    )

    // ── Viewer ──────────────────────────────────────────────────────────────
    const viewPath = shown !== null && 'path' in shown ? shown.path : undefined
    const viewTitle =
      shown === null ? 'Viewer'
        : shown.kind === 'search' ? `${shown.tool} “${shown.query}”${shown.where === undefined ? '' : ` in ${shown.where}`}`
        : shown.kind === 'bash' ? `$ ${shortCommand(shown.command, Math.max(20, (isWide ? cols * 0.6 : cols) - 24))}`
        : (viewPath ?? 'Viewer')

    const viewerBar = (
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text weight="semibold" wrap="truncate-middle">
          {viewTitle}
          {shown?.kind === 'diff' ? (
            <Text weight="regular"> <Text color="diffAdded">+{shown.adds}</Text> <Text color="diffRemoved">−{shown.dels}</Text></Text>
          ) : shown?.kind === 'created' ? (
            <Text weight="regular"> <Text color="diffAdded">+{shown.adds}</Text> <Text dimColor>new</Text></Text>
          ) : ''}
        </Text>
        <Box flexDirection="row" columnGap={1}>
          {viewPath !== undefined ? <Button key="mention" label="@ Mention" onPress={() => mention($, viewPath)} /> : ''}
          {following ? (
            <Text dimColor>● Following</Text>
          ) : (
            <Button key="follow" variant="primary" label="Follow" onPress={() => follow($)} />
          )}
        </Box>
      </Box>
    )

    let body
    if (shown === null) {
      body = (
        <Text dimColor>
          Files Claude reads and edits show here as it works. Click a file in the tree to open it.
        </Text>
      )
    } else if (shown.kind === 'file') {
      body = (
        <Box flexDirection="column">
          {shown.note !== undefined ? <Text dimColor size="footnote">{shown.note}</Text> : ''}
          <Code source={shown.source} language={languageOf(shown.path)} path={shown.path} startLine={shown.startLine ?? 1} />
        </Box>
      )
    } else if (shown.kind === 'diff') {
      body = <Code source={shown.source} format="diff" language={languageOf(shown.path)} path={shown.path} />
    } else if (shown.kind === 'created') {
      body = <Code source={shown.source} language={languageOf(shown.path)} path={shown.path} startLine={1} />
    } else if (shown.kind === 'search') {
      body = (
        <Box flexDirection="column">
          <Text dimColor>{shown.files.length === 0 ? 'No matching files.' : `${shown.files.length} ${shown.files.length === 1 ? 'file' : 'files'}`}</Text>
          {shown.files.slice(0, 100).map((f, i) => (
            <Button key={`hit:${i}:${f}`} plain onPress={() => pinFile($, f)}>
              {f}
              {marked[f]?.isEdited ? <Text dimColor> edited</Text> : ''}
            </Button>
          ))}
        </Box>
      )
    } else if (shown.kind === 'bash') {
      body = (
        <Box flexDirection="column" rowGap={1}>
          <Code source={shown.command} language="bash" />
          <Text color={shown.isOk ? 'success' : 'error'}>{shown.isOk ? '✓' : '✗'} {shown.status}</Text>
          {shown.output.trim() !== '' ? <Code source={shown.output} /> : <Text dimColor>No output.</Text>}
        </Box>
      )
    } else {
      body = <Text dimColor>{shown.text}</Text>
    }

    const viewer = (
      <Box flexDirection="column" rowGap={1} flexGrow={1} flexShrink={1}>
        {viewerBar}
        {body}
      </Box>
    )

    // ── Activity strip ──────────────────────────────────────────────────────
    const strip = recent.length === 0 ? '' : (
      <Box flexDirection="column">
        <Text dimColor size="footnote">Activity</Text>
        {recent.slice(0, SHOW_TOUCHES).map(t => (
          <Button key={`touch:${t.id}`} plain onPress={() => showTouch($, t)}>
            <Text dimColor>{t.kind === 'read' ? '◦ ' : t.kind === 'edit' ? '✎ ' : t.kind === 'search' ? '⌕ ' : '› '}</Text>
            {t.kind === 'run' ? t.label.replace(/ [✓✗]$/, '') : t.label}
            {t.adds !== undefined ? (
              <Text> <Text color="diffAdded">+{t.adds}</Text> <Text color="diffRemoved">−{t.dels ?? 0}</Text></Text>
            ) : ''}
            {t.kind === 'run' ? <Text color={t.isOk ? 'success' : 'error'}>{t.isOk ? ' ✓' : ' ✗'}</Text> : ''}
          </Button>
        ))}
      </Box>
    )

    // ── Layout ──────────────────────────────────────────────────────────────
    if (isWide) {
      return (
        <Box flexDirection="column" rowGap={1}>
          {header}
          <Box flexDirection="row" columnGap={2}>
            <Box flexDirection="column" width={Math.max(24, Math.min(44, Math.floor(cols * 0.32)))} flexShrink={0}>
              {tree}
            </Box>
            {viewer}
          </Box>
          {strip}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        {header}
        <Box flexDirection="row" columnGap={1}>
          <Button key="tab:files" label="Files" variant={current === 'files' ? 'primary' : 'secondary'} onPress={() => update($, tab, () => 'files')} />
          <Button key="tab:viewer" label="Viewer" variant={current === 'viewer' ? 'primary' : 'secondary'} onPress={() => update($, tab, () => 'viewer')} />
        </Box>
        {current === 'files' ? tree : viewer}
        {strip}
      </Box>
    )
  })
}
