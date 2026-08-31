import { describe, expect, it } from 'vitest'

import {
  createGymRequestGate,
  distanceKm,
  filterGyms,
  gymCities,
  gymInitialLocality,
  gymConflictRevision,
  gymListPath,
  gymStates,
  isGymOpen,
  rankGyms,
} from './gym-directory.js'

describe('gym directory request coordination', () => {
  it('never puts user coordinates in the public gym-list URL', () => {
    expect(gymListPath()).toBe('/api/gyms?limit=100')
  })

  it('aborts and invalidates an older list request when a newer one starts', () => {
    const gate = createGymRequestGate()
    const first = gate.begin()
    const second = gate.begin()

    expect(first.signal.aborted).toBe(true)
    expect(first.isCurrent()).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })

  it('uses the fresh server revision only for a stale-write conflict', () => {
    expect(gymConflictRevision({ status: 409, rev: 31 })).toBe(31)
    expect(gymConflictRevision({ status: 409, rev: '31' })).toBeNull()
    expect(gymConflictRevision({ status: 500, rev: 31 })).toBeNull()
  })
})

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

describe('gym social discovery', () => {
  const socialGyms = [
    {
      id: 'far-favorite', name: 'Smart Fit Centro', networkName: 'Smart Fit', state: 'AP', city: 'Macapá',
      address: 'Rua A', neighborhood: 'Central', latitude: 0.04, longitude: -51.07,
      tags: ['Preferida', 'Rede Smart Fit'], averageRating: 4.7, reviewCount: 31,
    },
    {
      id: 'near-trending', name: 'Box Tucuju', state: 'AP', city: 'Macapá',
      address: 'Avenida B', neighborhood: 'Buritizal', latitude: 0.001, longitude: -51.001,
      tags: ['Em alta'], averageRating: 4.9, reviewCount: 12,
    },
  ]

  it('calculates distance without mutating or persisting the user coordinates', () => {
    const location = Object.freeze({ latitude: 0, longitude: -51 })

    expect(distanceKm(location, socialGyms[1])).toBeCloseTo(0.16, 1)
    expect(distanceKm({}, socialGyms[1])).toBeNull()
    expect(location).toEqual({ latitude: 0, longitude: -51 })
  })

  it('searches network and neighborhood and applies the social chips', () => {
    expect(filterGyms(socialGyms, { state: 'AP', city: 'Macapá', query: 'smart central' }).map(gym => gym.id)).toEqual(['far-favorite'])
    expect(rankGyms(socialGyms, { filter: 'favorites' }).map(gym => gym.id)).toEqual(['far-favorite'])
    expect(rankGyms(socialGyms, { filter: 'trending' }).map(gym => gym.id)).toEqual(['near-trending'])
    expect(rankGyms(socialGyms, { filter: 'nearby', location: { latitude: 0, longitude: -51 } }).map(gym => gym.id)).toEqual(['near-trending', 'far-favorite'])
  })

  it('keeps favorites first in the default ranking and reports current opening state', () => {
    expect(rankGyms(socialGyms, { filter: 'all', location: { latitude: 0, longitude: -51 } })[0].id).toBe('far-favorite')
    expect(isGymOpen({ openingHours: [{ day: 1, open: '06:00', close: '22:00', closed: false }] }, new Date('2026-08-31T12:00:00-03:00'))).toBe(true)
    expect(isGymOpen({ openingHours: [{ day: 1, open: '06:00', close: '22:00', closed: false }] }, new Date('2026-08-31T23:00:00-03:00'))).toBe(false)
    expect(isGymOpen({ openingHours: [] }, new Date())).toBeNull()
  })
})
