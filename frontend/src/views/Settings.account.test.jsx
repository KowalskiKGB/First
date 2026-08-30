import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  user: null,
  navigate: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => harness.navigate }))
vi.mock('../store/useStore.js', () => {
  const state = {
    S: { lang: 'pt-BR', unit: 'kg', restSec: 90, sound: false, keepAwake: false, theme: 'dark', body: 'male', accent: 'lime', reminder: {} },
    get user() { return harness.user },
    update: vi.fn(), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(),
  }
  const useStore = selector => selector ? selector(state) : state
  useStore.getState = () => state
  return { useStore, DEF: { reminder: { time: '18:00' } }, hasData: () => false }
})
vi.mock('../store/useCollaboration.js', () => {
  const state = { profile: null, ownerId: null, context: 'student', setContext: vi.fn(), activateTrainer: vi.fn(), load: vi.fn(), reset: vi.fn() }
  return { useCollaboration: selector => selector(state) }
})
vi.mock('../store/useUI.js', () => {
  const state = { toast: harness.toast, openSheet: vi.fn() }
  const useUI = selector => selector(state)
  useUI.getState = () => state
  return { useUI }
})
vi.mock('../lib/format.js', () => ({ ACCENTS: { lime: '#00ff00' }, todayISO: () => '2026-08-30', localTZ: () => 'America/Fortaleza' }))
vi.mock('../lib/history.js', () => ({ effortOf: () => 'none' }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false }))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/i18n.js', () => ({
  DEFAULT_LANG: 'pt-BR', LANGS: { 'pt-BR': 'Português' }, INSTR_LANGS: ['pt-BR'],
  t: (message, ...args) => args.reduce((text, value, index) => text.replaceAll(`{${index}}`, value), message),
}))
vi.mock('../lib/demo.js', () => ({ APP_NAME: 'First', DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../lib/exercises.js', () => ({ mediaEnabled: false }))
vi.mock('../sheets.jsx', () => ({ loadStarterPlan: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn() }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ui.jsx', () => ({
  Section: ({ title, children }) => <section><h2>{title}</h2>{children}</section>,
  Row: ({ title, subtitle, children }) => <div>{title}{subtitle}{children}</div>,
  SelectRow: ({ title }) => <div>{title}</div>,
  Switch: () => <input type="checkbox" readOnly />,
  Segmented: () => <div />,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  TextField: props => <input {...props} />,
  NumberField: ({ decimal, nullable, value, ...props }) => <input value={value ?? ''} {...props} />,
}))

import Settings, { ProfileEditor } from './Settings.jsx'

const fieldTag = (markup, name) => markup.match(new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bname="${name}"[^>]*>`))?.[0] || ''

describe('Settings account boundary', () => {
  beforeEach(() => {
    harness.user = null
    harness.navigate.mockReset()
    harness.toast.mockReset()
  })

  it('does not duplicate login or registration controls for a guest', () => {
    const markup = renderToStaticMarkup(<Settings />)

    expect(markup).not.toContain('Sign in with passkey')
    expect(markup).not.toContain('Create passkey profile')
    expect(markup).not.toContain('Dev panel')
    expect(markup).not.toMatch(/<h2>Profile<\/h2>/)
  })

  it('shows the editable Profile area only to a logged-in user and never links Dev', () => {
    harness.user = { id: 'student-1', name: 'Ana Souza', email: 'ana@example.com', admin: true }

    const markup = renderToStaticMarkup(<Settings />)

    expect(markup).toMatch(/<h2>Profile<\/h2>/)
    expect(markup).toContain('Ana Souza')
    expect(markup).toContain('ana@example.com')
    expect(markup).not.toContain('Dev panel')
    expect(markup).not.toContain('Providers and AI models')
  })

  it('keeps email and password changes inside the protected profile editor', () => {
    harness.user = { id: 'student-1', name: 'Ana Souza', email: 'ana@example.com' }

    const markup = renderToStaticMarkup(<ProfileEditor close={() => {}} />)

    expect(markup).toContain('name="profile-email"')
    expect(markup).not.toMatch(/name="profile-email"[^>]*disabled/)
    expect(markup).toContain('name="profile-current-password"')
    expect(markup).toContain('name="profile-new-password"')
    expect(fieldTag(markup, 'profile-email')).toContain('type="email"')
    expect(fieldTag(markup, 'profile-email')).toContain('autoComplete="email"')
    expect(fieldTag(markup, 'profile-email')).not.toContain('spellCheck="true"')
    expect(fieldTag(markup, 'profile-weight')).toContain('autoComplete="off"')
    expect(fieldTag(markup, 'profile-goal')).toContain('autoComplete="off"')
    expect(markup).toContain('autoComplete="current-password"')
    expect(markup).toContain('autoComplete="new-password"')
  })

  it('lets legacy passkey-only profiles edit body data without forcing an email first', () => {
    harness.user = { id: 'student-1', name: 'Ana Souza' }

    const markup = renderToStaticMarkup(<ProfileEditor close={() => {}} />)

    expect(markup).toContain('name="profile-email"')
    expect(fieldTag(markup, 'profile-email')).not.toContain('required')
  })
})
