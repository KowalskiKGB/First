import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  effects: [],
  stateCursor: 0,
  stateSlots: [],
  state: null,
  context: null,
  overview: null,
  wizard: null,
  api: vi.fn(),
  persistContext: vi.fn(),
  pollJob: vi.fn(),
  replaceState: vi.fn(),
  pushState: vi.fn(),
  toast: vi.fn(),
  update: vi.fn(),
}))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    useEffect: effect => harness.effects.push(effect),
    useState: initial => {
      const index = harness.stateCursor++
      if (!(index in harness.stateSlots)) harness.stateSlots[index] = typeof initial === 'function' ? initial() : initial
      return [harness.stateSlots[index], value => {
        harness.stateSlots[index] = typeof value === 'function' ? value(harness.stateSlots[index]) : value
      }]
    },
  }
})
vi.mock('../components/AiPlanExperience.jsx', () => ({
  AiPlanOverview: props => { harness.overview = props; return <div>AI overview</div> },
  AiWizard: props => { harness.wizard = props; return <div>AI wizard</div> },
}))
vi.mock('../lib/api.js', () => ({ api: (...args) => harness.api(...args) }))
vi.mock('../lib/ai-job-flow.js', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    persistAiWizardContext: (...args) => harness.persistContext(...args),
    pollExistingAiJob: (...args) => harness.pollJob(...args),
  }
})
vi.mock('../lib/i18n.js', () => ({ t: value => value }))
vi.mock('../lib/personal-forms.js', () => ({ copyPersonalRoutine: routine => ({ ...routine }) }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: (...args) => harness.toast(...args) }) }))
vi.mock('../store/useStore.js', () => {
  const store = {
    get S() { return harness.state },
    user: { id: 'student-a' },
    ready: true,
    replaceState: (...args) => harness.replaceState(...args),
    update: (...args) => harness.update(...args),
  }
  const useStore = selector => selector(store)
  useStore.getState = () => ({ ...store, pushState: harness.pushState })
  return { useStore }
})

import AiPlanCard from './AiPlanCard.jsx'

const plan = {
  id: 'plan-applied', version: 3, provider: 'openai', model: 'gpt-5-mini', contextHash: 'ctx-3',
  source: 'ai', status: 'applied',
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
  harness.stateCursor = 0
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
    harness.stateCursor = 0
    harness.stateSlots = []
    harness.overview = null
    harness.wizard = null
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
    harness.toast.mockReset()
    harness.update.mockReset().mockImplementation(change => {
      const next = structuredClone(harness.state)
      change(next)
      harness.state = next
    })
    harness.persistContext.mockReset()
    harness.pollJob.mockReset()
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

  it('keeps provider status unknown after an initial load failure and retries explicitly', async () => {
    harness.api.mockRejectedValue(new Error('network unavailable'))

    await mountAndLoad()
    harness.effects = []
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)

    expect(harness.overview.status).toBeNull()
    expect(harness.overview.error).toBe('Could not load AI workout data.')
    expect(harness.overview.onRetry).toEqual(expect.any(Function))

    harness.api.mockImplementation(async path => path === '/api/ai/context'
      ? harness.context
      : path === '/api/ai/status'
        ? { configured: true }
        : (() => { throw new Error(`unexpected ${path}`) })())
    await harness.overview.onRetry()
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)

    expect(harness.overview.status).toEqual({ configured: true })
    expect(harness.overview.error).toBeNull()
  })

  it('rejects an invalid completed wizard draft before syncing state or calling the API', async () => {
    await mountAndLoad()
    harness.effects = []
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)
    harness.overview.onOpen()
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)
    harness.api.mockClear()
    harness.pushState.mockClear()

    await harness.wizard.onSubmit({
      ageBand: 'adult', heightCm: 170, weight: 74, waistCm: 9, chestCm: '', hipCm: '', armCm: '', thighCm: '', calfCm: '',
      goal: 'Força', experience: 'intermediario', availableDays: [1, 3], minutesPerSession: 45, focusAreas: [],
      gymName: 'Centro', genericEquipment: ['dumbbell'], specificMachines: [], favoriteExerciseIds: [], avoidedExerciseIds: [],
      limitations: '', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: false,
    })

    expect(harness.pushState).not.toHaveBeenCalled()
    expect(harness.api).not.toHaveBeenCalled()
  })

  it('persists a valid draft and creates one generation job after local preflight', async () => {
    await mountAndLoad()
    harness.effects = []
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)
    harness.overview.onOpen()
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)
    harness.api.mockClear().mockImplementation(async path => {
      if (path === '/api/ai/context') return harness.context
      if (path === '/api/ai/jobs') return { job: { id: 'job-new', status: 'queued' } }
      throw new Error(`unexpected ${path}`)
    })
    harness.pushState.mockClear()
    harness.persistContext.mockResolvedValue({
      context: { ...harness.context, completeness: { eligible: true, missing: [], blockers: [] } },
      status: { configured: true },
    })
    harness.pollJob.mockResolvedValue({ id: 'job-new', status: 'applied', planVersion: 3 })

    await harness.wizard.onSubmit({
      ageBand: 'adult', heightCm: 170, weight: 74, waistCm: '', chestCm: '', hipCm: '', armCm: '', thighCm: '', calfCm: '',
      goal: 'Força', experience: 'intermediario', availableDays: [1, 3], minutesPerSession: 45, focusAreas: [],
      gymName: 'Centro', genericEquipment: ['dumbbell'], specificMachines: [], favoriteExerciseIds: [], avoidedExerciseIds: [],
      limitations: '', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: false,
    })

    expect(harness.pushState).toHaveBeenCalledOnce()
    expect(harness.persistContext).toHaveBeenCalledOnce()
    expect(harness.api).toHaveBeenCalledWith('/api/ai/jobs', expect.objectContaining({ method: 'POST' }))
    expect(harness.pollJob).toHaveBeenCalledOnce()
  })

  it('copies the current AI routines into a separately editable workout', async () => {
    await mountAndLoad()
    harness.effects = []
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)
    harness.update.mockClear()
    harness.toast.mockClear()

    harness.overview.onCopy()

    expect(harness.update).toHaveBeenCalledOnce()
    expect(harness.state.routines).toHaveLength(3)
    expect(harness.state.routines.at(-1).name).toBe('Força IA · copy')
    expect(harness.toast).toHaveBeenCalledWith('{0} routines copied to My workout.')

    harness.state = { ...harness.state, routines: harness.state.routines.filter(routine => routine._aiGenerated !== true) }
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)
    harness.update.mockClear()
    harness.overview.onCopy()
    expect(harness.update).not.toHaveBeenCalled()
  })

  it('enables rollback from retained server history in a fresh browser and reconciles the restored plan', async () => {
    const previousPlan = {
      ...plan,
      id: 'plan-previous',
      version: 2,
      contextHash: 'ctx-2',
      justification: 'VersÃ£o anterior retida no servidor.',
      routines: [{
        id: 'ai-routine-previous', name: 'ForÃ§a anterior', exercises: [
          { id: 'ai-output-previous', exerciseId: '0001', mode: 'reps', sets: 2, repMin: 10, repMax: 12, restSeconds: 60 },
        ],
      }],
      schedule: [{ day: 3, routineId: 'ai-routine-previous' }],
    }
    harness.context = { ...harness.context, planHistory: [plan, previousPlan] }

    await mountAndLoad()
    harness.effects = []
    harness.stateCursor = 0
    renderToStaticMarkup(<AiPlanCard />)

    expect(localStorage.getItem('first_ai_context_student-a')).toBeTruthy()
    expect(harness.overview.canRollback).toBe(true)
    harness.api.mockImplementation(async (path, options) => {
      if (path === '/api/ai/plan/rollback') {
        expect(JSON.parse(options.body)).toEqual({ planId: 'plan-previous' })
        harness.context = { ...harness.context, plan: previousPlan, planHistory: [plan, previousPlan] }
        return { plan: previousPlan }
      }
      if (path === '/api/ai/context') return harness.context
      if (path === '/api/ai/status') return { configured: true }
      throw new Error(`unexpected ${path}`)
    })

    await harness.overview.onRollback()

    expect(harness.state.sourceSchedules.ai[0]).toMatchObject({ planId: 'plan-previous', version: 2, week: { 3: 'ai-routine-previous' } })
    expect(harness.state.routines.map(routine => routine.id)).toEqual(['manual', 'ai-routine-previous'])
    expect(harness.pushState).toHaveBeenCalledTimes(2)
  })
})
