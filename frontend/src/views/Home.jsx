import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button } from '../components/ui.jsx'
import { effectiveRoutineId, lastBW, streakWeeks, trainedDates } from '../lib/history.js'
import { aiProfile } from '../lib/ai-plan.js'
import { DAYS, fmtDate, fmtNum, isoOf, todayISO, weekKey } from '../lib/format.js'
import { glyphOf } from '../lib/glyphs.js'
import { dateLocale, t } from '../lib/i18n.js'
import { scheduledRoutineOptions, scheduledRoutineOptionsForWeekday } from '../lib/schedule.js'
import { bwDeltaColor, bwSheet, calendarSheet, dayOverrideSheet, goalSheet, startFlow } from '../sheets.jsx'
import { useStore } from '../store/useStore.js'

const openAccount = () => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent('first:account', { detail: { mode: 'login' } }))
}

// Home keeps the next workout obvious while making progress and AI setup useful at a glance.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(store => store.S)
  const user = useStore(store => store.user)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const todayId = todayISO()
  const todayOptions = scheduledRoutineOptions(S, todayId)
  const routine = todayOptions[0]?.routine || null
  const todayOvr = S.dayPlan[todayId] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null
  const profile = aiProfile(S)

  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = trainedDates(S.workouts)
  const strip = []
  let selectedWeekDone = 0
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    const iso = isoOf(date)
    const effective = effectiveRoutineId(S, iso)
    const override = S.dayPlan[iso] !== undefined
    const done = doneDays.has(iso)
    if (done) selectedWeekDone += 1
    const dot = done ? ' done' : override && effective ? ' ovr' : effective ? ' plan' : ''
    strip.push(
      <button
        type="button"
        key={iso}
        className={`wday${iso === todayId ? ' today' : ''}`}
        onClick={() => dayOverrideSheet(iso)}
        aria-label={date.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
      >
        <span className="lbl">{t(DAYS[date.getDay()])}</span>
        <span className="num">{date.getDate()}</span>
        <span className={`dot${dot}`} />
      </button>,
    )
  }

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const weekLabel = weekOffset === 0
    ? t('This week')
    : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`
  const completedThisWeek = [...doneDays].filter(date => weekKey(date) === weekKey(todayId)).length
  const plannedPerWeek = Array.from({ length: 7 }, (_, day) => scheduledRoutineOptionsForWeekday(S, day).length > 0).filter(Boolean).length
  const selectedProgress = plannedPerWeek ? Math.min(selectedWeekDone / plannedPerWeek, 1) : 0
  const bwPoints = S.bodyweight.slice(-30).map(entry => ({ t: entry.t || new Date(entry.d).getTime(), y: entry.w, d: entry.d }))
  const readiness = [
    [t('Current weight'), Boolean(bw?.w)],
    [t('Height (cm)'), Boolean(profile.heightCm)],
    [t('Primary goal'), Boolean(String(profile.goal || '').trim())],
    [t('Available equipment'), Boolean(profile.equipment?.length)],
  ]
  const readinessCount = readiness.filter(([, complete]) => complete).length

  const onToday = () => {
    if (S.active) nav('/workout')
    else if (todayOptions.length) startFlow()
    else dayOverrideSheet(todayId)
  }
  const onAi = () => {
    if (!user) {
      openAccount()
      return
    }
    nav('/plan', { state: { openAi: true } })
  }

  return <div className="narrow home-dashboard">
    <header className="hdr home-header">
      <div>
        <h1>{user?.name ? t('Hello, {0}', user.name) : t('Hello!')}</h1>
        <div className="sub capitalize">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      <div className="home-header-actions">
        {!user ? <button type="button" className="btn primary sm home-login-cta" onClick={openAccount}>{t('Sign in')}</button> : null}
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
      </div>
    </header>

    <section className="card home-week-card" aria-labelledby="home-week-title">
      <div className="home-card-heading">
        <div>
          <span className="personal-eyebrow">{t('Training rhythm')}</span>
          <h2 id="home-week-title">{t('This week')}</h2>
        </div>
        <strong>{selectedWeekDone}{plannedPerWeek ? ` / ${plannedPerWeek}` : ''}</strong>
      </div>
      <div className="home-week-progress" role="progressbar" aria-label={t('This week')} aria-valuemin="0" aria-valuemax={Math.max(plannedPerWeek, selectedWeekDone, 1)} aria-valuenow={selectedWeekDone}>
        <span style={{ transform: `scaleX(${selectedProgress})` }} />
      </div>
      <div className="home-week-nav">
        <button className="iconbtn" onClick={() => setWeekOffset(value => value - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        <span>{weekLabel}</span>
        <button className="iconbtn" onClick={() => setWeekOffset(value => value + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="week home-week-rail">{strip}</div>
      <button type="button" className="today-row" onClick={onToday}>
        <div className="row home-today-copy">
          <span className={`lrow-i ${S.active ? 'home-session-active' : routine ? 'home-session-ready' : 'home-session-rest'}`}>
            <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : t('Rest day')}{todayOvr && routine ? ` · ${t('rescheduled')}` : ''}</div>
          </div>
        </div>
        {S.active ? <span className="tag home-resume-tag">{t('Resume')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
            : <Icon name="plus" className="chev" />}
      </button>
    </section>

    <section className="home-ai-card" aria-labelledby="home-ai-title">
      <div className="home-ai-heading">
        <span className="home-ai-icon"><Icon name="sparkles" /></span>
        <div>
          <span className="personal-eyebrow">{t('Adaptive weekly plan')}</span>
          <h2 id="home-ai-title">{S.aiLastGeneration ? t('Review your AI workout') : t('Build workout with AI')}</h2>
          <p>{S.aiLastGeneration
            ? t('Version {0} is active. Update only when you choose.', S.aiLastGeneration.version)
            : user ? t('Measurements, goals and gym equipment in four short steps.') : t('Sign in to generate a workout with AI.')}</p>
        </div>
        <span className="plan-source-badge source-ai">IA</span>
      </div>

      {user ? <div className="home-ai-readiness">
        <div className="home-ai-readiness-head"><span>{t('Data and measurements')}</span><strong>{readinessCount}/4</strong></div>
        <ul>{readiness.map(([label, complete]) => <li key={label} className={complete ? 'is-complete' : ''}><Icon name={complete ? 'check' : 'plus'} /><span>{label}</span></li>)}</ul>
      </div> : <div className="home-ai-guest-note"><Icon name="shield" /><span>{t('Your workouts. Your weights. Your profile.')}</span></div>}

      <Button variant="primary" icon="sparkles" onClick={onAi}>{t('Build workout with AI')}</Button>
    </section>

    {!S.routines.length && !S.active ? <section className="card home-empty-plan">
      <div className="home-empty-icon"><Icon name="clipboard" /></div>
      <div>
        <span className="personal-eyebrow">{t('Your weekly routine')}</span>
        <h2>{t('Your first workout starts here')}</h2>
        <p>{t('Use your data to build a personalized week, or create every detail manually.')}</p>
      </div>
      <div className="home-empty-actions">
        <Button variant="primary" icon="sparkles" onClick={onAi}>{t('Build workout with AI')}</Button>
        <Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    </section> : null}

    <section className="card home-weight-card">
      <div className="row between home-weight-heading">
        <h2>{t('Body weight')}</h2>
        <div className="row home-weight-actions">
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row home-weight-value">
          <div className="big">{fmtNum(bw.w)} <span className="muted">{S.unit}</span></div>
          {!!delta ? <span className="small row home-weight-delta" style={{ color: bwDeltaColor(delta, bw.w) }}>
            <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} />{fmtNum(Math.abs(delta))}
          </span> : null}
          <span className="dim small">{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW ? <div className="small row home-weight-goal">
          <Icon name="target" />
          <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', `${fmtNum(Math.abs(S.targetW - bw.w))} ${S.unit}`)}</span>
        </div> : null}
        <div className="chart home-weight-chart"><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="home-weight-empty"><Icon name="info" /><p>{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</p><Button size="sm" variant="tinted" onClick={() => bwSheet()}>{t('Log body weight')}</Button></div>}
    </section>

    <button type="button" className="card tappable" onClick={() => calendarSheet()} aria-label={t('Open training calendar')}>
      <div>
        <div className="home-streak"><Icon name="flame" />{t('{0} week streak', streakWeeks(S))}</div>
        <div className="muted small">{completedThisWeek}{plannedPerWeek ? ` / ${plannedPerWeek}` : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
      </div>
      <Icon name="calendar" className="chev" />
    </button>
  </div>
}
