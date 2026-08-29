import { describe, expect, it } from 'vitest'

import {
  contextFingerprint,
  draftFromAiContext,
  generationSubmission,
  jobPresentation,
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

  it('fingerprints canonical values deterministically and detects meaningful changes', () => {
    const reordered = { measurements: context.measurements, gym: context.gym, profile: context.profile }
    expect(contextFingerprint(reordered)).toBe(contextFingerprint(context))
    expect(contextFingerprint({ ...context, gym: { ...context.gym, name: 'Outra academia' } })).not.toBe(contextFingerprint(context))
  })

  it('maps every persistent job state to the approved visible stages', () => {
    expect(jobPresentation({ status: 'queued', stage: 'organizing' }).label).toBe('Na fila')
    expect(jobPresentation({ status: 'running', stage: 'generating' }).label).toBe('Gerando treino')
    expect(jobPresentation({ status: 'running', stage: 'validating' }).label).toBe('Validando plano')
    expect(jobPresentation({ status: 'applied' }).label).toBe('Aplicado')
    expect(jobPresentation({ status: 'failed' }).label).toBe('Falha na geração')
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
})
