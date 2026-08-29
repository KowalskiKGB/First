import { describe, expect, it } from 'vitest'
import pt from '../locales/pt.js'
import { DATE_LOCALES, DEFAULT_LANG, LANGS } from './i18n.js'

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
})

