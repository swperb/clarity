import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { ChangedFile, Feature, Features, GitState, TestRun } from '../types'
import { countPatch, formatDuration, parseGitStatus, relativeTo, riskOf, testCommandOf } from './lib'

// ── State ───────────────────────────────────────────────────────────────────
// Held by the host for the session, so a hot reload keeps it. Bump a `shape`
// tag when its type changes: values stored under an old tag read as initial.

const ALL_ON: Features = { band: true, guard: true, changes: true, status: true }
const FEATURE_INFO: Record<Feature, string> = {
  band: 'Attention band: failing tests, uncommitted work, a filling context window',
  guard: 'Risky-command guard: asks before force-pushes, hard resets, sweeping deletes',
  changes: 'Changed-files pane: every file Claude edited this session',
  status: 'Status line: session time, cost and context use',
}

const features = atom({ plugin: 'workbench', key: 'features' } as const, ALL_ON)
const files = atom({ plugin: 'workbench', key: 'files' } as const, [], { shape: 'files-1' })
const tests = atom({ plugin: 'workbench', key: 'tests' } as const, null, { shape: 'tests-1' })
const git = atom({ plugin: 'workbench', key: 'git' } as const, null, { shape: 'git-1' })
const context = atom({ plugin: 'workbench', key: 'context' } as const, null)
const isPaneOpened = atom({ plugin: 'workbench', key: 'isPaneOpened' } as const, false)

const PANE = 'workbench-changes'
const STORE_KEY = 'features'

// ── Effects ─────────────────────────────────────────────────────────────────

async function isOn($: Engine, feature: Feature): Promise<boolean> {
  return (await read($, features))[feature]
}

async function refreshGit($: Engine): Promise<void> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], {
      timeoutMs: 5000,
    })
    const next: GitState | null = exitCode === 0 ? parseGitStatus(stdout) : null
    await update($, git, () => next)
  } catch {
    await update($, git, () => null)
  }
}

async function refreshStatus($: Engine): Promise<void> {
  if (!(await isOn($, 'status'))) {
    $.ui.status(undefined)
    return
  }
  const usage = await $.session.usage()
  const parts = [`⏱ ${formatDuration((await $.clock.now()) - usage.startedAt)}`]
  if (usage.cost !== undefined) {
    parts.push(`$${usage.cost.usd.toFixed(2)}`)
  }
  if (usage.context.percent !== undefined) {
    parts.push(`${usage.context.percent}% context`)
  }
  $.ui.status(parts.join('  ·  '))
}

type FileResult = { type?: string; structuredPatch?: { lines: string[] }[]; originalFile?: string | null }

async function recordChange($: Engine, absolutePath: string, result: unknown, isWholeFile: boolean): Promise<void> {
  const r = (result ?? {}) as FileResult
  const isNew = r.type === 'create' || (isWholeFile && r.originalFile === null)
  const counted = countPatch(r.structuredPatch)
  // A brand-new file has no patch: count its lines as added.
  const fallbackAdds = isNew && counted.adds === 0 ? 1 : 0
  const path = relativeTo(await $.session.cwd(), absolutePath)
  const at = await $.clock.now()

  await update($, files, list => {
    const old = list.find(f => f.path === path)
    const entry: ChangedFile = {
      path,
      adds: (old?.adds ?? 0) + counted.adds + fallbackAdds,
      dels: (old?.dels ?? 0) + counted.dels,
      edits: (old?.edits ?? 0) + 1,
      isNew: old?.isNew ?? isNew,
      at,
    }
    return [entry, ...list.filter(f => f.path !== path)].slice(0, 300)
  })

  if (!(await read($, isPaneOpened))) {
    await update($, isPaneOpened, () => true)
    void $.ui.open({ id: PANE, title: 'Changed files' })
  }
}

// ── Register ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(STORE_KEY)) as Partial<Features> | undefined
    await update($, features, () => ({ ...ALL_ON, ...(saved ?? {}) }))
    await $.command.register({
      name: 'workbench',
      description: 'Show or switch Workbench features: /workbench [band|guard|changes|status] [on|off]',
    })
    await $.command.register({ name: 'changes', description: 'Open the pane of files Claude changed this session' })
    void refreshGit($)
    void refreshStatus($)
    return next(e)
  })

  // ── /workbench and /changes ───────────────────────────────────────────────

  on('command.run', { command: 'workbench' }, async ($, e) => {
    const [name = '', state = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const current = await read($, features)

    if (name in current && (state === 'on' || state === 'off')) {
      const next: Features = { ...current, [name]: state === 'on' }
      await update($, features, () => next)
      await $.store.set(STORE_KEY, next)
      if (name === 'status') {
        await refreshStatus($)
      }
      return { text: `Workbench ${name} is ${state}. This sticks across sessions.` }
    }

    const lines = (Object.keys(FEATURE_INFO) as Feature[]).map(
      f => `${current[f] ? '●' : '○'} ${f.padEnd(8)} ${FEATURE_INFO[f]}`,
    )
    return { text: [...lines, '', 'Switch one with /workbench <feature> on|off'].join('\n') }
  })

  on('command.run', { command: 'changes' }, async $ => {
    await update($, isPaneOpened, () => true)
    await $.ui.open({ id: PANE, title: 'Changed files' })
    return { text: 'Opened the Changed files pane.' }
  })

  // ── 1. Risky-command guard ────────────────────────────────────────────────
  // A plugin's `ask` always goes to a person, even in auto mode, so the
  // dialog appears with our reason. A deny from beneath stands.

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    const command = (e.input as { command?: unknown } | undefined)?.command
    if (verdict.decision === 'deny' || typeof command !== 'string' || !(await isOn($, 'guard'))) {
      return verdict
    }
    const reason = riskOf(command)
    return reason === undefined
      ? verdict
      : { decision: 'ask', reason: `Workbench: this command ${reason}. Run it anyway?` }
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'ask', reason: 'Workbench guard failed; check this command.' }))

  // ── 2. Test results, for the band ─────────────────────────────────────────

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = testCommandOf(e.command)
    if (command !== undefined && ran.deny === undefined) {
      const run: TestRun = { command, isPassing: ran.isError !== true, at: await $.clock.now() }
      await update($, tests, () => run).catch(() => undefined)
    }
    return ran
  })

  // ── 3. Changed files ──────────────────────────────────────────────────────

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && (await isOn($, 'changes'))) {
      await recordChange($, e.file_path, ran.result, false).catch(() => undefined)
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && (await isOn($, 'changes'))) {
      await recordChange($, e.file_path, ran.result, true).catch(() => undefined)
    }
    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && (await isOn($, 'changes'))) {
      await recordChange($, e.notebook_path, undefined, false).catch(() => undefined)
    }
    return ran
  })

  // ── 4. Status line and context, refreshed as the engine measures ──────────

  on('session.measure', async ($, e, next) => {
    await update($, context, () => e.context.percent ?? null)
    await refreshStatus($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refreshGit($)
    await refreshStatus($)
    return next(e)
  })

  // ── Drawing: the attention band ───────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isOn($, 'band'))) {
      return next(e)
    }
    const run = await read($, tests)
    const repo = await read($, git)
    const fill = await read($, context)

    const showTests = run !== null
    const showGit = repo !== null && (repo.dirty > 0 || repo.ahead > 0)
    const showContext = fill !== null && fill >= 60

    if (!showTests && !showGit && !showContext) {
      return next(e) // All quiet: draw nothing.
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const fillColor = fill !== null && fill >= 90 ? 'error' : fill !== null && fill >= 75 ? 'warning' : 'subtle'

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {showTests && (
          <Text color={run.isPassing ? 'success' : 'error'} bold={!run.isPassing}>
            {run.isPassing ? '✓ Tests passing' : '✗ Tests failing'}
            <Text dimColor> {run.command}</Text>
          </Text>
        )}
        {showGit && (
          <Box flexDirection="row" columnGap={1}>
            <Text color="warning">
              {repo.dirty > 0 ? `● ${repo.dirty} uncommitted` : ''}
              {repo.dirty > 0 && repo.ahead > 0 ? '  ' : ''}
              {repo.ahead > 0 ? `↑ ${repo.ahead} unpushed` : ''}
              <Text dimColor> on {repo.branch}</Text>
            </Text>
            {repo.dirty > 0 && (
              <Button
                key="commit"
                plain
                dimColor
                onPress={() =>
                  $.prompt.fill({
                    text: 'Review the uncommitted changes and commit them with a clear message.',
                    mode: 'replace',
                  })
                }
              >
                commit…
              </Button>
            )}
          </Box>
        )}
        {showContext && (
          <Box flexDirection="row" columnGap={1}>
            <Text color={fillColor}>◔ Context {fill}% full</Text>
            {fill >= 75 && (
              <Button key="compact" plain dimColor onPress={() => $.prompt.fill({ text: '/compact', mode: 'replace' })}>
                compact…
              </Button>
            )}
          </Box>
        )}
      </Box>
    )
  })

  // ── Drawing: the changed-files pane ───────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, files)
    const adds = list.reduce((n, f) => n + f.adds, 0)
    const dels = list.reduce((n, f) => n + f.dels, 0)
    const summary = `${list.length} ${list.length === 1 ? 'file' : 'files'}`

    if (e.props.placement === 'widget') {
      return (
        <Text>
          {summary} <Text color="diffAdded">+{adds}</Text> <Text color="diffRemoved">−{dels}</Text>
        </Text>
      )
    }

    if (list.length === 0) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text dimColor>No files changed yet this session.</Text>
          <Text dimColor size="footnote">
            Files Claude edits will appear here. Click one to mention it in your next message.
          </Text>
        </Box>
      )
    }

    const room = Math.max(3, (e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24) - 4)
    const mentionAll = list.map(f => `@${f.path}`).join(' ')

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text weight="semibold">
            {summary} <Text color="diffAdded">+{adds}</Text> <Text color="diffRemoved">−{dels}</Text>
          </Text>
          <Box flexDirection="row" columnGap={2}>
            <Button
              key="review"
              variant="primary"
              label="Review all"
              onPress={() =>
                $.prompt.fill({
                  text: `Review your changes to ${mentionAll} for bugs, leftover debug code and missing tests.`,
                  mode: 'replace',
                })
              }
            />
            <Button key="clear" label="Clear" onPress={() => update($, files, () => [])} />
          </Box>
        </Box>
        <Box flexDirection="column">
          {list.slice(0, room).map(f => (
            <Button key={`file:${f.path}`} plain onPress={() => $.prompt.fill({ text: `@${f.path} `, mode: 'insert' })}>
              <Text color="diffAdded" tabular>+{f.adds}</Text> <Text color="diffRemoved" tabular>−{f.dels}</Text> {f.path}
              {f.isNew ? <Text color="suggestion"> new</Text> : ''}
              <Text dimColor> ×{f.edits}</Text>
            </Button>
          ))}
          {list.length > room && <Text dimColor>…and {list.length - room} more</Text>}
        </Box>
      </Box>
    )
  })
}
