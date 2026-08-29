import { describe, expect, it, vi } from 'vitest'

import { applyAiPlanToState, canonicalAiMissingFields, generateAiWorkout, persistCanonicalAiContext } from './ai-job-flow.js'

describe('AI job flow', () => {
  it('creates a job, polls to applied and refreshes canonical AI context', async () => {
    const calls = []
    const request = vi.fn(async (path, options) => {
      calls.push({ path, options })
      if (path === '/api/ai/jobs') return { job: { id: 'job-1', status: 'queued' } }
      if (path === '/api/ai/job?id=job-1') return { job: { id: 'job-1', status: calls.length === 2 ? 'running' : 'applied' } }
      if (path === '/api/ai/context') return { plan: { id: 'plan-1', version: 2, justification: 'Seguro', routines: [], schedule: [] } }
      throw new Error(`unexpected ${path}`)
    })

    const result = await generateAiWorkout({ request, idempotencyKey: 'request-1', wait: async () => {} })

    expect(calls.map(call => call.path)).toEqual([
      '/api/ai/jobs', '/api/ai/job?id=job-1', '/api/ai/job?id=job-1', '/api/ai/context'
    ])
    expect(calls[0].options).toEqual(expect.objectContaining({
      method: 'POST', headers: { 'Idempotency-Key': 'request-1' }
    }))
    expect(result.context.plan.id).toBe('plan-1')
  })

  it('applies canonical routines and AI schedule without changing the manual week', () => {
    const state = { week: { 1: 'manual' }, routines: [{ id: 'manual', name: 'Manual', ex: [] }] }
    const next = applyAiPlanToState(state, {
      id: 'plan-1', version: 3, justification: 'Seguro', appliedAt: '2026-08-29T12:00:00.000Z',
      routines: [{
        id: 'ai-routine', name: 'Treino IA', _aiGenerated: true,
        exercises: [{ id: 'ai-exercise', exerciseId: '0001', mode: 'reps', sets: 3, repMin: 8, repMax: 12, seconds: null, restSeconds: 90, progression: 'RPE 8', note: '' }]
      }],
      schedule: [{ day: 2, routineId: 'ai-routine' }]
    })

    expect(next.week).toEqual({ 1: 'manual' })
    expect(next.week).toBe(state.week)
    expect(next.aiSchedule).toEqual([{ day: 2, routineId: 'ai-routine' }])
    expect(next.routines.map(routine => routine.id)).toEqual(['manual', 'ai-routine'])
    expect(next.routines[1].ex[0]).toEqual(expect.objectContaining({ id: '0001', sets: 3, repsMin: 8, repsMax: 12, weight: 0 }))
  })

  it('surfaces a failed job public error without refreshing context', async () => {
    const calls = []
    const request = async path => {
      calls.push(path)
      return path === '/api/ai/jobs'
        ? { job: { id: 'job-1', status: 'queued' } }
        : { job: { id: 'job-1', status: 'failed', publicError: 'Geração interrompida.' } }
    }

    await expect(generateAiWorkout({ request, idempotencyKey: 'request-1', wait: async () => {} }))
      .rejects.toThrow('Geração interrompida.')
    expect(calls).toEqual(['/api/ai/jobs', '/api/ai/job?id=job-1'])
  })

  it('persists profile, gym and measurement with chained revisions before refreshing context and status', async () => {
    const calls = []
    const request = vi.fn(async (path, options) => {
      calls.push({ path, options, body: options?.body ? JSON.parse(options.body) : null })
      if (path === '/api/ai/context' && calls.length === 1) return { rev: 7, completeness: { eligible: false, missing: ['perfil'] } }
      if (path === '/api/ai/profile') return { rev: 8 }
      if (path === '/api/ai/gym') return { rev: 9 }
      if (path === '/api/ai/measurements') return { rev: 10 }
      if (path === '/api/ai/context') return { rev: 10, completeness: { eligible: true, missing: [], blockers: [] } }
      if (path === '/api/ai/status') return { configured: true, eligible: true, missing: [], blockers: [] }
      throw new Error(`unexpected ${path}`)
    })
    const profile = {
      ageBand: 'adult', heightCm: 170, goal: 'Força', experience: 'intermediario',
      availableDays: [1, 3, 5], minutesPerSession: 45, targetAreas: ['back'],
      favoriteExerciseIds: ['0001'], blockedExerciseIds: ['0002'], limitations: '',
      consent: true, guardianConsent: false, equipment: ['dumbbell'], gymName: 'Academia Centro'
    }

    const result = await persistCanonicalAiContext({ request, profile, weight: 74.2, weightUnit: 'kg', observedAt: '2026-08-29' })

    expect(calls.map(call => call.path)).toEqual([
      '/api/ai/context', '/api/ai/profile', '/api/ai/gym', '/api/ai/measurements',
      '/api/ai/context', '/api/ai/status'
    ])
    expect(calls[1]).toEqual(expect.objectContaining({
      path: '/api/ai/profile',
      body: expect.objectContaining({ rev: 7, ageBand: 'adult', availableDays: [1, 3, 5], consent: true, guardianConsent: null })
    }))
    expect(calls[2]).toEqual(expect.objectContaining({
      path: '/api/ai/gym', body: { rev: 8, name: 'Academia Centro', genericEquipment: ['dumbbell'], specificMachines: [] }
    }))
    expect(calls[3]).toEqual(expect.objectContaining({
      path: '/api/ai/measurements', body: { rev: 9, kind: 'weight', value: 74.2, unit: 'kg', observedAt: '2026-08-29' }
    }))
    expect(result.context.rev).toBe(10)
    expect(result.status.configured).toBe(true)
  })

  it('requires explicit age, consent, guardian consent, days and gym', () => {
    const profile = {
      heightCm: 170, goal: 'Força', experience: 'iniciante', minutesPerSession: 45,
      equipment: ['dumbbell'], gymName: 'Academia', availableDays: [1], ageBand: '14to17', consent: true
    }
    expect(canonicalAiMissingFields({ profile, weight: 70 })).toEqual(['autorização do responsável'])
    expect(canonicalAiMissingFields({ profile: { ...profile, guardianConsent: true }, weight: 70 })).toEqual([])
  })
})
