export type Feature = 'ledger' | 'notify' | 'tint' | 'radar'

export type Features = Record<Feature, boolean>

/** working: a turn runs. waiting: the turn ended and the session waits on you. */
export type SessionState = 'working' | 'waiting' | 'idle' | 'failed' | 'ended'

/** One session's line in the shared ledger: `<ledger>/<id>.json`. */
export type Entry = {
  v: 1
  id: string
  /** Display name: the repository's folder (shared by its worktrees), else the cwd's. */
  project: string
  /** What makes two sessions "the same repo": git's common dir, else the cwd. */
  repo: string
  /** The checkout's top folder; edited files are stored relative to it. */
  root: string
  branch: string | null
  state: SessionState
  /** First line of the latest prompt. */
  task: string
  startedAt: number
  /** When `state` last changed: how long it has been working, or waiting on you. */
  since: number
  /** Rewritten every minute while the session lives; older than 10 min means gone. */
  heartbeatAt: number
  cost: number | null
  context: number | null
  /** Files this session edited, relative to `root`, newest first. */
  files: string[]
}

/** Where this session sits, worked out once at start. */
export type Place = { project: string; repo: string; root: string; branch: string | null }

/** Another session in the same repo that edited a file this one edited. */
export type Collision = { file: string; otherId: string; otherBranch: string | null; otherTask: string }

declare module 'claude-code' {
  interface PluginState {
    factory: {
      features: Features
      self: Shaped<Entry | null>
      floor: Shaped<Entry[]>
      collisions: Shaped<Collision[]>
      dismissed: string[]
      isPaneOpen: boolean
      notifiedCount: number | null
    }
  }
}
