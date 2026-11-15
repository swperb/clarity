/** The plugin whose theme stands in Clarity's place, or null while Clarity's own is in use. */
export type DeferTo = string | null

declare module 'claude-code' {
  interface PluginState {
    'clarity-theme': {
      deferTo: DeferTo
    }
  }
}
