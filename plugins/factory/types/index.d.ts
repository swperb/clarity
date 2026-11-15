export type Feature = 'ledger' | 'notify' | 'tint' | 'radar' | 'home'

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
  /** The plan's rate-limit windows as this session last read them (account-wide). */
  limits: Limit[]
}

/** One rate-limit window: `five_hour`, `seven_day`, a gateway's `spend_limit`. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// ── Home: what happened while you were away ─────────────────────────────────

/**
 * done: a turn finished with an answer.
 * question: Claude asked you something. blocked: it waited on a permission,
 * was denied, or hit a limit. failed: a turn ended on an error.
 * commit / push: git work it did.
 */
export type JournalKind = 'done' | 'question' | 'blocked' | 'failed' | 'commit' | 'push'

export type JournalEvent = {
  at: number
  kind: JournalKind
  /** One line, nothing injected, nothing internal. */
  text: string
  /** question / blocked: when it was answered or cleared; absent while open. */
  resolvedAt?: number
  /** done: files the turn edited, relative to the checkout. */
  files?: string[]
  /** done: what the turn cost in dollars. */
  cost?: number
  /** done: how long the turn ran. */
  durationMs?: number
}

/** One session's journal: `<factory>/journal/<id>.json`. */
export type Journal = {
  v: 1
  id: string
  project: string
  branch: string | null
  events: JournalEvent[]
}

/**
 * The person's presence, shared by every session: `<factory>/presence.json`.
 * Away (hibernating) while `awaySince` is set and `backAt` is not.
 */
export type Presence = {
  v: 1
  /** The last time the person did anything in any session. */
  lastSeenAt: number
  /** When the stretch of absence the briefing covers began; null when briefed. */
  awaySince: number | null
  /** When they came back from it; null while still away. */
  backAt: number | null
  /** When they last dismissed a briefing. */
  briefedAt: number | null
}

/** What a turn is gathering for its `done` line. */
export type TurnLog = { startedAt: number; costAtStart: number | null; files: string[] }

/**
 * A theme another plugin set, kept so the tint can lie over it: `ThemeSetArgs`
 * as stored (the contract can't import it, so its shape is spelled out loosely).
 */
export type BaseTheme = {
  backdrop?: object
  overrideColorScheme?: 'light' | 'dark'
  colors?: {
    v: 1
    id?: string
    label: string
    inputs: { light?: Record<string, `#${string}`>; dark?: Record<string, `#${string}`> }
    codeTheme?: { light?: string; dark?: string }
    contrast?: 'more'
  }
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
      journal: Shaped<Journal | null>
      journals: Shaped<Journal[]>
      turnLog: Shaped<TurnLog | null>
      presence: Shaped<Presence | null>
      isHomeOpen: boolean
      homeOpenedFor: number | null
      homeView: 'away' | 'today'
      baseTheme: Shaped<BaseTheme | null>
    }
  }
}
