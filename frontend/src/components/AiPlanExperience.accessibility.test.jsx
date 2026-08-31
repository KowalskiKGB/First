import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  hook: 0,
  step: 4,
  errors: {},
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
      if (hook === 1) return [harness.errors, harness.setErrors]
      return [initial, vi.fn()]
    },
  }
})
vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'pt-BR', exerciseName: exercise => exercise?.n || '',
  t: (value, ...args) => args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), value),
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('./Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('./ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  NumberField: props => <input {...props} onChange={undefined} />,
  SearchField: props => <input {...props} onChange={undefined} />,
  Segmented: () => <div />,
  TextArea: props => <textarea {...props} onChange={undefined} />,
  TextField: props => <input {...props} onChange={undefined} />,
}))

import { AiWizard, MachineEditor } from './AiPlanExperience.jsx'

const draft = {
  ageBand: 'under14', heightCm: 170, weight: 70, waistCm: '', chestCm: '', hipCm: '', armCm: '', thighCm: '', calfCm: '',
  goal: 'Força', experience: 'intermediario', availableDays: [1, 3, 5], minutesPerSession: 50, focusAreas: [],
  gymName: 'Academia', genericEquipment: ['dumbbell'], specificMachines: [], favoriteExerciseIds: [], avoidedExerciseIds: [],
  limitations: '', acuteRisk: false, medicalRestriction: false, consent: false, guardianConsent: false,
}

function findElement(node, type) {
  if (!node || typeof node !== 'object') return null
  if (node.type === type) return node
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]
  for (const child of children) {
    const found = findElement(child, type)
    if (found) return found
  }
  return null
}

function findElementByChild(node, child) {
  if (!node || typeof node !== 'object') return null
  if (node.props?.children === child) return node
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]
  for (const nested of children) {
    const found = findElementByChild(nested, child)
    if (found) return found
  }
  return null
}

function findElements(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    node.forEach(nested => findElements(nested, predicate, found))
    return found
  }
  if (predicate(node)) found.push(node)
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]
  children.forEach(nested => findElements(nested, predicate, found))
  return found
}

function wizardStep(step, onDraft = vi.fn()) {
  harness.hook = 0
  harness.step = step
  harness.errors = {}
  const tree = AiWizard({ draft, onDraft, onClose: () => {}, onSubmit: () => {}, busy: false })
  const stepElement = findElements(tree, node => node.type?.name === `Step${['', 'One', 'Two', 'Three', 'Four'][step]}`)[0]
  return { onDraft, tree: stepElement.type(stepElement.props) }
}

describe('AiWizard accessibility', () => {
  beforeEach(() => {
    harness.hook = 0
    harness.step = 4
    harness.errors = {
      consent: 'Confirm consent.',
      guardianConsent: 'Confirm guardian authorization.',
    }
    harness.setStep.mockReset()
    harness.setErrors.mockReset()
    harness.heading.focus.mockReset()
    harness.form.querySelector.mockReset()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  it('associates consent errors with the corresponding checkboxes', () => {
    const markup = renderToStaticMarkup(<AiWizard draft={draft} onDraft={() => {}} onClose={() => {}} onSubmit={() => {}} busy={false} />)
    const consent = markup.match(/<input[^>]*name="ai-consent"[^>]*>/)?.[0]
    const guardianConsent = markup.match(/<input[^>]*name="ai-guardian-consent"[^>]*>/)?.[0]

    expect(consent).toContain('aria-invalid="true"')
    expect(consent).toContain('aria-describedby="ai-error-consent"')
    expect(guardianConsent).toContain('aria-invalid="true"')
    expect(guardianConsent).toContain('aria-describedby="ai-error-guardianConsent"')
  })

  it('moves focus to the first invalid field after final validation changes step', () => {
    harness.hook = 0
    harness.errors = {}
    const invalidControl = { focus: vi.fn() }
    harness.form.querySelector.mockReturnValue(invalidControl)
    const tree = AiWizard({ draft: { ...draft, heightCm: 0 }, onDraft: () => {}, onClose: () => {}, onSubmit: () => {}, busy: false })
    const form = findElement(tree, 'form')

    form.props.onSubmit({ preventDefault: vi.fn() })

    expect(harness.setStep).toHaveBeenCalledWith(1)
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    requestAnimationFrame.mock.calls[0][0]()
    expect(harness.form.querySelector).toHaveBeenCalledWith(expect.stringContaining('[aria-invalid="true"]'))
    expect(invalidControl.focus).toHaveBeenCalledOnce()
  })

  it('prevents the Continue click from becoming an implicit final submit after the step changes', () => {
    harness.hook = 0
    harness.step = 3
    harness.errors = {}
    const tree = AiWizard({ draft, onDraft: () => {}, onClose: () => {}, onSubmit: () => {}, busy: false })
    const continueButton = findElementByChild(tree, 'Continue')
    const event = { preventDefault: vi.fn() }

    continueButton.props.onClick(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(harness.setStep).toHaveBeenCalledOnce()
  })

  it('associates specific-machine errors with the machine name and exercise picker', () => {
    harness.hook = 0
    harness.step = 3
    harness.errors = {
      specificMachineName0: 'Enter the machine name.',
      specificMachineExercises0: 'Choose at least one supported exercise.',
      genericEquipment: 'Choose at least one available equipment item.',
    }
    const markup = renderToStaticMarkup(<AiWizard
      draft={{ ...draft, gymName: 'Academia', specificMachines: [{ name: '', category: '', exerciseIds: [] }] }}
      onDraft={() => {}} onClose={() => {}} onSubmit={() => {}} busy={false}
    />)
    const name = markup.match(/<input[^>]*name="specific-machine-name-0"[^>]*>/)?.[0]
    const exercises = markup.match(/<input[^>]*name="specific-machine-exercises-0"[^>]*>/)?.[0]

    expect(name).toContain('aria-invalid="true"')
    expect(name).toContain('aria-describedby="ai-error-specificMachineName0"')
    expect(exercises).toContain('aria-invalid="true"')
    expect(exercises).toContain('aria-describedby="ai-error-specificMachineExercises0"')
    expect(markup).toContain('Enter the machine name.')
    expect(markup).toContain('Choose at least one supported exercise.')
  })

  it('edits specific machines without mutating the existing list', () => {
    const machines = [{ name: 'Leg press', category: 'Pernas', exerciseIds: ['0003'] }]
    const onChange = vi.fn()
    const tree = MachineEditor({ machines, onChange })

    findElementByChild(tree, 'Add machine').props.onClick()
    findElements(tree, node => node.props?.name === 'specific-machine-name-0')[0].props.onChange({ target: { value: 'Hack squat' } })
    findElements(tree, node => node.props?.name === 'specific-machine-category-0')[0].props.onChange({ target: { value: 'Quadríceps' } })
    findElements(tree, node => node.props?.name === 'specific-machine-exercises-0')[0].props.onChange(['0001'])
    findElements(tree, node => node.props?.children === 'Remove machine')[0].props.onClick()

    expect(machines).toEqual([{ name: 'Leg press', category: 'Pernas', exerciseIds: ['0003'] }])
    expect(onChange.mock.calls[0][0]).toHaveLength(2)
    expect(onChange.mock.calls[1][0][0].name).toBe('Hack squat')
    expect(onChange.mock.calls[2][0][0].category).toBe('Quadríceps')
    expect(onChange.mock.calls[3][0][0].exerciseIds).toEqual(['0001'])
    expect(onChange.mock.calls[4][0]).toEqual([])
  })

  it('routes every wizard field change through immutable draft patches', () => {
    const first = wizardStep(1)
    findElements(first.tree, node => node.props?.value === draft.ageBand && Array.isArray(node.props?.options))[0].props.onChange('adult')
    findElements(first.tree, node => node.props?.name === 'ai-height')[0].props.onChange(171)
    findElements(first.tree, node => node.props?.name === 'ai-weight')[0].props.onChange(71)
    findElements(first.tree, node => node.props?.name === 'ai-waistCm')[0].props.onChange(0)

    const second = wizardStep(2)
    findElementByChild(second.tree, 'Gain muscle').props.onClick()
    findElements(second.tree, node => node.props?.name === 'ai-minutes')[0].props.onChange(60)
    findElements(second.tree, node => node.type === 'button' && node.props?.['aria-pressed'] === false)[0].props.onClick()
    const priorities = findElements(second.tree, node => node.props?.legend === 'Training priorities')[0]
    findElements(priorities.type(priorities.props), node => node.type === 'button')[0].props.onClick()

    const third = wizardStep(3)
    findElements(third.tree, node => node.props?.name === 'ai-gym-name')[0].props.onChange({ target: { value: 'Academia Norte' } })
    const equipment = findElements(third.tree, node => node.props?.legend === 'Available equipment')[0]
    equipment.props.onChange(['0003'])
    findElements(third.tree, node => node.type?.name === 'MachineEditor')[0].props.onChange([])
    findElements(third.tree, node => node.props?.name === 'ai-favorite-exercises')[0].props.onChange(['0001'])
    findElements(third.tree, node => node.props?.name === 'ai-avoided-exercises')[0].props.onChange(['0002'])
    findElements(third.tree, node => node.props?.name === 'ai-limitations')[0].props.onChange({ target: { value: 'Sem impacto' } })

    const fourth = wizardStep(4)
    for (const name of ['ai-consent', 'ai-guardian-consent', 'ai-acute-risk', 'ai-medical-restriction']) {
      findElements(fourth.tree, node => node.props?.name === name)[0].props.onChange({ target: { checked: true } })
    }

    expect(first.onDraft).toHaveBeenCalledTimes(4)
    expect(second.onDraft).toHaveBeenCalledTimes(4)
    expect(third.onDraft).toHaveBeenCalledTimes(6)
    expect(fourth.onDraft).toHaveBeenCalledTimes(4)
    expect(first.onDraft.mock.calls[0][0]).toMatchObject({ ...draft, ageBand: 'adult' })
    expect(third.onDraft.mock.calls.at(-1)[0]).toMatchObject({ ...draft, limitations: 'Sem impacto' })
  })
})
