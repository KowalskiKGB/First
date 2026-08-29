import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'
import { useUI } from '../store/useUI.js'

const PROVIDERS = [
  ['openai', 'ChatGPT / OpenAI', 'gpt-5.6'],
  ['gemini', 'Google Gemini', 'gemini-3.7-flash'],
  ['anthropic', 'Claude / Anthropic', 'claude-opus-5']
]

const emptyForm = () => ({ id: '', provider: 'openai', label: 'OpenAI principal', model: 'gpt-5.6', apiKey: '', active: true })

export default function DevPanel() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [session, setSession] = useState(null)
  const [login, setLogin] = useState({ username: '', password: '' })
  const [providers, setProviders] = useState([])
  const [form, setForm] = useState(emptyForm())
  const [models, setModels] = useState([])
  const [busy, setBusy] = useState(false)

  const loadSession = () => api('/api/dev/session').then(data => {
    setSession(data)
    setLogin(current => ({ ...current, username: data.username || current.username }))
    if (data.unlocked) return loadProviders()
  }).catch(error => toast(error.message || 'Painel indisponível'))
  const loadProviders = () => api('/api/dev/ai/providers').then(data => setProviders(data.providers || []))

  useEffect(() => { loadSession() }, [])

  const unlock = async e => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/dev/login', { method: 'POST', body: JSON.stringify(login) })
      setSession(current => ({ ...(current || {}), unlocked: true }))
      await loadProviders()
      toast('Painel dev desbloqueado.')
    } catch (error) {
      toast(error.message || 'Credencial inválida.')
    } finally {
      setBusy(false)
    }
  }
  const saveProvider = async e => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/dev/ai/providers', { method: 'POST', body: JSON.stringify(form) })
      setForm(emptyForm())
      setModels([])
      await loadProviders()
      toast('Provedor salvo.')
    } catch (error) {
      toast(error.message || 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }
  const editProvider = provider => {
    setForm({ ...provider, apiKey: '' })
    setModels([])
  }
  const removeProvider = async id => {
    setBusy(true)
    try {
      await api('/api/dev/ai/providers/delete', { method: 'POST', body: JSON.stringify({ id }) })
      await loadProviders()
      toast('Provedor removido.')
    } catch (error) {
      toast(error.message || 'Não foi possível remover.')
    } finally {
      setBusy(false)
    }
  }
  const listModels = async id => {
    setBusy(true)
    try {
      const data = await api(`/api/dev/ai/models?id=${encodeURIComponent(id)}`)
      setModels(data.models || [])
    } catch (error) {
      toast(error.message || 'Não foi possível listar modelos.')
    } finally {
      setBusy(false)
    }
  }
  const selectProvider = provider => {
    const row = PROVIDERS.find(([id]) => id === provider)
    setForm(current => ({ ...current, provider, model: row?.[2] || current.model, label: row?.[1] || current.label }))
  }

  return <div className="narrow dev-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>Painel dev</h1><div className="sub">IA, modelos e chaves BYOK</div></div>
    </div>

    {!session?.unlocked ? <form className="dev-card" onSubmit={unlock}>
      <div className="dev-card-head"><Icon name="shield" /><div><h2>Credencial extra</h2><p>Exige login admin por passkey e esta senha dev.</p></div></div>
      <label><span>Usuário</span><TextField name="dev-username" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} autoComplete="username" spellCheck={false} /></label>
      <label><span>Senha</span><TextField name="dev-password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} type="password" autoComplete="current-password" /></label>
      <Button icon="key" disabled={busy}>{busy ? 'Validando…' : 'Entrar no painel dev'}</Button>
    </form> : <>
      <section className="dev-card">
        <div className="dev-card-head"><Icon name="sparkles" /><div><h2>Provedores de IA</h2><p>Chaves ficam criptografadas no servidor. O app usa apenas o provedor ativo.</p></div></div>
        <div className="dev-provider-list">
          {providers.length ? providers.map(provider => <div key={provider.id} className="dev-provider-row">
            <div><b>{provider.label}</b><span>{provider.provider} · {provider.model} · {provider.hasKey ? 'chave salva' : 'sem chave'}</span></div>
            <div className="row">
              {provider.active && <span className="tag acc">ativo</span>}
              <button className="iconbtn" onClick={() => listModels(provider.id)} aria-label="Listar modelos"><Icon name="magnifier" /></button>
              <button className="iconbtn" onClick={() => editProvider(provider)} aria-label="Editar"><Icon name="pencil" /></button>
              <button className="iconbtn" onClick={() => removeProvider(provider.id)} aria-label="Remover"><Icon name="trash" /></button>
            </div>
          </div>) : <p className="ss">Nenhum provedor configurado ainda.</p>}
        </div>
      </section>

      <form className="dev-card" onSubmit={saveProvider}>
        <div className="dev-card-head"><Icon name="key" /><div><h2>{form.id ? 'Editar provedor' : 'Adicionar provedor'}</h2><p>OpenAI, Gemini e Anthropic seguem schema JSON na geração.</p></div></div>
        <label><span>Fornecedor</span><select className="field" name="dev-provider" value={form.provider} onChange={e => selectProvider(e.target.value)}>
          {PROVIDERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label><span>Nome interno</span><TextField name="dev-label" autoComplete="off" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></label>
        <label><span>Modelo</span><TextField name="dev-model" autoComplete="off" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} list="dev-models" /></label>
        <datalist id="dev-models">{models.map(model => <option key={model} value={model} />)}</datalist>
        <label><span>API key {form.id ? '(preencha só para trocar)' : ''}</span><TextField name="dev-api-key" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} type="password" autoComplete="off" spellCheck={false} /></label>
        <label className="dev-inline"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Usar como provedor ativo</label>
        <Button icon="check" disabled={busy}>{busy ? 'Salvando…' : 'Salvar provedor'}</Button>
      </form>
    </>}
  </div>
}
