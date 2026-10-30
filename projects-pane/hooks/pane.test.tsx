import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'projects-pane',
  component: 'Pane',
  requestId: 'projects',
  props: {
    title: 'Projects',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const run = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('the pane groups projects by folder and opens one on every surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('command.register', () => ({ value: { command: 'projects' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: '/Users/me/Projects/acme/web-app' }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('clock.now', () => ({ value: 1_000_000_000_000 }))
  on('process.run', (_, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('find')) {
      return run(
        [
          '/Users/me/Projects/acme/web-app/.git',
          '/Users/me/Projects/other-repo/.git',
          '/Users/me/Projects/.loop-worktrees/x/.git',
        ].join('\n'),
      )
    }
    if (argv.includes('status')) {
      return argv.includes('other-repo') ? run('## main...origin/main\n') : run('## develop\n M a.ts\n')
    }
    return run('999996400\tfeat: add band\n')
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'projects' } as Parameters<typeof $.command.run>[0])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^web-app$/ }))?.text).toBe('web-app')
    expect((await ui.find({ type: 'Text', text: /^acme$/ }))?.text).toBe('acme')
    expect((await ui.find({ type: 'Text', text: /^other-repo$/ }))?.text).toBe('other-repo')
    expect(await ui.find({ type: 'Text', text: /loop-worktrees/ })).toBeUndefined()

    await ui.press({ key: 'open:acme' })
    expect((await ui.find({ type: 'Text', text: /you are here/ }))?.text).toContain('web-app')
    expect((await ui.find({ type: 'Text', text: /changes/ }))?.text).toBe('● changes')
    expect(await ui.find({ type: 'Button', key: 'new:/Users/me/Projects/acme/web-app' })).toBeDefined()

    await ui.press({ key: 'back' })
    await ui.unmount()
  }

  const repo = '/Users/me/Projects/acme/web-app'
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open:acme' })
  await ui.press({ key: `wt:${repo}` })
  await ui.input({ key: `wt-text:${repo}`, text: 'ABC-123 Outbound retry!', kind: 'change' })
  expect((await ui.find({ type: 'Text', text: /→/ }))?.text).toBe('→ feat/abc-123-outbound-retry')
  await ui.select({ key: `wt-type:${repo}`, value: 'fix' })
  await ui.input({ key: `wt-text:${repo}`, text: 'login bug', kind: 'change' })
  expect((await ui.find({ type: 'Text', text: /→/ }))?.text).toBe('→ fix/20010909-login-bug')
  await ui.press({ key: `wt-go:${repo}` })
  expect(sent[0]).toContain(`${repo} in a new worktree`)
  expect(sent[0]).toContain('branch_name fix/')
  expect(await ui.find({ type: 'Text', text: /→/ })).toBeUndefined()
  await ui.unmount()
})
