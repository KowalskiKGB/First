import { describe, expect, it } from 'vitest'
import { aiMissingFields, aiProfile, equipmentLabel, latestBodyWeight } from './ai-plan.js'

describe('AI plan helpers', () => {
  it('detects missing student data before generation', () => {
    expect(aiMissingFields({ bodyweight: [], aiProfile: {} })).toEqual(['peso', 'altura', 'objetivo', 'aparelhos'])
  })

  it('keeps stable defaults for a student AI profile', () => {
    expect(aiProfile({}).experience).toBe('intermediario')
    expect(aiProfile({}).sessionsPerWeek).toBe(4)
  })

  it('finds the latest bodyweight by date', () => {
    expect(latestBodyWeight({ bodyweight: [{ d: '2026-08-28', w: 81 }, { d: '2026-08-29', w: 82 }] }).w).toBe(82)
  })

  it('labels exercise equipment in pt-BR', () => {
    expect(equipmentLabel('leverage machine')).toBe('Máquinas articuladas')
  })
})
