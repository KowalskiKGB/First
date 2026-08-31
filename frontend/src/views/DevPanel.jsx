import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, SearchField, TextField } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { canActivateProvider, DEV_PROVIDERS, emptyProviderDraft, filterProviderModels, safeDevError, usageKpis } from '../lib/dev-ai-ui.js'
import { dateLocale, t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'

const number = value => new Intl.NumberFormat(dateLocale()).format(value || 0)
const providerSlot = (providers, provider) => providers.find(item => item.provider === provider) || { provider, testStatus: 'untested' }
const requestStatus = status => ({ pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[status] || 'Pending')
const accountRole = role => ({ student: 'Student', trainer: 'Personal', personal: 'Personal', admin: 'Administrator' }[role] || 'Student')
const trainingGoal = goal => ({ muscle_gain: 'Muscle gain', weight_loss: 'Weight loss', both: 'Muscle gain and weight loss', recomposition: 'Muscle gain and weight loss' }[goal] || 'Not informed')
const requestName = request => request?.equipmentName || request?.payload?.name || (request?.kind === 'gym' ? request?.payload?.name : '') || 'Equipment request'
const formatHeight = value => Number.isFinite(Number(value)) && Number(value) > 0
  ? `${new Intl.NumberFormat(dateLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) / 100)} m`
  : t('Not informed')

export function presenceCopy(account, now = Date.now()) {
  if (account?.online) return t('Online now')
  const numericAccess = Number(account?.lastAccessAt)
  const lastAccessAt = Number.isFinite(numericAccess) && numericAccess > 0
    ? numericAccess
    : Date.parse(account?.lastAccessAt || '')
  if (!Number.isFinite(lastAccessAt) || lastAccessAt <= 0) return t('Never online')
  const elapsedMinutes = Math.max(0, Math.floor((now - lastAccessAt) / 60_000))
  if (elapsedMinutes < 60) return t('Offline for {0}', `${Math.max(1, elapsedMinutes)} min`)
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 48) return t('Offline for {0}', `${elapsedHours} h`)
  return t('Offline for {0}', `${Math.floor(elapsedHours / 24)} d`)
}

const measurementLabel = kind => ({
  weight: 'Weight', waist: 'Waist', chest: 'Chest', hip: 'Hips', arm: 'Arms', thigh: 'Thighs', calf: 'Calves',
}[kind] || kind || 'Measurement')

export function ModelChoices({ models, selected, onSelect }) {
  return <div className="model-results" role="group" aria-label={t('Available models')}>
    {models.slice(0, 40).map(model => <button type="button" translate="no" aria-pressed={selected === model} style={selected === model ? { color: 'var(--acc)' } : undefined} key={model} onClick={() => onSelect(model)}>{model}</button>)}
  </div>
}

export function DevLogin({ busy, values, onChange, onSubmit, error = '' }) {
  return (
    <form className="dev-card dev-login" onSubmit={onSubmit} aria-labelledby="dev-login-title">
      <div className="dev-card-head"><Icon name="shield" /><div><h2 id="dev-login-title">{t('Dev credential')}</h2><p>{t('Use the dedicated Dev credential. Student and Personal accounts are not required.')}</p></div></div>
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

function ConsoleTabs({ section, onSection }) {
  const tabs = [['apis', 'APIs'], ['requests', 'Requests'], ['users', 'Users']]
  return <nav className="dev-console-tabs" role="tablist" aria-label={t('Dev console sections')}>
    {tabs.map(([value, label]) => <button
      type="button"
      role="tab"
      aria-selected={section === value}
      aria-controls={`dev-panel-${value}`}
      key={value}
      onClick={() => onSection?.(value)}
    >{t(label)}</button>)}
  </nav>
}

function ProviderChoices({ providers, selectedProvider, onSelectProvider }) {
  return <div className="dev-provider-list" aria-label={t('AI providers')}>
    {DEV_PROVIDERS.map(definition => {
      const slot = providerSlot(providers, definition.provider)
      const tested = slot.testStatus === 'success'
      return <button
        className={`client-row compact${selectedProvider === definition.provider ? ' is-selected' : ''}`}
        type="button"
        aria-pressed={selectedProvider === definition.provider}
        key={definition.provider}
        onClick={() => onSelectProvider?.(definition.provider)}
      >
        <span className="client-row-main">
          <span className="client-row-title"><strong translate="no">{definition.name}</strong><small translate="no">{definition.product}</small></span>
          <span className="client-facts">{slot.selectedModel || t('No model selected')}</span>
        </span>
        <span className={`status-badge ${slot.active ? 'status-paid' : tested ? 'status-confirmed' : 'status-none'}`}>{t(slot.active ? 'Active' : tested ? 'Tested' : 'Inactive')}</span>
      </button>
    })}
  </div>
}

function ProviderConsole({ providers, selectedProvider, onSelectProvider, onChanged }) {
  const selectedDefinition = DEV_PROVIDERS.find(item => item.provider === selectedProvider)
  return <section id="dev-panel-apis" role="tabpanel" aria-labelledby="dev-providers-title">
    <div className="dev-section-heading"><div><span className="personal-eyebrow">{t('Bring your own key')}</span><h2 id="dev-providers-title">{t('AI providers')}</h2><p>{t('Choose a provider, save the key, test the model and activate it.')}</p></div></div>
    <ProviderChoices providers={providers} selectedProvider={selectedProvider} onSelectProvider={onSelectProvider} />
    {selectedDefinition ? <ProviderCard definition={selectedDefinition} slot={providerSlot(providers, selectedDefinition.provider)} onChanged={onChanged} /> : null}
  </section>
}

function LegacyProviderConsole({ providers, onChanged }) {
  return <section id="dev-panel-apis" role="tabpanel" aria-labelledby="dev-providers-title">
    <div className="dev-section-heading"><div><span className="personal-eyebrow">{t('Bring your own key')}</span><h2 id="dev-providers-title">{t('AI providers')}</h2><p>{t('Save, test structured output, then activate one provider globally.')}</p></div></div>
    <div className="dev-provider-grid">
      {DEV_PROVIDERS.map(definition => <ProviderCard key={definition.provider} definition={definition} slot={providerSlot(providers, definition.provider)} onChanged={onChanged} />)}
    </div>
  </section>
}

function RequestConsole({ requests = [], selectedRequestId, onSelectRequest, onReviewRequest, reviewingRequestId }) {
  const selected = requests.find(item => item.id === selectedRequestId) || requests[0]
  const gym = selected?.gym || {}
  const submitter = selected?.requestedBy || selected?.submittedBy || {}
  const payload = selected?.payload || {}
  return <section id="dev-panel-requests" role="tabpanel" aria-labelledby="dev-requests-title" className="personal-panel">
    <div className="panel-heading"><div><span className="personal-eyebrow">{t('Moderation')}</span><h2 id="dev-requests-title">{t('Equipment requests')}</h2></div><span className="status-badge status-none">{number(requests.length)}</span></div>
    {requests.length ? <div className="dev-console-split">
      <div className="client-list" aria-label={t('Requests')}>
        {requests.map(request => <button className="client-row compact" type="button" aria-pressed={selected?.id === request.id} key={request.id} onClick={() => onSelectRequest?.(request.id)}>
          <span className="client-row-main"><span className="client-row-title"><strong>{requestName(request)}</strong></span><span className="client-facts">{request.gym?.name || request.payload?.name || t('New gym')}</span></span>
          <span className={`status-badge status-${request.status === 'approved' ? 'confirmed' : request.status === 'rejected' ? 'late' : 'none'}`}>{t(requestStatus(request.status))}</span>
        </button>)}
      </div>
      {selected ? <article className="dev-request-detail">
        <div className="dev-provider-head"><div><span className="personal-eyebrow">{t(selected.kind === 'gym' ? 'New gym' : 'Equipment')}</span><h3>{requestName(selected)}</h3></div><span className={`status-badge status-${selected.status === 'approved' ? 'confirmed' : selected.status === 'rejected' ? 'late' : 'none'}`}>{t(requestStatus(selected.status))}</span></div>
        <dl className="dev-provider-meta">
          <div><dt>{t('Gym')}</dt><dd>{gym.name || payload.name || t('Not informed')}</dd></div>
          <div><dt>{t('Municipality')}</dt><dd>{gym.municipality || gym.city || payload.city || t('Not informed')}</dd></div>
          <div><dt>{t('Address')}</dt><dd>{gym.address || payload.address || t('Not informed')}</dd></div>
          <div><dt>{t('Requested by')}</dt><dd>{submitter.name || t('Not informed')}</dd></div>
          <div><dt>{t('Email')}</dt><dd>{submitter.email || t('Not informed')}</dd></div>
          <div><dt>{t('Exercises')}</dt><dd>{number((payload.exerciseIds || selected.exerciseIds || []).length)}</dd></div>
          <div><dt>{t('Notes')}</dt><dd>{payload.openingHoursNote || payload.note || t('Not informed')}</dd></div>
          <div><dt>{t('Submitted')}</dt><dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleString(dateLocale()) : t('Not informed')}</dd></div>
        </dl>
        {selected.status === 'pending' && onReviewRequest ? <div className="dev-provider-actions">
          <Button type="button" variant="primary" disabled={reviewingRequestId === selected.id} onClick={() => onReviewRequest(selected.id, 'approve')}>{t('Approve')}</Button>
          <Button type="button" disabled={reviewingRequestId === selected.id} onClick={() => onReviewRequest(selected.id, 'reject')}>{t('Reject')}</Button>
        </div> : null}
      </article> : null}
    </div> : <p className="model-empty" role="status">{t('No requests awaiting review.')}</p>}
  </section>
}

function UserConsole({ users = [], selectedUserId, selectedUser, onSelectUser }) {
  const listed = users.find(item => item.id === selectedUserId) || users[0]
  const detailAccount = selectedUser?.user?.id === listed?.id ? selectedUser.user : listed
  const profile = selectedUser?.user?.id === listed?.id ? selectedUser.trainingProfile || {} : listed?.profile || {}
  const gym = selectedUser?.user?.id === listed?.id ? selectedUser.gymProfile || {} : listed?.gymProfile || {}
  const latestWeight = selectedUser?.user?.id === listed?.id && selectedUser.bodyweight?.length
    ? selectedUser.bodyweight[selectedUser.bodyweight.length - 1]?.w
    : profile.weightKg
  const measurements = selectedUser?.user?.id === listed?.id && Array.isArray(selectedUser.measurements)
    ? selectedUser.measurements
    : []
  return <section id="dev-panel-users" role="tabpanel" aria-labelledby="dev-users-title" className="personal-panel">
    <div className="panel-heading"><div><span className="personal-eyebrow">{t('Accounts')}</span><h2 id="dev-users-title">{t('Registered users')}</h2></div><span className="status-badge status-none">{number(users.length)}</span></div>
    {users.length ? <div className="dev-console-split">
      <div className="client-list" aria-label={t('Registered users')}>
        {users.map(user => <button className="client-row compact" type="button" aria-pressed={listed?.id === user.id} key={user.id} onClick={() => onSelectUser?.(user.id)}>
          <span className="client-row-main"><span className="client-row-title"><strong>{user.name || t('Unnamed user')}</strong></span><span className="client-facts">{user.email} · {t(accountRole(user.role || (user.admin ? 'admin' : 'student')))} · {presenceCopy(user)}</span></span>
          <span className={`status-badge ${user.online ? 'status-confirmed' : 'status-none'}`}>{t(user.online ? 'Online' : 'Offline')}</span>
        </button>)}
      </div>
      {detailAccount ? <article className="dev-user-detail">
        <div className="dev-provider-head"><div><span className="personal-eyebrow">{t(accountRole(detailAccount.role || (detailAccount.admin ? 'admin' : 'student')))}</span><h3>{detailAccount.name || t('Unnamed user')}</h3><p>{detailAccount.email}</p></div><span className={`status-badge ${detailAccount.online ? 'status-confirmed' : 'status-none'}`}>{t(detailAccount.online ? 'Online' : 'Offline')}</span></div>
        <div className="student-context">
          <div><span>{t('Weight')}</span><strong>{Number.isFinite(Number(latestWeight)) && Number(latestWeight) > 0 ? `${number(latestWeight)} kg` : t('Not informed')}</strong></div>
          <div><span>{t('Height')}</span><strong>{formatHeight(profile.heightCm)}</strong></div>
          <div><span>{t('Goal')}</span><strong>{t(trainingGoal(profile.goal))}</strong></div>
          <div><span>{t('Gym')}</span><strong>{gym.name || t('Not informed')}</strong></div>
        </div>
        <dl className="dev-provider-meta">
          <div><dt>{t('Last access')}</dt><dd>{detailAccount.lastAccessAt ? new Date(detailAccount.lastAccessAt).toLocaleString(dateLocale()) : t('Never')}</dd></div>
          <div><dt>{t('Last login')}</dt><dd>{detailAccount.lastLoginAt ? new Date(detailAccount.lastLoginAt).toLocaleString(dateLocale()) : t('Never')}</dd></div>
        </dl>
        {measurements.length ? <section className="dev-user-measurements" aria-labelledby="dev-user-measurements-title">
          <h4 id="dev-user-measurements-title">{t('Body measurements')}</h4>
          <dl>{measurements.slice(0, 12).map(measurement => <div key={measurement.id}>
            <dt>{t(measurementLabel(measurement.kind))}</dt>
            <dd>{number(measurement.value)} {measurement.unit || ''}<small>{measurement.observedAt || ''}</small></dd>
          </div>)}</dl>
        </section> : null}
      </article> : null}
    </div> : <p className="model-empty" role="status">{t('No registered users.')}</p>}
  </section>
}

function ProviderCard({ definition, slot, onChanged }) {
  const [draft, setDraft] = useState(() => emptyProviderDraft(slot))
  const [models, setModels] = useState([])
  const [query, setQuery] = useState('')
  const [modelState, setModelState] = useState('idle')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { setDraft(emptyProviderDraft(slot)) }, [slot.provider, slot.selectedModel, slot.keyFingerprint, slot.testedAt])
  useEffect(() => {
    setModels([])
    setQuery('')
    setModelState('idle')
    setError('')
  }, [definition.provider])
  const visibleModels = useMemo(() => filterProviderModels(models, query), [models, query])
  const providerPayload = () => ({
    provider: draft.provider,
    ...(draft.selectedModel ? { selectedModel: draft.selectedModel } : {}),
    ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
  })
  const run = async (kind, action, fallback = 'The operation could not be completed.') => {
    setBusy(kind); setError('')
    try { await action() }
    catch (requestError) { setError(t(safeDevError(requestError, fallback))) }
    finally { setBusy('') }
  }
  const save = event => {
    event.preventDefault()
    run('save', async () => {
      await api('/api/dev/ai/provider', { method: 'PUT', body: JSON.stringify(providerPayload()) })
      setDraft(current => ({ ...current, apiKey: '' }))
      await onChanged?.()
    })
  }
  const loadModels = () => run('models', async () => {
    setModelState('loading')
    try {
      if (draft.apiKey) {
        await api('/api/dev/ai/provider', { method: 'PUT', body: JSON.stringify(providerPayload()) })
        setDraft(current => ({ ...current, apiKey: '' }))
        await onChanged?.()
      }
      const data = await api(`/api/dev/ai/models?provider=${encodeURIComponent(definition.provider)}`)
      setModels(data.models || []); setModelState((data.models || []).length ? 'ready' : 'empty')
    } catch (requestError) {
      setModelState('error'); throw requestError
    }
  }, 'Models could not be loaded. Try again.')
  const test = () => run('test', async () => {
    await api('/api/dev/ai/provider/test', { method: 'POST', body: JSON.stringify({ provider: definition.provider }) })
    await onChanged?.()
  })
  const activate = () => run('activate', async () => {
    await api('/api/dev/ai/active', { method: 'PUT', body: JSON.stringify({ provider: definition.provider }) })
    await onChanged?.()
  })
  const deactivate = () => run('activate', async () => {
    await api('/api/dev/ai/active', { method: 'PUT', body: JSON.stringify({ provider: null }) })
    await onChanged?.()
  })

  const tested = slot.testStatus === 'success'
  const hasUnsavedConfiguration = !!draft.apiKey || draft.selectedModel !== (slot.selectedModel || '')
  return (
    <form className={`dev-provider-card${slot.active ? ' is-active' : ''}`} onSubmit={save} aria-labelledby={`provider-${definition.provider}`}>
      <div className="dev-provider-head">
        <div translate="no"><span className="personal-eyebrow">{definition.product}</span><h3 id={`provider-${definition.provider}`}>{definition.name}</h3></div>
        <span className={`status-badge ${slot.active ? 'status-paid' : tested ? 'status-confirmed' : 'status-none'}`}>{slot.active ? t('Active') : tested ? t('Tested') : t('Inactive')}</span>
      </div>
      <dl className="dev-provider-meta">
        <div><dt>{t('Configuration')}</dt><dd>{slot.configured ? t('Key configured') : t('No key configured')}</dd></div>
        <div><dt>{t('Fingerprint')}</dt><dd>{slot.keyFingerprint || '—'}</dd></div>
        <div><dt>{t('Last test')}</dt><dd>{slot.testedAt ? new Date(slot.testedAt).toLocaleString(dateLocale()) : t('Not tested')}</dd></div>
      </dl>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <label><span>{t('Model')}</span><TextField name={`${definition.provider}-model`} value={draft.selectedModel} onChange={event => setDraft({ ...draft, selectedModel: event.target.value })} autoComplete="off" /></label>
      <div className="model-picker">
        <div className="model-picker-tools">
          <SearchField name={`${definition.provider}-model-search`} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={t('Clear search')} autoComplete="off" placeholder={t('Search loaded models…')} />
          <Button type="button" size="sm" icon="reset" onClick={loadModels} disabled={!!busy}>{modelState === 'loading' ? t('Loading…') : t('Load models')}</Button>
        </div>
        {modelState === 'empty' ? <p className="model-empty" role="status">{t('No compatible model was returned.')}</p> : null}
        {visibleModels.length ? <ModelChoices models={visibleModels} selected={draft.selectedModel} onSelect={selectedModel => setDraft({ ...draft, selectedModel })} /> : null}
      </div>
      <label><span>{t('New API key')}</span><TextField name={`${definition.provider}-api-key`} value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} type="password" autoComplete="new-password" spellCheck={false} placeholder={slot.configured ? t('Key configured') : t('Paste a key to configure')} /></label>
      <p className="dev-secret-note"><Icon name="lock" />{t('The saved key is never displayed again.')}</p>
      <div className="dev-provider-actions">
        <Button disabled={!!busy}>{busy === 'save' ? t('Saving…') : t('Save configuration')}</Button>
        <Button type="button" onClick={test} disabled={!!busy || !slot.configured || !slot.selectedModel || hasUnsavedConfiguration}>{busy === 'test' ? t('Testing…') : t('Test structured output')}</Button>
        <Button type="button" variant="primary" onClick={slot.active ? deactivate : activate} disabled={!!busy || (!slot.active && !canActivateProvider(slot, draft))}>{slot.active ? busy === 'activate' ? t('Deactivating…') : t('Deactivate globally') : busy === 'activate' ? t('Activating…') : t('Activate globally')}</Button>
      </div>
    </form>
  )
}

export function DevDashboard({
  providers = [], usage = {}, window = '7d', section = 'apis', selectedProvider,
  requests = [], selectedRequestId, users = [], selectedUserId, selectedUser,
  onSection, onSelectProvider, onSelectRequest, onReviewRequest, reviewingRequestId,
  onSelectUser, onWindow, onLogout, onChanged,
}) {
  return (
    <>
      <div className="dev-section-heading"><div><span className="personal-eyebrow">{t('Restricted operations')}</span><h2>{t('Operations console')}</h2><p>{t('Manage AI access, review requests and inspect registered accounts.')}</p></div><Button icon="signOut" onClick={onLogout}>{t('Log out of Dev')}</Button></div>
      {ConsoleTabs({ section, onSection })}
      {section === 'apis' ? <>
        <UsageBoard usage={usage} window={window} onWindow={onWindow} />
        {selectedProvider === undefined
          ? LegacyProviderConsole({ providers, onChanged })
          : ProviderConsole({ providers, selectedProvider, onSelectProvider, onChanged })}
      </> : null}
      {section === 'requests' ? RequestConsole({ requests, selectedRequestId, onSelectRequest, onReviewRequest, reviewingRequestId }) : null}
      {section === 'users' ? UserConsole({ users, selectedUserId, selectedUser, onSelectUser }) : null}
    </>
  )
}

export default function DevPanel() {
  const toast = useUI(state => state.toast)
  const [session, setSession] = useState(null)
  const [login, setLogin] = useState({ username: '', password: '' })
  const [providers, setProviders] = useState([])
  const [window, setWindow] = useState('7d')
  const [usage, setUsage] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [section, setSection] = useState('apis')
  const [selectedProvider, setSelectedProvider] = useState('')
  const [requests, setRequests] = useState([])
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [reviewingRequestId, setReviewingRequestId] = useState('')

  const loadDashboard = async selectedWindow => {
    setError('')
    const [providerData, usageData] = await Promise.all([
      api('/api/dev/ai/providers'),
      api(`/api/dev/ai/usage?window=${selectedWindow}`),
    ])
    const [requestResult, userResult] = await Promise.allSettled([
      api('/api/dev/gym-requests'),
      api('/api/dev/users'),
    ])
    const requestData = requestResult.status === 'fulfilled' ? requestResult.value : {}
    const userData = userResult.status === 'fulfilled' ? userResult.value : {}
    if (requestResult.status === 'rejected' || userResult.status === 'rejected') {
      setError(t('Some console data could not be loaded.'))
    }
    const nextProviders = providerData.providers || []
    const nextRequests = requestData.requests || []
    const nextUsers = userData.users || []
    setProviders(nextProviders); setUsage(usageData.usage || {})
    setRequests(nextRequests); setUsers(nextUsers)
    setSelectedProvider(current => {
      const activeProvider = nextProviders.find(item => item.active)?.provider
      if (!current) return activeProvider || 'openai'
      return DEV_PROVIDERS.some(item => item.provider === current) ? current : activeProvider || 'openai'
    })
    setSelectedRequestId(current => nextRequests.some(item => item.id === current) ? current : nextRequests[0]?.id || '')
    setSelectedUserId(current => nextUsers.some(item => item.id === current) ? current : '')
  }
  useEffect(() => {
    let current = true
    api('/api/dev/session').then(async data => {
      if (!current) return
      setSession(data); setLogin(value => ({ ...value, username: data.username || value.username }))
      if (data.unlocked) await loadDashboard('7d')
    }).catch(requestError => current && setError(t(safeDevError(requestError, 'Dev panel is unavailable.'))))
    return () => { current = false }
  }, [])

  const unlock = async event => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await api('/api/dev/login', { method: 'POST', body: JSON.stringify(login) })
      setLogin(value => ({ ...value, password: '' })); setSession(value => ({ ...(value || {}), unlocked: true }))
      await loadDashboard(window)
    } catch (requestError) { setError(t(safeDevError(requestError, 'Invalid Dev credential.'))) }
    finally { setBusy(false) }
  }
  const changeWindow = async value => {
    setWindow(value)
    try { const data = await api(`/api/dev/ai/usage?window=${value}`); setUsage(data.usage || {}) }
    catch (requestError) { toast(t(safeDevError(requestError, 'Usage could not be loaded.'))) }
  }
  const logout = async () => {
    try {
      await api('/api/dev/logout', { method: 'POST', body: '{}' })
      setProviders([]); setUsage({}); setRequests([]); setUsers([]); setSelectedUser(null)
      setSession(value => ({ ...(value || {}), unlocked: false }))
    } catch (requestError) { toast(t(safeDevError(requestError, 'Could not log out of Dev.'))) }
  }
  const selectUser = async userId => {
    setSelectedUserId(userId); setSelectedUser(null)
    try { setSelectedUser(await api(`/api/dev/user?id=${encodeURIComponent(userId)}`)) }
    catch (requestError) { toast(t(safeDevError(requestError, 'User details could not be loaded.'))) }
  }
  const reviewRequest = async (id, decision) => {
    setReviewingRequestId(id)
    try {
      await api('/api/dev/gym-requests/review', { method: 'POST', body: JSON.stringify({ id, decision }) })
      const data = await api('/api/dev/gym-requests')
      const nextRequests = data.requests || []
      setRequests(nextRequests); setSelectedRequestId(current => nextRequests.some(item => item.id === current) ? current : nextRequests[0]?.id || '')
    } catch (requestError) { toast(t(safeDevError(requestError, 'The request could not be reviewed.'))) }
    finally { setReviewingRequestId('') }
  }

  return (
    <main className="personal-page dev-page">
      <header className="personal-header">
        <div className="personal-header-copy"><span className="personal-eyebrow">{t('Restricted operations')}</span><h1>{t('Dev panel')}</h1><p>{t('Providers, models and controlled AI usage.')}</p></div>
      </header>
      {error && session?.unlocked ? <p className="personal-notice" role="alert">{error}</p> : null}
      {!session?.unlocked
        ? <DevLogin busy={busy} values={login} onChange={setLogin} onSubmit={unlock} error={error} />
        : <DevDashboard
          providers={providers} usage={usage} window={window} section={section} selectedProvider={selectedProvider}
          requests={requests} selectedRequestId={selectedRequestId} users={users} selectedUserId={selectedUserId} selectedUser={selectedUser}
          reviewingRequestId={reviewingRequestId} onSection={setSection} onSelectProvider={setSelectedProvider}
          onSelectRequest={setSelectedRequestId} onReviewRequest={reviewRequest} onSelectUser={selectUser}
          onWindow={changeWindow} onLogout={logout} onChanged={() => loadDashboard(window)}
        />}
    </main>
  )
}
