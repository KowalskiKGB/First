import { describe, expect, it } from 'vitest'
import namesPt from '../exercise-names/pt.js'
import instructionsPt from '../instr/pt.js'
import pt from '../locales/pt.js'
import { EXDB } from './exercises-data.js'
import {
  dateLocale,
  DATE_LOCALES,
  DEFAULT_LANG,
  exerciseName,
  getLang,
  INSTR_LANGS,
  instrFor,
  LANGS,
  setLang,
  t,
} from './i18n.js'

describe('Brazilian Portuguese defaults', () => {
  it('starts new installations in pt-BR', () => {
    expect(DEFAULT_LANG).toBe('pt')
    expect(LANGS.pt).toBe('Português (Brasil)')
    expect(DATE_LOCALES.pt).toBe('pt-BR')
  })

  it('uses Brazilian interface vocabulary', () => {
    expect(pt.Delete).toBe('Excluir')
    expect(pt.Save).toBe('Salvar')
    expect(pt.Settings).toBe('Configurações')
    expect(pt['Log body weight']).toBe('Registrar peso corporal')
  })

  it('translates the complete AI product workspace without falling back to English', () => {
    const aiWorkspaceKeys = [
      'Data and measurements',
      'Goal and availability',
      'Gym and preferences',
      'Review and consent',
      'Generate and apply',
      'Your workout can be updated',
      'Copy and customize',
      'Undo generation',
      'Weekly intelligence',
      'My workout',
      'Choose a session',
      'You have {0} sessions available.',
      'Prefer rest for this day',
      'Dev credential',
      'Providers and AI models',
      'AI providers',
      'Test structured output',
      'The saved key is never displayed again.',
      'Permission required',
      'Training profile and priorities',
      'Gym and equipment',
      'Applied AI plan',
      'Personal guidance:',
    ]

    expect(aiWorkspaceKeys.every(key => typeof pt[key] === 'string' && pt[key].trim() && pt[key] !== key)).toBe(true)
    expect(aiWorkspaceKeys.map(key => pt[key]).join(' ')).not.toMatch(/Ã|Â|�/)
  })

  it('covers every equipment label used by the catalogue', () => {
    const equipment = [...new Set(EXDB.map(ex => ex.eq).filter(Boolean))]

    expect(equipment).toHaveLength(28)
    expect(equipment.every(label => typeof pt[label] === 'string' && pt[label].trim())).toBe(true)
    expect(pt['leverage machine']).toBe('máquina articulada')
    expect(pt['stationary bike']).toBe('bicicleta ergométrica')
  })

  it('loads pt-BR strings and formats placeholders', async () => {
    await setLang('pt')

    expect(getLang()).toBe('pt')
    expect(dateLocale()).toBe('pt-BR')
    expect(t('Delete')).toBe('Excluir')
    expect(t('{0} exercises', 3)).toBe('3 exercícios')
  })

  it('loads complete pt-BR exercise names and instructions by stable id', async () => {
    await setLang('pt')
    const exercise = EXDB.find(ex => ex.id === '0001')

    expect(INSTR_LANGS).toContain('pt')
    expect(Object.keys(namesPt)).toHaveLength(EXDB.length)
    expect(Object.keys(instructionsPt)).toHaveLength(EXDB.length)
    expect(Object.keys(namesPt).toSorted()).toEqual(EXDB.map(ex => ex.id).toSorted())
    expect(Object.keys(instructionsPt).toSorted()).toEqual(EXDB.map(ex => ex.id).toSorted())
    expect(Object.values(namesPt).every(name => typeof name === 'string' && name.trim())).toBe(true)
    expect(Object.values(instructionsPt).reduce((total, steps) => total + steps.length, 0)).toBe(7710)
    expect(exerciseName(exercise)).toBe('Abdominal 3/4')
    expect(instrFor(exercise)[0]).toBe('Deite-se de costas, com os joelhos dobrados e os pés apoiados no chão.')
  })

  it('keeps user-created and untranslated names as safe fallbacks', async () => {
    await setLang('pt')
    expect(exerciseName({ id: 'custom-own', n: 'Meu exercício' })).toBe('Meu exercício')

    await setLang('en')
    expect(exerciseName({ id: '0001', n: '3/4 sit-up' })).toBe('3/4 sit-up')
  })

  it('falls back safely for unknown languages and missing exercise ids', async () => {
    await setLang('not-a-language')
    expect(getLang()).toBe('en')
    expect(dateLocale()).toBe('en-GB')
    expect(t('Missing {0}', 'value')).toBe('Missing value')

    await setLang('pt')
    expect(instrFor({ id: 'no-pack', st: ['fallback step'] })).toEqual(['fallback step'])
  })
})
