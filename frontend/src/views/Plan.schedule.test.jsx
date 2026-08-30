import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stateFixture = () => ({
  routines: [
    { id: 'manual', name: 'Meu treino', emoji: 'dumbbell', ex: [] },
    { id: 'personal', name: 'Treino do Personal', emoji: 'clipboard', ex: [], _personalProgramId: 'personal-plan' },
    { id: 'ai', name: 'Treino IA', emoji: 'sparkles', ex: [], _aiGenerated: true },
  ],
  week: { 1: 'manual' },
  sourceSchedules: {
    personal: [{ planId: 'personal-plan', version: 2, label: 'Hipertrofia', active: true, week: { 1: 'personal' } }],
    ai: [{ planId: 'ai-plan', version: 3, label: 'Plano IA v3', active: true, week: { 1: 'ai' } }],
  },
})
const harness = vi.hoisted(() => ({
  state: null,
  user: null,
  navigate: vi.fn(),
  update: vi.fn(),
  dayAssignSheet: vi.fn(),
  loadStarterPlan: vi.fn(),
  generateAiRoutineSheet: vi.fn(),
  api: vi.fn(),
  dispatchEvent: vi.fn(),
}))

const findElement = (node, predicate) => {
  if (!React.isValidElement(node)) return null
  if (predicate(node)) return node
  for (const child of React.Children.toArray(node.props.children)) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ key: 'test', state: null }),
  useNavigate: () => harness.navigate,
}))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: harness.state, user: harness.user, update: harness.update }) }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: harness.dayAssignSheet,
  generateAiRoutineSheet: harness.generateAiRoutineSheet,
  loadStarterPlan: harness.loadStarterPlan,
  planToolsSheet: vi.fn(),
}))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name, ...props }) => <i data-icon={name} {...props} /> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: value => value, DEFAULT_GLYPH: 'dumbbell' }))
vi.mock('../lib/format.js', () => ({ DAYN: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], exCount: String, uid: () => 'new' }))
vi.mock('../lib/api.js', () => ({ api: harness.api }))
vi.mock('../lib/i18n.js', () => ({
  t: (message, ...args) => {
    const pt = {
      'Build workout with AI': 'Montar treino com IA',
      'Create your week with AI': 'Montar treino com IA',
      'Set up my AI workout': 'Montar treino com IA',
      'Push Day': 'Dia de Empurrar',
      'Pull Day': 'Dia de Puxar',
      'Leg Day': 'Dia de Pernas',
    }
    return args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), pt[message] || message)
  },
}))
vi.mock('./AiPlanCard.jsx', () => ({ default: () => null }))

import Plan from './Plan.jsx'

describe('Plan weekly schedule', () => {
  beforeEach(() => {
    harness.state = stateFixture()
    harness.user = null
    harness.navigate.mockReset()
    harness.dayAssignSheet.mockReset()
    harness.generateAiRoutineSheet.mockReset()
    harness.api.mockReset()
    harness.loadStarterPlan.mockReset()
    harness.dispatchEvent.mockReset()
    harness.update.mockReset().mockImplementation(recipe => recipe(harness.state))
    vi.stubGlobal('window', { dispatchEvent: harness.dispatchEvent })
    vi.stubGlobal('CustomEvent', class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail }
    })
  })

  it('shows manual, Personal and AI options on the same day', () => {
    const markup = renderToStaticMarkup(<Plan />)
    const schedule = markup.split('plan-week-list')[1].split('plan-routine-heading')[0]
    const monday = schedule.match(/<button[\s\S]*?<\/button>/)?.[0] || ''

    expect(monday).toContain('Meu treino')
    expect(monday).toContain('Treino do Personal')
    expect(monday).toContain('Treino IA')
    expect(monday).toContain('source-personal')
    expect(monday).toContain('source-ai')
  })

  it('creates a manual routine only after choosing the manual option', () => {
    const tree = Plan()
    const button = findElement(tree, element => element.props.children === 'New' && typeof element.props.onClick === 'function')

    button.props.onClick()
    harness.generateAiRoutineSheet.mock.calls[0][0].onManual()

    expect(harness.state.routines.at(-1)).toEqual({ id: 'new', name: 'New routine', emoji: 'dumbbell', ex: [] })
    expect(harness.navigate).toHaveBeenCalledWith('/plan/r/new')
  })

  it('opens manual or AI choices before creating a new routine', () => {
    const tree = Plan()
    const button = findElement(tree, element => element.props.children === 'New' && typeof element.props.onClick === 'function')

    button.props.onClick()

    expect(harness.state.routines).toHaveLength(3)
    expect(harness.navigate).not.toHaveBeenCalled()
    expect(harness.generateAiRoutineSheet).toHaveBeenCalledWith(expect.objectContaining({
      onManual: expect.any(Function),
      onAi: expect.any(Function),
    }))
  })

  it('requires login before opening the AI routine flow', () => {
    const tree = Plan()
    const button = findElement(tree, element => element.props.children === 'New' && typeof element.props.onClick === 'function')

    button.props.onClick()
    harness.generateAiRoutineSheet.mock.calls[0][0].onAi({ focus: 'legs' })

    expect(harness.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'first:account',
      detail: { mode: 'login' },
    }))
    expect(harness.state.routines).toHaveLength(3)
  })

  it('adds an AI-generated editable routine for the selected focus', async () => {
    harness.user = { id: 'student-1', name: 'Ana' }
    harness.api.mockResolvedValue({
      routine: {
        id: 'ai-suggested',
        name: 'Pernas IA',
        ex: [{ id: '0043', sets: 4, reps: 8 }],
        _aiSuggested: true,
        sourceType: 'ai',
        readOnly: false,
      },
    })
    const tree = Plan()
    const button = findElement(tree, element => element.props.children === 'New' && typeof element.props.onClick === 'function')

    button.props.onClick()
    await harness.generateAiRoutineSheet.mock.calls[0][0].onAi({ focus: 'legs' })

    expect(harness.state.routines.at(-1)).toEqual(expect.objectContaining({
      id: 'ai-suggested',
      name: 'Pernas IA',
      _aiSuggested: true,
      sourceType: 'ai',
      readOnly: false,
    }))
    expect(harness.api).toHaveBeenCalledWith('/api/ai/routine', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ focus: 'legs' }),
    }))
    expect(harness.navigate).toHaveBeenCalledWith('/plan/r/ai-suggested')
  })

  it('applies a coalesced AI routine response only once', async () => {
    harness.user = { id: 'student-1', name: 'Ana' }
    harness.api.mockResolvedValue({
      routine: { id: 'ai-shared', name: 'Pernas IA', ex: [] },
    })
    const tree = Plan()
    const button = findElement(tree, element => element.props.children === 'New' && typeof element.props.onClick === 'function')

    button.props.onClick()
    const onAi = harness.generateAiRoutineSheet.mock.calls[0][0].onAi
    await Promise.all([onAi({ focus: 'legs' }), onAi({ focus: 'legs' })])

    expect(harness.state.routines.filter(routine => routine.id === 'ai-shared')).toHaveLength(1)
  })

  it('translates legacy starter routine names when rendering existing data', () => {
    harness.state = {
      ...stateFixture(),
      routines: [
        { id: 'push', name: 'Push Day', emoji: 'barbell', ex: [] },
        { id: 'pull', name: 'Pull Day', emoji: 'pullup', ex: [] },
        { id: 'legs', name: 'Leg Day', emoji: 'legs', ex: [] },
      ],
      week: { 1: 'push' },
      sourceSchedules: { personal: [], ai: [] },
    }

    const markup = renderToStaticMarkup(<Plan />)

    expect(markup).toContain('Dia de Empurrar')
    expect(markup).toContain('Dia de Puxar')
    expect(markup).toContain('Dia de Pernas')
    expect(markup).not.toMatch(/Push Day|Pull Day|Leg Day/i)
  })

  it('opens the selected weekday and offers AI setup instead of a PPL starter for an empty schedule', () => {
    const populatedTree = Plan()
    const monday = findElement(populatedTree, element => element.type === 'button' && element.props.className === 'item')
    monday.props.onClick()
    expect(harness.dayAssignSheet).toHaveBeenCalledWith(1)

    harness.state = { ...stateFixture(), routines: [], week: {}, sourceSchedules: { personal: [], ai: [] } }
    const emptyTree = Plan()
    const aiSetup = findElement(emptyTree, element => element.props.children === 'Montar treino com IA')
    const markup = renderToStaticMarkup(emptyTree)

    expect(markup).toContain('No routines yet.')
    expect(markup).toContain('Rest day')
    expect(markup).toContain('Montar treino com IA')
    expect(markup).not.toMatch(/PPL|Push\s*\/\s*Pull\s*\/\s*Legs/i)
    expect(aiSetup).toBeDefined()
    expect(aiSetup.props.icon).toBe('sparkles')
    expect(harness.loadStarterPlan).not.toHaveBeenCalled()
  })
})
