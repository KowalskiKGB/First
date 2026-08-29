import { describe, expect, it, vi } from 'vitest'

import { persistAiWizardContext } from '../lib/ai-job-flow.js'
import { draftFromAiContext, isAiContextStale } from '../lib/ai-product.js'

const canonical = {
  rev: 3,
  profile: { ageBand: 'adult', heightCm: 170, goal: 'Força', experience: 'intermediario', availableDays: [1, 3, 5], minutesPerSession: 50, focusAreas: [], favoriteExerciseIds: [], avoidedExerciseIds: [], limitations: '', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: null },
  gym: { name: 'Academia Centro', genericEquipment: ['dumbbell'], specificMachines: [] },
  measurements: { weight: { value: 70, unit: 'kg' }, waist: { value: 80, unit: 'cm' } },
}

describe('Plan AI canonical persistence', () => {
  it('saves profile, gym and every informed measurement in chained revision order before generation', async () => {
    const calls = []
    const request = vi.fn(async (path, options) => {
      const body = options?.body ? JSON.parse(options.body) : null
      calls.push({ path, body })
      if (path === '/api/ai/profile') return { rev: 4 }
      if (path === '/api/ai/gym') return { rev: 5 }
      if (path === '/api/ai/measurements') return { rev: body.kind === 'weight' ? 6 : 7 }
      if (path === '/api/ai/context') return { ...canonical, rev: 7 }
      if (path === '/api/ai/status') return { configured: true, eligible: true }
      throw new Error(`unexpected ${path}`)
    })

    const result = await persistAiWizardContext({ request, draft: draftFromAiContext(canonical), rev: 3, observedAt: '2026-08-29', unit: 'kg' })

    expect(calls.map(call => call.path)).toEqual([
      '/api/ai/profile', '/api/ai/gym', '/api/ai/measurements', '/api/ai/measurements', '/api/ai/context', '/api/ai/status',
    ])
    expect(calls.map(call => call.body?.rev).slice(0, 4)).toEqual([3, 4, 5, 6])
    expect(calls.filter(call => call.path === '/api/ai/measurements').map(call => call.body.kind)).toEqual(['weight', 'waist'])
    expect(result.context.rev).toBe(7)
  })

  it('stops before any job when a canonical save fails', async () => {
    const request = vi.fn(async path => { if (path === '/api/ai/profile') throw new Error('Falha ao salvar perfil') })
    await expect(persistAiWizardContext({ request, draft: draftFromAiContext(canonical), rev: 3, observedAt: '2026-08-29' })).rejects.toThrow('Falha ao salvar perfil')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalledWith('/api/ai/jobs', expect.anything())
  })

  it('marks a changed context stale without making a network request', () => {
    const request = vi.fn()
    const stored = 'ctx-old'
    expect(isAiContextStale(canonical, stored)).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
})
