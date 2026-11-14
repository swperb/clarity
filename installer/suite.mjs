// Pure logic for the suite installer: no process, no terminal, easy to test.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SOURCE = 'swperb/claude-code-themes'
export const SCOPES = ['user', 'project', 'local']

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

/** The `claude` argument vector for one step. */
export function commandFor(step, marketplace, scope) {
  const id = `${step.name}@${marketplace}`
  return ['plugin', step.action, id, '--scope', scope]
}

/** What starts checked in the picker: everything on a first install, else what's enabled now. */
export function initialSelection(catalog, state) {
  const enabled = catalog.plugins.filter(p => state.get(p.name)?.enabled).map(p => p.name)
  return new Set(state.size === 0 ? catalog.plugins.map(p => p.name) : enabled)
}

/** More than one theme selected: only one can paint at a time. */
export function themeConflict(catalog, selected) {
  const themes = catalog.plugins.filter(p => p.kind === 'theme' && selected.has(p.name)).map(p => p.name)
  return themes.length > 1 ? themes : undefined
}

export const HELP = `Claude Code suite installer

  npx github:${SOURCE}                 pick what to install (everything is checked)
  npx github:${SOURCE} config          change what's installed later (same picker)

Options
  --all                 install or enable everything, no picker
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
