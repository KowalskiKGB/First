import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  hook: 0,
  step: 2,
  setStep: vi.fn(),
  setErrors: vi.fn(),
  heading: { focus: vi.fn() },
  form: { querySelector: vi.fn() },
}))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    useEffect: vi.fn(),
    useRef: () => ({ current: harness.hook++ === 2 ? harness.heading : harness.form }),
    useState: initial => {
      const hook = harness.hook++
      if (hook === 0) return [harness.step, harness.setStep]
      if (hook === 1) return [{}, harness.setErrors]
      return [initial, vi.fn()]
    },
  }
})

const translations = {
  'Primary goal': 'Objetivo principal',
  'Gain muscle': 'Ganhar massa muscular',
  'Lose weight': 'Perder peso',
  'Body recomposition': 'Recomposição corporal',
  Strength: 'Força',
  Conditioning: 'Condicionamento',
  'General health': 'Saúde geral',
}

vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'pt-BR',
  exerciseName: exercise => exercise?.n || '',
  t: (value, ...args) => args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), translations[value] || value),
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('./Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('./ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  NumberField: props => <input name={props.name} />,
  SearchField: props => <input name={props.name} />,
  Segmented: ({ options = [], value, onChange }) => <div>{options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>,
  TextArea: props => <textarea name={props.name} />,
  TextField: props => <input name={props.name} />,
}))

import { AiWizard } from './AiPlanExperience.jsx'

const draft = Object.freeze({
  ageBand: 'adult', heightCm: 177, weight: 82, waistCm: '', chestCm: '', hipCm: '', armCm: '', thighCm: '', calfCm: '',
  goal: 'muscle_gain', experience: 'intermediario', availableDays: [1, 3, 5], minutesPerSession: 50, focusAreas: [],
  gymName: 'Academia X', genericEquipment: ['barbell'], specificMachines: [], favoriteExerciseIds: [], avoidedExerciseIds: [],
  limitations: '', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: false,
})

function findElements(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    node.forEach(child => findElements(child, predicate, found))
    return found
  }
  if (predicate(node)) found.push(node)
  if (typeof node.type === 'function') {
    findElements(node.type(node.props), predicate, found)
    return found
  }
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]
  children.forEach(child => findElements(child, predicate, found))
  return found
}

function stepTwo(onDraft = vi.fn()) {
  harness.hook = 0
  harness.step = 2
  const wizard = AiWizard({ draft, onDraft, onClose: () => {}, onSubmit: () => {}, busy: false })
  const step = findElements(wizard, node => node.type?.name === 'StepTwo')[0]
  return { onDraft, tree: step.type(step.props) }
}

describe('AI goal choices', () => {
  beforeEach(() => {
    harness.hook = 0
    harness.step = 2
    harness.setStep.mockReset()
    harness.setErrors.mockReset()
  })

  it('replaces the free-text goal with six canonical Portuguese buttons', () => {
    const markup = renderToStaticMarkup(<AiWizard draft={draft} onDraft={() => {}} onClose={() => {}} onSubmit={() => {}} busy={false} />)

    expect(markup).not.toMatch(/<input\b[^>]*name="ai-goal"/)
    expect(markup).toContain('<legend>Objetivo principal</legend>')
    for (const label of ['Ganhar massa muscular', 'Perder peso', 'Recomposição corporal', 'Força', 'Condicionamento', 'Saúde geral']) {
      expect(markup).toContain(`>${label}</button>`)
    }
  })

  it('writes the selected canonical value through an immutable draft patch', () => {
    const { tree, onDraft } = stepTwo()
    const goals = [
      ['Ganhar massa muscular', 'muscle_gain'],
      ['Perder peso', 'weight_loss'],
      ['Recomposição corporal', 'recomposition'],
      ['Força', 'strength'],
      ['Condicionamento', 'conditioning'],
      ['Saúde geral', 'general_health'],
    ]
    goals.forEach(([label, value], index) => {
      const goalButton = findElements(tree, node => node.type === 'button' && node.props?.children === label)[0]
      expect(goalButton, `botão ${label}`).toBeDefined()
      goalButton.props.onClick()
      expect(onDraft).toHaveBeenNthCalledWith(index + 1, { ...draft, goal: value })
    })

    expect(draft.goal).toBe('muscle_gain')
    expect(onDraft.mock.calls[0][0]).not.toBe(draft)
  })
})
