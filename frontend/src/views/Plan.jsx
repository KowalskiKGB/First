import { Link, useLocation, useNavigate } from 'react-router-dom'

import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { DAYN, exCount, uid } from '../lib/format.js'
import { DEFAULT_GLYPH, glyphOf } from '../lib/glyphs.js'
import { t } from '../lib/i18n.js'
import { scheduledRoutineOptionsForWeekday } from '../lib/schedule.js'
import { dayAssignSheet, planToolsSheet } from '../sheets.jsx'
import { useStore } from '../store/useStore.js'
import AiPlanCard from './AiPlanCard.jsx'

export { default as AiPlanCard } from './AiPlanCard.jsx'

const routineSource = routine => routine._aiGenerated === true ? 'IA' : routine._personalProgramId ? t('Personal') : t('My workout')
const optionSource = source => source === 'ai' ? 'IA' : source === 'personal' ? t('Personal') : t('My workout')

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

  const addRoutine = () => {
    const routine = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(next => { next.routines.push(routine) })
    navigate(`/plan/r/${routine.id}`)
  }
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
        return <button type="button" key={day} className="item" onClick={() => dayAssignSheet(day)}><div className="grow"><div className="tt">{t(DAYN[day])}</div><div className="ss">{options.length ? options.map((option, index) => <span key={`${option.sourceType}-${option.planId || 'local'}-${option.routineId}-${option.version || 0}`}>{index ? ' · ' : ''}<span className={`plan-source-badge source-${option.sourceType}`}>{optionSource(option.sourceType)}</span> {option.routine.name}</span>) : t('Rest day')}</div></div><Icon name="chevronRight" className="chev" /></button>
      })}</div>
    </div><div>
      <div className="row between plan-routine-heading"><h4 className="sec">{t('Routines')}</h4><Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button></div>
      {state.routines.length ? <div className="list">{state.routines.map(routine => <Link key={routine.id} className="item" to={`/plan/r/${routine.id}`}><span className="lrow-i"><Icon name={glyphOf(routine.emoji)} /></span><div className="grow"><div className="tt">{routine.name}</div><div className="ss">{exCount(routine.ex.length)} · <span className={`plan-source-badge source-${routine._aiGenerated ? 'ai' : routine._personalProgramId ? 'personal' : 'manual'}`}>{routineSource(routine)}</span></div></div><Icon name="chevronRight" className="chev" /></Link>)}</div> : <div className="plan-empty-actions"><div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Generate with AI or create a routine manually.')}</div><Button variant="primary" icon="sparkles" onClick={openAi}>{t('Build workout with AI')}</Button><Button onClick={addRoutine}>{t('Build my own plan')}</Button></div>}
    </div></div>
  </>
}
