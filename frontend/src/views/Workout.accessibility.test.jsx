import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  state: {
    active: null,
    routines: [{ id: 'manual-a', name: 'Treino A', emoji: 'dumbbell', ex: [{ id: '0001' }] }],
    dayPlan: {}, week: {}, sourceSchedules: { personal: [], ai: [] },
  },
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector({ S: harness.state, update: vi.fn(), user: null })
  useStore.getState = () => ({ S: harness.state, update: vi.fn(), user: null })
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector({}) : {}
  useUI.getState = () => ({})
  return { useUI }
})
vi.mock('../lib/format.js', () => ({
  fmtNum: String, fmtDate: String, todayISO: () => '2026-08-31', exCount: count => `${count} exercises`,
  DAYN: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}))
vi.mock('../lib/i18n.js', () => ({
  exerciseName: exercise => exercise?.n || '',
  t: (message, ...args) => `i18n:${args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), message)}`,
}))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: () => 'dumbbell' }))
vi.mock('../lib/schedule.js', () => ({ scheduledRoutineOptions: () => [] }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseDetailSheet: vi.fn(),
  topWeightSheet: vi.fn(), finishWorkout: vi.fn(), workoutCompleteSheet: vi.fn(), confirmSheet: vi.fn(),
}))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/Media.jsx', () => ({ default: () => <span /> }))
vi.mock('../components/ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Check: () => <button />, NumberField: props => <input {...props} />,
}))

import Workout, { PrescribedNote } from './Workout.jsx'

describe('Workout accessibility', () => {
  it('uses a native button for every item under Other routines', () => {
    const markup = renderToStaticMarkup(<Workout />)

    expect(markup).toContain('<button class="item"')
    expect(markup).not.toContain('<div class="item"')
  })

  it('routes the Personal guidance label through i18n', () => {
    const markup = renderToStaticMarkup(<PrescribedNote target={{ note: 'Amplitude controlada' }} />)

    expect(markup).toContain('<strong>i18n:Personal guidance:</strong>')
  })
})
