import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  buttons: [],
  navigate: vi.fn(),
  state: null,
  routineId: 'personal-program-1-routine-a',
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => harness.navigate,
  useParams: () => ({ id: harness.routineId }),
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({
    S: harness.state,
    update: recipe => recipe(harness.state),
  }),
}))

vi.mock('../lib/format.js', () => ({ uid: () => 'copy-1' }))
vi.mock('../lib/exercises.js', () => ({ exOr: id => ({ id, n: 'Supino' }) }))
vi.mock('../lib/history.js', () => ({
  cleanupSg: vi.fn(),
  exLine: () => '4 × 8-12',
  supersetUnits: exercises => exercises.map((_, index) => [index]),
}))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: () => 'clipboard' }))
vi.mock('../lib/muscles.js', () => ({
  loadOfRoutine: () => ({}),
  rankOf: () => ({ worked: [] }),
  MUSCLE_NAME: {},
}))
vi.mock('../lib/progression.js', () => ({
  POLICIES_FOR: { reps: [] },
  POLICY_NAME: {},
  POLICY_DESC: {},
}))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => <span>mídia</span> }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => <div>mapa</div> }))
vi.mock('../sheets.jsx', () => ({
  glyphPicker: vi.fn(),
  exercisePicker: vi.fn(),
  exConfigSheet: vi.fn(),
  confirmSheet: vi.fn(),
}))
vi.mock('../components/ui.jsx', async () => {
  const ReactModule = await import('react')
  return {
    Button: props => {
      harness.buttons.push(props)
      return ReactModule.createElement('button', null, props.children)
    },
    SelectRow: () => ReactModule.createElement('div', null, 'Progression'),
  }
})

import RoutineEdit from './RoutineEdit.jsx'

const prescribedRoutine = () => ({
  id: 'personal-program-1-routine-a',
  name: 'Treino A',
  emoji: 'clipboard',
  _personalProgramId: 'program-1',
  _personalProgramName: 'Hipertrofia',
  _personalVersion: 2,
  prog: 'linear',
  ex: [{
    id: '0043', sets: 4, reps: 12, repsMin: 8, repsMax: 12,
    prescribedRepsLabel: '8-12', prog: 'double', note: 'Amplitude controlada',
  }],
})

describe('RoutineEdit prescribed routine', () => {
  beforeEach(() => {
    harness.buttons.length = 0
    harness.navigate.mockReset()
    harness.routineId = 'personal-program-1-routine-a'
    harness.state = {
      unit: 'kg', body: 'male',
      routines: [prescribedRoutine()],
      week: { 1: 'personal-program-1-routine-a' },
      dayPlan: { '2026-08-31': 'personal-program-1-routine-a' },
    }
  })

  it('is read-only and copies to an independent editable routine without replacing the Personal schedule', () => {
    const markup = renderToStaticMarkup(<RoutineEdit />)

    expect(markup).toContain('Programa do Personal')
    expect(markup).toContain('Hipertrofia')
    expect(markup).toContain('Versão 2')
    expect(markup).toContain('Copiar para meu plano')
    expect(markup).not.toContain('<input')
    expect(markup).not.toContain('Progression')
    expect(markup).not.toContain('Add exercise')
    expect(markup).not.toContain('Delete routine')
    expect(markup).not.toContain('Move up')

    const copyButton = harness.buttons.find(button => button.children === 'Copiar para meu plano')
    expect(copyButton).toBeTruthy()
    copyButton.onClick()

    const copied = harness.state.routines[1]
    expect(copied).toEqual(expect.objectContaining({ id: 'copy-1', name: 'Treino A' }))
    expect(copied).not.toHaveProperty('_personalProgramId')
    expect(copied).not.toHaveProperty('_personalProgramName')
    expect(copied).not.toHaveProperty('_personalVersion')
    expect(copied.ex).toEqual(prescribedRoutine().ex)
    expect(copied.ex).not.toBe(harness.state.routines[0].ex)
    expect(harness.state.week).toEqual({ 1: 'personal-program-1-routine-a' })
    expect(harness.state.dayPlan).toEqual({ '2026-08-31': 'personal-program-1-routine-a' })
    expect(harness.navigate).toHaveBeenCalledWith('/plan/r/copy-1')
  })

  it('treats an AI routine as read-only and copies it as manual', () => {
    harness.routineId = 'ai-routine'
    harness.state.routines = [{
      id: 'ai-routine', name: 'Treino IA', emoji: 'sparkles', _aiGenerated: true,
      _aiPlanId: 'plan-1', _aiVersion: 3, ex: [{ id: '0043', _aiExerciseId: 'ai-exercise', sets: 3, reps: 10 }],
    }]

    const markup = renderToStaticMarkup(<RoutineEdit />)

    expect(markup).toContain('Plano da IA')
    expect(markup).toContain('VersÃ£o 3')
    expect(markup).toContain('Copiar e personalizar')
    expect(markup).not.toContain('<input')
    const copyButton = harness.buttons.find(button => button.children === 'Copiar e personalizar')
    copyButton.onClick()
    expect(harness.state.routines[1]).toEqual({ id: 'copy-1', name: 'Treino IA', emoji: 'sparkles', ex: [{ id: '0043', sets: 3, reps: 10 }] })
  })
})
