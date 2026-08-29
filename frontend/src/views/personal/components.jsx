import { useState } from 'react'
import { Link } from 'react-router-dom'

import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { useUI } from '../../store/useUI.js'
import { useCollaboration } from '../../store/useCollaboration.js'
import { fmtDate } from '../../lib/format.js'
import { dateLocale, t } from '../../lib/i18n.js'
import { formatMoneyBRL, normalizePriority, priorityLabel } from '../../lib/personal.js'
import {
  appointmentStatusLabel,
  buildDayTimeline,
  clientFinanceStatus,
  dateInTimeZone,
  formatTimeInZone,
  mutationErrorMessage,
  priorityReasonLabels,
  receivableStatusLabel,
} from '../../lib/personal-view.js'

const timeOf = (value, timeZone) => formatTimeInZone(value, dateLocale(), timeZone)

export function PersonalHeader({ title, subtitle, backTo, action, eyebrow = 'Professional workspace' }) {
  return (
    <header className="personal-header">
      {backTo ? <Link className="iconbtn" to={backTo} aria-label={t('Back')}><Icon name="chevronLeft" /></Link> : null}
      <div className="personal-header-copy">
        <span className="personal-eyebrow">{t(eyebrow)}</span>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <div className="personal-header-action">{action}</div> : null}
    </header>
  )
}

export function MetricCard({ label, value, icon = 'chart', tone, hint }) {
  return (
    <article className={`personal-metric${tone ? ` ${tone}` : ''}`}>
      <div className="personal-metric-label"><Icon name={icon} /><span>{label}</span></div>
      <strong className="personal-metric-value">{value}</strong>
      {hint ? <span className="personal-metric-hint">{hint}</span> : null}
    </article>
  )
}

export function PriorityBadge({ client }) {
  const priority = normalizePriority(client)
  return <span className={`status-badge priority-${priority}`}>{t(priorityLabel(priority))}</span>
}

export function StatusBadge({ status, children }) {
  return <span className={`status-badge status-${status}`}>{children}</span>
}

export function ClientRow({ client, compact = false }) {
  const timeZone = useCollaboration(state => state.profile?.timezone || 'America/Fortaleza')
  const progress = client.progress || {}
  const financeStatus = clientFinanceStatus(client.finance)
  const lastWorkout = progress.lastActivity ? fmtDate(progress.lastActivity, true) : t('No workout recorded')
  const nextClass = client.nextAppointment ? `${fmtDate(dateInTimeZone(client.nextAppointment.startsAt, timeZone), true)}, ${timeOf(client.nextAppointment.startsAt, timeZone)}` : t('No class scheduled')
  const financialLabel = financeStatus === 'none' ? t('No charges this month') : t(receivableStatusLabel(financeStatus))
  const reason = priorityReasonLabels(client).map(label => t(label)).join(' · ') || t('Up to date')

  return (
    <Link className={`client-row${compact ? ' compact' : ''}`} to={`/personal/alunos/${encodeURIComponent(client.id)}`}>
      <span className="client-row-main">
        <span className="client-row-title">
          <strong>{client.name || t('Unnamed student')}</strong>
          <PriorityBadge client={client} />
        </span>
        <span className="client-reason">{reason}</span>
        <span className="client-facts">
          <span><b>{t('Adherence')}</b>{t('{0}%', progress.adherence || 0)}</span>
          <span><b>{t('Last workout')}</b>{lastWorkout}</span>
          <span><b>{t('Next class')}</b>{nextClass}</span>
          <span><b>{t('Financial')}</b>{financialLabel}</span>
        </span>
      </span>
      <Icon name="chevronRight" />
    </Link>
  )
}

export function AgendaRail({ agenda, onEdit, onBook, title = 'Today timeline', emptyBody = 'No open slots or classes today.' }) {
  const timeZone = useCollaboration(state => state.profile?.timezone || 'America/Fortaleza')
  const timeline = buildDayTimeline(agenda)
  return (
    <section className="agenda-panel" aria-labelledby="today-timeline-title">
      <div className="panel-heading"><h2 id="today-timeline-title">{t(title)}</h2><span>{t('{0} entries', timeline.length)}</span></div>
      {timeline.length ? (
        <ol className="agenda-rail">
          {timeline.map((item, index) => {
            const open = item.kind === 'open'
            const label = open ? t('Available') : item.clientName || t('Class')
            return (
              <li className={`agenda-entry ${open ? 'is-open' : 'is-busy'}`} key={item.id || `${item.startsAt}-${index}`}>
                <time dateTime={item.startsAt}>{timeOf(item.startsAt, timeZone)}</time>
                <span className="agenda-marker" aria-hidden="true" />
                <span className="agenda-entry-copy">
                  <strong>{label}</strong>
                  <span>{timeOf(item.startsAt, timeZone)}–{timeOf(item.endsAt, timeZone)} · {t(appointmentStatusLabel(item.status))}</span>
                </span>
                {open && onBook ? <Button size="small" onClick={() => onBook(item)}>{t('Book')}</Button> : null}
                {!open && onEdit ? <Button size="small" onClick={() => onEdit(item)}>{t('Edit')}</Button> : null}
              </li>
            )
          })}
        </ol>
      ) : <EmptyPersonal icon="calendar" title={t('Today is clear')} body={t(emptyBody)} />}
    </section>
  )
}

export function EmptyPersonal({ icon = 'person', title, body, action }) {
  return (
    <div className="empty personal-empty">
      <div className="ico"><Icon name={icon} /></div>
      <strong>{title}</strong>
      <p>{body}</p>
      {action ? <div className="empty-action"><Button variant="primary" onClick={action.onClick}>{action.label}</Button></div> : null}
    </div>
  )
}

export function PersonalMutation({ path, method = 'POST', success, afterSave, close, children }) {
  const mutate = useCollaboration(state => state.mutate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async payload => {
    setBusy(true)
    setError('')
    try {
      const result = await mutate(path, payload, method)
      if (afterSave) await afterSave(result)
      if (success) useUI.getState().toast(t(success))
      setBusy(false)
      close?.()
      return result
    } catch (submitError) {
      setBusy(false)
      if (submitError.status === 403) {
        useUI.getState().toast(t(mutationErrorMessage(submitError)))
        close?.()
        return null
      }
      setError(t(mutationErrorMessage(submitError)))
      return null
    }
  }

  return (
    <>
      {children({ submit, busy })}
      {error ? <p className="form-error mutation-error" role="alert" aria-live="polite">{error}</p> : null}
    </>
  )
}

export function FinanceStatus({ finance }) {
  const status = clientFinanceStatus(finance)
  if (status === 'none') return <StatusBadge status="none">{t('No charges')}</StatusBadge>
  return <StatusBadge status={status}>{t(receivableStatusLabel(status))}</StatusBadge>
}

export { formatMoneyBRL, timeOf }
