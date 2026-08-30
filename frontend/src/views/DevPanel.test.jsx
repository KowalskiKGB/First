import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  calls: 0, values: [], setters: [], effects: [], navigate: vi.fn(), toast: vi.fn(), api: vi.fn(),
  reset(values = []) { this.calls = 0; this.values = values; this.setters = []; this.effects = []; this.navigate.mockReset(); this.toast.mockReset(); this.api.mockReset() },
}))

vi.mock('react', async importOriginal => ({
  ...(await importOriginal()),
  useState: initial => {
    const index = harness.calls++
    const value = index < harness.values.length ? harness.values[index] : typeof initial === 'function' ? initial() : initial
    const setter = vi.fn()
    harness.setters[index] = setter
    return [value, setter]
  },
  useEffect: effect => { harness.effects.push(effect) },
  useMemo: factory => factory(),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => harness.navigate }))
vi.mock('../lib/api.js', () => ({ api: harness.api }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: harness.toast }) }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  SearchField: props => <input {...props} />,
  TextField: props => <input {...props} />,
}))
vi.mock('../lib/i18n.js', () => ({ dateLocale: () => 'pt-BR', t: value => value }))

import DevPanel, { DevDashboard, DevLogin, ModelChoices } from './DevPanel.jsx'

function findElements(node, predicate, found = []) {
  if (!React.isValidElement(node)) return found
  if (predicate(node)) found.push(node)
  React.Children.forEach(node.props.children, child => findElements(child, predicate, found))
  return found
}

const byTypeName = (node, name) => findElements(node, element => element.type?.name === name)[0]
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Dev AI panel UI contracts', () => {
  beforeEach(() => harness.reset())

  it('explains that the dedicated Dev credential is independent from app accounts', () => {
    const onChange = vi.fn()
    const login = DevLogin({ busy: true, values: { username: '', password: '' }, onChange, onSubmit: vi.fn(), error: 'Invalid' })
    findElements(login, element => element.props.name === 'dev-username')[0].props.onChange({ target: { value: 'first_dev' } })
    findElements(login, element => element.props.name === 'dev-password')[0].props.onChange({ target: { value: 'password' } })
    expect(onChange).toHaveBeenCalledWith({ username: 'first_dev', password: '' })
    expect(onChange).toHaveBeenCalledWith({ username: '', password: 'password' })
    const markup = renderToStaticMarkup(login)
    expect(markup).toContain('Use the dedicated Dev credential. Student and Personal accounts are not required.')
    expect(markup).not.toContain('administrator passkey')
    expect(markup).toContain('Checking…')
    expect(markup).toContain('Invalid')
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

  it('uses ordinary keyboard-operable buttons instead of an incomplete ARIA listbox', () => {
    const onSelect = vi.fn()
    const choices = ModelChoices({ models: ['gpt-5', 'gpt-5-mini'], selected: 'gpt-5-mini', onSelect })
    const markup = renderToStaticMarkup(choices)

    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).not.toContain('role="listbox"')
    expect(markup).not.toContain('role="option"')
    findElements(choices, element => element.type === 'button' && element.props.children === 'gpt-5')[0].props.onClick()
    expect(onSelect).toHaveBeenCalledWith('gpt-5')
  })

  it('switches the usage window and formats every KPI state', () => {
    const onWindow = vi.fn()
    const dashboard = DevDashboard({ providers: [], usage: { requests: 9, successes: 7, failures: 2, totalTokens: 1234, latencyMs: 900 }, window: '7d', onWindow, onLogout: vi.fn() })
    const board = byTypeName(dashboard, 'UsageBoard')
    const rendered = board.type(board.props)
    findElements(rendered, element => element.type === 'button' && element.props.children === '30 days')[0].props.onClick()

    expect(onWindow).toHaveBeenCalledWith('30d')
    expect(renderToStaticMarkup(rendered)).toContain('1.234')
    expect(renderToStaticMarkup(rendered)).toContain('100 ms')
  })

  it('loads, selects, saves, tests and activates a provider', async () => {
    const slot = { provider: 'openai', selectedModel: 'gpt-5', configured: true, keyFingerprint: '…A1', testedAt: '2026-08-29T12:00:00Z', testStatus: 'success', active: false }
    const definition = { provider: 'openai', name: 'OpenAI', product: 'ChatGPT' }
    const onChanged = vi.fn().mockResolvedValue(undefined)
    const draft = { provider: 'openai', selectedModel: 'gpt-5', apiKey: 'secret' }
    harness.reset([draft, ['gpt-5', 'gpt-5-mini'], 'mini', 'ready', '', ''])
    harness.api.mockImplementation(async (path) => path.includes('/models') ? { models: ['gpt-5-mini'] } : { ok: true })
    const dashboard = DevDashboard({ providers: [slot], usage: {}, window: '7d', onWindow: vi.fn(), onLogout: vi.fn(), onChanged })
    const provider = findElements(dashboard, element => element.props.definition?.provider === 'openai')[0]
    const form = provider.type(provider.props)
    const button = label => findElements(form, element => element.props.children === label && typeof element.props.onClick === 'function')[0]

    harness.effects[0]()
    byTypeName(form, 'ModelChoices').props.onSelect('gpt-5-mini')
    findElements(form, element => element.props.name === 'openai-model')[0].props.onChange({ target: { value: 'gpt-5-mini' } })
    const search = findElements(form, element => element.props.name === 'openai-model-search')[0]
    search.props.onChange({ target: { value: 'mini' } })
    search.props.onClear()
    findElements(form, element => element.props.name === 'openai-api-key')[0].props.onChange({ target: { value: 'new-key' } })
    await button('Load models').props.onClick()
    form.props.onSubmit({ preventDefault: vi.fn() })
    await flush()
    await button('Test structured output').props.onClick()
    await button('Activate globally').props.onClick()

    expect(harness.api).toHaveBeenCalledWith('/api/dev/ai/provider', { method: 'PUT', body: JSON.stringify(draft) })
    expect(harness.api).toHaveBeenCalledWith('/api/dev/ai/provider/test', { method: 'POST', body: JSON.stringify({ provider: 'openai' }) })
    expect(harness.api).toHaveBeenCalledWith('/api/dev/ai/active', { method: 'PUT', body: JSON.stringify({ provider: 'openai' }) })
    expect(onChanged).toHaveBeenCalledTimes(4)
    expect(harness.setters[0]).toHaveBeenCalled()
    expect(harness.setters[1]).toHaveBeenCalledWith(['gpt-5-mini'])
    const clearKey = harness.setters[0].mock.calls.map(([value]) => value).find(value => typeof value === 'function')
    expect(clearKey({ ...draft, apiKey: 'old' })).toEqual({ ...draft, apiKey: '' })
  })

  it('keeps the model empty while loading models after a key paste', async () => {
    const slot = { provider: 'openai', selectedModel: '', configured: false, testStatus: 'untested', active: false }
    const draft = { provider: 'openai', selectedModel: '', apiKey: 'secret' }
    harness.reset([draft, [], '', 'idle', '', ''])
    harness.api
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ models: ['gpt-5-mini'] })
    const dashboard = DevDashboard({ providers: [slot], usage: {}, window: '7d', onWindow: vi.fn(), onLogout: vi.fn(), onChanged: vi.fn() })
    const provider = findElements(dashboard, element => element.props.definition?.provider === 'openai')[0]
    const form = provider.type(provider.props)

    expect(findElements(form, element => element.props.name === 'openai-model')[0].props.value).toBe('')
    await findElements(form, element => element.props.children === 'Load models' && typeof element.props.onClick === 'function')[0].props.onClick()

    expect(harness.api).toHaveBeenNthCalledWith(1, '/api/dev/ai/provider', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'openai', selectedModel: '', apiKey: 'secret' }),
    })
    expect(harness.api).toHaveBeenNthCalledWith(2, '/api/dev/ai/models?provider=openai')
    expect(harness.setters[1]).toHaveBeenCalledWith(['gpt-5-mini'])
    expect(harness.setters[0]).not.toHaveBeenCalledWith(expect.objectContaining({ selectedModel: 'gpt-5-mini' }))
  })

  it('deactivates the active provider and refreshes with no global provider active', async () => {
    const slot = { provider: 'openai', selectedModel: 'gpt-5', configured: true, keyFingerprint: '...A1', testedAt: '2026-08-29T12:00:00Z', testStatus: 'success', active: true }
    const onChanged = vi.fn().mockResolvedValue(undefined)
    harness.reset([{ provider: 'openai', selectedModel: 'gpt-5', apiKey: '' }, [], '', 'idle', '', ''])
    harness.api.mockResolvedValue({ ok: true })
    const dashboard = DevDashboard({ providers: [slot], usage: {}, window: '7d', onWindow: vi.fn(), onLogout: vi.fn(), onChanged })
    const provider = findElements(dashboard, element => element.props.definition?.provider === 'openai')[0]
    const form = provider.type(provider.props)
    const deactivate = findElements(form, element => element.props.children === 'Deactivate globally' && typeof element.props.onClick === 'function')[0]

    expect(deactivate).toBeTruthy()
    await deactivate.props.onClick()

    expect(harness.api).toHaveBeenCalledWith('/api/dev/ai/active', { method: 'PUT', body: JSON.stringify({ provider: null }) })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('sanitizes provider failures and renders loading, empty and active states', async () => {
    const slot = { provider: 'gemini', selectedModel: 'gemini-2.5', configured: false, testStatus: 'untested', active: true }
    const definition = { provider: 'gemini', name: 'Gemini', product: 'Google AI' }
    harness.reset([{ provider: 'gemini', selectedModel: 'gemini-2.5', apiKey: '' }, [], '', 'loading', 'models', 'Visible error'])
    harness.api.mockRejectedValue(new Error('upstream secret'))
    const dashboard = DevDashboard({ providers: [slot], usage: {}, window: '30d', onWindow: vi.fn(), onLogout: vi.fn(), onChanged: vi.fn() })
    const provider = findElements(dashboard, element => element.props.definition?.provider === 'gemini')[0]
    const form = provider.type(provider.props)
    const load = findElements(form, element => element.props.children === 'Loading…' && typeof element.props.onClick === 'function')[0]

    await load.props.onClick()

    expect(harness.setters[3]).toHaveBeenCalledWith('error')
    expect(harness.setters[5]).toHaveBeenCalledWith(expect.any(String))
    expect(renderToStaticMarkup(form)).toContain('Active globally')
    expect(renderToStaticMarkup(form)).toContain('Visible error')

    harness.reset([{ provider: 'gemini', selectedModel: '', apiKey: '' }, [], '', 'empty', '', ''])
    harness.api.mockResolvedValue({})
    const empty = provider.type(provider.props)
    await findElements(empty, element => element.props.children === 'Load models' && typeof element.props.onClick === 'function')[0].props.onClick()
    expect(renderToStaticMarkup(empty)).toContain('No compatible model was returned.')
  })

  it('renders each provider operation while it is busy', () => {
    const definition = { provider: 'openai', name: 'OpenAI', product: 'ChatGPT' }
    const slot = { provider: 'openai', selectedModel: 'gpt-5', configured: true, testStatus: 'success', active: false }
    const provider = findElements(DevDashboard({ providers: [slot], usage: {}, window: '7d' }), element => element.props.definition?.provider === 'openai')[0]

    for (const [busy, label] of [['save', 'Saving…'], ['test', 'Testing…'], ['activate', 'Activating…']]) {
      harness.reset([{ provider: 'openai', selectedModel: 'gpt-5', apiKey: '' }, [], '', 'idle', busy, ''])
      expect(renderToStaticMarkup(provider.type(provider.props))).toContain(label)
    }
  })

  it('unlocks the Dev session, refreshes usage and logs out', async () => {
    const session = { unlocked: false }
    const login = { username: 'first_dev_test', password: 'temporary' }
    harness.reset([session, login, [], '7d', {}, false, ''])
    harness.api.mockImplementation(async path => {
      if (path === '/api/dev/ai/providers') return { providers: [{ provider: 'openai' }] }
      if (path.startsWith('/api/dev/ai/usage')) return { usage: { requests: 3 } }
      return { ok: true }
    })
    const panel = DevPanel()
    const loginView = byTypeName(panel, 'DevLogin')

    await loginView.props.onSubmit({ preventDefault: vi.fn() })
    expect(harness.api).toHaveBeenCalledWith('/api/dev/login', { method: 'POST', body: JSON.stringify(login) })
    expect(harness.setters[0]).toHaveBeenCalled()
    expect(harness.setters[2]).toHaveBeenCalledWith([{ provider: 'openai' }])
    const clearPassword = harness.setters[1].mock.calls.map(([value]) => value).find(value => typeof value === 'function')
    const unlockSession = harness.setters[0].mock.calls.map(([value]) => value).find(value => typeof value === 'function')
    expect(clearPassword(login)).toEqual({ ...login, password: '' })
    expect(unlockSession(null)).toEqual({ unlocked: true })

    hooksResetForDashboard()
    const dashboardPanel = DevPanel()
    const dashboard = byTypeName(dashboardPanel, 'DevDashboard')
    await dashboard.props.onWindow('30d')
    await dashboard.props.onLogout()
    await dashboard.props.onChanged()
    expect(harness.api).toHaveBeenCalledWith('/api/dev/ai/usage?window=30d')
    expect(harness.api).toHaveBeenCalledWith('/api/dev/logout', { method: 'POST', body: '{}' })
    expect(findElements(dashboardPanel, element => element.props['aria-label'] === 'Back')).toHaveLength(0)
    expect(harness.navigate).not.toHaveBeenCalled()
    const lockSession = harness.setters[0].mock.calls.map(([value]) => value).find(value => typeof value === 'function')
    expect(lockSession(null)).toEqual({ unlocked: false })
  })

  it('handles session, login, usage and logout errors without throwing', async () => {
    harness.reset([{ unlocked: false }, { username: 'bad', password: 'bad' }, [], '7d', {}, false, ''])
    harness.api.mockRejectedValue(new Error('private detail'))
    const panel = DevPanel()
    const loginView = byTypeName(panel, 'DevLogin')
    await loginView.props.onSubmit({ preventDefault: vi.fn() })
    expect(harness.setters[6]).toHaveBeenCalledWith(expect.any(String))

    hooksResetForDashboard('Existing error')
    harness.api.mockRejectedValue(new Error('private detail'))
    const dashboardPanel = DevPanel()
    const dashboard = byTypeName(dashboardPanel, 'DevDashboard')
    await dashboard.props.onWindow('30d')
    await dashboard.props.onLogout()
    expect(harness.toast).toHaveBeenCalledTimes(2)
    expect(renderToStaticMarkup(dashboardPanel)).toContain('Existing error')
  })

  it('loads an existing unlocked session and handles session failures or unmounts', async () => {
    harness.reset([null, { username: 'typed', password: '' }, [], '7d', {}, false, ''])
    harness.api.mockImplementation(async path => {
      if (path === '/api/dev/session') return { unlocked: true, username: 'first_dev_saved' }
      if (path === '/api/dev/ai/providers') return { providers: [] }
      if (path === '/api/dev/ai/usage?window=7d') return { usage: {} }
      return { ok: true }
    })
    DevPanel()
    const cleanup = harness.effects[0]()
    await flush()
    await flush()
    expect(harness.setters[0]).toHaveBeenCalledWith({ unlocked: true, username: 'first_dev_saved' })
    const mergeUsername = harness.setters[1].mock.calls[0][0]
    expect(mergeUsername({ username: 'typed', password: '' })).toEqual({ username: 'first_dev_saved', password: '' })
    cleanup()

    let resolveSession
    harness.reset([null, { username: 'typed', password: '' }, [], '7d', {}, false, ''])
    harness.api.mockImplementation(path => path === '/api/dev/session' ? new Promise(resolve => { resolveSession = resolve }) : Promise.resolve({}))
    DevPanel()
    const earlyCleanup = harness.effects[0]()
    earlyCleanup()
    resolveSession({ unlocked: false })
    await flush()
    expect(harness.setters[0]).not.toHaveBeenCalled()

    harness.reset([null, { username: '', password: '' }, [], '7d', {}, false, ''])
    harness.api.mockRejectedValue(new Error('session unavailable'))
    DevPanel()
    harness.effects[0]()
    await flush()
    expect(harness.setters[6]).toHaveBeenCalledWith(expect.any(String))
  })
})

function hooksResetForDashboard(error = '') {
  harness.reset([{ unlocked: true }, { username: '', password: '' }, [], '7d', {}, false, error])
  harness.api.mockImplementation(async path => path.startsWith('/api/dev/ai/usage') ? { usage: { requests: 30 } } : { ok: true })
}
