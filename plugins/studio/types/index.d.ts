/** What the viewer shows. Paths are relative to the session folder when inside it. */
export type View =
  | { kind: 'file'; path: string; source: string; startLine?: number; note?: string }
  | { kind: 'diff'; path: string; source: string; adds: number; dels: number }
  | { kind: 'created'; path: string; source: string; adds: number }
  | { kind: 'search'; tool: string; query: string; where?: string; files: string[] }
  | { kind: 'bash'; command: string; isOk: boolean; status: string; output: string }
  | { kind: 'note'; path?: string; text: string }

/** One thing Claude did, for the activity strip. */
export type Touch = {
  id: string
  /** `read`, `edit`, `search` or `run`. */
  kind: 'read' | 'edit' | 'search' | 'run'
  label: string
  path?: string
  adds?: number
  dels?: number
  isOk?: boolean
  at: number
  view: View
}

/** A tool call still running: drives the live line and the accent in the tree. */
export type Active = { id: string; verb: string; path?: string; label: string }

/** What this session did to one file. */
export type FileMark = { adds: number; dels: number; isEdited: boolean; isRead: boolean }

export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number }

export type SessionInfo = { cwd: string; folder: string; branch: string | null; model: string | null }

export type Tab = 'files' | 'viewer'

declare module 'claude-code' {
  interface PluginState {
    studio: {
      info: Shaped<SessionInfo | null>
      active: Shaped<Active[]>
      touches: Shaped<Touch[]>
      marks: Shaped<Record<string, FileMark>>
      listings: Shaped<Record<string, Entry[]>>
      expanded: Shaped<string[]>
      view: Shaped<View | null>
      isFollowing: boolean
      /** A main-loop turn is running: from turn.start (or its first tool call) to turn.complete. */
      isWorking: boolean
      tab: Tab
      canDock: boolean
      isOpened: boolean
      isAutoOpen: boolean
    }
  }
}
