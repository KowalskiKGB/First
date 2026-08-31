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
vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'pt-BR',
  t: (value, ...args) => args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), value),
}))

import DevPanel, { DevDashboard, DevLogin, GymConsole, ModelChoices, presenceCopy } from './DevPanel.jsx'

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

  it('clears stale model results when the selected provider changes', () => {
    const slot = { provider: 'gemini', selectedModel: '', configured: true, testStatus: 'untested', active: false }
    harness.reset([{ provider: 'gemini', selectedModel: '', apiKey: '' }, ['gpt-5-mini'], 'gpt', 'ready', '', 'old error'])
    const dashboard = DevDashboard({
      providers: [slot], usage: {}, window: '7d', selectedProvider: 'gemini',
      onSelectProvider: vi.fn(), onWindow: vi.fn(), onLogout: vi.fn(), onChanged: vi.fn(),
    })
    const provider = findElements(dashboard, element => element.props.definition?.provider === 'gemini')[0]

    provider.type(provider.props)
    expect(harness.effects).toHaveLength(2)
    harness.effects[1]()

    expect(harness.setters[1]).toHaveBeenCalledWith([])
    expect(harness.setters[2]).toHaveBeenCalledWith('')
    expect(harness.setters[3]).toHaveBeenCalledWith('idle')
    expect(harness.setters[5]).toHaveBeenCalledWith('')
  })

  it('always saves into the provider currently rendered even before stale draft state settles', async () => {
    const slot = { provider: 'gemini', selectedModel: '', configured: false, testStatus: 'untested', active: false }
    harness.reset([{ provider: 'openai', selectedModel: '', apiKey: 'new-gemini-key' }, [], '', 'idle', '', ''])
    harness.api.mockResolvedValue({ ok: true })
    const dashboard = DevDashboard({
      providers: [slot], usage: {}, window: '7d', selectedProvider: 'gemini',
      onWindow: vi.fn(), onLogout: vi.fn(), onChanged: vi.fn(),
    })
    const provider = findElements(dashboard, element => element.props.definition?.provider === 'gemini')[0]
    const form = provider.type(provider.props)

    form.props.onSubmit({ preventDefault: vi.fn() })
    await flush()

    expect(harness.api).toHaveBeenCalledWith('/api/dev/ai/provider', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'gemini', apiKey: 'new-gemini-key' }),
    })
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
      body: JSON.stringify({ provider: 'openai', apiKey: 'secret' }),
    })
    expect(harness.api).toHaveBeenNthCalledWith(2, '/api/dev/ai/models?provider=openai')
    expect(harness.setters[1]).toHaveBeenCalledWith(['gpt-5-mini'])
    expect(harness.setters[0]).not.toHaveBeenCalledWith(expect.objectContaining({ selectedModel: 'gpt-5-mini' }))
  })

  it('saves a replacement key before loading models when a model is already selected', async () => {
    const slot = { provider: 'gemini', selectedModel: 'gemini-2.5-flash', configured: true, testStatus: 'success', active: false }
    const draft = { provider: 'gemini', selectedModel: 'gemini-2.5-flash', apiKey: 'replacement-key' }
    harness.reset([draft, [], '', 'idle', '', ''])
    harness.api
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'] })
    const dashboard = DevDashboard({ providers: [slot], usage: {}, window: '7d', onWindow: vi.fn(), onLogout: vi.fn(), onChanged: vi.fn() })
    const provider = findElements(dashboard, element => element.props.definition?.provider === 'gemini')[0]
    const form = provider.type(provider.props)

    await findElements(form, element => element.props.children === 'Load models' && typeof element.props.onClick === 'function')[0].props.onClick()

    expect(harness.api).toHaveBeenNthCalledWith(1, '/api/dev/ai/provider', {
      method: 'PUT',
      body: JSON.stringify(draft),
    })
    expect(harness.api).toHaveBeenNthCalledWith(2, '/api/dev/ai/models?provider=gemini')
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
    expect(renderToStaticMarkup(form)).toContain('Deactivate globally')
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

  it('opens the active provider editor after loading an unlocked Dev session', async () => {
    harness.reset([null, { username: '', password: '' }, [], '7d', {}, false, '', 'apis', ''])
    harness.api.mockImplementation(async path => {
      if (path === '/api/dev/session') return { unlocked: true, username: 'first_dev_saved' }
      if (path === '/api/dev/ai/providers') {
        return { providers: [
          { provider: 'openai', configured: false, active: false },
          { provider: 'gemini', configured: true, selectedModel: 'gemini-2.5-flash', testStatus: 'success', active: true },
        ] }
      }
      if (path === '/api/dev/ai/usage?window=7d') return { usage: {} }
      if (path === '/api/dev/gym-requests') return { requests: [] }
      if (path === '/api/dev/users') return { users: [] }
      return { ok: true }
    })

    DevPanel()
    harness.effects[0]()
    await flush()
    await flush()

    const chooseProvider = harness.setters[8].mock.calls.map(([value]) => value).find(value => typeof value === 'function')
    expect(chooseProvider('')).toBe('gemini')
    expect(chooseProvider('openai')).toBe('openai')
  })
})

describe('Dev operations console contracts', () => {
  beforeEach(() => harness.reset())

  const providers = [
    { provider: 'openai', configured: true, selectedModel: 'gpt-5-mini', testStatus: 'success', active: true },
    { provider: 'gemini', configured: true, selectedModel: 'gemini-2.5-flash', testStatus: 'success', active: false },
    { provider: 'anthropic', configured: false, selectedModel: '', testStatus: 'untested', active: false },
  ]

  it('describes how long an account has been offline', () => {
    const now = Date.parse('2026-08-30T12:00:00Z')
    expect(presenceCopy({ online: true }, now)).toBe('Online now')
    expect(presenceCopy({ online: false, lastAccessAt: now - 90 * 60_000 }, now)).toBe('Offline for 1 h')
    expect(presenceCopy({ online: false, lastAccessAt: null }, now)).toBe('Never online')
  })

  it('organizes the console into APIs, gyms and users tabs', () => {
    const onSection = vi.fn()
    const dashboard = DevDashboard({
      providers,
      usage: {},
      window: '7d',
      section: 'apis',
      onSection,
      onWindow: vi.fn(),
      onLogout: vi.fn(),
    })
    const markup = renderToStaticMarkup(dashboard)

    expect(markup).toContain('role="tablist"')
    for (const label of ['APIs', 'Gyms', 'Users']) {
      const tab = findElements(dashboard, element => element.props.role === 'tab' && element.props.children === label)[0]
      expect(tab).toBeTruthy()
      tab.props.onClick()
    }
    expect(onSection.mock.calls).toEqual([['apis'], ['gyms'], ['users']])
  })

  it('compares a contribution before and after and requires a reason before review', () => {
    const onView = vi.fn()
    const onReason = vi.fn()
    const onPrepareAction = vi.fn()
    const console = <GymConsole
      view="contributions"
      onView={onView}
      requests={[{
        id: 'request-correction', kind: 'correction', status: 'pending', gymId: 'gym-1',
        gym: { id: 'gym-1', name: 'Academia Centro' },
        payload: { address: 'Rua Nova, 200', neighborhood: 'Centro' },
        createdAt: '2026-08-31T12:00:00Z',
      }]}
      gyms={[{ id: 'gym-1', name: 'Academia Centro', address: 'Rua Antiga, 10', neighborhood: 'Aldeota', status: 'verified', visibility: 'public', exerciseIds: [] }]}
      selectedRequestId="request-correction"
      reason=""
      onReason={onReason}
      onPrepareAction={onPrepareAction}
    />
    const markup = renderToStaticMarkup(console)

    expect(markup).toContain('Contributions')
    expect(markup).toContain('Directory')
    expect(markup).toContain('Reviews')
    expect(markup).toContain('Before')
    expect(markup).toContain('After')
    expect(markup).toContain('Rua Antiga, 10')
    expect(markup).toContain('Rua Nova, 200')
    expect(markup).not.toContain('submittedByUserId')

    const textarea = findElements(console, element => element.props.name === 'gym-moderation-reason')[0]
    textarea.props.onChange({ target: { value: 'Cadastro confirmado na fonte.' } })
    expect(onReason).toHaveBeenCalledWith('Cadastro confirmado na fonte.')
    const approve = findElements(console, element => element.props.children === 'Approve')[0]
    expect(approve.props.disabled).toBe(true)

    const ready = GymConsole({
      view: 'contributions', requests: console.props.requests, gyms: console.props.gyms,
      selectedRequestId: 'request-correction', reason: 'Cadastro confirmado na fonte.', onPrepareAction,
    })
    findElements(ready, element => element.props.children === 'Approve')[0].props.onClick()
    expect(onPrepareAction).toHaveBeenCalledWith({ type: 'request', id: 'request-correction', action: 'approve' })
  })

  it('inspects directory sources and confirms archive, restore and review moderation actions', () => {
    const onPrepareAction = vi.fn()
    const gym = {
      id: 'gym-1', name: 'Academia Centro', state: 'AP', city: 'Macapá', address: 'Rua Central, 10',
      status: 'verified', visibility: 'public', exerciseIds: ['0043'],
      source: { label: 'Site oficial', url: 'https://example.com/gym', confidence: 'high', verifiedAt: '2026-08-30' },
    }
    const directory = GymConsole({
      view: 'directory', gyms: [gym], selectedGymId: gym.id, reason: 'Unidade encerrou as atividades.', onPrepareAction,
    })
    const directoryMarkup = renderToStaticMarkup(directory)
    expect(directoryMarkup).toContain('Site oficial')
    expect(directoryMarkup).toContain('verified')
    findElements(directory, element => element.props.children === 'Archive')[0].props.onClick()
    expect(onPrepareAction).toHaveBeenCalledWith({ type: 'gym', id: gym.id, action: 'archive' })

    const confirm = GymConsole({
      view: 'directory', gyms: [gym], selectedGymId: gym.id, reason: 'Unidade encerrou as atividades.',
      pendingAction: { type: 'gym', id: gym.id, action: 'archive' }, onConfirmAction: vi.fn(), onCancelAction: vi.fn(),
    })
    expect(renderToStaticMarkup(confirm)).toContain('Confirm archive')

    const review = {
      id: 'review-1', gymId: gym.id, rating: 2, comment: 'Contato em texto removido.', status: 'removed',
      submittedBy: { name: 'Ana Silva', email: 'ana@example.com' }, createdAt: '2026-08-30T10:00:00Z',
    }
    const reviews = GymConsole({
      view: 'reviews', gyms: [gym], reviews: [review], reviewFilter: 'removed', selectedReviewId: review.id,
      reason: 'Comentário revisado.', onPrepareAction,
    })
    expect(renderToStaticMarkup(reviews)).toContain('Contato em texto removido.')
    findElements(reviews, element => element.props.children === 'Restore')[0].props.onClick()
    expect(onPrepareAction).toHaveBeenCalledWith({ type: 'review', id: review.id, action: 'restore' })
  })

  it('shows three compact provider choices but opens only the selected provider editor', () => {
    const dashboard = DevDashboard({
      providers,
      usage: {},
      window: '7d',
      section: 'apis',
      selectedProvider: 'gemini',
      onSelectProvider: vi.fn(),
      onWindow: vi.fn(),
      onLogout: vi.fn(),
    })
    const markup = renderToStaticMarkup(dashboard)

    expect(markup).toContain('OpenAI')
    expect(markup).toContain('Gemini')
    expect(markup).toContain('Anthropic')
    expect((markup.match(/type="password"/g) || [])).toHaveLength(1)
    expect((markup.match(/name="[^"]+-model-search"/g) || [])).toHaveLength(1)
    expect((markup.match(/>Load models</g) || [])).toHaveLength(1)
    expect(markup).toContain('name="gemini-api-key"')
    expect(markup).not.toContain('name="openai-api-key"')
    expect(markup).not.toContain('name="anthropic-api-key"')
    expect(markup).toContain('Activate globally')
    expect(markup).not.toContain('Deactivate globally')

    const activeDashboard = DevDashboard({
      providers,
      usage: {},
      window: '7d',
      section: 'apis',
      selectedProvider: 'openai',
      onSelectProvider: vi.fn(),
      onWindow: vi.fn(),
      onLogout: vi.fn(),
    })
    const activeMarkup = renderToStaticMarkup(activeDashboard)
    expect(activeMarkup).toContain('Deactivate globally')
    expect(activeMarkup).not.toContain('Activate globally')
  })

  it('renders an equipment request list and selected request details without leaking secrets', () => {
    const requests = [{
      id: 'request-leg-press',
      kind: 'equipment',
      status: 'pending',
      equipmentName: 'Leg press 45°',
      exerciseId: 'leg-press-45',
      payload: { exerciseIds: ['0043', '0085'], openingHoursNote: 'Segunda a sexta, 6:00 às 22:00' },
      gym: { id: 'gym-1', name: 'Academia X', municipality: 'Fortaleza', address: 'Rua ABC, 123' },
      requestedBy: { id: 'student-1', name: 'Ana Silva', email: 'ana@example.com' },
      createdAt: '2026-08-30T12:00:00Z',
      apiKey: 'must-never-render',
    }]
    const dashboard = DevDashboard({
      providers,
      usage: {},
      window: '7d',
      section: 'requests',
      requests,
      selectedRequestId: 'request-leg-press',
      onSelectRequest: vi.fn(),
      onWindow: vi.fn(),
      onLogout: vi.fn(),
    })
    const markup = renderToStaticMarkup(dashboard)

    expect(markup).toContain('Leg press 45°')
    expect(markup).toContain('Academia X')
    expect(markup).toContain('Rua ABC, 123')
    expect(markup).toContain('Ana Silva')
    expect(markup).toContain('ana@example.com')
    expect(markup).toContain('Pending')
    expect(markup).toContain('Segunda a sexta, 6:00 às 22:00')
    expect(markup).not.toContain('must-never-render')
  })

  it('renders a compact registered-user list and opens operational details without credentials', () => {
    const users = [{
      id: 'student-1',
      name: 'Ana Silva',
      email: 'ana@example.com',
      role: 'student',
      online: false,
      lastAccessAt: '2026-08-30T10:00:00Z',
      profile: { weightKg: 68, heightCm: 171, goal: 'muscle_gain' },
      passwordHash: 'scrypt-secret-hash',
      apiKey: 'provider-secret',
    }]
    const dashboard = DevDashboard({
      providers,
      usage: {},
      window: '7d',
      section: 'users',
      users,
      selectedUserId: 'student-1',
      onSelectUser: vi.fn(),
      onWindow: vi.fn(),
      onLogout: vi.fn(),
    })
    const markup = renderToStaticMarkup(dashboard)

    expect(markup).toContain('Registered users')
    expect(markup).toContain('Ana Silva')
    expect(markup).toContain('ana@example.com')
    expect(markup).toContain('68 kg')
    expect(markup).toContain('1,71 m')
    expect(markup).toContain('Muscle gain')
    expect(markup).toContain('Offline')
    expect(markup).toContain('Offline for')
    expect(markup).not.toContain('scrypt-secret-hash')
    expect(markup).not.toContain('provider-secret')
  })
})

function hooksResetForDashboard(error = '') {
  harness.reset([{ unlocked: true }, { username: '', password: '' }, [], '7d', {}, false, error])
  harness.api.mockImplementation(async path => path.startsWith('/api/dev/ai/usage') ? { usage: { requests: 30 } } : { ok: true })
}
