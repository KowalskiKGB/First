import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ buttons: [], calls: [], store: null, toasts: [] }))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(harness.store)
  useStore.getState = () => harness.store
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: message => harness.toasts.push(message) }) }))
vi.mock('../lib/api.js', () => ({
  api: async (path, options) => {
    harness.calls.push({ path, options })
    if (path === '/api/ai/jobs') return { job: { id: 'job-1', status: 'queued' } }
    if (path === '/api/ai/job?id=job-1') return { job: { id: 'job-1', status: 'applied' } }
    if (path === '/api/ai/context') return {
      plan: { id: 'plan-1', version: 1, justification: 'Seguro', appliedAt: 'now', routines: [], schedule: [{ day: 2, routineId: 'ai-routine' }] }
    }
    if (path === '/api/ai/status') return { configured: true, eligible: true, missing: [] }
    throw new Error(`unexpected ${path}`)
  }
}))
vi.mock('../lib/ai-plan.js', () => ({
  AI_EQUIPMENT: [], AI_EXPERIENCE: [], aiMissingFields: () => [],
  aiProfile: state => state.aiProfile, latestBodyWeight: () => ({ w: 70 })
}))
vi.mock('../lib/format.js', () => ({ DAYN: {}, uid: () => 'request-id', exCount: () => '' }))
vi.mock('../lib/i18n.js', () => ({ t: value => value }))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: value => value, DEFAULT_GLYPH: 'clipboard' }))
vi.mock('../sheets.jsx', () => ({ dayAssignSheet: vi.fn(), loadStarterPlan: vi.fn(), planToolsSheet: vi.fn() }))
vi.mock('../components/Icon.jsx', () => ({ default: () => <i /> }))
vi.mock('../components/ui.jsx', () => ({
  Button: props => { harness.buttons.push(props); return <button>{props.children}</button> },
  NumberField: () => <input />, Segmented: () => <div />, TextArea: () => <textarea />, TextField: () => <input />
}))

import { AiPlanCard } from './Plan.jsx'

describe('Plan AI job integration', () => {
  beforeEach(() => {
    harness.buttons.length = 0
    harness.calls.length = 0
    harness.toasts.length = 0
    harness.store = {
      S: {
        unit: 'kg', week: { 1: 'manual' }, routines: [{ id: 'manual', name: 'Manual', ex: [] }],
        aiProfile: { heightCm: 170, goal: 'Força', experience: 'intermediario', sessionsPerWeek: 3, minutesPerSession: 45, equipment: [] }
      },
      user: { id: 'student-a' },
      update: vi.fn(),
      pushState: vi.fn(async () => {}),
      replaceState: vi.fn(next => { harness.store.S = next })
    }
  })

  it('uses the async job flow, refreshes the state and never writes the manual week', async () => {
    renderToStaticMarkup(<AiPlanCard />)
    const generate = harness.buttons.find(button => button.children === 'Elaborar meu treino com IA')
    await generate.onClick()

    expect(harness.calls.map(call => call.path)).toEqual([
      '/api/ai/jobs', '/api/ai/job?id=job-1', '/api/ai/context'
    ])
    expect(harness.calls.some(call => call.path === '/api/ai/workout/generate')).toBe(false)
    expect(harness.store.replaceState).toHaveBeenCalledTimes(1)
    expect(harness.store.S.week).toEqual({ 1: 'manual' })
    expect(harness.store.S.aiSchedule).toEqual([{ day: 2, routineId: 'ai-routine' }])
    expect(harness.store.pushState).toHaveBeenCalledTimes(2)
    expect(harness.toasts.at(-1)).toMatch(/gerado e aplicado/i)
  })
})
