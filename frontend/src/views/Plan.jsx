import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { AI_EQUIPMENT, AI_EXPERIENCE, aiProfile, latestBodyWeight } from '../lib/ai-plan.js'
import { applyAiPlanToState, canonicalAiMissingFields, generateAiWorkout, persistCanonicalAiContext } from '../lib/ai-job-flow.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Segmented, TextArea, TextField } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    <div className="cols"><div>
      <AiPlanCard />
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}{r._personalProgramId ? ` · ${t('Personal')}` : ''}{r._aiGenerated ? ' · IA' : ''}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}

export function AiPlanCard() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const replaceState = useStore(s => s.replaceState)
  const toast = useUI(s => s.toast)
  const profile = aiProfile(S)
  const latest = latestBodyWeight(S)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [weight, setWeight] = useState(latest?.w || '')
  const generationMissing = canonicalAiMissingFields({ profile, weight })

  useEffect(() => { setWeight(latest?.w || '') }, [latest?.w])
  useEffect(() => {
    if (!user) return
    api('/api/ai/status').then(setStatus).catch(() => setStatus({ configured: false }))
  }, [user?.id])

  const setProfile = patch => update(state => { state.aiProfile = { ...aiProfile(state), ...patch } }, false)
  const toggleEquipment = id => {
    const current = new Set(profile.equipment || [])
    if (current.has(id)) current.delete(id); else current.add(id)
    setProfile({ equipment: [...current] })
  }
  const toggleAvailableDay = day => {
    const current = profile.availableDays || []
    setProfile({
      availableDays: current.includes(day)
        ? current.filter(value => value !== day)
        : [...current, day].sort((a, b) => a - b)
    })
  }
  const saveWeight = value => {
    setWeight(value)
    update(state => {
      const today = new Date().toISOString().slice(0, 10)
      state.bodyweight = (state.bodyweight || []).filter(row => row.d !== today)
      if (value) state.bodyweight.push({ d: today, w: value })
    }, false)
  }
  const generate = async () => {
    if (!user) { toast('Entre com sua conta para usar IA.'); return }
    const currentState = useStore.getState().S
    const currentProfile = aiProfile(currentState)
    const nowMissing = canonicalAiMissingFields({ profile: currentProfile, weight })
    if (nowMissing.length) { toast(`Complete: ${nowMissing.join(', ')}`); return }
    setBusy(true)
    try {
      await useStore.getState().pushState()
      const prepared = await persistCanonicalAiContext({
        profile: currentProfile,
        weight,
        weightUnit: currentState.unit,
        observedAt: new Date().toISOString().slice(0, 10)
      })
      setStatus(prepared.status)
      const completeness = prepared.context.completeness || {}
      if (prepared.status?.configured === false) throw new Error('Configure um provedor de IA antes de gerar o treino.')
      if (completeness.blockers?.length) throw new Error('A geração está bloqueada até a revisão dos dados de saúde.')
      if (completeness.eligible !== true || completeness.missing?.length) {
        throw new Error(`Complete: ${(completeness.missing || ['dados obrigatórios']).join(', ')}`)
      }
      const { context } = await generateAiWorkout({ idempotencyKey: `plan-${uid()}` })
      replaceState(applyAiPlanToState(useStore.getState().S, context.plan), false)
      await useStore.getState().pushState()
      setStatus(current => ({
        ...(current || {}),
        configured: true,
        eligible: context.completeness?.eligible ?? true,
        missing: context.completeness?.missing || [],
        blockers: context.completeness?.blockers || []
      }))
      toast('Treino da semana gerado e aplicado.')
    } catch (error) {
      toast(error.message || 'Não foi possível gerar o treino.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ai-card" aria-labelledby="ai-plan-title">
      <div className="ai-card-head">
        <span className="ai-icon"><Icon name="sparkles" /></span>
        <div className="grow">
          <h2 id="ai-plan-title">Treino da semana com IA</h2>
          <p>Plano premium: usa seus dados, objetivo e aparelhos da academia para montar a semana.</p>
        </div>
        <span className={'ai-pill ' + (status?.configured ? 'ok' : '')}>{status?.configured ? 'IA ativa' : 'Configurar IA'}</span>
      </div>

      {S.aiLastGeneration && <div className="ai-last">
        <b>{S.aiLastGeneration.name}</b>
        <span>{S.aiLastGeneration.summary}</span>
      </div>}

      <div className="ai-form-grid">
        <label><span>Peso atual ({S.unit || 'kg'})</span><NumberField name="ai-weight" value={weight} onChange={saveWeight} /></label>
        <label><span>Altura (cm)</span><NumberField name="ai-height" decimal={false} value={profile.heightCm} onChange={heightCm => setProfile({ heightCm })} /></label>
        <label><span>Sessões/semana</span><NumberField name="ai-sessions" decimal={false} value={profile.sessionsPerWeek} onChange={sessionsPerWeek => setProfile({ sessionsPerWeek })} /></label>
        <label><span>Minutos/sessão</span><NumberField name="ai-minutes" decimal={false} value={profile.minutesPerSession} onChange={minutesPerSession => setProfile({ minutesPerSession })} /></label>
        <label><span>Academia</span><TextField name="ai-gym-name" autoComplete="organization" value={profile.gymName} onChange={e => setProfile({ gymName: e.target.value })} /></label>
      </div>

      <label className="ai-field"><span>Objetivo principal</span><TextField name="ai-goal" autoComplete="off" value={profile.goal} onChange={e => setProfile({ goal: e.target.value })} placeholder="Ex.: hipertrofia, emagrecimento, força…" /></label>
      <fieldset className="ai-choice-group">
        <legend>Faixa etária</legend>
        <Segmented className="ai-seg" value={profile.ageBand} onChange={ageBand => setProfile({ ageBand })} options={[
          { value: 'under14', label: 'Menos de 14' }, { value: '14to17', label: '14 a 17' }, { value: 'adult', label: '18 ou mais' }
        ]} />
      </fieldset>
      <fieldset className="ai-choice-group">
        <legend>Consentimento para usar estes dados na geração</legend>
        <Segmented className="ai-seg" value={profile.consent} onChange={consent => setProfile({ consent })} options={[
          { value: true, label: 'Autorizo' }, { value: false, label: 'Não autorizo' }
        ]} />
      </fieldset>
      {profile.ageBand && profile.ageBand !== 'adult' && <fieldset className="ai-choice-group">
        <legend>Autorização do responsável</legend>
        <Segmented className="ai-seg" value={profile.guardianConsent} onChange={guardianConsent => setProfile({ guardianConsent })} options={[
          { value: true, label: 'Autorizado' }, { value: false, label: 'Não autorizado' }
        ]} />
      </fieldset>}
      <fieldset className="ai-choice-group">
        <legend>Dias disponíveis</legend>
        <div className="ai-days">
          {[1, 2, 3, 4, 5, 6, 0].map(day => <button key={day} type="button" aria-pressed={(profile.availableDays || []).includes(day)} onClick={() => toggleAvailableDay(day)}>
            {t(DAYN[day])}
          </button>)}
        </div>
      </fieldset>
      <fieldset className="ai-choice-group">
        <legend>Experiência</legend>
        <Segmented className="ai-seg" value={profile.experience} onChange={experience => setProfile({ experience })} options={AI_EXPERIENCE.map(([value, label]) => ({ value, label }))} />
      </fieldset>
      <label className="ai-field"><span>Preferências</span><TextArea name="ai-preferences" autoComplete="off" value={profile.preferences} onChange={e => setProfile({ preferences: e.target.value })} placeholder="Ex.: gosto de costas, não gosto de corrida, prefiro halteres…" /></label>
      <label className="ai-field"><span>Restrições ou observações</span><TextArea name="ai-limitations" autoComplete="off" value={profile.limitations} onChange={e => setProfile({ limitations: e.target.value })} placeholder="Ex.: evitar impacto no joelho, sem agachamento livre…" /></label>

      <div className="ai-equipment">
        <div className="ai-equipment-title">Aparelhos disponíveis na academia</div>
        <div className="ai-equipment-grid">
          {AI_EQUIPMENT.map(([id, label]) => <button key={id} type="button" className={profile.equipment.includes(id) ? 'on' : ''} onClick={() => toggleEquipment(id)} aria-pressed={profile.equipment.includes(id)}>
            <span className="ai-check"><Icon name="check" /></span>
            <span>{label}</span>
          </button>)}
        </div>
      </div>

      <div className="ai-actions">
        <div className="ss">{generationMissing.length ? `Falta: ${generationMissing.join(', ')}` : status?.provider ? `Modelo: ${status.provider.label || status.provider.provider} · ${status.provider.selectedModel}` : 'Dados completos para gerar.'}</div>
        <Button icon="sparkles" onClick={generate} disabled={busy || status?.configured === false || generationMissing.length > 0}>{busy ? 'Gerando…' : 'Elaborar meu treino com IA'}</Button>
      </div>
    </section>
  )
}
