import { describe, expect, it, vi } from 'vitest'

import { applyAiPlanToState, canonicalAiMissingFields, generateAiWorkout, persistCanonicalAiContext, pollExistingAiJob } from './ai-job-flow.js'

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
    expect(next.sourceSchedules.ai).toEqual([{
      sourceType: 'ai', planId: 'plan-1', version: 3, label: 'Plano IA v3', active: true,
      updatedAt: '2026-08-29T12:00:00.000Z', week: { 2: 'ai-routine' },
    }])
    expect(next.routines.map(routine => routine.id)).toEqual(['manual', 'ai-routine'])
    expect(next.routines[1]).toEqual(expect.objectContaining({ _aiPlanId: 'plan-1', _aiVersion: 3 }))
    expect(next.routines[1].ex[0]).toEqual(expect.objectContaining({ id: '0001', sets: 3, repsMin: 8, repsMax: 12, weight: 0 }))
  })

  it('replaces only AI routines and schedules when a new AI version arrives', () => {
    const state = {
      week: { 1: 'manual' },
      routines: [
        { id: 'manual', ex: [] },
        { id: 'personal-a', ex: [], _personalProgramId: 'personal-plan' },
        { id: 'old-ai', ex: [], _aiGenerated: true },
      ],
      sourceSchedules: {
        personal: [{ sourceType: 'personal', planId: 'personal-plan', version: 1, active: true, week: { 2: 'personal-a' } }],
        ai: [{ sourceType: 'ai', planId: 'old-plan', version: 1, active: true, week: { 3: 'old-ai' } }],
      },
    }

    const next = applyAiPlanToState(state, {
      id: 'new-plan', version: 2, appliedAt: '2026-08-29T12:00:00.000Z', justification: 'Seguro',
      routines: [{ id: 'new-ai', name: 'Nova IA', exercises: [] }], schedule: [{ day: 4, routineId: 'new-ai' }],
    })

    expect(next.week).toEqual({ 1: 'manual' })
    expect(next.routines.map(routine => routine.id)).toEqual(['manual', 'personal-a', 'new-ai'])
    expect(next.sourceSchedules.personal).toEqual(state.sourceSchedules.personal)
    expect(next.sourceSchedules.ai[0]).toMatchObject({ planId: 'new-plan', version: 2, week: { 4: 'new-ai' } })
    expect(next.aiPlanHistory.map(plan => plan.planId)).toEqual(['old-plan', 'new-plan'])
  })

  it('resumes an existing job without creating another submission and supports cancellation', async () => {
    const request = vi.fn(async () => ({ job: { id: 'job-1', status: 'applied', planVersion: 2 } }))
    const updates = []
    const job = await pollExistingAiJob({ request, job: { id: 'job-1', status: 'running' }, wait: async () => {}, onUpdate: value => updates.push(value) })
    expect(request).toHaveBeenCalledWith('/api/ai/job?id=job-1')
    expect(request).not.toHaveBeenCalledWith('/api/ai/jobs', expect.anything())
    expect(job.status).toBe('applied')
    expect(updates.at(-1).status).toBe('applied')

    const controller = new AbortController(); controller.abort()
    await expect(pollExistingAiJob({ request, job: { id: 'job-2', status: 'running' }, wait: async () => {}, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps two distinct AI sessions scheduled on the same day', () => {
    const next = applyAiPlanToState({ week: {}, routines: [] }, {
      id: 'double-plan', version: 1, appliedAt: '2026-08-29T12:00:00.000Z', justification: 'Duas sessões',
      routines: [
        { id: 'ai-am', name: 'Manhã', exercises: [] },
        { id: 'ai-pm', name: 'Tarde', exercises: [] },
      ],
      schedule: [{ day: 1, routineId: 'ai-am' }, { day: 1, routineId: 'ai-pm' }],
    })

    expect(next.sourceSchedules.ai[0].week).toEqual({ 1: ['ai-am', 'ai-pm'] })
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
