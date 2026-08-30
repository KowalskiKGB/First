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
vi.mock('./ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  NumberField: props => <input {...props} onChange={undefined} />,
  SearchField: props => <input {...props} onChange={undefined} />,
  Segmented: () => <div />,
  TextArea: props => <textarea {...props} onChange={undefined} />,
  TextField: props => <input {...props} onChange={undefined} />,
}))

import { AiWizard } from './AiPlanExperience.jsx'

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

    expect(markup).toMatch(/name="ai-consent"[^>]*aria-invalid="true"[^>]*aria-describedby="ai-error-consent"/)
    expect(markup).toMatch(/name="ai-guardian-consent"[^>]*aria-invalid="true"[^>]*aria-describedby="ai-error-guardianConsent"/)
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
})
