import { describe, expect, it, vi } from 'vitest'

import { applyAiPlanToState, generateAiWorkout } from './ai-job-flow.js'

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
})
