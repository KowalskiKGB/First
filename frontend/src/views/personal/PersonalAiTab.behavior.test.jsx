import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ calls: 0, values: [], setters: [], reset(values = []) { this.calls = 0; this.values = values; this.setters = [] } }))

vi.mock('react', async importOriginal => ({
  ...(await importOriginal()),
  useState: initial => {
    const index = hooks.calls++
    const value = index < hooks.values.length ? hooks.values[index] : typeof initial === 'function' ? initial() : initial
    const setter = vi.fn()
    hooks.setters[index] = setter
    return [value, setter]
  },
  useEffect: effect => { effect() },
  useMemo: factory => factory(),
}))
vi.mock('../../components/AiPlanExperience.jsx', () => ({ MachineEditor: props => <div data-machine-editor {...props} /> }))
vi.mock('../../components/ExerciseCatalogPicker.jsx', () => ({
  default: function ExerciseCatalogPicker(props) { return <div data-exercise-catalog {...props} /> },
}))
vi.mock('../../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../../components/ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  NumberField: props => <input {...props} />,
  TextArea: props => <textarea {...props} />,
  TextField: props => <input {...props} />,
}))
vi.mock('../../lib/i18n.js', () => ({
  dateLocale: () => 'pt-BR', exerciseName: exercise => exercise?.n || '',
  t: (message, ...args) => args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), message),
}))
vi.mock('./components.jsx', () => ({
  PersonalMutation: ({ children }) => <div>{children({ submit: vi.fn(), busy: false })}</div>,
  StatusBadge: ({ children, status }) => <span data-status={status}>{children}</span>,
}))

import PersonalAiTab from './PersonalAiTab.jsx'

const profile = {
  ageBand: 'adult', heightCm: 170, goal: 'Força', experience: 'intermediario', availableDays: [1, 3],
  minutesPerSession: 50, focusAreas: ['back'], favoriteExerciseIds: ['0001'], avoidedExerciseIds: ['0002'],
  limitations: 'Joelho sensível', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: null,
  updatedAt: '2026-08-28T12:00:00Z',
}
const gym = {
  name: 'Academia Centro', directoryGymId: 'gym-centro',
  directorySnapshot: { id: 'gym-centro', name: 'Academia Centro', state: 'CE', city: 'Fortaleza', address: 'Rua A, 10', status: 'verified', openingHours: [], exerciseIds: ['0001', '0003'] },
  genericEquipment: ['dumbbell'], specificMachines: [
    { name: 'Catálogo da academia', category: 'exercise-catalog', exerciseIds: ['0001', '0003'] },
    { name: 'Crossover', category: 'Cabo', exerciseIds: ['0001'] },
  ], updatedAt: '2026-08-28T12:00:00Z',
}
const plan = {
  id: 'plan-2', version: 2, provider: 'openai', model: 'gpt-5-mini', contextHash: 'context', justification: 'Plano seguro.', appliedAt: '2026-08-29T12:00:00Z',
  schedule: { 0: 'routine-time', 1: 'routine-reps' },
  routines: [
    { id: 'routine-reps', name: 'Força', exercises: [
      { id: 'a', exerciseId: '0001', mode: 'reps', sets: 3, repMin: 8, repMax: 12, restSeconds: 60, progression: 'Progredir.', note: 'Controle.' },
      { id: 'b', exerciseId: 'unknown', mode: 'reps', sets: 2, repMin: 10, repMax: 10, restSeconds: 45, progression: 'Manter.', note: '' },
    ] },
    { id: 'routine-time', name: 'Condicionamento', exercises: [
      { id: 'c', exerciseId: '0002', mode: 'time', sets: 4, seconds: 30, restSeconds: 30, progression: 'Acrescentar tempo.', note: '' },
    ] },
  ],
}
const client = { id: 'client-1', trainingProfile: profile, gymProfile: gym, aiPlan: plan }

function findElements(node, predicate, found = []) {
  if (!React.isValidElement(node)) return found
  if (predicate(node)) found.push(node)
  React.Children.forEach(node.props.children, child => findElements(child, predicate, found))
  return found
}

const byTypeName = (node, name) => findElements(node, element => element.type?.name === name)[0]

describe('Personal AI tab behavior', () => {
  beforeEach(() => hooks.reset())

  it('enforces each permission projection without exposing the other section', () => {
    const none = renderToStaticMarkup(<PersonalAiTab client={client} measurements={[]} grants={{ trainingProfileWrite: false, aiPlanRead: false }} />)
    expect(none).toContain('Permission required')
    expect(none).not.toContain('Plano seguro.')

    const planOnly = renderToStaticMarkup(<PersonalAiTab client={client} measurements={[]} grants={{ trainingProfileWrite: false, aiPlanRead: true }} />)
    expect(planOnly).toContain('Plano seguro.')
    expect(planOnly).not.toContain('Edit AI training profile')

    hooks.reset()
    const editOnly = renderToStaticMarkup(<PersonalAiTab client={client} measurements={[]} grants={{ trainingProfileWrite: true, aiPlanRead: false }} />)
    expect(editOnly).toContain('Edit AI training profile')
    expect(editOnly).not.toContain('Plano seguro.')
  })

  it('submits the complete profile and executes immutable field, day and preference updates', () => {
    const root = PersonalAiTab({ client, measurements: [], grants: { trainingProfileWrite: true, aiPlanRead: false } })
    const editor = byTypeName(root, 'ProfileEditor')
    hooks.reset()
    const mutation = editor.type(editor.props)
    const setDraft = hooks.setters[0]
    setDraft.mockClear()
    const submit = vi.fn()
    const form = mutation.props.children({ submit, busy: false })

    form.props.onSubmit({ preventDefault: vi.fn() })
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-1', goal: 'Força', favoriteExerciseIds: ['0001'] }))

    const named = name => findElements(form, element => element.props.name === name)[0]
    named('personal-ai-age-band').props.onChange({ target: { value: 'under14' } })
    named('personal-ai-height').props.onChange(171)
    named('personal-ai-experience').props.onChange({ target: { value: 'avancado' } })
    named('personal-ai-minutes').props.onChange(45)
    named('personal-ai-limitations').props.onChange({ target: { value: 'Sem impacto' } })
    named('personal-ai-consent').props.onChange({ target: { checked: false } })
    named('personal-ai-acute-risk').props.onChange({ target: { checked: true } })
    named('personal-ai-medical-restriction').props.onChange({ target: { checked: true } })
    const dayButtons = findElements(form, element => element.type === 'button' && Number.isInteger(element.key == null ? NaN : Number(element.key)))
    findElements(form, element => element.type === 'button' && element.props.children === 'Monday')[0].props.onClick()
    findElements(form, element => element.type === 'button' && element.props.children === 'Tuesday')[0].props.onClick()
    expect(dayButtons.length).toBeGreaterThan(0)

    const priorities = byTypeName(form, 'ToggleGrid')
    const priorityButtons = findElements(priorities.type(priorities.props), element => element.type === 'button')
    priorityButtons.find(button => button.props.children === 'back').props.onClick()
    priorityButtons.find(button => button.props.children === 'chest').props.onClick()
    findElements(form, element => element.type === 'button' && element.props.children === 'Strength')[0].props.onClick()

    const catalogues = findElements(form, element => element.type?.name === 'ExerciseCatalogPicker')
    catalogues.find(picker => picker.props.searchName === 'personal-ai-favorite-exercises').props.onChange(['0002'])
    catalogues.find(picker => picker.props.searchName === 'personal-ai-avoided-exercises').props.onChange(['0001'])

    const updateResults = setDraft.mock.calls.filter(([value]) => typeof value === 'function').map(([update]) => update(profile))
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ goal: 'strength' }))
    expect(updateResults).toContainEqual(expect.objectContaining({ availableDays: [3] }))
    expect(updateResults).toContainEqual(expect.objectContaining({ availableDays: [1, 2, 3] }))
    expect(updateResults).toContainEqual(expect.objectContaining({ favoriteExerciseIds: ['0002'], avoidedExerciseIds: [] }))
    expect(updateResults).toContainEqual(expect.objectContaining({ avoidedExerciseIds: ['0001'], favoriteExerciseIds: [] }))
  })

  it('builds safe blank drafts and exposes guardian confirmation only for minors', () => {
    const blankClient = { id: 'blank', trainingProfile: null, gymProfile: null, aiPlan: null }
    const root = PersonalAiTab({ client: blankClient, measurements: [], grants: { trainingProfileWrite: true, aiPlanRead: false } })
    const profileEditor = byTypeName(root, 'ProfileEditor')
    hooks.reset()
    const profileMutation = profileEditor.type(profileEditor.props)
    const blankForm = profileMutation.props.children({ submit: vi.fn(), busy: true })
    expect(renderToStaticMarkup(blankForm)).toContain('Saving…')
    expect(renderToStaticMarkup(blankForm)).not.toContain('personal-ai-guardian-consent')

    hooks.reset()
    const minorMutation = profileEditor.type({ ...profileEditor.props, profile: { ageBand: 'under14', guardianConsent: false } })
    const minorForm = minorMutation.props.children({ submit: vi.fn(), busy: false })
    expect(renderToStaticMarkup(minorForm)).toContain('personal-ai-guardian-consent')
    findElements(minorForm, element => element.props.name === 'personal-ai-guardian-consent')[0].props.onChange({ target: { checked: true } })
    findElements(minorForm, element => element.props.name === 'personal-ai-age-band')[0].props.onChange({ target: { value: 'adult' } })

    const gymEditor = byTypeName(root, 'GymEditor')
    hooks.reset()
    const gymMutation = gymEditor.type(gymEditor.props)
    expect(renderToStaticMarkup(gymMutation.props.children({ submit: vi.fn(), busy: false }))).toContain('Save gym')
  })

  it('uses the shared exercise catalogue for personal preferences', () => {
    const root = PersonalAiTab({ client, measurements: [], grants: { trainingProfileWrite: true, aiPlanRead: false } })
    const editor = byTypeName(root, 'ProfileEditor')
    hooks.reset()
    const mutation = editor.type(editor.props)
    const form = mutation.props.children({ submit: vi.fn(), busy: false })

    expect(findElements(form, element => element.type?.name === 'ExercisePreferenceEditor')).toEqual([])
    expect(findElements(form, element => element.type?.name === 'ExerciseCatalogPicker')).toEqual(expect.arrayContaining([
      expect.objectContaining({ props: expect.objectContaining({ searchName: 'personal-ai-favorite-exercises', selectedIds: ['0001'] }) }),
      expect.objectContaining({ props: expect.objectContaining({ searchName: 'personal-ai-avoided-exercises', selectedIds: ['0002'] }) }),
    ]))
  })

  it('submits and updates the canonical gym draft', () => {
    const root = PersonalAiTab({ client, measurements: [], grants: { trainingProfileWrite: true, aiPlanRead: false } })
    const editor = byTypeName(root, 'GymEditor')
    hooks.reset()
    const mutation = editor.type(editor.props)
    const setDraft = hooks.setters[0]
    setDraft.mockClear()
    const submit = vi.fn()
    const form = mutation.props.children({ submit, busy: true })

    form.props.onSubmit({ preventDefault: vi.fn() })
    findElements(form, element => element.props.name === 'personal-ai-gym')[0].props.onChange({ target: { value: 'Nova academia' } })
    const equipment = byTypeName(form, 'ExerciseCatalogPicker')
    expect(equipment.props).toMatchObject({ searchName: 'personal-ai-equipment-search', selectedIds: ['0001', '0003'] })
    equipment.props.onChange(['0002'])
    byTypeName(form, 'MachineEditor').props.onChange([])

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1', name: 'Academia Centro', directoryGymId: 'gym-centro', genericEquipment: [],
    }))
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nova academia' }))
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ availableExerciseIds: ['0002'] }))
    expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({
      specificMachines: [{ name: 'Catálogo de exercícios', category: 'exercise-catalog', exerciseIds: ['0001', '0003'] }],
    }))
    expect(renderToStaticMarkup(form)).toContain('Saving…')
  })

  it('does not erase legacy generic equipment until an exact catalogue is selected', () => {
    const legacyClient = {
      ...client,
      gymProfile: { name: 'Academia antiga', genericEquipment: ['dumbbell'], specificMachines: [], updatedAt: '2026-08-20T12:00:00Z' },
    }
    const root = PersonalAiTab({ client: legacyClient, measurements: [], grants: { trainingProfileWrite: true, aiPlanRead: false } })
    const editor = byTypeName(root, 'GymEditor')
    hooks.reset()
    const mutation = editor.type(editor.props)
    const submit = vi.fn()
    const form = mutation.props.children({ submit, busy: false })

    form.props.onSubmit({ preventDefault: vi.fn() })

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1', name: 'Academia antiga', genericEquipment: ['dumbbell'], specificMachines: [],
    }))
  })

  it('renders empty, current and stale plan states with every prescription mode', () => {
    const noPlanRoot = PersonalAiTab({ client: { ...client, aiPlan: null }, measurements: [], grants: { trainingProfileWrite: false, aiPlanRead: true } })
    const noPlan = byTypeName(noPlanRoot, 'PlanSummary')
    expect(renderToStaticMarkup(noPlan.type(noPlan.props))).toContain('No AI plan applied')

    const root = PersonalAiTab({ client, measurements: [{ id: 'm1', kind: 'weight', value: 70, unit: 'kg' }], grants: { trainingProfileWrite: false, aiPlanRead: true } })
    const summary = byTypeName(root, 'PlanSummary')
    const currentMarkup = renderToStaticMarkup(summary.type(summary.props))
    expect(currentMarkup).toContain('Current')
    expect(currentMarkup.indexOf('Força')).toBeLessThan(currentMarkup.indexOf('Condicionamento'))
    expect(currentMarkup).toContain('3 × 8–12')
    expect(currentMarkup).toContain('2 × 10')
    expect(currentMarkup).toContain('4 × 30 s')
    expect(currentMarkup).toContain('unknown')

    const staleClient = { ...client, trainingProfile: { ...profile, updatedAt: '2026-08-30T12:00:00Z' } }
    const staleRoot = PersonalAiTab({ client: staleClient, measurements: [], grants: { trainingProfileWrite: false, aiPlanRead: true } })
    const stale = byTypeName(staleRoot, 'PlanSummary')
    expect(renderToStaticMarkup(stale.type(stale.props))).toContain('Update recommended')

    const emptyDetails = byTypeName(summary.type(summary.props), 'PlanDetails')
    expect(renderToStaticMarkup(emptyDetails.type({ plan: { routines: [], schedule: [] } }))).toBe('')
  })
})
