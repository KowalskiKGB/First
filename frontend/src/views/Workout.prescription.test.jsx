import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../store/useStore.js', () => {
  const useStore = vi.fn()
  useStore.getState = vi.fn(() => ({}))
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = vi.fn()
  useUI.getState = vi.fn(() => ({}))
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(),
  exerciseDetailSheet: vi.fn(), topWeightSheet: vi.fn(), finishWorkout: vi.fn(),
  workoutCompleteSheet: vi.fn(), confirmSheet: vi.fn(),
}))

import { PrescribedNote } from './Workout.jsx'

describe('PrescribedNote', () => {
  it('shows only a non-empty note already carried by the workout target', () => {
    expect(renderToStaticMarkup(<PrescribedNote target={{ note: 'Amplitude controlada' }} />))
      .toContain('Amplitude controlada')
    expect(renderToStaticMarkup(<PrescribedNote target={{ note: '   ' }} />)).toBe('')
    expect(renderToStaticMarkup(<PrescribedNote />)).toBe('')
  })
})
