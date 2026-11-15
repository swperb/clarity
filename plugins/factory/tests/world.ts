// What Factory's engine tests share: a ledger entry, and a world of files and answers.
import type { On, ThemeSetArgs } from 'claude-code'
import { mock } from 'claude-code/testing'

import type { Entry } from '../types'

export const NOW = 1_800_000_000_000
export const MIN = 60_000
export const BASE = '/home/me/.claude/factory'

export function entry(over: Partial<Entry>): Entry {
  return {
    v: 1,
    id: 'x',
    project: 'atlas',
    repo: '/code/atlas/.git',
    root: '/code/atlas',
    branch: 'main',
    state: 'working',
    task: '',
    startedAt: NOW - 30 * MIN,
    since: NOW - 5 * MIN,
    heartbeatAt: NOW - MIN,
    cost: 1,
    context: 20,
    files: [],
    limits: [],
    ...over,
  }
}

export type World = { files: Map<string, string>; opened: string[]; usd: number }

export function world(on: On, id = 'me', cwd = '/code/atlas'): World {
  const w: World = { files: new Map(), opened: [], usd: 0.5 }
  mock.env(on, { HOME: '/home/me' })
  mock.store(on)
  on('session.id', () => ({ value: id }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200000, percent: 12 }, rateLimits: [{ kind: 'five_hour', percentUsed: 31 }], cost: { usd: w.usd } },
  }))
  on('process.run', (_, e) => ({
    value:
      e.argv[1] === 'rev-parse'
        ? { exitCode: 0, stdout: `${cwd}\n${cwd}/.git\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.exists', (_, e) => ({ value: [...w.files.keys()].some(p => p === e.path || p.startsWith(`${e.path}/`)) }))
  on('fs.list', (_, e) => ({
    value: [...w.files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })),
  }))
  on('fs.read', (_, e) => ({ value: w.files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => (w.files.set(e.path, e.text), { value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_, e) => (w.opened.push(e.id), { value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.StopFailure', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', () => ({ result: {} }))
  themes(on)
  return w
}

/**
 * Factory hooks `theme.set`, so its hooks load only where `$.theme` exists. From
 * engine 2.1.321 it is core and a test answers its events; older test kits have
 * none, so one is added for them too (the newer kit skips that).
 */
export function themes(on: On): void {
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'theme' } }))
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
  on('engine.create', async (_, e, next) => ({
    ...(await next(e)),
    theme: {
      set: async (_look: ThemeSetArgs) => ({ isDrawn: true as const, requestId: 'theme' }),
      clear: async () => ({ isDrawn: false as const, reason: 'cleared' }),
    },
  }))
}

export const START = { cwd: '/code/atlas', surface: 'desktop', isInteractive: true } as const
export const composer = { kind: 'composer' } as const
