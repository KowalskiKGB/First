import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  boot: vi.fn(),
  collaborationLoad: vi.fn(),
  syncPersonalPrograms: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  HashRouter: ({ children }) => <div data-router="student-app">{children}</div>,
  Routes: ({ children }) => <>{children}</>,
  Route: () => null,
  Navigate: () => <div data-view="redirect" />,
  useLocation: () => ({ pathname: '/home' }),
  useNavigate: () => vi.fn(),
}))
vi.mock('./store/useStore.js', () => {
  const state = {
    S: { theme: 'dark', accent: 'lime', lang: 'pt-BR', active: null },
    user: null,
    ready: true,
    boot: harness.boot,
    isGuest: () => false,
    syncPersonalPrograms: harness.syncPersonalPrograms,
  }
  return { useStore: selector => selector ? selector(state) : state }
})
vi.mock('./store/useCollaboration.js', () => {
  const state = { load: harness.collaborationLoad, programs: [] }
  return { useCollaboration: selector => selector(state) }
})
vi.mock('./store/useUI.js', () => ({ useUI: () => ({}) }))
vi.mock('./components/ui.jsx', () => ({ bindUI: vi.fn() }))
vi.mock('./lib/format.js', () => ({ ACCENTS: { lime: '#00ff00' } }))
vi.mock('./lib/i18n.js', () => ({ DEFAULT_LANG: 'pt-BR', setLang: vi.fn(), useLang: () => 'pt-BR' }))
vi.mock('./lib/nav.js', () => ({ setNav: vi.fn() }))
vi.mock('./lib/wakelock.js', () => ({ useWakeLock: vi.fn() }))
vi.mock('./sheets.jsx', () => ({ startFlow: vi.fn() }))
vi.mock('./components/Icon.jsx', () => ({ default: () => <i /> }))
vi.mock('./components/TabBar.jsx', () => ({ default: () => <nav data-view="student-tabs">tabs</nav> }))
vi.mock('./components/ErrorBoundary.jsx', () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('./components/Modals.jsx', () => ({ default: () => <div data-view="student-modals" /> }))
vi.mock('./components/Toast.jsx', () => ({ default: () => null }))
vi.mock('./components/RestTimer.jsx', () => ({ default: () => null }))
vi.mock('./views/Login.jsx', () => ({ default: () => <main data-view="student-login">student login</main> }))
vi.mock('./views/DevPanel.jsx', () => ({ default: () => <main data-view="devadmin-login">dev login</main> }))
vi.mock('./views/Home.jsx', () => ({ default: () => null }))
vi.mock('./views/Plan.jsx', () => ({ default: () => null }))
vi.mock('./views/RoutineEdit.jsx', () => ({ default: () => null }))
vi.mock('./views/Workout.jsx', () => ({ default: () => null }))
vi.mock('./views/Stats.jsx', () => ({ default: () => null }))
vi.mock('./views/History.jsx', () => ({ default: () => null }))
vi.mock('./views/Library.jsx', () => ({ default: () => null }))
vi.mock('./views/Settings.jsx', () => ({ default: () => null }))
vi.mock('./views/Admin.jsx', () => ({ default: () => null }))
vi.mock('./views/personal/PersonalGuard.jsx', () => ({ default: ({ children }) => children }))
vi.mock('./views/personal/PersonalHome.jsx', () => ({ default: () => null }))
vi.mock('./views/personal/Students.jsx', () => ({ default: () => null }))
vi.mock('./views/personal/StudentDetail.jsx', () => ({ default: () => null }))
vi.mock('./views/personal/Agenda.jsx', () => ({ default: () => null }))
vi.mock('./views/personal/Finance.jsx', () => ({ default: () => null }))
vi.mock('./views/student/Connections.jsx', () => ({ default: () => null }))

import App from './App.jsx'

describe('literal /devadmin entry', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders only the protected Dev surface without requiring a student session', () => {
    vi.stubGlobal('window', { location: { pathname: '/devadmin' }, scrollTo: vi.fn() })

    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('data-view="devadmin-login"')
    expect(markup).not.toContain('data-view="student-login"')
    expect(markup).not.toContain('data-view="student-tabs"')
    expect(markup).not.toContain('data-router="student-app"')
  })
})
