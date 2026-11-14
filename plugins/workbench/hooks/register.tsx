import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { ChangedFile, Feature, Features, GitState, TestRun, UsageView } from '../types'
import {
  classifyMcpTool,
  countPatch,
  formatDuration,
  formatTokens,
  isTestLast,
  parseGitStatus,
  relativeTo,
  riskOf,
  testCommandOf,
  testOutcome,
  untilReset,
} from './lib'

// ── State ───────────────────────────────────────────────────────────────────
// Held by the host for the session, so a hot reload keeps it. Bump a `shape`
// tag when its type changes: values stored under an old tag read as initial.

const ALL_ON: Features = { band: true, guard: true, changes: true, usage: true, status: false }
const FEATURE_INFO: Record<Feature, string> = {
  band: 'Attention band: failing tests, uncommitted work, a filling context window',
  guard: 'Risky-command guard: asks before force-pushes, hard resets, sweeping deletes',
  changes: 'Changed-files pane: every file Claude edited this session',
  usage: 'Usage chip in the band: time, cost and context; click it for what each means',
  status: 'Plain status-line copy of the usage figures (off by default; it cannot be clicked)',
}

const features = atom({ plugin: 'workbench', key: 'features' } as const, ALL_ON)
const files = atom({ plugin: 'workbench', key: 'files' } as const, [], { shape: 'files-1' })
const tests = atom({ plugin: 'workbench', key: 'tests' } as const, null, { shape: 'tests-1' })
const git = atom({ plugin: 'workbench', key: 'git' } as const, null, { shape: 'git-1' })
const context = atom({ plugin: 'workbench', key: 'context' } as const, null)
const isPaneOpened = atom({ plugin: 'workbench', key: 'isPaneOpened' } as const, false)
const usage = atom({ plugin: 'workbench', key: 'usage' } as const, null, { shape: 'usage-1' })
const isUsageOpen = atom({ plugin: 'workbench', key: 'isUsageOpen' } as const, false)

const PANE = 'workbench-changes'
const USAGE_PANE = 'workbench-usage'
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

/** A bar of block characters, `fraction` 0..1. */
function bar(fraction: number, width = 28): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

/** "⏱ 18m · $8.49 · 28% context" */
function usageLine(view: UsageView): string {
  const parts = [`⏱ ${formatDuration(view.now - view.startedAt)}`]
  if (view.usd !== undefined) {
    parts.push(`$${view.usd.toFixed(2)}`)
  }
  if (view.percent !== undefined) {
    parts.push(`${view.percent}% context`)
  }
  return parts.join(' · ')
}

async function refreshStatus($: Engine): Promise<void> {
  // The breakdown is a local estimate (`summary` sends no requests); only
  // worth computing while the usage pane is open.
  const withRows = await read($, isUsageOpen)
  const live = await $.session.usage(withRows ? { breakdown: 'summary' } : undefined)
  const view: UsageView = {
    startedAt: live.startedAt,
    now: await $.clock.now(),
    usd: live.cost?.usd,
    percent: live.context.percent,
    tokens: live.context.tokens,
    window: live.context.window,
    rateLimits: live.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    rows: live.context.breakdown?.categories
      .filter(c => !c.isDeferred)
      .map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
  }
  await update($, usage, () => view)
  $.ui.status((await isOn($, 'status')) ? usageLine(view) : undefined)
}

async function openUsage($: Engine): Promise<void> {
  await update($, isUsageOpen, () => true)
  await refreshStatus($)
  await $.ui.open({ id: USAGE_PANE, title: 'Session usage' })
}

function lineCount(text: string | undefined): number {
  if (text === undefined || text === '') {
    return 0
  }
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

type FileResult = { type?: string; structuredPatch?: { lines: string[] }[]; originalFile?: string | null }

async function recordChange($: Engine, absolutePath: string, result: unknown, isWholeFile: boolean, content?: string): Promise<void> {
  const r = (result ?? {}) as FileResult
  const isNew = r.type === 'create' || (isWholeFile && r.originalFile === null)
  const counted = countPatch(r.structuredPatch)
  // A brand-new file has no patch: count its lines as added.
  const fallbackAdds = isNew && counted.adds === 0 ? lineCount(content) : 0
  await recordCounts($, absolutePath, counted.adds + fallbackAdds, counted.dels, isNew)
}

async function recordCounts($: Engine, somePath: string, adds: number, dels: number, isNew: boolean): Promise<void> {
  const path = relativeTo(await $.session.cwd(), somePath)
  const at = await $.clock.now()

  await update($, files, list => {
    const old = list.find(f => f.path === path)
    const entry: ChangedFile = {
      path,
      adds: (old?.adds ?? 0) + adds,
      dels: (old?.dels ?? 0) + dels,
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
  void refreshGit($)
}

/** Records a test run from a shell command, judged by its output first (see testOutcome). */
async function recordTestRun($: Engine, command: string, output: string | undefined, isError: boolean): Promise<void> {
  const runner = testCommandOf(command)
  if (runner === undefined) {
    return
  }
  const outcome = testOutcome(output, isError, isTestLast(command))
  if (outcome === undefined) {
    return
  }
  const run: TestRun = { command: runner, isPassing: outcome === 'pass', at: await $.clock.now() }
  await update($, tests, () => run)
}

// ── Register ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(STORE_KEY)) as Partial<Features> | undefined
    await update($, features, () => ({ ...ALL_ON, ...(saved ?? {}) }))
    // One at a time: a name the app or another plugin already holds is
    // refused, and that must never stop the rest of Workbench from starting.
    const commands = [
      { name: 'workbench', description: 'Show or switch Workbench features: /workbench [band|guard|changes|usage|status] [on|off]' },
      { name: 'changes', description: 'Open the pane of files Claude changed this session' },
      { name: 'usage-info', description: 'What this session has used so far (time, cost, context, plan limits), explained' },
    ]
    for (const command of commands) {
      await $.command.register(command).catch(error => $.ui.log(`workbench: /${command.name} unavailable: ${String(error)}`))
    }
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
      if (name === 'status' || name === 'usage') {
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

  on('command.run', { command: 'usage-info' }, async $ => {
    await openUsage($)
    return { text: 'Opened the Session usage pane.' }
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
    if (/\bgit\s/.test(e.command)) {
      void refreshGit($)
    }
    if (ran.deny === undefined) {
      await recordTestRun($, e.command, ran.text, ran.isError === true).catch(() => undefined)
    }
    return ran
  })

  // ── Tools from other MCP servers: file edits, shells and test runners ─────

  on('tool.call', async ($, e, next) => {
    const touch = classifyMcpTool(e.tool, e as unknown as Record<string, unknown>)
    if (touch === undefined) {
      return next(e)
    }
    const absolute = 'path' in touch && !touch.path.startsWith('/') ? `${await $.session.cwd()}/${touch.path}` : 'path' in touch ? touch.path : ''
    const existed = touch.kind === 'write' ? await $.fs.exists(absolute).catch(() => true) : true
    const ran = await next(e)
    if (ran.deny !== undefined) {
      return ran
    }
    const isError = ran.isError === true
    try {
      if (touch.kind === 'edit' && !isError && (await isOn($, 'changes'))) {
        await recordCounts($, absolute, touch.adds, touch.dels, false)
      } else if (touch.kind === 'write' && !isError && (await isOn($, 'changes'))) {
        await recordCounts($, absolute, touch.adds, 0, !existed)
      } else if (touch.kind === 'shell') {
        await recordTestRun($, touch.command, ran.text, isError)
      } else if (touch.kind === 'checks') {
        const outcome = testOutcome(ran.text, isError, true)
        if (outcome !== undefined) {
          const run: TestRun = { command: touch.label, isPassing: outcome === 'pass', at: await $.clock.now() }
          await update($, tests, () => run)
        }
      }
    } catch {
      // Bookkeeping never disturbs the tool call.
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
      await recordChange($, e.file_path, ran.result, true, e.content).catch(() => undefined)
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
    const view = (await isOn($, 'usage')) ? await read($, usage) : null

    const showTests = run !== null
    const showGit = repo !== null && (repo.dirty > 0 || repo.ahead > 0)
    const showContext = fill !== null && fill >= 60

    if (!showTests && !showGit && !showContext && view === null) {
      return next(e) // All quiet: draw nothing.
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const fillColor = fill !== null && fill >= 90 ? 'error' : fill !== null && fill >= 75 ? 'warning' : 'subtle'

    return (
      <Box flexDirection="row" justifyContent="space-between" columnGap={3}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} flexShrink={1}>
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
      {view !== null && (
        <Button key="usage" plain dimColor onPress={() => openUsage($)}>
          {usageLine(view)} ⓘ
        </Button>
      )}
      </Box>
    )
  })

  // ── Drawing: the session usage pane, every figure explained ───────────────

  on('ui.render', { component: 'Pane', requestId: USAGE_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const view = await read($, usage)

    if (view === null) {
      return <Text dimColor>Measuring… figures appear after Claude's first reply.</Text>
    }
    if (e.props.placement === 'widget') {
      return <Text>{usageLine(view)}</Text>
    }

    const elapsed = formatDuration(view.now - view.startedAt)
    const hours = Math.max((view.now - view.startedAt) / 3_600_000, 1 / 60)
    const used = (view.rows ?? []).filter(r => r.kind !== 'free' && r.kind !== 'buffer' && r.tokens > 0)
    const fillColor = (view.percent ?? 0) >= 90 ? 'error' : (view.percent ?? 0) >= 75 ? 'warning' : 'success'
    const limitName: Record<string, string> = {
      five_hour: '5-hour window',
      seven_day: '7-day window',
      spend_limit: 'Spend limit',
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Text weight="semibold">⏱ Time · {elapsed}</Text>
          <Text dimColor>How long this session has been open, counted from when it started (or first started, if resumed).</Text>
        </Box>

        {view.usd !== undefined && (
          <Box flexDirection="column">
            <Text weight="semibold">
              $ Cost · ${view.usd.toFixed(2)} <Text dimColor>(about ${(view.usd / hours).toFixed(2)}/hour)</Text>
            </Text>
            <Text dimColor>
              What this session's model calls come to at API prices, the same total /cost shows. On a Claude
              subscription it's a measure of how much you've used, not a separate bill.
            </Text>
          </Box>
        )}

        <Box flexDirection="column" rowGap={1}>
          <Text weight="semibold">
            ◔ Context · {view.percent ?? 0}%{' '}
            <Text dimColor>
              ({view.tokens === undefined ? '—' : formatTokens(view.tokens)} of {formatTokens(view.window)} tokens)
            </Text>
          </Text>
          <Text color={fillColor}>{bar((view.percent ?? 0) / 100)}</Text>
          <Text dimColor>
            Claude's working memory for this conversation: every message, file it read, and tool result so far.
            Near the limit Claude compacts, summarizing older messages to make room, and small details can be
            lost. Compacting yourself at a natural break lets you choose when.
          </Text>
          {used.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor size="footnote">What's in it now</Text>
              {used.map(r => (
                <Text>
                  <Text tabular>{formatTokens(r.tokens).padStart(6)}</Text>  {r.name}
                </Text>
              ))}
            </Box>
          )}
          <Box flexDirection="row" columnGap={2}>
            <Button key="compact-now" variant={(view.percent ?? 0) >= 75 ? 'primary' : 'secondary'} label="Compact…" onPress={() => $.prompt.fill({ text: '/compact', mode: 'replace' })} />
            <Button key="context-detail" label="Full breakdown" onPress={() => $.prompt.fill({ text: '/context', mode: 'replace' })} />
          </Box>
          <Text color={fillColor} size="footnote">
            {(view.percent ?? 0) >= 90
              ? 'Almost full: compact now or start a fresh session for the next task.'
              : (view.percent ?? 0) >= 75
                ? 'Getting full: a good moment to compact once this step is done.'
                : 'Plenty of room.'}
          </Text>
        </Box>

        {view.rateLimits.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            <Text weight="semibold">⟳ Plan limits</Text>
            {view.rateLimits.map(r => (
              <Text>
                <Text color={r.percentUsed >= 90 ? 'error' : r.percentUsed >= 75 ? 'warning' : 'subtle'}>{bar(Math.min(r.percentUsed, 100) / 100, 16)}</Text>
                {' '}{limitName[r.kind] ?? r.kind} {r.percentUsed}%
                <Text dimColor>{r.resetsAt === undefined ? '' : ` · resets ${untilReset(r.resetsAt, view.now)}`}</Text>
              </Text>
            ))}
            <Text dimColor>
              Your plan's usage allowance across all your sessions, on rolling windows. When one fills, requests
              slow or pause until it resets.
            </Text>
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
