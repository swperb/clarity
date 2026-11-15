// What Factory's floor and its home pane share: where the files live, and the ledger.
import type { EngineInterface as Engine } from 'claude-code'

import type { Entry } from '../types'
import { parseEntry } from './lib'

// ── The ledger on disk ──────────────────────────────────────────────────────

/** `~/.claude/factory`, or under `$CLAUDE_CONFIG_DIR` when set. */
export async function factoryDir($: Engine): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const base = config !== undefined && config !== '' ? config : `${home ?? '~'}/.claude`
  return `${base.replace(/\/+$/, '')}/factory`
}

export async function ledgerDir($: Engine): Promise<string> {
  return `${await factoryDir($)}/sessions`
}

export async function readLedger($: Engine): Promise<Entry[]> {
  const dir = await ledgerDir($)
  if (!(await $.fs.exists(dir))) {
    return []
  }
  const names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && /^[\w-]+\.json$/.test(f.name))
  const parsed = await Promise.all(
    names.map(f =>
      $.fs
        .read(`${dir}/${f.name}`)
        .then(text => (typeof text === 'string' ? parseEntry(text) : undefined))
        .catch(() => undefined),
    ),
  )
  return parsed.filter((e): e is Entry => e !== undefined)
}
