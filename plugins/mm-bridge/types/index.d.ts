export type MmMarkdown = string

declare module 'claude-code' {
  interface PluginState {
    'mm-bridge': { view: MmMarkdown; queue: MmMarkdown }
  }
}
