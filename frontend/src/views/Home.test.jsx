import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  state: null,
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => harness.navigate }))
vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: harness.state, user: null }),
}))
vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'en-GB',
  t: (message, ...args) => args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), message),
}))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(),
  startFlow: vi.fn(), loadStarterPlan: vi.fn(), bwDeltaColor: vi.fn(),
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => <div data-chart /> }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children }) => <button>{children}</button> }))
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

describe('Home schedule summary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00'))
    harness.navigate.mockReset()
    harness.state = baseState()
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
})
