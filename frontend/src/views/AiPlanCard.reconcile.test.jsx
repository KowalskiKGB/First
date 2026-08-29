import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  effects: [],
  state: null,
  context: null,
  api: vi.fn(),
  replaceState: vi.fn(),
  pushState: vi.fn(),
}))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, useEffect: effect => harness.effects.push(effect) }
})
vi.mock('../components/AiPlanExperience.jsx', () => ({
  AiPlanOverview: () => <div>AI overview</div>,
  AiWizard: () => <div>AI wizard</div>,
}))
vi.mock('../lib/api.js', () => ({ api: (...args) => harness.api(...args) }))
vi.mock('../lib/i18n.js', () => ({ t: value => value }))
vi.mock('../lib/personal-forms.js', () => ({ copyPersonalRoutine: routine => ({ ...routine }) }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: vi.fn() }) }))
vi.mock('../store/useStore.js', () => {
  const store = {
    get S() { return harness.state },
    user: { id: 'student-a' },
    replaceState: (...args) => harness.replaceState(...args),
    update: vi.fn(),
  }
  const useStore = selector => selector(store)
  useStore.getState = () => ({ ...store, pushState: harness.pushState })
  return { useStore }
})

import AiPlanCard from './AiPlanCard.jsx'

const plan = {
  id: 'plan-applied', version: 3, provider: 'openai', model: 'gpt-5-mini', contextHash: 'ctx-3',
  justification: 'Plano concluído enquanto o app estava fechado.', appliedAt: '2026-08-29T18:00:00.000Z',
  routines: [{
    id: 'ai-routine', name: 'Força IA', exercises: [
      { id: 'ai-output', exerciseId: '0001', mode: 'reps', sets: 3, repMin: 8, repMax: 10, restSeconds: 90 },
    ],
  }],
  schedule: [{ day: 1, routineId: 'ai-routine' }],
}

const initialState = () => ({
  unit: 'kg', bodyweight: [], week: { 1: 'manual' }, sourceSchedules: { ai: [], personal: [] },
  routines: [{ id: 'manual', name: 'Meu treino', ex: [] }], workouts: [],
})

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function mountAndLoad() {
  harness.effects = []
  renderToStaticMarkup(<AiPlanCard />)
  const cleanup = harness.effects[0]?.()
  await flush()
  return cleanup
}

describe('AiPlanCard initial applied-plan reconciliation', () => {
  beforeEach(() => {
    const storage = new Map()
    vi.stubGlobal('localStorage', {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    })
    harness.state = initialState()
    harness.context = {
      rev: 8, profile: {}, gym: {}, measurements: {}, plan,
      job: { id: 'job-applied', status: 'applied', planVersion: 3 },
    }
    harness.api.mockReset().mockImplementation(async path => path === '/api/ai/context'
      ? harness.context
      : path === '/api/ai/status'
        ? { configured: true }
        : (() => { throw new Error(`unexpected ${path}`) })())
    harness.replaceState.mockReset().mockImplementation(next => { harness.state = next })
    harness.pushState.mockReset().mockResolvedValue(undefined)
  })

  it('materializes and persists a terminal server plan exactly once across remounts', async () => {
    await mountAndLoad()

    expect(harness.replaceState).toHaveBeenCalledTimes(1)
    expect(harness.pushState).toHaveBeenCalledTimes(1)
    expect(harness.state.week).toEqual({ 1: 'manual' })
    expect(harness.state.routines.map(routine => routine.id)).toEqual(['manual', 'ai-routine'])
    expect(harness.state.sourceSchedules.ai[0]).toMatchObject({ planId: 'plan-applied', version: 3, week: { 1: 'ai-routine' } })
    expect(harness.api).not.toHaveBeenCalledWith('/api/ai/jobs', expect.anything())

    await mountAndLoad()
    expect(harness.replaceState).toHaveBeenCalledTimes(1)
    expect(harness.pushState).toHaveBeenCalledTimes(1)
  })

  it('does not reconcile a stale request after the component is unmounted', async () => {
    let resolveContext
    harness.api.mockImplementation(path => path === '/api/ai/context'
      ? new Promise(resolve => { resolveContext = resolve })
      : Promise.resolve({ configured: true }))

    harness.effects = []
    renderToStaticMarkup(<AiPlanCard />)
    const cleanup = harness.effects[0]?.()
    cleanup?.()
    resolveContext(harness.context)
    await flush()

    expect(harness.replaceState).not.toHaveBeenCalled()
    expect(harness.pushState).not.toHaveBeenCalled()
  })
})
