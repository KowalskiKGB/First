import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: vi.fn() }) }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  SearchField: props => <input {...props} />,
  TextField: props => <input {...props} />,
}))
vi.mock('../lib/i18n.js', () => ({ dateLocale: () => 'pt-BR', t: value => value }))

import { DevDashboard, DevLogin } from './DevPanel.jsx'

describe('Dev AI panel UI contracts', () => {
  it('renders the second authentication layer and an explicit Dev logout', () => {
    expect(renderToStaticMarkup(<DevLogin busy={false} values={{ username: '', password: '' }} onChange={() => {}} onSubmit={() => {}} />)).toContain('Dev credential')
    expect(renderToStaticMarkup(<DevDashboard providers={[]} usage={{}} window="7d" onWindow={() => {}} onLogout={() => {}} />)).toContain('Log out of Dev')
  })

  it('always renders all three provider slots without exposing a key value', () => {
    const markup = renderToStaticMarkup(<DevDashboard
      providers={[{ provider: 'openai', configured: true, keyFingerprint: 'sha256:abc', selectedModel: 'gpt-5', testStatus: 'success', testedAt: '2026-08-29T12:00:00Z' }]}
      usage={{ requests: 2, failures: 0, totalTokens: 120, latencyMs: 200 }} window="7d" onWindow={() => {}} onLogout={() => {}}
    />)
    expect(markup).toContain('OpenAI')
    expect(markup).toContain('Gemini')
    expect(markup).toContain('Anthropic')
    expect(markup).toContain('sha256:abc')
    expect(markup).not.toContain('value="sha256:abc"')
  })
})
