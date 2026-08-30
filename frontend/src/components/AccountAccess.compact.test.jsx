import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/i18n.js', () => ({
  t: (message, ...args) => {
    const pt = {
      'Create account': 'Criar conta',
      'Full name': 'Nome completo',
      'Email': 'E-mail',
      'Password': 'Senha',
      'Current weight': 'Peso atual',
      'Height': 'Altura',
      'Waist': 'Cintura',
      'Arm': 'Braço',
      'Main goal': 'Objetivo principal',
      'Access': 'Acesso',
      'Body and goal': 'Corpo e meta',
      'Lose weight': 'Perder peso',
      'Gain muscle': 'Ganhar massa',
      'Both': 'Ambos',
      'Choose later': 'Decidir depois',
    }
    return args.reduce((text, value, index) => text.replaceAll(`{${index}}`, value), pt[message] || message)
  },
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))

import { AccountAccess } from './AccountAccess.jsx'

const renderRegister = () => renderToStaticMarkup(<AccountAccess mode="register" onModeChange={() => {}} onSubmit={() => {}} />)

describe('AccountAccess compact registration contract', () => {
  it('groups credentials and body data into solid registration sections', () => {
    const markup = renderRegister()

    expect(markup).toContain('<legend>Acesso</legend>')
    expect(markup).toContain('<legend>Corpo e meta</legend>')
    expect(markup).toContain('account-access-section')
    expect(markup).toContain('measure-card')
  })

  it('labels measurements with persistent units and formats height in meters', () => {
    const markup = renderRegister()

    expect(markup).toContain('aria-label="Peso atual em kg"')
    expect(markup).toContain('aria-label="Altura em metros"')
    expect(markup).toContain('aria-label="Cintura em cm"')
    expect(markup).toContain('aria-label="Braço em cm"')
    expect(markup).toContain('name="heightM"')
    expect(markup).not.toContain('name="heightCm"')
  })

  it('uses a fieldset of radio choices for the training goal', () => {
    const markup = renderRegister()

    expect(markup).toContain('<legend>Objetivo principal</legend>')
    expect(markup).not.toMatch(/<select\b[^>]*name="goal"/)
    expect(markup.match(/type="radio"[^>]*name="goal"/g)).toHaveLength(4)
    expect(markup).toContain('Perder peso')
    expect(markup).toContain('Ganhar massa')
    expect(markup).toContain('Ambos')
    expect(markup).toContain('Decidir depois')
  })
})
