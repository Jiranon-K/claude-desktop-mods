import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Info, Limit } from '../types'

const info = atom({ plugin: 'folder-band', key: 'info' } as const, null)

const empty: Info = {
  model: '',
  effort: null,
  cwd: '',
  branch: null,
  isDirty: false,
  startedAt: 0,
  now: 0,
  tokens: null,
  window: 0,
  percent: null,
  limits: [],
}

const patch = ($: EngineInterface, fields: Partial<Info>) =>
  update($, info, prev => ({ ...(prev ?? empty), ...fields }))

const toLimits = (raw: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Limit[] =>
  raw.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt ?? null }))

async function readGit($: EngineInterface, cwd: string) {
  const r = await $.process.run(['git', 'status', '--porcelain', '--branch'], { cwd, timeoutMs: 3000 })
  if (r.exitCode !== 0) return { branch: null, isDirty: false }
  const [head, ...rest] = r.stdout.split('\n')
  const branch = (head ?? '').replace(/^## /, '').replace(/^No commits yet on /, '').split('...')[0]
  return { branch, isDirty: rest.some(line => line.trim() !== '') }
}

async function refresh($: EngineInterface) {
  const [cwd, model, usage] = await Promise.all([$.session.cwd(), $.session.model(), $.session.usage()])
  const git = await readGit($, cwd)
  await patch($, {
    cwd,
    model,
    ...git,
    startedAt: usage.startedAt,
    now: await $.clock.now(),
    tokens: usage.context.tokens ?? null,
    window: usage.context.window,
    percent: usage.context.percent ?? null,
    limits: toLimits(usage.rateLimits),
  })
}

const tildify = (path: string, home: string) =>
  home && path.startsWith(home) ? `~${path.slice(home.length)}` : path

function duration(ms: number) {
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

const level = (percent: number) => (percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'subtle')

const ink = { blue: '#4493f8', purple: '#a371f7', green: '#3fb950', warning: '#d29922', error: '#e5534b' }

const icon = (path: string, stroke: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`

const folderIcon = icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', ink.blue)
const branchIcon = icon('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/>', ink.purple)

const meter = (percent: number, accent: string, title: string) => {
  const w = Math.round((Math.max(0, Math.min(100, percent)) / 100) * 28)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="12" viewBox="0 0 28 12"><title>${title}</title><rect y="5" width="28" height="3" rx="1.5" fill="#8b8b8b" fill-opacity="0.25"/><rect y="5" width="${w}" height="3" rx="1.5" fill="${level(percent) === 'subtle' ? accent : ink[level(percent) as 'warning' | 'error']}"/></svg>`
}

function resetsIn(iso: string | null, now: number) {
  if (!iso) return ''
  const left = Date.parse(iso) - now
  return left > 0 ? `, resets in ${duration(left)}` : ''
}

export const register: Register = on => {
  let home = ''

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    home = (await $.env.get('HOME')) ?? ''
    await refresh($)
    $.clock.every(60_000, () => void $.clock.now().then(now => patch($, { now })))
    return result
  })

  on('turn.step', async function* ($, e, next) {
    void patch($, { model: e.model, effort: e.effort === undefined ? null : String(e.effort) })
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await patch($, {
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      percent: e.context.percent ?? null,
      limits: toLimits(e.rateLimits),
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, info)
    if (e.props.hasSurvey || v === null || v.cwd === '') return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null

    const path = tildify(v.cwd, home)
    const cut = path.lastIndexOf('/') + 1
    const five = v.limits.find(l => l.kind === 'five_hour')
    const week = v.limits.find(l => l.kind === 'seven_day')

    const glyph = (source: string, alt: string) =>
      Svg ? <Svg source={source} alt={alt} width={12} height={12} /> : null

    const stat = (key: string, label: string, percent: number, accent: string, title: string) => (
      <Box key={key} flexDirection="row" alignItems="center" gap="xs">
        <Text size="caption" color="subtle">{label}</Text>
        {Svg ? <Svg source={meter(percent, accent, title)} alt={title} width={28} height={12} isInteractive /> : null}
        <Text size="caption" tabular color={level(percent) === 'subtle' ? 'text' : level(percent)}>{Math.round(percent)}%</Text>
      </Box>
    )

    const stats = [
      v.percent === null
        ? null
        : stat('ctx', 'Context', v.percent, ink.green, `${compact(v.tokens ?? 0)} / ${compact(v.window)} tokens`),
      five ? stat('5h', '5h', five.percent, ink.blue, `5-hour limit${resetsIn(five.resetsAt, v.now)}`) : null,
      week ? stat('wk', 'Week', week.percent, ink.purple, `Weekly limit${resetsIn(week.resetsAt, v.now)}`) : null,
    ]

    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md" paddingX={1}>
        <Box flexDirection="row" alignItems="center" gap="sm" flexShrink={1}>
          {glyph(folderIcon, 'Folder')}
          <Text size="caption" mono wrap="truncate-start">
            <Text color="subtle">{path.slice(0, cut)}</Text>
            <Text color="suggestion" weight="semibold">{path.slice(cut)}</Text>
          </Text>
          {v.branch ? glyph(branchIcon, 'Branch') : null}
          {v.branch ? (
            <Text size="caption" color="merged" weight="medium">
              {v.branch}
              {v.isDirty ? <Text color="warning"> ●</Text> : <Text color="success"> ✓</Text>}
            </Text>
          ) : null}
        </Box>
        <Box flexDirection="row" alignItems="center" gap="md" flexShrink={0}>
          {stats}
          <Text size="caption" color="subtle">
            <Text color="claude" weight="medium">{v.model}</Text>
            {v.effort ? ` · ${v.effort}` : ''}
            {` · ${duration(Math.max(0, v.now - v.startedAt))}`}
          </Text>
        </Box>
      </Box>
    )
  })
}
