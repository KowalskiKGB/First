import { describe, expect, it } from 'vitest'

import { activeSourceMetadata, normalizeScheduleState, scheduledRoutineOptions } from './schedule.js'

const routines = [
  { id: 'manual', name: 'Manual', ex: [] },
  { id: 'personal-a', name: 'Personal A', ex: [], _personalProgramId: 'personal-plan', _personalVersion: 2 },
  { id: 'ai-a', name: 'IA A', ex: [], _aiGenerated: true, _aiPlanId: 'ai-plan', _aiVersion: 3 },
]

const coexistenceState = dayPlan => ({
  routines,
  week: { 1: 'manual' },
  dayPlan: dayPlan || {},
  sourceSchedules: {
    personal: [{ sourceType: 'personal', planId: 'personal-plan', version: 2, label: 'Força', active: true, week: { 1: 'personal-a' } }],
    ai: [{ sourceType: 'ai', planId: 'ai-plan', version: 3, label: 'Plano IA v3', active: true, week: { 1: 'ai-a' } }],
  },
})

describe('scheduledRoutineOptions', () => {
  it('returns manual, Personal and AI sessions together on the same Monday', () => {
    const options = scheduledRoutineOptions(coexistenceState(), '2026-08-31')

    expect(options.map(({ routineId, sourceType, planId, version }) => ({ routineId, sourceType, planId, version }))).toEqual([
      { routineId: 'manual', sourceType: 'manual', planId: null, version: null },
      { routineId: 'personal-a', sourceType: 'personal', planId: 'personal-plan', version: 2 },
      { routineId: 'ai-a', sourceType: 'ai', planId: 'ai-plan', version: 3 },
    ])
  })

  it('moves the dayPlan preference first without hiding alternatives', () => {
    const options = scheduledRoutineOptions(coexistenceState({ '2026-08-31': 'ai-a' }), '2026-08-31')

    expect(options.map(option => option.routineId)).toEqual(['ai-a', 'manual', 'personal-a'])
    expect(options.map(option => option.preferred)).toEqual([true, false, false])
  })

  it('keeps every option when rest is preferred', () => {
    const options = scheduledRoutineOptions(coexistenceState({ '2026-08-31': 'rest' }), '2026-08-31')

    expect(options.map(option => option.routineId)).toEqual(['manual', 'personal-a', 'ai-a'])
    expect(options.every(option => option.preferred === false)).toBe(true)
  })

  it('deduplicates the same managed source/plan/routine but keeps distinct source sessions', () => {
    const state = coexistenceState()
    state.sourceSchedules.personal.push({ ...state.sourceSchedules.personal[0], version: 3 })

    const options = scheduledRoutineOptions(state, '2026-08-31')

    expect(options).toHaveLength(3)
    expect(options.filter(option => option.routineId === 'personal-a')).toHaveLength(1)
  })

  it('supports multiple routines per managed weekday and ignores inactive or missing routines', () => {
    const state = coexistenceState({ '2026-08-31': { routineId: 'personal-b', sourceType: 'personal', planId: 'personal-plan', version: 2 } })
    state.routines = [...state.routines, { id: 'personal-b', name: 'Personal B', ex: [] }]
    state.sourceSchedules.personal = [
      { ...state.sourceSchedules.personal[0], week: { 1: ['personal-a', 'personal-b', 'missing'] } },
      { sourceType: 'personal', planId: 'inactive', version: 1, active: false, week: { 1: 'personal-b' } },
    ]

    expect(scheduledRoutineOptions(state, '2026-08-31').map(option => option.routineId)).toEqual([
      'personal-b', 'manual', 'personal-a', 'ai-a',
    ])
  })
})

describe('activeSourceMetadata', () => {
  it('carries origin metadata into active and completed workouts', () => {
    expect(activeSourceMetadata({ routineId: 'ai-a', sourceType: 'ai', planId: 'ai-plan', version: 3 })).toEqual({
      sourceType: 'ai', planId: 'ai-plan', version: 3,
    })
    expect(activeSourceMetadata('manual')).toEqual({ sourceType: 'manual', planId: null, version: null })
  })
})

describe('normalizeScheduleState', () => {
  it('immutably migrates identifiable managed routines out of legacy week and consumes aiSchedule', () => {
    const legacy = {
      routines,
      week: { 1: 'personal-a', 2: 'ai-a', 3: 'manual' },
      dayPlan: { '2026-09-01': 'ai-a' },
      aiSchedule: [{ day: 4, routineId: 'ai-a' }],
      aiLastGeneration: { planId: 'ai-plan', version: 3, name: 'Plano IA v3' },
    }

    const normalized = normalizeScheduleState(legacy)

    expect(normalized.week).toEqual({ 3: 'manual' })
    expect(normalized.dayPlan).toEqual(legacy.dayPlan)
    expect(normalized.sourceSchedules.personal[0]).toMatchObject({ planId: 'personal-plan', version: 2, week: { 1: 'personal-a' } })
    expect(normalized.sourceSchedules.ai[0]).toMatchObject({ planId: 'ai-plan', version: 3, week: { 2: 'ai-a', 4: 'ai-a' } })
    expect(legacy.week).toEqual({ 1: 'personal-a', 2: 'ai-a', 3: 'manual' })
    expect(normalizeScheduleState(normalized)).toEqual(normalized)
  })

  it('normalizes empty, invalid and array-valued schedules without inventing options', () => {
    const normalized = normalizeScheduleState({
      routines: [], week: { 7: 'missing' }, dayPlan: null,
      sourceSchedules: {
        personal: [{ sourceType: 'wrong', planId: '', version: 0, active: false, week: { 1: ['', null], 9: 'missing' } }],
        ai: 'invalid',
      },
      aiSchedule: [{ day: 'bad', routineId: 'missing' }],
    })

    expect(normalized).toMatchObject({
      week: { 7: 'missing' }, dayPlan: {},
      sourceSchedules: { personal: [{ sourceType: 'personal', planId: 'legacy-personal', version: 1, active: false, week: {} }], ai: [] },
    })
    expect(scheduledRoutineOptions(normalized, '2026-08-31')).toEqual([])
  })
})
