import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'folder-band',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('the band shows the folder path and branch on every surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/me/Projects/acme/web-app' }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 439_600, window: 1_000_000, percent: 44 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 82 }],
    },
  }))
  on('clock.now', () => ({ value: 3_600_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '## develop...origin/develop\n M a.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /web-app/ }))?.text).toContain('~/Projects/acme/web-app')
    expect((await ui.find({ type: 'Text', text: /develop/ }))?.text).toContain('●')
    expect((await ui.find({ type: 'Text', text: /82%/ }))?.text).toBe('82%')
    await ui.unmount()
  }
})
