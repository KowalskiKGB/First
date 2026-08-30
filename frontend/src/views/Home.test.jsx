import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  state: null,
  user: null,
  weekOffset: 0,
  navigate: vi.fn(),
  setWeekOffset: vi.fn(),
  bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(),
  startFlow: vi.fn(), loadStarterPlan: vi.fn(), bwDeltaColor: vi.fn(),
}))

vi.mock('react', async importOriginal => ({ ...(await importOriginal()), useState: initial => [harness.weekOffset ?? initial, harness.setWeekOffset] }))
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => harness.navigate,
}))
vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: harness.state, user: harness.user }),
}))
vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'en-GB',
  t: (message, ...args) => args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), message),
}))
vi.mock('../sheets.jsx', () => ({
  bwSheet: harness.bwSheet, goalSheet: harness.goalSheet, dayOverrideSheet: harness.dayOverrideSheet, calendarSheet: harness.calendarSheet,
  startFlow: harness.startFlow, loadStarterPlan: harness.loadStarterPlan, bwDeltaColor: harness.bwDeltaColor,
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => <div data-chart /> }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: () => 'barbell' }))
vi.mock('../lib/demo.js', () => ({ APP_NAME: 'Workout' }))

import Home from './Home.jsx'

const manualRoutine = { id: 'manual', name: 'Manual Monday', emoji: 'barbell', ex: [] }
const baseState = () => ({
  routines: [manualRoutine],
  week: { 1: 'manual' },
  dayPlan: {},
  sourceSchedules: { ai: [], personal: [] },
  workouts: [],
  bodyweight: [],
  targetW: null,
  unit: 'kg',
  active: null,
  exWeights: {},
})

function findElements(node, predicate, found = []) {
  if (!React.isValidElement(node)) return found
  if (predicate(node)) found.push(node)
  React.Children.forEach(node.props.children, child => findElements(child, predicate, found))
  return found
}

describe('Home schedule summary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00'))
    Object.values(harness).filter(value => typeof value?.mockReset === 'function').forEach(mock => mock.mockReset())
    harness.state = baseState()
    harness.user = null
    harness.weekOffset = 0
  })

  afterAll(() => vi.useRealTimers())

  it('counts a date once in weekly adherence when two sessions were completed that day', () => {
    harness.state.workouts = [
      { id: 'manual-session', d: '2026-08-31', entries: [] },
      { id: 'ai-session', d: '2026-08-31', sourceType: 'ai', entries: [] },
    ]

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('>1 / 1 this week')
    expect(markup).toContain('2 workouts total')
  })

  it('shows a real managed option even when rest is stored as the day preference', () => {
    const aiRoutine = { id: 'ai-monday', name: 'AI Monday', emoji: 'sparkles', ex: [] }
    harness.state = {
      ...baseState(),
      routines: [aiRoutine],
      week: {},
      dayPlan: { '2026-08-31': 'rest' },
      sourceSchedules: {
        personal: [],
        ai: [{ sourceType: 'ai', planId: 'plan-1', version: 1, active: true, week: { 1: 'ai-monday' } }],
      },
    }

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('AI Monday')
    expect(markup).not.toContain('Rest day')
    expect(markup).toContain('class="dot ovr"')
  })

  it('renders the calendar days, today session and history card as native buttons', () => {
    const markup = renderToStaticMarkup(<Home />)

    expect(markup.match(/<button[^>]*class="wday/g)).toHaveLength(7)
    expect(markup).toMatch(/<button[^>]*class="today-row"/)
    expect(markup).toMatch(/<button[^>]*class="card tappable"/)
    expect(markup).toContain('aria-label="Open training calendar"')
  })

  it('executes keyboard button actions for navigation, week paging and calendar dates', () => {
    const tree = Home()
    const byLabel = label => findElements(tree, element => element.props['aria-label'] === label)[0]

    byLabel('Settings').props.onClick()
    byLabel('Previous week').props.onClick()
    const previous = harness.setWeekOffset.mock.calls[0][0]
    byLabel('Next week').props.onClick()
    const next = harness.setWeekOffset.mock.calls[1][0]
    findElements(tree, element => String(element.props.className || '').startsWith('wday'))[0].props.onClick()
    byLabel('Open training calendar').props.onClick()

    expect(harness.navigate).toHaveBeenCalledWith('/settings')
    expect(previous(3)).toBe(2)
    expect(next(3)).toBe(4)
    expect(harness.dayOverrideSheet).toHaveBeenCalledWith('2026-08-31')
    expect(harness.calendarSheet).toHaveBeenCalledOnce()
  })

  it('starts, resumes or reschedules today according to the current state', () => {
    findElements(Home(), element => element.props.className === 'today-row')[0].props.onClick()
    expect(harness.startFlow).toHaveBeenCalledOnce()

    harness.state = { ...baseState(), active: { name: 'Sessão ativa' } }
    findElements(Home(), element => element.props.className === 'today-row')[0].props.onClick()
    expect(harness.navigate).toHaveBeenCalledWith('/workout')

    harness.state = { ...baseState(), routines: [], week: {} }
    findElements(Home(), element => element.props.className === 'today-row')[0].props.onClick()
    expect(harness.dayOverrideSheet).toHaveBeenCalledWith('2026-08-31')
  })

  it('runs starter, custom-plan, goal and weight actions from their real controls', () => {
    harness.state = { ...baseState(), routines: [], week: {} }
    const tree = Home()
    const action = label => findElements(tree, element => element.props.children === label && typeof element.props.onClick === 'function')[0]

    action('Load starter plan (PPL)').props.onClick()
    action('Build my own plan').props.onClick()
    action('Goal').props.onClick()
    action('Log').props.onClick()

    expect(harness.loadStarterPlan).toHaveBeenCalledOnce()
    expect(harness.navigate).toHaveBeenCalledWith('/plan')
    expect(harness.goalSheet).toHaveBeenCalledOnce()
    expect(harness.bwSheet).toHaveBeenCalledOnce()
  })

  it('renders the personalized, rescheduled and bodyweight result branches', () => {
    harness.user = { name: 'Ana' }
    harness.weekOffset = 1
    harness.state = {
      ...baseState(), dayPlan: { '2026-08-31': 'manual' }, aiLastGeneration: { version: 4 }, targetW: 70,
      bodyweight: [{ d: '2026-08-24', w: 68 }, { d: '2026-08-31', w: 70 }], workouts: [{ id: 'one', d: '2026-08-31' }],
    }

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('Hi Ana')
    expect(markup).toContain('rescheduled')
    expect(markup).toContain('Version 4 is active')
    expect(markup).toContain('reached!')
    expect(markup).toContain('1 workout total')
    expect(harness.bwDeltaColor).toHaveBeenCalledWith(2, 70)
  })

  it('renders gain, loss and rest-day bodyweight branches', () => {
    harness.state = { ...baseState(), routines: [], week: {}, targetW: 80, bodyweight: [{ d: '2026-08-31', w: 70 }] }
    expect(renderToStaticMarkup(<Home />)).toContain('10 kg to gain')

    harness.state = { ...harness.state, targetW: 60 }
    const markup = renderToStaticMarkup(<Home />)
    expect(markup).toContain('10 kg to lose')
    expect(markup).toContain('Rest day')
  })
})
