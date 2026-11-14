// Distribution checks: every marketplace entry is a real, complete plugin,
// and the installer's update/uninstall commands drive the right claude calls.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { fakeClaude } from './fake-claude.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
const SEMVER = /^\d+\.\d+\.\d+$/

test('the marketplace is named, described and owned', () => {
  assert.equal(market.name, 'clarity')
  assert.ok(market.description?.length > 20)
  assert.ok(market.owner?.name)
})

for (const entry of market.plugins) {
  test(`${entry.name}: a complete plugin at ${entry.source}`, () => {
    const dir = join(ROOT, entry.source)
    const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.equal(manifest.name, entry.name, 'marketplace name matches plugin.json')
    assert.match(manifest.version, SEMVER)
    assert.equal(manifest.license, 'MIT')
    assert.equal(manifest.repository, 'https://github.com/swperb/clarity')
    assert.ok(manifest.description?.length > 20, 'has a description')
    assert.ok(existsSync(join(dir, 'README.md')), 'has a README')
    assert.ok(existsSync(join(dir, manifest.icon ?? '.claude-plugin/icon.png')), 'has an icon')
    const hooks = JSON.parse(readFileSync(join(dir, 'hooks', 'hooks.json'), 'utf8'))
    for (const module of hooks.modules) {
      assert.ok(existsSync(join(dir, 'hooks', module)), `hooks module ${module} exists`)
    }
  })
}

test('every plugin in the suite shares one version', () => {
  const versions = new Set(market.plugins.map(e =>
    JSON.parse(readFileSync(join(ROOT, e.source, '.claude-plugin', 'plugin.json'), 'utf8')).version))
  assert.equal(versions.size, 1, `versions: ${[...versions].join(', ')}`)
})

const run = (fake, ...args) =>
  spawnSync(process.execPath, [join(ROOT, 'installer', 'cli.mjs'), ...args], { env: { ...process.env, CLAUDE_BIN: fake }, encoding: 'utf8' })

test('update refreshes the marketplace, then each installed plugin', () => {
  const { bin: fake, calls } = fakeClaude({
    installed: [
      { id: 'workbench@clarity', enabled: true, scope: 'user' },
      { id: 'studio@clarity', enabled: false, scope: 'project' },
    ],
    markets: [{ name: 'clarity' }],
  })
  assert.equal(run(fake, 'update', '--yes').status, 0)
  assert.deepEqual(calls().slice(1), [
    'plugin marketplace update clarity',
    'plugin update workbench@clarity --scope user',
    'plugin update studio@clarity --scope project',
  ])
})

test('uninstall removes every plugin, then the marketplace', () => {
  const { bin: fake, calls } = fakeClaude({ installed: [{ id: 'clarity-theme@clarity', enabled: true, scope: 'user' }], markets: [{ name: 'clarity' }] })
  assert.equal(run(fake, 'uninstall', '--yes').status, 0)
  assert.deepEqual(calls().slice(1), [
    'plugin uninstall clarity-theme@clarity --scope user',
    'plugin marketplace remove clarity',
  ])
})
