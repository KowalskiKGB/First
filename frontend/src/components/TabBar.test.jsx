import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  pathname: '/home',
  navigate: vi.fn(),
  state: { active: null },
  user: { id: 'student-1', name: 'Ana' },
  isGuest: false,
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: harness.pathname }),
  useNavigate: () => harness.navigate,
}))
vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({
    S: harness.state,
    user: harness.user,
    isGuest: () => harness.isGuest,
  }),
}))
vi.mock('../store/useCollaboration.js', () => ({
  useCollaboration: selector => selector({ context: 'student', profile: null, ownerId: null }),
}))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))
vi.mock('../lib/personal.js', () => ({ canEnterPersonal: () => false, personalTabs: () => [] }))
vi.mock('../lib/i18n.js', () => ({
  t: message => ({
    Home: 'Início',
    Plan: 'Plano',
    Start: 'Iniciar',
    Gyms: 'Academias',
    Exercises: 'Exercícios',
    Stats: 'Estatísticas',
    'Student navigation': 'Navegação do aluno',
  }[message] || message),
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))

import TabBar from './TabBar.jsx'

describe('student TabBar', () => {
  it('shows the primary student flow with gyms instead of statistics', () => {
    const markup = renderToStaticMarkup(<TabBar onStart={() => {}} />)

    expect(markup).toContain('Início')
    expect(markup).toContain('Plano')
    expect(markup).toContain('Iniciar')
    expect(markup).toContain('Academias')
    expect(markup).toContain('Exercícios')
    expect(markup).not.toContain('Estatísticas')
  })
})
