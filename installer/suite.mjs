// Pure logic for the suite installer: no process, no terminal, easy to test.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SOURCE = 'swperb/clarity'
export const SCOPES = ['user', 'project', 'local']

// The suite was first published as the `claude-code-themes` marketplace, with
// the theme named `clarity`. Installs under those names move to the new ones.
export const LEGACY_MARKETPLACE = 'claude-code-themes'
const LEGACY_RENAMES = { clarity: 'clarity-theme' }

/** Plugins installed from the old marketplace: { id, name (current name), enabled, scope }. */
export function readLegacy(listJson) {
  const found = []
  for (const entry of JSON.parse(listJson || '[]')) {
    const [old, market] = String(entry.id ?? '').split('@')
    if (market === LEGACY_MARKETPLACE && old) {
      found.push({ id: entry.id, name: LEGACY_RENAMES[old] ?? old, enabled: entry.enabled !== false, scope: entry.scope })
    }
  }
  return found
}

/** Steps that uninstall the old-name copies, run after the new ones are installed. */
export function legacySteps(legacy) {
  return legacy.map(l => ({ action: 'uninstall-legacy', name: l.name, id: l.id, scope: l.scope }))
}

/** The plugins this repo offers, from its marketplace file. */
export function readCatalog(root) {
  const market = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
  return {
    marketplace: market.name,
    plugins: market.plugins.map(p => ({
      name: p.name,
      description: p.description ?? '',
      kind: String(p.source).includes('/themes/') ? 'theme' : 'plugin',
    })),
  }
}

/** name → { installed, enabled } for this marketplace's plugins, from `claude plugin list --json`. */
export function readState(listJson, marketplace) {
  const state = new Map()
  for (const entry of JSON.parse(listJson || '[]')) {
    const [name, market] = String(entry.id ?? '').split('@')
    if (market === marketplace && name) {
      state.set(name, { installed: true, enabled: entry.enabled !== false, scope: entry.scope })
    }
  }
  return state
}

/**
 * The steps that take the current state to the selection.
 * Unselecting an installed plugin disables it (its data stays) unless `remove` is set.
 */
export function plan(catalog, state, selected, { remove = false } = {}) {
  const steps = []
  for (const { name } of catalog.plugins) {
    const now = state.get(name)
    const wanted = selected.has(name)
    if (wanted && !now) {
      steps.push({ action: 'install', name })
    } else if (wanted && now && !now.enabled) {
      steps.push({ action: 'enable', name })
    } else if (!wanted && now && remove) {
      steps.push({ action: 'uninstall', name })
    } else if (!wanted && now?.enabled) {
      steps.push({ action: 'disable', name })
    }
  }
  return steps
}

/** One argument quoted for cmd.exe: wrapped in quotes when it holds spaces or cmd's special characters. */
export function cmdQuote(arg) {
  const s = String(arg)
  return /[\s"&|<>^%()!]/.test(s) || s === '' ? `"${s.replace(/"/g, '""')}"` : s
}

/** The `claude` argument vector for one step. */
export function commandFor(step, marketplace, scope) {
  if (step.action === 'uninstall-legacy') {
    return ['plugin', 'uninstall', step.id, '--scope', step.scope && step.scope !== 'synced' ? step.scope : scope]
  }
  const id = `${step.name}@${marketplace}`
  return ['plugin', step.action, id, '--scope', scope]
}

/** What starts checked in the picker: everything (one theme) on a first install, else what's enabled now. */
export function initialSelection(catalog, state, legacy = []) {
  if (legacy.length > 0 && state.size === 0) {
    // Moving from the old names: keep exactly what was enabled there.
    return new Set(legacy.filter(l => l.enabled).map(l => l.name).filter(n => catalog.plugins.some(p => p.name === n)))
  }
  const enabled = catalog.plugins.filter(p => state.get(p.name)?.enabled).map(p => p.name)
  return state.size === 0 ? everything(catalog) : new Set(enabled)
}

/**
 * Everything, as a first install and `--all` mean it: every plugin and one theme,
 * the first listed (the Clarity theme). Only one theme paints, so the others are
 * there to pick, not to install by default.
 */
export function everything(catalog) {
  const firstTheme = catalog.plugins.find(p => p.kind === 'theme')
  return new Set(catalog.plugins.filter(p => p.kind !== 'theme' || p === firstTheme).map(p => p.name))
}

/** More than one theme selected: only one can paint at a time. */
export function themeConflict(catalog, selected) {
  const themes = catalog.plugins.filter(p => p.kind === 'theme' && selected.has(p.name)).map(p => p.name)
  return themes.length > 1 ? themes : undefined
}

export const HELP = `Clarity installer

  npx github:${SOURCE}                 pick what to install (every plugin and the Clarity theme are checked)
  npx github:${SOURCE} config          change what's installed later (same picker)
  npx github:${SOURCE} update          update every installed Clarity plugin to the latest
  npx github:${SOURCE} uninstall       remove every Clarity plugin and the marketplace

Options
  --all                 install or enable every plugin and the Clarity theme, no picker
  --only a,b            install or enable just these (others are disabled)
  --remove              uninstall what you uncheck instead of disabling it
  --scope <scope>       user (default), project or local
  --list                show what's available and installed
  --dry-run             print the claude commands without running them
  -y, --yes             apply without the confirmation question
  -h, --help            this help

In the picker: ↑/↓ or j/k move, space toggles, a selects all, n selects none,
enter applies, q quits.`

/** Parses argv (without node and the script). Throws a readable Error on bad input. */
export function parseArgs(argv) {
  const out = { command: 'install', all: false, only: undefined, remove: false, scope: 'user', list: false, dryRun: false, yes: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case 'config':
      case 'install':
      case 'update':
      case 'uninstall':
        out.command = arg
        break
      case '--all':
        out.all = true
        break
      case '--remove':
        out.remove = true
        break
      case '--list':
        out.list = true
        break
      case '--dry-run':
        out.dryRun = true
        break
      case '-y':
      case '--yes':
        out.yes = true
        break
      case '-h':
      case '--help':
        out.help = true
        break
      case '--only':
      case '--scope': {
        const value = argv[i + 1]
        if (value === undefined || value.startsWith('-')) {
          throw new Error(`${arg} needs a value`)
        }
        i += 1
        if (arg === '--only') {
          out.only = value.split(',').map(s => s.trim()).filter(Boolean)
        } else if (SCOPES.includes(value)) {
          out.scope = value
        } else {
          throw new Error(`--scope must be one of ${SCOPES.join(', ')}`)
        }
        break
      }
      default:
        throw new Error(`Unknown option: ${arg}. Run with --help.`)
    }
  }
  if (out.all && out.only) {
    throw new Error('Use --all or --only, not both')
  }
  return out
}
