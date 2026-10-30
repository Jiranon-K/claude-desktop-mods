export type Repo = {
  path: string
  branch: string | null
  isDirty: boolean
  committedAt: number
  subject: string
}

export type Dashboard = {
  home: string
  root: string
  cwd: string
  repos: Repo[]
  isLoading: boolean
  scannedAt: number
}

export type Draft = { path: string; type: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'projects-pane': { dashboard: Shaped<Dashboard | null>; category: string | null; draft: Draft | null }
  }
}
