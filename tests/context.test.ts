import { expect, mock, test } from 'claude-code/testing'

import { CTX_HUE, ctxColor, ctxGlyph, ctxPct, ringSvg } from '../hooks/cache-art'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

test('the context gauge turns blue, then yellow, then red as the window fills', async () => {
  expect(ctxColor(0)).toBe(CTX_HUE.blue)
  expect(ctxColor(49)).toBe(CTX_HUE.blue)
  expect(ctxColor(50)).toBe(CTX_HUE.yellow)
  expect(ctxColor(79)).toBe(CTX_HUE.yellow)
  expect(ctxColor(80)).toBe(CTX_HUE.red)
  expect(ctxColor(100)).toBe(CTX_HUE.red)
  expect(ctxPct(0, 200000)).toBeNull()
  expect(ctxPct(50000, 0)).toBeNull()
  expect(ctxPct(250000, 200000)).toBe(100)
  expect(ringSvg(90)).toContain(`stroke="${CTX_HUE.red}"`)
  expect(ringSvg(0)).toContain('stroke-dasharray="0 ')
  expect(ctxGlyph(10)).toBe('○')
  expect(ctxGlyph(50)).toBe('◑')
  expect(ctxGlyph(100)).toBe('●')
})

test('the gauge reads the engine before the first reply, stacks when squeezed, and clears with the session', async ($, on) => {
  let tokens: number | undefined = 300000
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  // No reply yet, so no cache: the gauge still shows.
  const wide = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await wide.findAll({ type: 'Svg' })).map(s => s.props.alt)).toEqual(['Context 30% used'])
  // With no cache yet, the gauge closes the row after the last window.
  const row = JSON.stringify(await wide.find({ type: 'Box' }))
  expect(row.indexOf('"key":"w-1"')).toBeGreaterThan(-1)
  expect(row.indexOf('"key":"ctx"')).toBeGreaterThan(row.indexOf('"key":"w-1"'))
  await wide.unmount()

  // 84 columns would be one row without the gauge; with it, the windows stack.
  const half = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 84 } })
  expect(await half.find({ text: '30%' })).toBeDefined()
  expect(await half.find({ text: '82% left' })).toBeDefined()
  await half.unmount()

  tokens = undefined
  await $.classic.SessionStart({ source: 'clear' })
  const cleared = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await cleared.findAll({ type: 'Svg' })).toEqual([])
  await cleared.unmount()
})

test('in a tight band the gauge leads the cache row', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 60, context_tokens: 450000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 40 } })
  const row = JSON.stringify(await band.find({ key: 'cache' }))
  expect(row).toContain('Context 45% used')
  expect(row.indexOf('Context 45% used')).toBeLessThan(row.indexOf('Robo'))
  await band.unmount()
})

for (const [tokens, pct, hue] of [
  [100000, 10, CTX_HUE.blue],
  [600000, 60, CTX_HUE.yellow],
  [900000, 90, CTX_HUE.red],
] as const) {
  test(`at ${pct}% the ring sits between the windows and the cache in its colour`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NOW })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
    on('classic.SessionStart', () => ({}))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 60, context_tokens: tokens, model: 'claude-opus-5-5' })

    const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const svgs = await band.findAll({ type: 'Svg' })
    expect(svgs[0]?.props.alt).toBe(`Context ${pct}% used`)
    expect(String(svgs[0]?.props.source)).toContain(`stroke="${hue}"`)
    const all = JSON.stringify(await band.find({ type: 'Box' }))
    // The gauge's box comes after the last window and before the cache badge.
    expect(all.indexOf('"key":"w-1"')).toBeGreaterThan(-1)
    expect(all.indexOf('"key":"ctx"')).toBeGreaterThan(all.indexOf('"key":"w-1"'))
    expect(all.indexOf('"key":"inline"')).toBeGreaterThan(-1)
    expect(all.indexOf('"key":"ctx"')).toBeLessThan(all.indexOf('"key":"inline"'))
    await band.unmount()
  })
}
