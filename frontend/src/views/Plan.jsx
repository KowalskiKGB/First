import { Link, useLocation, useNavigate } from 'react-router-dom'

import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { DAYN, exCount, uid } from '../lib/format.js'
import { DEFAULT_GLYPH, glyphOf } from '../lib/glyphs.js'
import { t } from '../lib/i18n.js'
import { scheduledRoutineOptionsForWeekday } from '../lib/schedule.js'
import { dayAssignSheet, generateAiRoutineSheet, planToolsSheet } from '../sheets.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import AiPlanCard from './AiPlanCard.jsx'

export { default as AiPlanCard } from './AiPlanCard.jsx'

const routineSource = routine => routine._aiGenerated === true || routine._aiSuggested === true ? 'IA' : routine._personalProgramId ? t('Personal') : t('My workout')
const optionSource = source => source === 'ai' ? 'IA' : source === 'personal' ? t('Personal') : t('My workout')
const sourceClass = routine => routine._aiGenerated === true || routine._aiSuggested === true ? 'ai' : routine._personalProgramId ? 'personal' : 'manual'
const LEGACY_ROUTINE_NAMES = { 'Push Day': 'Dia de Empurrar', 'Pull Day': 'Dia de Puxar', 'Leg Day': 'Dia de Pernas' }
const routineName = routine => {
  const name = routine?.name || ''
  const translated = t(name)
  return translated === name ? (LEGACY_ROUTINE_NAMES[name] || translated) : translated
}

const openAccount = () => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent('first:account', { detail: { mode: 'login' } }))
}

export default function Plan() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = useStore(store => store.S)
  const user = useStore(store => store.user)
  const update = useStore(store => store.update)
  const openAiSignal = location.state?.openAi ? (location.key || 'open') : null

  const addManualRoutine = () => {
    const routine = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(next => { next.routines.push(routine) })
    navigate(`/plan/r/${routine.id}`)
  }
  const addSuggestedRoutine = async choice => {
    if (!user) { openAccount(); return true }
    try {
      const response = await api('/api/ai/routine', { method: 'POST', body: JSON.stringify(choice) })
      const routine = response.routine || response
      const id = routine.id || uid()
      update(next => {
        if (next.routines.some(existing => existing.id === id)) return
        next.routines.push({
          ...routine,
          id,
          name: routine.name || t('AI routine'),
          emoji: routine.emoji || 'sparkles',
          ex: Array.isArray(routine.ex) ? routine.ex : Array.isArray(routine.exercises) ? routine.exercises : [],
          _aiSuggested: true,
          sourceType: 'ai',
          readOnly: false,
          _aiFocusAreas: choice.focus ? [choice.focus] : [],
        })
      })
      navigate(`/plan/r/${id}`)
      return true
    } catch (error) {
      useUI.getState().toast(t(error?.message || 'The AI routine could not be created.'))
      return false
    }
  }
  const addRoutine = () => generateAiRoutineSheet({ onManual: addManualRoutine, onAi: addSuggestedRoutine })
  const openAi = () => {
    if (!user) { openAccount(); return }
    navigate('/plan', { state: { openAi: true }, replace: true })
  }

  return <>
    <div className="hdr"><div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div><button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button></div>
    <div className="cols"><div>
      <AiPlanCard openSignal={openAiSignal} />
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list plan-week-list">{[1, 2, 3, 4, 5, 6, 0].map(day => {
        const options = scheduledRoutineOptionsForWeekday(state, day)
        return <button type="button" key={day} className="item" onClick={() => dayAssignSheet(day)}><div className="grow"><div className="tt">{t(DAYN[day])}</div><div className="ss">{options.length ? options.map((option, index) => <span key={`${option.sourceType}-${option.planId || 'local'}-${option.routineId}-${option.version || 0}`}>{index ? ' · ' : ''}<span className={`plan-source-badge source-${option.sourceType}`}>{optionSource(option.sourceType)}</span> {routineName(option.routine)}</span>) : t('Rest day')}</div></div><Icon name="chevronRight" className="chev" /></button>
      })}</div>
    </div><div>
      <div className="row between plan-routine-heading"><h4 className="sec">{t('Routines')}</h4><Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button></div>
      {state.routines.length ? <div className="list">{state.routines.map(routine => <Link key={routine.id} className="item" to={`/plan/r/${routine.id}`}><span className="lrow-i"><Icon name={glyphOf(routine.emoji)} /></span><div className="grow"><div className="tt">{routineName(routine)}</div><div className="ss">{exCount(routine.ex.length)} · <span className={`plan-source-badge source-${sourceClass(routine)}`}>{routineSource(routine)}</span></div></div><Icon name="chevronRight" className="chev" /></Link>)}</div> : <div className="plan-empty-actions"><div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Generate with AI or create a routine manually.')}</div><Button variant="primary" icon="sparkles" onClick={openAi}>{t('Build workout with AI')}</Button><Button onClick={addRoutine}>{t('Build my own plan')}</Button></div>}
    </div></div>
  </>
}
