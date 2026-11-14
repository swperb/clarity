#!/usr/bin/env node
// Installs the suite's plugins into Claude Code, all at once or a la carte.
// Zero dependencies: it drives the `claude plugin` CLI you already have.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HELP,
  LEGACY_MARKETPLACE,
  legacySteps,
  readLegacy,
  SOURCE,
  commandFor,
  initialSelection,
  parseArgs,
  plan,
  readCatalog,
  readState,
  themeConflict,
} from './suite.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLAUDE = process.env.CLAUDE_BIN || 'claude'
const tty = process.stdout.isTTY && process.stdin.isTTY
const paint = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text)
const bold = t => paint('1', t)
const dim = t => paint('2', t)
const green = t => paint('32', t)
const red = t => paint('31', t)
const accent = t => paint('36', t)

function claude(args, { quiet = false } = {}) {
  const run = spawnSync(CLAUDE, args, { encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'pipe', 'pipe'] })
  if (run.error) {
    throw new Error(`Couldn't run \`${CLAUDE}\`. Is Claude Code installed and on your PATH? (${run.error.message})`)
  }
  return run
}

function fail(message) {
  console.error(red(`✗ ${message}`))
  process.exit(1)
}

// ── The picker ──────────────────────────────────────────────────────────────

function pick(catalog, state, selected) {
  return new Promise(resolve => {
    let cursor = 0
    let drawn = 0
    const rows = catalog.plugins
    const out = process.stdout

    const draw = () => {
      if (drawn > 0) {
        out.write(`\x1b[${drawn}A\x1b[0J`)
      }
      const lines = []
      let lastKind
      rows.forEach((p, i) => {
        if (p.kind !== lastKind) {
          lines.push(dim(p.kind === 'theme' ? '  Themes' : '  Plugins'))
          lastKind = p.kind
        }
        const on = selected.has(p.name)
        const now = state.get(p.name)
        const status = !now ? '' : now.enabled ? dim(' installed') : dim(' disabled')
        const pointer = i === cursor ? accent('❯') : ' '
        const box = on ? green('◉') : dim('○')
        const name = i === cursor ? bold(p.name) : p.name
        lines.push(`${pointer} ${box} ${name}${status}`)
        if (i === cursor) {
          lines.push(dim(`      ${p.description}`))
        }
      })
      const conflict = themeConflict(catalog, selected)
      lines.push('')
      if (conflict) {
        lines.push(paint('33', `  Only one theme paints at a time; the last loaded wins (${conflict.join(', ')}).`))
      }
      lines.push(dim('  ↑/↓ move · space toggle · a all · n none · enter apply · q quit'))
      out.write(`${lines.join('\n')}\n`)
      drawn = lines.length
    }

    const done = value => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onKey)
      resolve(value)
    }

    const onKey = buf => {
      const key = buf.toString()
      if (key === '\u0003' || key === 'q' || key === '\u001b') {
        return done(undefined)
      }
      if (key === '\r' || key === '\n') {
        return done(selected)
      }
      if (key === '\u001b[A' || key === 'k') {
        cursor = (cursor - 1 + rows.length) % rows.length
      } else if (key === '\u001b[B' || key === 'j') {
        cursor = (cursor + 1) % rows.length
      } else if (key === ' ') {
        const name = rows[cursor].name
        selected.has(name) ? selected.delete(name) : selected.add(name)
      } else if (key === 'a') {
        rows.forEach(p => selected.add(p.name))
      } else if (key === 'n') {
        selected.clear()
      }
      draw()
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onKey)
    draw()
  })
}

function confirm(question) {
  return new Promise(resolve => {
    process.stdout.write(`${question} ${dim('[Y/n]')} `)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.once('data', buf => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      const key = buf.toString().toLowerCase()
      process.stdout.write('\n')
      resolve(key !== 'n' && key !== 'q' && key !== '\u0003' && key !== '\u001b')
    })
  })
}

// ── Main ────────────────────────────────────────────────────────────────────

/** `update`: refresh the marketplace, then update each installed plugin. `uninstall`: remove them all. */
async function lifecycle(args, catalog, state) {
  const installed = [...state.entries()]
  if (installed.length === 0) {
    console.log(dim(`No Clarity plugins are installed. Install with: npx github:${SOURCE}`))
    return
  }
  const updating = args.command === 'update'
  const verb = updating ? 'update' : 'uninstall'
  console.log(`\n${bold(updating ? 'Update' : 'Uninstall')}: ${installed.map(([n]) => n).join(', ')}`)
  const commands = installed.map(([name, s]) => ['plugin', verb, `${name}@${catalog.marketplace}`, '--scope', s.scope && s.scope !== 'synced' ? s.scope : args.scope])
  if (updating) {
    commands.unshift(['plugin', 'marketplace', 'update', catalog.marketplace])
  } else {
    commands.push(['plugin', 'marketplace', 'remove', catalog.marketplace])
  }
  if (args.dryRun) {
    console.log(dim('Dry run. These would run:'))
    commands.forEach(c => console.log(dim(`  ${CLAUDE} ${c.join(' ')}`)))
    return
  }
  if (!args.yes && tty && !(await confirm(`\n${updating ? 'Update' : 'Remove'} ${installed.length} plugin(s)?`))) {
    console.log(dim('Nothing changed.'))
    return
  }
  let failed = 0
  for (const c of commands) {
    const run = claude(c, { quiet: true })
    const label = c.slice(1, 3).join(' ')
    if (run.status === 0) {
      console.log(`${green('✓')} ${label}`)
    } else {
      failed += 1
      console.log(`${red('✗')} ${label}\n${dim((run.stderr || run.stdout).trim())}`)
    }
  }
  console.log(failed === 0 ? `\n${green('Done.')} Start a new Claude Code session to load the changes.` : `\n${red(`${failed} step(s) failed.`)}`)
  process.exit(failed === 0 ? 0 : 1)
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    fail(error.message)
  }
  if (args.help) {
    console.log(HELP)
    return
  }

  const catalog = readCatalog(ROOT)
  const listed = claude(['plugin', 'list', '--json'], { quiet: true })
  const state = readState(listed.status === 0 ? listed.stdout : '[]', catalog.marketplace)
  const legacy = readLegacy(listed.status === 0 ? listed.stdout : '[]')
  if (legacy.length > 0) {
    console.log(dim(`Found ${legacy.length} plugin(s) installed under the old name "${LEGACY_MARKETPLACE}"; they move to "${catalog.marketplace}".`))
  }

  if (args.command === 'update' || args.command === 'uninstall') {
    return lifecycle(args, catalog, state)
  }

  if (args.list) {
    for (const p of catalog.plugins) {
      const now = state.get(p.name)
      const status = !now ? dim('not installed') : now.enabled ? green('installed') : dim('disabled')
      console.log(`${bold(p.name.padEnd(12))} ${dim(p.kind.padEnd(7))} ${status}\n  ${dim(p.description)}`)
    }
    return
  }

  const unknown = (args.only ?? []).filter(n => !catalog.plugins.some(p => p.name === n))
  if (unknown.length > 0) {
    fail(`Not in this suite: ${unknown.join(', ')}. Available: ${catalog.plugins.map(p => p.name).join(', ')}`)
  }

  let selected
  if (args.all) {
    selected = new Set(catalog.plugins.map(p => p.name))
  } else if (args.only) {
    selected = new Set(args.only)
  } else if (tty) {
    console.log(`\n${bold('Clarity')} ${dim(`· ${SOURCE}`)}\n`)
    selected = await pick(catalog, state, initialSelection(catalog, state, legacy))
    if (selected === undefined) {
      console.log(dim('Nothing changed.'))
      return
    }
  } else {
    selected = initialSelection(catalog, state, legacy) // Not a terminal: first run installs everything.
  }

  const steps = [...plan(catalog, state, selected, { remove: args.remove }), ...legacySteps(legacy)]
  if (steps.length === 0) {
    console.log(green('✓ Already set up that way. Nothing to change.'))
    return
  }

  const verbs = { install: green('install'), enable: green('enable'), disable: dim('disable'), uninstall: red('uninstall'), 'uninstall-legacy': dim('remove old copy of') }
  console.log(`\n${bold('Plan')} ${dim(`(scope: ${args.scope})`)}`)
  steps.forEach(s => console.log(`  ${verbs[s.action]} ${s.name}`))

  if (args.dryRun) {
    console.log(`\n${dim('Dry run. These would run:')}`)
    console.log(dim(`  ${CLAUDE} plugin marketplace add ${SOURCE}   (or update, if already added)`))
    steps.forEach(s => console.log(dim(`  ${CLAUDE} ${commandFor(s, catalog.marketplace, args.scope).join(' ')}`)))
    return
  }
  if (!args.yes && tty && !(await confirm('\nApply?'))) {
    console.log(dim('Nothing changed.'))
    return
  }

  // Make sure the marketplace is there and current, so new plugins install.
  const markets = claude(['plugin', 'marketplace', 'list', '--json'], { quiet: true })
  const hasMarket = markets.status === 0 && JSON.parse(markets.stdout || '[]').some(m => m.name === catalog.marketplace)
  const market = hasMarket
    ? claude(['plugin', 'marketplace', 'update', catalog.marketplace], { quiet: true })
    : claude(['plugin', 'marketplace', 'add', SOURCE], { quiet: true })
  if (market.status !== 0) {
    fail(`Couldn't ${hasMarket ? 'update' : 'add'} the marketplace ${SOURCE}:\n${market.stderr || market.stdout}`)
  }

  let failed = 0
  for (const step of steps) {
    // Old-name copies are removed only once every new install has worked,
    // so a failure never leaves you with neither.
    if (step.action === 'uninstall-legacy' && failed > 0) {
      console.log(dim(`· kept old copy of ${step.name} (an install above failed)`))
      continue
    }
    const run = claude(commandFor(step, catalog.marketplace, args.scope), { quiet: true })
    const label = step.action === 'uninstall-legacy' ? `removed old ${step.id}` : `${step.action} ${step.name}`
    if (run.status === 0) {
      console.log(`${green('✓')} ${label}`)
    } else {
      failed += 1
      console.log(`${red('✗')} ${label}\n${dim((run.stderr || run.stdout).trim())}`)
    }
  }
  if (legacy.length > 0 && failed === 0) {
    const removed = claude(['plugin', 'marketplace', 'remove', LEGACY_MARKETPLACE], { quiet: true })
    console.log(removed.status === 0 ? `${green('✓')} removed old marketplace ${LEGACY_MARKETPLACE}` : dim(`· old marketplace ${LEGACY_MARKETPLACE} left in place`))
  }

  console.log(
    failed === 0
      ? `\n${green('Done.')} Start a new Claude Code session to load the changes.\nChange your picks any time: ${accent(`npx github:${SOURCE} config`)}`
      : `\n${red(`${failed} step(s) failed.`)} Nothing else was changed.`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(error => fail(error.message))
