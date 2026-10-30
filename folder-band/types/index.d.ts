export type Limit = { kind: string; percent: number; resetsAt: string | null }

export type Info = {
  model: string
  effort: string | null
  cwd: string
  branch: string | null
  isDirty: boolean
  startedAt: number
  now: number
  tokens: number | null
  window: number
  percent: number | null
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'folder-band': { info: Info | null }
  }
}
