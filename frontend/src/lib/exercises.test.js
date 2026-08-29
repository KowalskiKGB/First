import { describe, expect, it } from 'vitest'
import { setLang } from './i18n.js'
import {
  allExercises,
  equipmentOf,
  exerciseMatchesQuery,
  exerciseSearchText,
  searchKey,
  exOr,
  EXIDX,
  gifSrc,
  imgSrc,
  isBodyweightEq,
  isCardio,
  mediaEnabled,
  registerCustom,
} from './exercises.js'

describe('optional exercise media', () => {
  it('does not request third-party media without an explicit licensed-media build flag', () => {
    const exercise = { img: 'example.jpg', gif: 'example.gif' }

    expect(mediaEnabled).toBe(false)
    expect(imgSrc(exercise)).toBeNull()
    expect(gifSrc(exercise)).toBeNull()
  })
})

describe('exercise catalogue helpers', () => {
  it('sorts available equipment by frequency and name', () => {
    expect(equipmentOf([
      { eq: 'barbell' },
      { eq: 'body weight' },
      { eq: 'barbell' },
      { eq: 'cable' },
      { eq: 'body weight' },
      { eq: 'band' },
      {},
    ])).toEqual(['barbell', 'body weight', 'band', 'cable'])
  })

  it('registers custom exercises ahead of the built-in catalogue', () => {
    const custom = { id: 'custom-first-row', n: 'Custom Row', bp: 'back', eq: 'band' }

    registerCustom([custom])
    expect(EXIDX[custom.id]).toBe(custom)
    expect(allExercises({ customEx: [custom] })[0]).toBe(custom)

    registerCustom([])
    expect(EXIDX[custom.id]).toBeUndefined()
  })

  it('detects cardio/bodyweight exercises and supplies safe placeholders', () => {
    expect(isCardio({ bp: 'cardio' })).toBe(true)
    expect(isCardio({ bp: 'chest' })).toBe(false)
    expect(isBodyweightEq({ eq: 'body weight' })).toBe(true)
    expect(isBodyweightEq({ eq: 'dumbbell' })).toBe(false)

    expect(exOr('missing-exercise-id')).toMatchObject({
      id: 'missing-exercise-id',
      missing: true,
    })
  })

  it('searches the catalogue by Portuguese and English vocabulary', async () => {
    await setLang('pt')
    const exercise = EXIDX['0025']
    const haystack = exerciseSearchText(exercise)

    expect(haystack).toContain(exercise.n.toLowerCase())
    expect(haystack).toContain('supino')
    expect(haystack).toContain('barra')
    expect(exerciseMatchesQuery(exercise, 'supino barra')).toBe(true)
  })

  it('normalizes accents for Brazilian Portuguese search terms', async () => {
    await setLang('pt')
    const stabilityBall = Object.values(EXIDX).find(ex => ex.eq === 'stability ball')

    expect(searchKey('Flexão de tríceps na bola suíça')).toBe('flexao de triceps na bola suica')
    expect(exerciseSearchText(EXIDX['0002'])).toContain('flexao')
    expect(exerciseSearchText(stabilityBall)).toContain('bola suica')
  })
})
