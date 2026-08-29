import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ buttons: [], calls: [], fields: [], server: null, store: null, toasts: [] }))

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
    if (path === '/api/ai/context' && !options && harness.server.contextReads++ === 0) return {
      rev: 3, completeness: { eligible: false, missing: ['perfil', 'academia', 'peso'], blockers: [] }
    }
    if (path === '/api/ai/profile') {
      if (harness.server.profileError) throw new Error('Falha ao salvar perfil.')
      return { rev: 4 }
    }
    if (path === '/api/ai/gym') return { rev: 5 }
    if (path === '/api/ai/measurements') return { rev: 6 }
    if (path === '/api/ai/jobs') return { job: { id: 'job-1', status: 'queued' } }
    if (path === '/api/ai/job?id=job-1') return { job: { id: 'job-1', status: 'applied' } }
    if (path === '/api/ai/context') return {
      rev: 6, completeness: { eligible: true, missing: [], blockers: [] },
      plan: { id: 'plan-1', version: 1, justification: 'Seguro', appliedAt: 'now', routines: [], schedule: [{ day: 2, routineId: 'ai-routine' }] }
    }
    if (path === '/api/ai/status') return { configured: true, eligible: true, missing: [] }
    throw new Error(`unexpected ${path}`)
  }
}))
vi.mock('../lib/ai-plan.js', () => ({
  AI_EQUIPMENT: [['dumbbell', 'Halteres']], AI_EXPERIENCE: [['intermediario', 'Intermediário']], aiMissingFields: () => [],
  aiProfile: state => state.aiProfile, latestBodyWeight: () => ({ w: 70 })
}))
vi.mock('../lib/format.js', () => ({ DAYN: {}, uid: () => 'request-id', exCount: () => '' }))
vi.mock('../lib/i18n.js', () => ({ t: value => value }))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: value => value, DEFAULT_GLYPH: 'clipboard' }))
vi.mock('../sheets.jsx', () => ({ dayAssignSheet: vi.fn(), loadStarterPlan: vi.fn(), planToolsSheet: vi.fn() }))
vi.mock('../components/Icon.jsx', () => ({ default: () => <i /> }))
vi.mock('../components/ui.jsx', () => ({
  Button: props => { harness.buttons.push(props); return <button disabled={props.disabled}>{props.children}</button> },
  NumberField: props => { harness.fields.push(props); return <input name={props.name} aria-label={props['aria-label']} /> },
  Segmented: props => { harness.fields.push(props); return <div /> },
  TextArea: props => { harness.fields.push(props); return <textarea name={props.name} /> },
  TextField: props => { harness.fields.push(props); return <input name={props.name} /> }
}))

import { AiPlanCard } from './Plan.jsx'

describe('Plan AI job integration', () => {
  beforeEach(() => {
    harness.buttons.length = 0
    harness.calls.length = 0
    harness.fields.length = 0
    harness.toasts.length = 0
    harness.server = { contextReads: 0, profileError: false }
    harness.store = {
      S: {
        unit: 'kg', week: { 1: 'manual' }, routines: [{ id: 'manual', name: 'Manual', ex: [] }],
        aiProfile: {
          ageBand: 'adult', consent: true, guardianConsent: false, availableDays: [1, 3, 5],
          heightCm: 170, goal: 'Força', experience: 'intermediario', sessionsPerWeek: 3,
          minutesPerSession: 45, equipment: ['dumbbell'], gymName: 'Academia Centro'
        }
      },
      user: { id: 'student-a' },
      update: vi.fn(recipe => recipe(harness.store.S)),
      pushState: vi.fn(async () => {}),
      replaceState: vi.fn(next => { harness.store.S = next })
    }
  })

  it('saves an initially incomplete canonical context before the async job and never writes the manual week', async () => {
    harness.store.S.aiProfile = {
      ...harness.store.S.aiProfile, ageBand: undefined, consent: false, gymName: ''
    }
    renderToStaticMarkup(<AiPlanCard />)
    harness.fields.find(field => field.options?.some(option => option.value === 'adult')).onChange('adult')
    harness.fields.find(field => field.options?.some(option => option.value === true)).onChange(true)
    harness.fields.find(field => field.name === 'ai-gym-name').onChange({ target: { value: 'Academia Centro' } })

    harness.buttons.length = 0
    harness.fields.length = 0
    const markup = renderToStaticMarkup(<AiPlanCard />)
    const generate = harness.buttons.find(button => button.children === 'Elaborar meu treino com IA')
    expect(generate.disabled).toBe(false)
    expect(markup).toMatch(/Faixa etária/)
    expect(markup).toMatch(/Dias disponíveis/)
    await generate.onClick()

    expect(harness.calls.map(call => call.path)).toEqual([
      '/api/ai/context', '/api/ai/profile', '/api/ai/gym', '/api/ai/measurements',
      '/api/ai/context', '/api/ai/status', '/api/ai/jobs', '/api/ai/job?id=job-1', '/api/ai/context'
    ])
    expect(JSON.parse(harness.calls[1].options.body).rev).toBe(3)
    expect(JSON.parse(harness.calls[2].options.body).rev).toBe(4)
    expect(JSON.parse(harness.calls[3].options.body).rev).toBe(5)
    expect(harness.calls.some(call => call.path === '/api/ai/workout/generate')).toBe(false)
    expect(harness.store.replaceState).toHaveBeenCalledTimes(1)
    expect(harness.store.S.week).toEqual({ 1: 'manual' })
    expect(harness.store.S.aiSchedule).toEqual([{ day: 2, routineId: 'ai-routine' }])
    expect(harness.store.pushState).toHaveBeenCalledTimes(2)
    expect(harness.toasts.at(-1)).toMatch(/gerado e aplicado/i)
  })

  it('does not create a job for a minor without explicit guardian consent', async () => {
    harness.store.S.aiProfile = { ...harness.store.S.aiProfile, ageBand: '14to17', guardianConsent: false }
    renderToStaticMarkup(<AiPlanCard />)
    const generate = harness.buttons.find(button => button.children === 'Elaborar meu treino com IA')
    await generate.onClick()

    expect(harness.calls).toEqual([])
    expect(harness.toasts.at(-1)).toMatch(/responsável/i)
  })

  it('does not create a job when a canonical save fails', async () => {
    harness.server.profileError = true
    renderToStaticMarkup(<AiPlanCard />)
    const generate = harness.buttons.find(button => button.children === 'Elaborar meu treino com IA')
    await generate.onClick()

    expect(harness.calls.map(call => call.path)).toEqual(['/api/ai/context', '/api/ai/profile'])
    expect(harness.calls.some(call => call.path === '/api/ai/jobs')).toBe(false)
    expect(harness.toasts.at(-1)).toBe('Falha ao salvar perfil.')
  })
})
