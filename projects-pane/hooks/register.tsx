import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Dashboard, Draft, Repo } from '../types'

const PANE = 'projects'
const TITLE = 'Projects'

const dashboard = atom({ plugin: 'projects-pane', key: 'dashboard' } as const, null, { shape: 'dashboard-2' })
const category = atom({ plugin: 'projects-pane', key: 'category' } as const, null)
const draft = atom({ plugin: 'projects-pane', key: 'draft' } as const, null)

const TYPES = ['feat', 'fix', 'chore'] as const

/* mirrors a typical new-feature branch script: "ABC-123 outbound retry" -> abc-123-outbound-retry, no ticket -> YYYYMMDD-slug */
function branchName(type: string, text: string, now: number) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const hasTicket = /^[A-Za-z]+-\d+$/.test(words[0] ?? '')
  const ticket = hasTicket ? words.shift()!.toLowerCase() : new Date(now).toISOString().slice(0, 10).replace(/-/g, '')
  const slug = words
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug ? `${type}/${ticket}-${slug}` : null
}

const ink = { blue: '#4493f8', purple: '#a371f7', amber: '#d29922' }

const icon = (path: string, stroke: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`

const folderPath = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
const folderIcon = icon(folderPath, ink.blue)
const categoryIcon = icon(folderPath, ink.amber)
const branchIcon = icon('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/>', ink.purple)

async function readRepo($: EngineInterface, path: string): Promise<Repo> {
  const [status, log] = await Promise.all([
    $.process.run(['git', '-C', path, 'status', '--porcelain', '--branch'], { timeoutMs: 5000 }),
    $.process.run(['git', '-C', path, 'log', '-1', '--format=%ct%x09%s'], { timeoutMs: 5000 }),
  ])
  const [head, ...rest] = status.exitCode === 0 ? status.stdout.split('\n') : []
  const branch = head ? head.replace(/^## /, '').replace(/^No commits yet on /, '').split('...')[0] ?? null : null
  const [time, ...subject] = log.exitCode === 0 ? log.stdout.trim().split('\t') : []

  return {
    path,
    branch,
    isDirty: rest.some(line => line.trim() !== ''),
    committedAt: Number(time ?? 0) * 1000,
    subject: subject.join('\t'),
  }
}

async function scan($: EngineInterface) {
  const [home, cwd] = await Promise.all([$.env.get('HOME'), $.session.cwd()])
  const root = `${home ?? ''}/Projects`
  await update($, dashboard, prev => ({
    home: home ?? '',
    root,
    cwd,
    repos: prev?.repos ?? [],
    isLoading: true,
    scannedAt: prev?.scannedAt ?? 0,
  }))

  const found = await $.process.run(['find', root, '-maxdepth', '4', '-type', 'd', '-name', '.git', '-prune'], {
    timeoutMs: 10_000,
  })
  /* hidden folders under the root (worktrees, tool caches) are not projects */
  const paths = found.stdout
    .split('\n')
    .filter(line => line.endsWith('/.git'))
    .map(line => line.slice(0, -'/.git'.length))
    .filter(path => !path.slice(root.length).split('/').some(part => part.startsWith('.')))
  const repos = (await Promise.all(paths.map(path => readRepo($, path)))).sort((a, b) => b.committedAt - a.committedAt)
  const now = await $.clock.now()

  await update($, dashboard, prev => ({ ...(prev ?? { home: '', root, cwd }), repos, isLoading: false, scannedAt: now }))
}

const tildify = (path: string, home: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)

/* the first folder under the root; a repo sitting at the root's first level is its own category */
const categoryOf = (path: string, root: string) => path.slice(root.length + 1).split('/')[0] ?? ''

function ago(ms: number, now: number) {
  if (!ms) return ''
  const m = Math.max(0, Math.floor((now - ms) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'projects', description: 'Open the Projects dashboard pane' })
    void open($)
    void scan($)
    return result
  })

  on('command.run', { command: 'projects' }, async $ => {
    await open($)
    await scan($)
    return { text: 'Projects pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const Input = 'Input' in ui ? ui.Input : null
    const Select = 'Select' in ui ? ui.Select : null
    const [d, selected, form] = await Promise.all([read($, dashboard), read($, category), read($, draft)])
    const now = d?.scannedAt || 0

    const glyph = (source: string, alt: string) => (Svg ? <Svg source={source} alt={alt} width={14} height={14} /> : null)

    const insert = (path: string) => () =>
      void $.prompt.fill({ text: `${path} `, mode: 'insert' }).then(r => {
        if (!r.isFilled) $.ui.toast(path)
      })

    const newSession = (path: string) => () =>
      void $.prompt.submit({
        text: `Start a new Claude Code session in ${path} (start_session with cwd set to that folder). Do nothing else.`,
        asUser: true,
      })

    const setDraft = (next: Draft | null) => void update($, draft, () => next)

    const createWorktree = (path: string, type: string, text: string) =>
      void $.clock.now().then(time => {
        const branch = branchName(type, text, time)
        if (!branch) {
          $.ui.toast('Type a slug, e.g. ABC-123 outbound-retry')
          return
        }
        setDraft(null)
        void $.prompt.submit({
          text: `Start a new Claude Code session in ${path} in a new worktree (start_session with cwd set to that folder, use_worktree true, branch_name ${branch}, cut from develop if the repo has it, else its default branch). Do nothing else.`,
          asUser: true,
        })
      })

    const choose = (name: string | null) => () => void update($, category, () => name)

    const name = (path: string) => path.slice(path.lastIndexOf('/') + 1)

    const skeleton = (
      <Box flexDirection="column" gap="sm">
        <Text size="caption" color="subtle">▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭</Text>
        <Text size="caption" color="subtle">▭▭▭▭▭▭▭▭▭▭▭▭</Text>
        <Text size="caption" color="subtle">▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭</Text>
      </Box>
    )

    if (d === null) {
      return <Box padding={1}>{skeleton}</Box>
    }

    const branchLine = (repo: Repo) => (
      <Box flexDirection="row" alignItems="center" gap="xs">
        {glyph(branchIcon, 'Branch')}
        <Text size="caption" color="merged" weight="medium">{repo.branch ?? 'no branch'}</Text>
        {repo.isDirty ? <Text size="caption" color="warning">● changes</Text> : <Text size="caption" color="success">✓ clean</Text>}
      </Box>
    )

    const current = d.repos.find(r => d.cwd === r.path || d.cwd.startsWith(`${r.path}/`))

    const currentCard = (
      <Box flexDirection="column" gap="xs" padding={1} borderStyle="round" borderColor="suggestion">
        <Text size="caption" color="subtle" weight="medium">CURRENT FOLDER</Text>
        <Box flexDirection="row" alignItems="center" gap="sm">
          {glyph(folderIcon, 'Folder')}
          <Text size="heading" color="suggestion" weight="semibold" wrap="truncate-end">{name(d.cwd)}</Text>
        </Box>
        <Text size="caption" mono color="subtle" wrap="truncate-start">{tildify(d.cwd, d.home)}</Text>
        {current ? branchLine(current) : null}
        {current?.subject ? (
          <Text size="caption" color="subtle" wrap="truncate-end">
            {current.subject} · {ago(current.committedAt, now)}
          </Text>
        ) : null}
      </Box>
    )

    const groups = new Map<string, Repo[]>()
    for (const repo of d.repos) {
      const key = categoryOf(repo.path, d.root)
      groups.set(key, [...(groups.get(key) ?? []), repo])
    }

    const header = (title: string, back: boolean) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="row" alignItems="center" gap="sm">
          {back ? <Button key="back" label="← Projects" plain onPress={choose(null)} /> : null}
          <Text size="caption" color="subtle" weight="medium">
            {title} {d.isLoading ? '· scanning…' : ''}
          </Text>
        </Box>
        <Button key="refresh" label="Refresh" plain onPress={() => void scan($)} />
      </Box>
    )

    const repos = selected === null ? null : groups.get(selected) ?? []

    if (repos === null) {
      const categories = [...groups.entries()]
      return (
        <Box flexDirection="column" gap="md" padding={1}>
          {currentCard}
          {header(`PROJECTS · ${categories.length} folders`, false)}
          {d.isLoading && categories.length === 0 ? skeleton : null}
          <Box flexDirection="column" gap="sm">
            {categories.map(([key, list]) => {
              const dirty = list.filter(r => r.isDirty).length
              const isHere = d.cwd.startsWith(`${d.root}/${key}`)
              return (
                <Box
                  key={`cat:${key}`}
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                  gap="sm"
                  padding={1}
                  borderStyle="round"
                  borderColor={isHere ? 'suggestion' : 'promptBorder'}
                >
                  <Box flexDirection="column" gap="xs" flexShrink={1}>
                    <Box flexDirection="row" alignItems="center" gap="sm">
                      {glyph(categoryIcon, 'Folder')}
                      <Text weight="semibold" color="text">{key}</Text>
                    </Box>
                    <Text size="caption" color="subtle">
                      {list.length} {list.length === 1 ? 'repo' : 'repos'}
                      {dirty > 0 ? <Text color="warning"> · {dirty} with changes</Text> : null}
                      {list[0] ? ` · ${ago(list[0].committedAt, now)}` : ''}
                    </Text>
                  </Box>
                  <Button key={`open:${key}`} label="Open →" variant="secondary" onPress={choose(key)} />
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="md" padding={1}>
        {header(`${selected ?? ''} · ${repos.length}`, true)}
        <Box flexDirection="column" gap="sm">
          {repos.map(repo => {
            const isHere = repo === current
            return (
              <Box
                key={`repo:${repo.path}`}
                flexDirection="column"
                gap="xs"
                padding={1}
                borderStyle="round"
                borderColor={isHere ? 'suggestion' : 'promptBorder'}
              >
                <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
                  <Text weight="semibold" color={isHere ? 'suggestion' : 'text'} wrap="truncate-end">
                    {name(repo.path)}
                    {isHere ? <Text size="caption" color="subtle"> · you are here</Text> : null}
                  </Text>
                  <Text size="caption" color="subtle" tabular>{ago(repo.committedAt, now)}</Text>
                </Box>
                <Text size="caption" mono color="subtle" wrap="truncate-start">{tildify(repo.path, d.home)}</Text>
                {branchLine(repo)}
                {repo.subject ? <Text size="caption" color="subtle" wrap="truncate-end">{repo.subject}</Text> : null}
                <Box flexDirection="row" gap="sm" flexWrap="wrap">
                  <Button key={`new:${repo.path}`} label="New session" variant="primary" onPress={newSession(repo.path)} />
                  {Input && Select ? (
                  <Button
                    key={`wt:${repo.path}`}
                    label="New worktree"
                    variant="secondary"
                    onPress={() => setDraft(form?.path === repo.path ? null : { path: repo.path, type: 'feat', text: '' })}
                  />
                  ) : null}
                  <Button key={`insert:${repo.path}`} label="Insert path" plain onPress={insert(repo.path)} />
                </Box>
                {form?.path === repo.path && Input && Select ? (
                  <Box flexDirection="column" gap="xs" paddingTop={1}>
                    <Box flexDirection="row" gap="sm" alignItems="center">
                      <Select
                        key={`wt-type:${repo.path}`}
                        value={form.type}
                        options={TYPES.map(t => ({ value: t, label: t }))}
                        onSelect={type => setDraft({ ...form, type })}
                      />
                      <Input
                        key={`wt-text:${repo.path}`}
                        placeholder="ABC-123 outbound-retry"
                        value={form.text}
                        submitLabel="Create"
                        autoFocus
                        onInput={text => setDraft({ ...form, text })}
                        onSubmit={text => createWorktree(repo.path, form.type, text)}
                      />
                    </Box>
                    <Text size="caption" mono color={branchName(form.type, form.text, now) ? 'merged' : 'subtle'}>
                      → {branchName(form.type, form.text, now) ?? `${form.type}/<ticket>-<slug>  ·  no ticket: ${form.type}/YYYYMMDD-<slug>`}
                    </Text>
                    <Box flexDirection="row" gap="sm">
                      <Button
                        key={`wt-go:${repo.path}`}
                        label="Create worktree"
                        variant="primary"
                        onPress={() => createWorktree(repo.path, form.type, form.text)}
                      />
                      <Button key={`wt-cancel:${repo.path}`} label="Cancel" plain onPress={() => setDraft(null)} />
                    </Box>
                  </Box>
                ) : null}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
