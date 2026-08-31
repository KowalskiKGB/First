import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  t: (message, ...args) => {
    const pt = {
      'Hi {0}': 'Olá, {0}',
      'Hello, {0}': 'Olá, {0}',
      'Hello!': 'Olá!',
      'Sign in': 'Faça login',
      'This week': 'Esta semana',
      'Training rhythm': 'Ritmo de treino',
      'Build workout with AI': 'Montar treino com IA',
      'Create your week with AI': 'Montar treino com IA',
      'Set up my AI workout': 'Montar treino com IA',
      'Rest day': 'Dia de descanso',
      'Leg Day': 'Dia de Pernas',
      'Select your gym': 'Selecione sua academia',
    }
    return args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), pt[message] || message)
  },
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

function elementText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!React.isValidElement(node)) return ''
  return React.Children.toArray(node.props.children).map(elementText).join('')
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
  afterEach(() => vi.unstubAllGlobals())

  it('keeps two same-day sessions in the total without restoring a weekly fraction', () => {
    harness.state.workouts = [
      { id: 'manual-session', d: '2026-08-31', entries: [] },
      { id: 'ai-session', d: '2026-08-31', sourceType: 'ai', entries: [] },
    ]

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('2 workouts total')
    expect(markup).not.toMatch(/>\s*1\s*\/\s*1\s*this week/)
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
    expect(markup).toContain('aria-label="Monday 31 August: rescheduled workout AI Monday"')
    expect(markup).not.toContain('<div class="ttl">Rest day')
    expect(markup).toContain('class="dot ovr"')
  })

  it('renders the calendar days, today session and history card as native buttons', () => {
    const markup = renderToStaticMarkup(<Home />)

    expect(markup.match(/<button[^>]*class="wday/g)).toHaveLength(7)
    expect(markup).toMatch(/<button[^>]*class="today-row"/)
    expect(markup).toMatch(/<button[^>]*class="card tappable"/)
    expect(markup).toContain('aria-label="Monday 31 August: planned workout Manual Monday"')
    expect(markup).toContain('aria-label="Open training calendar"')
  })

  it('greets a signed-in student by name instead of showing the product name', () => {
    harness.user = { id: 'student-1', name: 'Ana Souza' }

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('Olá, Ana Souza')
    expect(markup).not.toMatch(/<h1[^>]*>Workout<\/h1>/)
  })

  it('greets a guest and presents a prominent sign-in call to action', () => {
    const tree = Home()
    const markup = renderToStaticMarkup(tree)
    const signIn = findElements(tree, element => ['button', 'a'].includes(element.type) && elementText(element).includes('Faça login'))[0]

    expect(markup).toContain('Faça login')
    expect(markup).not.toContain('class="sub capitalize"')
    expect(signIn).toBeDefined()
    expect(markup).not.toMatch(/<h1[^>]*>Workout<\/h1>/)
  })

  it('presents the current week and AI workout invitation as distinct cards', () => {
    harness.user = { id: 'student-1', name: 'Ana' }
    harness.state = { ...baseState(), routines: [], week: {} }

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('home-week-card')
    expect(markup).toContain('home-ai-card')
    expect(markup).toContain('Esta semana')
    expect(markup).toContain('Montar treino com IA')
    expect(markup).not.toMatch(/PPL|Push\s*\/\s*Pull\s*\/\s*Legs/i)
  })

  it('keeps one compact week label without a progress fraction or duplicate heading', () => {
    harness.state.workouts = []

    const markup = renderToStaticMarkup(<Home />)

    expect(markup.match(/Esta semana/g)).toHaveLength(1)
    expect(markup).not.toContain('home-card-heading')
    expect(markup).not.toMatch(/>\s*0\s*\/\s*1\s*</)
    expect(markup).not.toContain('id="home-week-title"')
  })

  it('keeps AI readiness descriptive without a numeric fraction', () => {
    harness.user = { id: 'student-1', name: 'Ana' }

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('home-ai-readiness')
    expect(markup).not.toMatch(/>\s*\d+\s*\/\s*4\s*</)
  })

  it('uses one divider between the week rail and today action', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const rule = selector => css.match(new RegExp(`${selector.replaceAll('.', '\\.')}\\s*\\{([^}]+)\\}`))?.[1] || ''
    const railRule = rule('.home-week-rail')
    const todayRule = rule('.home-week-card .today-row')

    expect(railRule).not.toMatch(/border-block\s*:/)
    expect(railRule).not.toMatch(/border-bottom\s*:/)
    expect(todayRule.match(/border-top\s*:/g) || []).toHaveLength(1)
  })

  it('lets a guest open the gym directory without requiring authentication first', () => {
    const tree = Home()
    const gymAction = findElements(tree, element => (
      ['button', 'a'].includes(element.type)
      && elementText(element).includes('Selecione sua academia')
    ))[0]

    expect(gymAction).toBeDefined()
    expect(elementText(gymAction)).toContain('Selecione sua academia')
    if (gymAction.props.onClick) {
      gymAction.props.onClick()
      expect(harness.navigate).toHaveBeenCalledWith('/academias')
    } else {
      expect(gymAction.props.to).toBe('/academias')
    }
  })

  it('uses one compact AI CTA and removes the generic training-rhythm copy', () => {
    harness.user = { id: 'student-1', name: 'Ana' }
    harness.state = { ...baseState(), routines: [], week: {} }

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).not.toContain('Ritmo de treino')
    expect(markup.match(/Montar treino com IA/g)).toHaveLength(1)
  })

  it('renders the week as compact cards with accessible training states', () => {
    harness.state.workouts = [{ id: 'done', d: '2026-09-01', entries: [] }]
    harness.state.dayPlan = { '2026-09-02': 'rest' }

    const tree = Home()
    const days = findElements(tree, element => String(element.props.className || '').includes('home-week-day-card'))

    expect(days).toHaveLength(7)
    expect(days.map(day => day.props['aria-label'])).toEqual([
      'Monday 31 August: planned workout Manual Monday',
      'Tuesday 1 September: completed',
      'Wednesday 2 September: rest day selected',
      'Thursday 3 September: rest day',
      'Friday 4 September: rest day',
      'Saturday 5 September: rest day',
      'Sunday 6 September: rest day',
    ])
  })

  it('sends guests to authentication instead of allowing direct AI setup', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal('CustomEvent', class CustomEvent {
      constructor(type, init) {
        this.type = type
        this.detail = init?.detail
      }
    })
    const tree = Home()
    const aiAction = findElements(tree, element => elementText(element).includes('Montar treino com IA') && (element.props.to || element.props.onClick))[0]

    expect(aiAction).toBeDefined()
    aiAction.props.onClick()
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'first:account', detail: { mode: 'login' } })
    expect(harness.navigate).not.toHaveBeenCalled()
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

  it('opens AI setup instead of loading a PPL starter, while keeping the manual, goal and weight actions', () => {
    harness.user = { id: 'student-1', name: 'Ana' }
    harness.state = { ...baseState(), routines: [], week: {} }
    const tree = Home()
    const action = label => findElements(tree, element => element.props.children === label && typeof element.props.onClick === 'function')[0]

    const aiAction = action('Montar treino com IA')
    expect(aiAction).toBeDefined()
    expect(aiAction.props.icon).toBe('sparkles')
    aiAction.props.onClick()
    action('Build my own plan').props.onClick()
    action('Goal').props.onClick()
    action('Log').props.onClick()

    expect(harness.loadStarterPlan).not.toHaveBeenCalled()
    expect(harness.navigate).toHaveBeenCalledWith('/plan', { state: { openAi: true } })
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

    expect(markup).toContain('Olá, Ana')
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
    expect(markup).toContain('Dia de descanso')
    expect(markup).not.toContain('Dia De Descanso')
  })

  it('translates legacy routine names on the home schedule and today action', () => {
    harness.state = {
      ...baseState(),
      routines: [{ ...manualRoutine, name: 'Leg Day' }],
    }

    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('Dia de Pernas')
    expect(markup).not.toContain('Leg Day')
  })
})
