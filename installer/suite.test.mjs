import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { cmdQuote, commandFor, everything, initialSelection, legacySteps, parseArgs, plan, readCatalog, readLegacy, readState, themeConflict } from './suite.mjs'
import { fakeClaude } from './fake-claude.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = {
  marketplace: 'clarity',
  plugins: [
    { name: 'clarity-theme', kind: 'theme', description: '' },
    { name: 'workbench', kind: 'plugin', description: '' },
    { name: 'factory', kind: 'plugin', description: '' },
  ],
}

test('reads the real catalog from the marketplace file', () => {
  const real = readCatalog(ROOT)
  assert.equal(real.marketplace, 'clarity')
  assert.ok(real.plugins.some(p => p.name === 'clarity-theme' && p.kind === 'theme'))
  assert.ok(real.plugins.some(p => p.name === 'workbench' && p.kind === 'plugin'))
})

test('reads only this marketplace from claude plugin list', () => {
  const state = readState(
    JSON.stringify([
      { id: 'clarity-theme@clarity', enabled: true, scope: 'user' },
      { id: 'workbench@clarity', enabled: false, scope: 'user' },
      { id: 'sleepwalk@sleepwalk', enabled: true },
    ]),
    'clarity',
  )
  assert.deepEqual([...state.keys()], ['clarity-theme', 'workbench'])
  assert.equal(state.get('workbench').enabled, false)
})

test('first run selects everything; later runs reflect what is enabled', () => {
  assert.deepEqual([...initialSelection(catalog, new Map())], ['clarity-theme', 'workbench', 'factory'])
  const state = new Map([['clarity-theme', { installed: true, enabled: true }], ['workbench', { installed: true, enabled: false }]])
  assert.deepEqual([...initialSelection(catalog, state)], ['clarity-theme'])
})

test('plans installs, enables, disables, and uninstalls only with --remove', () => {
  const state = new Map([
    ['clarity-theme', { installed: true, enabled: true }],
    ['workbench', { installed: true, enabled: false }],
  ])
  const selected = new Set(['workbench', 'factory'])
  assert.deepEqual(plan(catalog, state, selected), [
    { action: 'disable', name: 'clarity-theme' },
    { action: 'enable', name: 'workbench' },
    { action: 'install', name: 'factory' },
  ])
  assert.deepEqual(plan(catalog, state, new Set(), { remove: true }), [
    { action: 'uninstall', name: 'clarity-theme' },
    { action: 'uninstall', name: 'workbench' },
  ])
  assert.deepEqual(plan(catalog, state, new Set(['clarity-theme'])), [])
})

test('parses flags and refuses bad ones', () => {
  assert.deepEqual(parseArgs(['--only', 'clarity-theme, workbench', '--scope', 'project']).only, ['clarity-theme', 'workbench'])
  assert.equal(parseArgs(['config']).command, 'config')
  assert.throws(() => parseArgs(['--scope', 'everywhere']), /--scope must be/)
  assert.throws(() => parseArgs(['--all', '--only', 'x']), /not both/)
  assert.throws(() => parseArgs(['--frobnicate']), /Unknown option/)
})

test('a first run and --all pick every plugin but only the first theme', () => {
  const two = { ...catalog, plugins: [...catalog.plugins, { name: 'neon-noir', kind: 'theme', description: '' }] }
  assert.deepEqual([...everything(two)], ['clarity-theme', 'workbench', 'factory'])
  assert.deepEqual([...initialSelection(two, new Map())], ['clarity-theme', 'workbench', 'factory'])
  const real = readCatalog(ROOT)
  assert.deepEqual([...everything(real)].filter(n => real.plugins.find(p => p.name === n).kind === 'theme'), ['clarity-theme'])
})

test('warns when two themes are selected', () => {
  const two = { ...catalog, plugins: [...catalog.plugins, { name: 'paper', kind: 'theme', description: '' }] }
  assert.deepEqual(themeConflict(two, new Set(['clarity-theme', 'paper'])), ['clarity-theme', 'paper'])
  assert.equal(themeConflict(two, new Set(['clarity-theme'])), undefined)
})

test('end to end against a fake claude: adds the marketplace, then installs what was asked', () => {
  const { bin, calls } = fakeClaude()
  const run = spawnSync(process.execPath, [join(ROOT, 'installer', 'cli.mjs'), '--only', 'workbench', '--yes'], {
    env: { ...process.env, CLAUDE_BIN: bin },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(calls(), [
    'plugin list --json',
    'plugin marketplace list --json',
    'plugin marketplace add swperb/clarity',
    'plugin install workbench@clarity --scope user',
  ])
})

test('cmdQuote keeps plain arguments and quotes risky ones for cmd.exe', () => {
  assert.equal(cmdQuote('workbench@clarity'), 'workbench@clarity')
  assert.equal(cmdQuote('C:\\Program Files\\claude.cmd'), '"C:\\Program Files\\claude.cmd"')
  assert.equal(cmdQuote('a&b'), '"a&b"')
  assert.equal(cmdQuote('say "hi"'), '"say ""hi"""')
})

test('moves installs from the old claude-code-themes names to clarity', () => {
  const list = JSON.stringify([
    { id: 'clarity@claude-code-themes', enabled: true, scope: 'user' },
    { id: 'workbench@claude-code-themes', enabled: false, scope: 'user' },
    { id: 'sleepwalk@sleepwalk', enabled: true },
  ])
  const legacy = readLegacy(list)
  assert.deepEqual(legacy.map(l => l.name), ['clarity-theme', 'workbench'])
  // Keeps exactly what was enabled before: the theme, not the disabled workbench.
  assert.deepEqual([...initialSelection(catalog, new Map(), legacy)], ['clarity-theme'])
  const steps = legacySteps(legacy)
  assert.deepEqual(commandFor(steps[0], 'clarity', 'user'), ['plugin', 'uninstall', 'clarity@claude-code-themes', '--scope', 'user'])
})
