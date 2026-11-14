export type Feature = 'band' | 'guard' | 'changes' | 'usage' | 'status'

export type Features = Record<Feature, boolean>

export type ChangedFile = {
  path: string
  adds: number
  dels: number
  edits: number
  isNew: boolean
  at: number
}

export type TestRun = { command: string; isPassing: boolean; at: number }

export type GitState = { branch: string; dirty: number; ahead: number; behind: number }

export type ContextRow = { name: string; tokens: number; kind: string }

export type UsageView = {
  startedAt: number
  now: number
  usd?: number
  percent?: number
  tokens?: number
  window: number
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  rows?: ContextRow[]
}

declare module 'claude-code' {
  interface PluginState {
    workbench: {
      features: Features
      files: Shaped<ChangedFile[]>
      tests: Shaped<TestRun | null>
      git: Shaped<GitState | null>
      context: number | null
      isPaneOpened: boolean
      usage: Shaped<UsageView | null>
      isUsageOpen: boolean
    }
  }
}
