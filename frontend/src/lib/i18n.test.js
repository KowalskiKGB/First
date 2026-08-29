import { describe, expect, it } from 'vitest'
import pt from '../locales/pt.js'
import {
  dateLocale,
  DATE_LOCALES,
  DEFAULT_LANG,
  getLang,
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

  it('loads pt-BR strings and formats placeholders', async () => {
    await setLang('pt')

    expect(getLang()).toBe('pt')
    expect(dateLocale()).toBe('pt-BR')
    expect(t('Delete')).toBe('Excluir')
    expect(t('{0} exercises', 3)).toBe('3 exercícios')
  })

  it('falls back safely for unknown languages and missing instruction packs', async () => {
    await setLang('not-a-language')
    expect(getLang()).toBe('en')
    expect(dateLocale()).toBe('en-GB')
    expect(t('Missing {0}', 'value')).toBe('Missing value')

    await setLang('pt')
    expect(instrFor({ id: 'no-pack', st: ['fallback step'] })).toEqual(['fallback step'])
  })
})
