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
  navigate: vi.fn(),
  update: vi.fn(),
  dayAssignSheet: vi.fn(),
  loadStarterPlan: vi.fn(),
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
  useNavigate: () => harness.navigate,
}))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: harness.state, update: harness.update }) }))
vi.mock('../sheets.jsx', () => ({ dayAssignSheet: harness.dayAssignSheet, loadStarterPlan: harness.loadStarterPlan, planToolsSheet: vi.fn() }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name, ...props }) => <i data-icon={name} {...props} /> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: value => value, DEFAULT_GLYPH: 'dumbbell' }))
vi.mock('../lib/format.js', () => ({ DAYN: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], exCount: String, uid: () => 'new' }))
vi.mock('../lib/i18n.js', () => ({ t: (message, ...args) => args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), message) }))
vi.mock('./AiPlanCard.jsx', () => ({ default: () => null }))

import Plan from './Plan.jsx'

describe('Plan weekly schedule', () => {
  beforeEach(() => {
    harness.state = stateFixture()
    harness.navigate.mockReset()
    harness.dayAssignSheet.mockReset()
    harness.loadStarterPlan.mockReset()
    harness.update.mockReset().mockImplementation(recipe => recipe(harness.state))
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

  it('creates a routine and opens it for editing', () => {
    const tree = Plan()
    const button = findElement(tree, element => element.props.children === 'New' && typeof element.props.onClick === 'function')

    button.props.onClick()

    expect(harness.state.routines.at(-1)).toEqual({ id: 'new', name: 'New routine', emoji: 'dumbbell', ex: [] })
    expect(harness.navigate).toHaveBeenCalledWith('/plan/r/new')
  })

  it('opens the selected weekday and offers the starter plan for an empty schedule', () => {
    const populatedTree = Plan()
    const monday = findElement(populatedTree, element => element.type === 'button' && element.props.className === 'item')
    monday.props.onClick()
    expect(harness.dayAssignSheet).toHaveBeenCalledWith(1)

    harness.state = { ...stateFixture(), routines: [], week: {}, sourceSchedules: { personal: [], ai: [] } }
    const emptyTree = Plan()
    const starter = findElement(emptyTree, element => element.props.children === 'Load starter plan (Push / Pull / Legs)')
    const markup = renderToStaticMarkup(emptyTree)

    expect(markup).toContain('No routines yet.')
    expect(markup).toContain('Rest day')
    starter.props.onClick()
    expect(harness.loadStarterPlan).toHaveBeenCalledOnce()
  })
})
