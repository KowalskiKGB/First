import { describe, expect, it } from 'vitest'

import { gymCities, gymInitialLocality, gymStates } from './gym-directory.js'

const gyms = [
  { id: 'gym-ce', state: 'CE', city: 'Fortaleza' },
  { id: 'gym-sp', state: 'SP', city: 'Campinas' },
]

describe('gym directory localities', () => {
  it('always exposes every Brazilian UF instead of deriving them from registered gyms', () => {
    expect(gymStates(gyms)).toHaveLength(27)
    expect(gymStates([])).toEqual(expect.arrayContaining(['AC', 'CE', 'DF', 'SP']))
  })

  it('starts empty but preserves the locality of an existing gym selection', () => {
    expect(gymInitialLocality(gyms)).toEqual({ state: '', city: '' })
    expect(gymInitialLocality(gyms, 'gym-sp')).toEqual({ state: 'SP', city: 'Campinas' })
  })

  it('merges API municipalities with gym cities from the selected UF', () => {
    expect(gymCities(gyms, 'CE', [
      { id: 2301000, name: 'Aquiraz' },
      { id: 2304400, name: 'Fortaleza' },
      { id: 2303709, name: 'Caucaia' },
    ])).toEqual(['Aquiraz', 'Caucaia', 'Fortaleza'])
  })
})
