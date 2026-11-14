import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { initialSelection, parseArgs, plan, readCatalog, readState, themeConflict } from './suite.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = {
  marketplace: 'claude-code-themes',
  plugins: [
    { name: 'clarity', kind: 'theme', description: '' },
    { name: 'workbench', kind: 'plugin', description: '' },
    { name: 'factory', kind: 'plugin', description: '' },
  ],
}

test('reads the real catalog from the marketplace file', () => {
  const real = readCatalog(ROOT)
  assert.equal(real.marketplace, 'claude-code-themes')
  assert.ok(real.plugins.some(p => p.name === 'clarity' && p.kind === 'theme'))
  assert.ok(real.plugins.some(p => p.name === 'workbench' && p.kind === 'plugin'))
})

test('reads only this marketplace from claude plugin list', () => {
  const state = readState(
    JSON.stringify([
      { id: 'clarity@claude-code-themes', enabled: true, scope: 'user' },
      { id: 'workbench@claude-code-themes', enabled: false, scope: 'user' },
      { id: 'sleepwalk@sleepwalk', enabled: true },
    ]),
    'claude-code-themes',
  )
  assert.deepEqual([...state.keys()], ['clarity', 'workbench'])
  assert.equal(state.get('workbench').enabled, false)
})

test('first run selects everything; later runs reflect what is enabled', () => {
  assert.deepEqual([...initialSelection(catalog, new Map())], ['clarity', 'workbench', 'factory'])
  const state = new Map([['clarity', { installed: true, enabled: true }], ['workbench', { installed: true, enabled: false }]])
  assert.deepEqual([...initialSelection(catalog, state)], ['clarity'])
})

test('plans installs, enables, disables, and uninstalls only with --remove', () => {
  const state = new Map([
    ['clarity', { installed: true, enabled: true }],
    ['workbench', { installed: true, enabled: false }],
  ])
  const selected = new Set(['workbench', 'factory'])
  assert.deepEqual(plan(catalog, state, selected), [
    { action: 'disable', name: 'clarity' },
    { action: 'enable', name: 'workbench' },
    { action: 'install', name: 'factory' },
  ])
  assert.deepEqual(plan(catalog, state, new Set(), { remove: true }), [
    { action: 'uninstall', name: 'clarity' },
    { action: 'uninstall', name: 'workbench' },
  ])
  assert.deepEqual(plan(catalog, state, new Set(['clarity'])), [])
})

test('parses flags and refuses bad ones', () => {
  assert.deepEqual(parseArgs(['--only', 'clarity, workbench', '--scope', 'project']).only, ['clarity', 'workbench'])
  assert.equal(parseArgs(['config']).command, 'config')
  assert.throws(() => parseArgs(['--scope', 'everywhere']), /--scope must be/)
  assert.throws(() => parseArgs(['--all', '--only', 'x']), /not both/)
  assert.throws(() => parseArgs(['--frobnicate']), /Unknown option/)
})

test('warns when two themes are selected', () => {
  const two = { ...catalog, plugins: [...catalog.plugins, { name: 'paper', kind: 'theme', description: '' }] }
  assert.deepEqual(themeConflict(two, new Set(['clarity', 'paper'])), ['clarity', 'paper'])
  assert.equal(themeConflict(two, new Set(['clarity'])), undefined)
})

test('end to end against a fake claude: adds the marketplace, then installs what was asked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'suite-'))
  const log = join(dir, 'calls.log')
  const fake = join(dir, 'claude')
  writeFileSync(
    fake,
    `#!/bin/sh\necho "$@" >> "${log}"\ncase "$*" in\n  "plugin list --json") echo '[]' ;;\n  "plugin marketplace list --json") echo '[]' ;;\nesac\nexit 0\n`,
  )
  chmodSync(fake, 0o755)
  const run = spawnSync(process.execPath, [join(ROOT, 'installer', 'cli.mjs'), '--only', 'workbench', '--yes'], {
    env: { ...process.env, CLAUDE_BIN: fake },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  const calls = readFileSync(log, 'utf8').trim().split('\n')
  assert.deepEqual(calls, [
    'plugin list --json',
    'plugin marketplace list --json',
    'plugin marketplace add swperb/claude-code-themes',
    'plugin install workbench@claude-code-themes --scope user',
  ])
})
