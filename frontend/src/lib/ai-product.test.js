import { describe, expect, it } from 'vitest'

import {
  canonicalDraftPayloads,
  contextFingerprint,
  draftFromAiContext,
  generationSubmission,
  isAiContextStale,
  jobPresentation,
  providerDisplayName,
  validateWizardStep,
} from './ai-product.js'

const context = {
  profile: {
    ageBand: '14to17', heightCm: 168, goal: 'Força', experience: 'iniciante',
    availableDays: [1, 3, 5], minutesPerSession: 50, focusAreas: ['back'],
    favoriteExerciseIds: ['0001'], avoidedExerciseIds: ['0002'], limitations: 'Sem impacto',
    acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: true,
  },
  gym: {
    name: 'Academia Centro', genericEquipment: ['dumbbell'],
    specificMachines: [{ name: 'Leg press', category: 'Pernas', exerciseIds: ['0003'] }],
  },
  measurements: { weight: { value: 62, unit: 'kg' }, waist: { value: 72, unit: 'cm' } },
}

describe('AI product flow helpers', () => {
  it('hydrates the four-step draft only from the canonical context', () => {
    expect(draftFromAiContext(context)).toMatchObject({
      ageBand: '14to17', heightCm: 168, weight: 62, waistCm: 72,
      gymName: 'Academia Centro', genericEquipment: ['dumbbell'],
      specificMachines: [{ name: 'Leg press', category: 'Pernas', exerciseIds: ['0003'] }],
      guardianConsent: true,
    })
  })

  it('blocks incomplete data and requires a guardian only for minors', () => {
    const draft = draftFromAiContext({ profile: null, gym: null, measurements: {} })
    expect(Object.keys(validateWizardStep(draft, 1))).toEqual(['ageBand', 'heightCm', 'weight'])
    expect(validateWizardStep({ ...draft, ageBand: '14to17', heightCm: 165, weight: 60, consent: true }, 4)).toHaveProperty('guardianConsent')
    expect(validateWizardStep({ ...draft, ageBand: 'adult', heightCm: 165, weight: 60, consent: true }, 4)).not.toHaveProperty('guardianConsent')
  })

  it('validates goals, availability, gym equipment and minor consent per wizard step', () => {
    const draft = draftFromAiContext()
    expect(Object.keys(validateWizardStep(draft, 2))).toEqual(['goal', 'availableDays'])
    expect(validateWizardStep({
      ...draft, goal: 'Condicionamento', experience: 'avancado', availableDays: [2], minutesPerSession: 180,
    }, 2)).toEqual({})
    expect(Object.keys(validateWizardStep(draft, 3))).toEqual(['gymName', 'genericEquipment'])
    expect(validateWizardStep({ ...draft, gymName: 'Centro', genericEquipment: ['cable'] }, 3)).toEqual({})
    expect(validateWizardStep({
      ...draft, gymName: 'Centro', specificMachines: [{ name: 'Leg press', exerciseIds: ['0572'] }],
    }, 3)).toEqual({})
    expect(Object.keys(validateWizardStep({ ...draft, ageBand: 'under14' }, 4))).toEqual(['consent', 'guardianConsent'])
    expect(validateWizardStep({ ...draft, ageBand: 'under14', consent: true, guardianConsent: true }, 4)).toEqual({})
  })

  it('rejects server-invalid numeric bounds while keeping optional measurements optional', () => {
    const draft = draftFromAiContext(context)

    expect(Object.keys(validateWizardStep({
      ...draft, heightCm: 170.5, weight: 19, waistCm: 9, chestCm: '',
    }, 1))).toEqual(['heightCm', 'weight', 'waistCm'])
    expect(validateWizardStep({ ...draft, weight: 800, waistCm: '' }, 1, 'lb')).toHaveProperty('weight')
    expect(validateWizardStep({ ...draft, heightCm: '170', weight: '70', waistCm: '' }, 1)).toEqual({})
  })

  it('requires every specific machine to have a bounded name and known exercises', () => {
    const draft = { ...draftFromAiContext(context), genericEquipment: [] }

    expect(Object.keys(validateWizardStep({
      ...draft, specificMachines: [{ name: '', category: '', exerciseIds: [] }],
    }, 3))).toEqual(['specificMachineName0', 'specificMachineExercises0', 'genericEquipment'])
    expect(validateWizardStep({
      ...draft, specificMachines: [{ name: 'Leg press', category: 'Pernas', exerciseIds: ['0003'] }],
    }, 3)).toEqual({})
    expect(validateWizardStep({
      ...draft, specificMachines: [{ name: 'Leg press', category: '', exerciseIds: ['missing-id'] }],
    }, 3)).toHaveProperty('specificMachineExercises0')
  })

  it('rejects server-invalid text, collection and integer limits', () => {
    const draft = {
      ...draftFromAiContext(context),
      goal: 'x'.repeat(161),
      availableDays: [1, 7],
      minutesPerSession: 45.5,
      focusAreas: Array.from({ length: 13 }, (_, index) => `focus-${index}`),
      limitations: 'x'.repeat(1001),
    }

    expect(validateWizardStep(draft, 2)).toEqual(expect.objectContaining({
      goal: expect.any(String),
      availableDays: expect.any(String),
      minutesPerSession: expect.any(String),
      focusAreas: expect.any(String),
    }))
    expect(validateWizardStep(draft, 3)).toHaveProperty('limitations')
  })

  it('keeps safe empty defaults and clones partially populated machine links', () => {
    expect(draftFromAiContext()).toMatchObject({
      gymName: '', genericEquipment: [], specificMachines: [], availableDays: [], focusAreas: [],
    })
    const draft = draftFromAiContext({ gym: { specificMachines: [{ name: 'Máquina livre' }] }, measurements: { weight: {} } })
    expect(draft.weight).toBe('')
    expect(draft.specificMachines).toEqual([{ name: 'Máquina livre', exerciseIds: [] }])
  })

  it('fingerprints canonical values deterministically and detects meaningful changes', () => {
    const reordered = { measurements: context.measurements, gym: context.gym, profile: context.profile }
    expect(contextFingerprint(reordered)).toBe(contextFingerprint(context))
    expect(contextFingerprint({ ...context, gym: { ...context.gym, name: 'Outra academia' } })).not.toBe(contextFingerprint(context))
  })

  it('detects a cross-device context update from canonical timestamps', () => {
    const plan = { id: 'plan-1', appliedAt: '2026-08-29T12:00:00.000Z', contextHash: 'hash-1' }
    expect(isAiContextStale({ ...context, plan, profile: { ...context.profile, updatedAt: '2026-08-29T13:00:00.000Z' } }, null)).toBe(true)
    expect(isAiContextStale({ ...context, plan, profile: { ...context.profile, updatedAt: '2026-08-29T11:00:00.000Z' } }, null)).toBe(false)
    expect(isAiContextStale({ ...context, plan, measurements: { weight: { ...context.measurements.weight, observedAt: '2026-08-30' } } }, null)).toBe(true)
  })

  it('does not mark a missing or identical plan context stale and detects server hash drift', () => {
    expect(isAiContextStale(context, 'anything')).toBe(false)
    const planContext = { ...context, plan: { id: 'plan-1', createdAt: '2026-08-29T12:00:00.000Z', contextHash: 'plan-hash' } }
    const canonical = { profile: planContext.profile, gym: planContext.gym, measurements: planContext.measurements }
    expect(isAiContextStale(planContext, contextFingerprint(canonical))).toBe(false)
    expect(isAiContextStale(planContext, 'ctx-different')).toBe(true)
    expect(isAiContextStale({ ...planContext, job: { contextHash: 'new-hash' } }, null)).toBe(true)
  })

  it('maps every persistent job state to the approved visible stages', () => {
    expect(jobPresentation({ status: 'queued', stage: 'organizing' }).label).toBe('Na fila')
    expect(jobPresentation({ status: 'running', stage: 'generating' }).label).toBe('Gerando treino')
    expect(jobPresentation({ status: 'running', stage: 'validating' }).label).toBe('Validando plano')
    expect(jobPresentation({ status: 'applied' }).label).toBe('Aplicado')
    expect(jobPresentation({ status: 'failed' }).label).toBe('Falha na geração')
    expect(jobPresentation({ status: 'running', stage: 'applying' })).toMatchObject({ key: 'applying', active: true })
    expect(jobPresentation()).toMatchObject({ key: 'organizing', active: false })
  })

  it('uses product names instead of internal provider ids', () => {
    expect(providerDisplayName('openai')).toBe('OpenAI')
    expect(providerDisplayName('gemini')).toBe('Gemini')
    expect(providerDisplayName('anthropic')).toBe('Anthropic')
    expect(providerDisplayName('private-provider')).toBe('private-provider')
    expect(providerDisplayName()).toBe('')
  })

  it('builds canonical minor measurement payloads without empty optional values', () => {
    const draft = {
      ...draftFromAiContext(context), weight: 62, waistCm: '', ageBand: '14to17', guardianConsent: true,
    }
    const payloads = canonicalDraftPayloads(draft, 5, '2026-08-29', 'lb')
    expect(payloads.profile).toMatchObject({ rev: 5, guardianConsent: true })
    expect(payloads.gym.specificMachines[0].exerciseIds).toEqual(['0003'])
    expect(payloads.measurements).toEqual([{ kind: 'weight', value: 62, unit: 'lb', observedAt: '2026-08-29' }])
    expect(canonicalDraftPayloads({ ...draft, ageBand: 'adult' }, 6, '2026-08-30').profile.guardianConsent).toBeNull()
  })

  it('keeps one idempotency key stable until the submission is cleared', () => {
    const values = new Map()
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
    const first = generationSubmission(storage, 'student-1', () => 'random-1')
    const second = generationSubmission(storage, 'student-1', () => 'random-2')
    expect(second.key).toBe(first.key)
    first.rememberJob('job-1')
    expect(generationSubmission(storage, 'student-1', () => 'random-3').jobId).toBe('job-1')
    first.clear()
    expect(generationSubmission(storage, 'student-1', () => 'random-4').key).toBe('random-4')
  })

  it('recovers a stable anonymous submission from corrupt local storage', () => {
    const values = new Map([['first_ai_generation_anonymous', '{invalid']])
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
    expect(generationSubmission(storage, '', () => 'anonymous-key')).toMatchObject({ key: 'anonymous-key', jobId: null })
  })
})
