import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Icon from '../components/Icon.jsx'
import { Button, SearchField, TextField } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { canActivateProvider, DEV_PROVIDERS, emptyProviderDraft, filterProviderModels, usageKpis } from '../lib/dev-ai-ui.js'
import { dateLocale, t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'

const number = value => new Intl.NumberFormat(dateLocale()).format(value || 0)
const providerSlot = (providers, provider) => providers.find(item => item.provider === provider) || { provider, testStatus: 'untested' }

export function DevLogin({ busy, values, onChange, onSubmit, error = '' }) {
  return (
    <form className="dev-card dev-login" onSubmit={onSubmit} aria-labelledby="dev-login-title">
      <div className="dev-card-head"><Icon name="shield" /><div><h2 id="dev-login-title">{t('Dev credential')}</h2><p>{t('The administrator passkey and this additional credential are both required.')}</p></div></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <label><span>{t('Username')}</span><TextField name="dev-username" value={values.username} onChange={event => onChange({ ...values, username: event.target.value })} autoComplete="username" spellCheck={false} required /></label>
      <label><span>{t('Password')}</span><TextField name="dev-password" value={values.password} onChange={event => onChange({ ...values, password: event.target.value })} type="password" autoComplete="current-password" required /></label>
      <Button variant="primary" icon="key" disabled={busy}>{busy ? t('Checking…') : t('Open Dev panel')}</Button>
    </form>
  )
}

function UsageBoard({ usage, window, onWindow }) {
  const kpis = usageKpis(usage)
  const cards = [
    ['API calls', kpis.requests], ['Successful', kpis.successes], ['Failures', kpis.failures],
    ['Tokens', kpis.totalTokens], ['Average latency', `${number(kpis.averageLatencyMs)} ms`],
  ]
  return (
    <section className="dev-usage" aria-labelledby="dev-usage-title">
      <div className="panel-heading">
        <div><span className="personal-eyebrow">{t('Operations')}</span><h2 id="dev-usage-title">{t('AI usage')}</h2></div>
        <div className="dev-window" aria-label={t('Metrics period')}>
          {['7d', '30d'].map(value => <button key={value} type="button" aria-pressed={window === value} onClick={() => onWindow?.(value)}>{value === '7d' ? t('7 days') : t('30 days')}</button>)}
        </div>
      </div>
      <div className="metric-grid dev-metrics">
        {cards.map(([label, value]) => <article className="personal-metric" key={label}><span className="personal-metric-label">{t(label)}</span><strong className="personal-metric-value">{typeof value === 'number' ? number(value) : value}</strong></article>)}
      </div>
    </section>
  )
}

function ProviderCard({ definition, slot, onChanged }) {
  const [draft, setDraft] = useState(() => emptyProviderDraft(slot))
  const [models, setModels] = useState([])
  const [query, setQuery] = useState('')
  const [modelState, setModelState] = useState('idle')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { setDraft(emptyProviderDraft(slot)) }, [slot.provider, slot.selectedModel, slot.keyFingerprint, slot.testedAt])
  const visibleModels = useMemo(() => filterProviderModels(models, query), [models, query])
  const run = async (kind, action) => {
    setBusy(kind); setError('')
    try { await action() }
    catch (requestError) { setError(requestError.message || t('The operation could not be completed.')) }
    finally { setBusy('') }
  }
  const save = event => {
    event.preventDefault()
    run('save', async () => {
      await api('/api/dev/ai/provider', { method: 'PUT', body: JSON.stringify(draft) })
      setDraft(current => ({ ...current, apiKey: '' }))
      await onChanged?.()
    })
  }
  const loadModels = () => run('models', async () => {
    setModelState('loading')
    try {
      const data = await api(`/api/dev/ai/models?provider=${encodeURIComponent(definition.provider)}`)
      setModels(data.models || []); setModelState((data.models || []).length ? 'ready' : 'empty')
    } catch (requestError) {
      setModelState('error'); throw requestError
    }
  })
  const test = () => run('test', async () => {
    await api('/api/dev/ai/provider/test', { method: 'POST', body: JSON.stringify({ provider: definition.provider }) })
    await onChanged?.()
  })
  const activate = () => run('activate', async () => {
    await api('/api/dev/ai/active', { method: 'PUT', body: JSON.stringify({ provider: definition.provider }) })
    await onChanged?.()
  })

  const tested = slot.testStatus === 'success'
  return (
    <form className={`dev-provider-card${slot.active ? ' is-active' : ''}`} onSubmit={save} aria-labelledby={`provider-${definition.provider}`}>
      <div className="dev-provider-head">
        <div><span className="personal-eyebrow">{definition.product}</span><h3 id={`provider-${definition.provider}`}>{definition.name}</h3></div>
        <span className={`status-badge ${slot.active ? 'status-paid' : tested ? 'status-confirmed' : 'status-none'}`}>{slot.active ? t('Active') : tested ? t('Tested') : t('Inactive')}</span>
      </div>
      <dl className="dev-provider-meta">
        <div><dt>{t('Configuration')}</dt><dd>{slot.configured ? t('Key configured') : t('No key configured')}</dd></div>
        <div><dt>{t('Fingerprint')}</dt><dd>{slot.keyFingerprint || '—'}</dd></div>
        <div><dt>{t('Last test')}</dt><dd>{slot.testedAt ? new Date(slot.testedAt).toLocaleString(dateLocale()) : t('Not tested')}</dd></div>
      </dl>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <label><span>{t('Model')}</span><TextField name={`${definition.provider}-model`} value={draft.selectedModel} onChange={event => setDraft({ ...draft, selectedModel: event.target.value })} autoComplete="off" required /></label>
      <div className="model-picker">
        <div className="model-picker-tools">
          <SearchField name={`${definition.provider}-model-search`} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} placeholder={t('Search loaded models…')} />
          <Button type="button" size="sm" icon="reset" onClick={loadModels} disabled={!!busy}>{modelState === 'loading' ? t('Loading…') : t('Load models')}</Button>
        </div>
        {modelState === 'error' ? <p className="model-empty" role="status">{t('Models could not be loaded. Try again.')}</p> : null}
        {modelState === 'empty' ? <p className="model-empty" role="status">{t('No compatible model was returned.')}</p> : null}
        {visibleModels.length ? <div className="model-results" role="listbox" aria-label={t('Available models')}>
          {visibleModels.slice(0, 40).map(model => <button type="button" role="option" aria-selected={draft.selectedModel === model} key={model} onClick={() => setDraft({ ...draft, selectedModel: model })}>{model}</button>)}
        </div> : null}
      </div>
      <label><span>{t('New API key')}</span><TextField name={`${definition.provider}-api-key`} value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} type="password" autoComplete="new-password" spellCheck={false} placeholder={slot.configured ? t('Key configured') : t('Paste a key to configure')} /></label>
      <p className="dev-secret-note"><Icon name="lock" />{t('The saved key is never displayed again.')}</p>
      <div className="dev-provider-actions">
        <Button disabled={!!busy}>{busy === 'save' ? t('Saving…') : t('Save configuration')}</Button>
        <Button type="button" onClick={test} disabled={!!busy || !slot.configured}>{busy === 'test' ? t('Testing…') : t('Test structured output')}</Button>
        <Button type="button" variant="primary" onClick={activate} disabled={!!busy || !canActivateProvider(slot, draft)}>{busy === 'activate' ? t('Activating…') : t('Activate globally')}</Button>
      </div>
    </form>
  )
}

export function DevDashboard({ providers, usage, window, onWindow, onLogout, onChanged }) {
  return (
    <>
      <UsageBoard usage={usage} window={window} onWindow={onWindow} />
      <section aria-labelledby="dev-providers-title">
        <div className="dev-section-heading"><div><span className="personal-eyebrow">{t('Bring your own key')}</span><h2 id="dev-providers-title">{t('AI providers')}</h2><p>{t('Save, test structured output, then activate one provider globally.')}</p></div><Button icon="signOut" onClick={onLogout}>{t('Log out of Dev')}</Button></div>
        <div className="dev-provider-grid">
          {DEV_PROVIDERS.map(definition => <ProviderCard key={definition.provider} definition={definition} slot={providerSlot(providers, definition.provider)} onChanged={onChanged} />)}
        </div>
      </section>
    </>
  )
}

export default function DevPanel() {
  const navigate = useNavigate()
  const toast = useUI(state => state.toast)
  const [session, setSession] = useState(null)
  const [login, setLogin] = useState({ username: '', password: '' })
  const [providers, setProviders] = useState([])
  const [window, setWindow] = useState('7d')
  const [usage, setUsage] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadDashboard = async selectedWindow => {
    const [providerData, usageData] = await Promise.all([
      api('/api/dev/ai/providers'), api(`/api/dev/ai/usage?window=${selectedWindow}`),
    ])
    setProviders(providerData.providers || []); setUsage(usageData.usage || {})
  }
  useEffect(() => {
    let current = true
    api('/api/dev/session').then(async data => {
      if (!current) return
      setSession(data); setLogin(value => ({ ...value, username: data.username || value.username }))
      if (data.unlocked) await loadDashboard('7d')
    }).catch(requestError => current && setError(requestError.message || t('Dev panel is unavailable.')))
    return () => { current = false }
  }, [])

  const unlock = async event => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await api('/api/dev/login', { method: 'POST', body: JSON.stringify(login) })
      setLogin(value => ({ ...value, password: '' })); setSession(value => ({ ...(value || {}), unlocked: true }))
      await loadDashboard(window)
    } catch (requestError) { setError(requestError.message || t('Invalid Dev credential.')) }
    finally { setBusy(false) }
  }
  const changeWindow = async value => {
    setWindow(value)
    try { const data = await api(`/api/dev/ai/usage?window=${value}`); setUsage(data.usage || {}) }
    catch (requestError) { toast(requestError.message || t('Usage could not be loaded.')) }
  }
  const logout = async () => {
    try {
      await api('/api/dev/logout', { method: 'POST', body: '{}' })
      setProviders([]); setUsage({}); setSession(value => ({ ...(value || {}), unlocked: false }))
    } catch (requestError) { toast(requestError.message || t('Could not log out of Dev.')) }
  }

  return (
    <main className="personal-page dev-page">
      <header className="personal-header">
        <button className="iconbtn" onClick={() => navigate('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
        <div className="personal-header-copy"><span className="personal-eyebrow">{t('Restricted operations')}</span><h1>{t('Dev panel')}</h1><p>{t('Providers, models and controlled AI usage.')}</p></div>
      </header>
      {error && session?.unlocked ? <p className="personal-notice" role="alert">{error}</p> : null}
      {!session?.unlocked
        ? <DevLogin busy={busy} values={login} onChange={setLogin} onSubmit={unlock} error={error} />
        : <DevDashboard providers={providers} usage={usage} window={window} onWindow={changeWindow} onLogout={logout} onChanged={() => loadDashboard(window)} />}
    </main>
  )
}
