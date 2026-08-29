import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import AppointmentForm from '../../components/personal/AppointmentForm.jsx'
import ClientForm from '../../components/personal/ClientForm.jsx'
import MeasurementForm from '../../components/personal/MeasurementForm.jsx'
import MoneyBars from '../../components/personal/MoneyBars.jsx'
import ProgramEditor from '../../components/personal/ProgramEditor.jsx'
import ReceivableForm from '../../components/personal/ReceivableForm.jsx'
import TrendChart from '../../components/personal/TrendChart.jsx'
import { Button } from '../../components/ui.jsx'
import { fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import {
  appointmentStatusLabel,
  dateInTimeZone,
  measurementKindLabel,
  measurementTrend,
  normalizeStudentTab,
  priorityReasonLabels,
  receivableDisplayStatus,
  receivableStatusLabel,
} from '../../lib/personal-view.js'
import { useCollaboration } from '../../store/useCollaboration.js'
import { useUI } from '../../store/useUI.js'
import { confirmSheet } from '../../sheets.jsx'
import {
  EmptyPersonal,
  FinanceStatus,
  MetricCard,
  PersonalHeader,
  PersonalMutation,
  PriorityBadge,
  StatusBadge,
  formatMoneyBRL,
  timeOf,
} from './components.jsx'

const TABS = [
  ['resumo', 'Summary'],
  ['treino', 'Training'],
  ['evolucao', 'Evolution'],
  ['medidas', 'Measurements'],
  ['agenda', 'Schedule'],
  ['financeiro', 'Finances'],
]

const BILATERAL = new Set(['arm', 'thigh', 'calf'])

function ClientSheet({ close, client }) {
  return (
    <>
      <h3>{t('Edit student record')}</h3>
      <PersonalMutation path="/api/personal/client" method="PUT" success="Student updated" close={close}>
        {({ submit, busy }) => <ClientForm client={client} onSubmit={submit} busy={busy} />}
      </PersonalMutation>
    </>
  )
}

function AppointmentSheet({ close, appointment, client, loadClient, timeZone }) {
  const editing = Boolean(appointment?.id)
  return (
    <>
      <h3>{t(editing ? 'Edit class' : 'Schedule class')}</h3>
      <PersonalMutation
        path={editing ? '/api/personal/appointment' : '/api/personal/appointments'}
        method={editing ? 'PUT' : 'POST'}
        success={editing ? 'Class updated' : 'Class scheduled'}
        afterSave={() => loadClient(client.id)}
        close={close}
      >
        {({ submit, busy }) => <AppointmentForm appointment={appointment} clients={[client]} clientId={client.id} timeZone={timeZone} onSubmit={submit} busy={busy} />}
      </PersonalMutation>
    </>
  )
}

function ReceivableSheet({ close, receivable, client, loadClient }) {
  const editing = Boolean(receivable?.id)
  return (
    <>
      <h3>{t(editing ? 'Edit charge' : 'New charge')}</h3>
      <p className="sheet-intro">{t('Manual accounts receivable in BRL. No payment is processed here.')}</p>
      <PersonalMutation
        path={editing ? '/api/personal/receivable' : '/api/personal/receivables'}
        method={editing ? 'PUT' : 'POST'}
        success={editing ? 'Charge updated' : 'Charge created'}
        afterSave={() => loadClient(client.id)}
        close={close}
      >
        {({ submit, busy }) => <ReceivableForm receivable={receivable} clients={[client]} clientId={client.id} onSubmit={submit} busy={busy} />}
      </PersonalMutation>
    </>
  )
}

function SummaryTab({ client }) {
  const progress = client.progress || {}
  return (
    <div className="detail-grid summary-grid">
      <section className="personal-panel summary-primary">
        <div className="panel-heading"><h2>{t('Operational summary')}</h2><PriorityBadge client={client} /></div>
        <dl className="detail-list">
          <div><dt>{t('Goal')}</dt><dd>{client.goal || t('Not informed')}</dd></div>
          <div><dt>{t('Last workout')}</dt><dd>{progress.lastActivity ? fmtDate(progress.lastActivity, true) : t('No workout recorded')}</dd></div>
          <div><dt>{t('Target')}</dt><dd>{t('{0} sessions per week', client.targetSessionsPerWeek || 3)}</dd></div>
          <div><dt>{t('Inactivity alert')}</dt><dd>{t('After {0} days', client.inactiveAfterDays || 7)}</dd></div>
        </dl>
      </section>
      <section className="personal-panel">
        <div className="panel-heading"><h2>{t('Reasons to act')}</h2></div>
        <ul className="reason-list">
          {priorityReasonLabels(client).map(reason => <li key={reason}>{t(reason)}</li>)}
          {!client.reasons?.length ? <li>{t('No urgent reason right now.')}</li> : null}
        </ul>
      </section>
      <section className="personal-panel">
        <div className="panel-heading"><h2>{t('Contact and notes')}</h2></div>
        <p>{client.phone || t('No phone informed')}</p>
        <p className="panel-note">{client.notes || t('No notes yet.')}</p>
      </section>
    </div>
  )
}

function TrainingTab({ client, program }) {
  return (
    <section className="personal-panel editor-panel">
      <div className="panel-heading">
        <h2>{t('Published program')}</h2>
        <span>{program ? t('Version {0}', program.version || 1) : t('No published version')}</span>
      </div>
      <p className="panel-note">{t('Publishing creates a new version for future training only.')}</p>
      <PersonalMutation path="/api/personal/program" method="PUT" success="Program published">
        {({ submit, busy }) => <ProgramEditor clientId={client.id} program={program} onPublish={submit} busy={busy} />}
      </PersonalMutation>
    </section>
  )
}

function EvolutionTab({ client, measurements }) {
  const kinds = useMemo(() => [...new Set(measurements.map(item => item.kind))], [measurements])
  const [kind, setKind] = useState(() => kinds[0] || 'weight')
  const activeKind = kinds.includes(kind) ? kind : kinds[0] || 'weight'
  const sides = BILATERAL.has(activeKind) ? ['left', 'right'] : [null]
  const progress = client.progress || {}
  const workoutPoints = (progress.recentWorkouts || []).slice().reverse().map(workout => ({
    id: workout.id || workout.d,
    label: fmtDate(workout.d, true),
    value: Number(workout.vol) || 0,
  }))

  return (
    <div className="evolution-layout">
      <section className="metric-grid evolution-kpis" aria-label={t('Training evolution indicators')}>
        <MetricCard label={t('Adherence in 28 days')} value={t('{0}%', progress.adherence || 0)} icon="target" />
        <MetricCard label={t('Frequency in 28 days')} value={progress.workouts28d || 0} icon="calendar" hint={t('{0} per week', ((progress.workouts28d || 0) / 4).toFixed(1))} />
        <MetricCard label={t('Volume in 28 days')} value={(progress.volume28d || 0).toLocaleString('pt-BR')} icon="barbell" />
        <MetricCard label={t('Last workout')} value={progress.lastActivity ? fmtDate(progress.lastActivity, true) : '—'} icon="history" />
      </section>

      <section className="personal-panel measurement-trends">
        <div className="panel-heading"><h2>{t('Body measurements')}</h2><span>{t('{0} entries', measurements.length)}</span></div>
        {kinds.length ? (
          <label className="form-field trend-picker">
            <span>{t('Measurement to compare')}</span>
            <select className="field" name="measurementTrendKind" autoComplete="off" value={activeKind} onChange={event => setKind(event.target.value)}>
              {kinds.map(value => <option value={value} key={value}>{t(measurementKindLabel(value))}</option>)}
            </select>
          </label>
        ) : null}
        <div className="trend-grid">
          {sides.map(side => {
            const series = measurementTrend(measurements, activeKind, side).map(item => ({ ...item, label: fmtDate(item.observedAt, true) }))
            const unit = series[0]?.unit || (activeKind === 'weight' ? 'kg' : activeKind === 'bodyFat' ? '%' : 'cm')
            const sideLabel = side ? ` · ${t(side === 'left' ? 'Left' : 'Right')}` : ''
            return <TrendChart key={side || activeKind} title={`${t(measurementKindLabel(activeKind))}${sideLabel}`} points={series} unit={unit} />
          })}
        </div>
      </section>

      <TrendChart title={t('Training volume by workout')} points={workoutPoints} valueFormatter={value => value.toLocaleString('pt-BR')} />
    </div>
  )
}

function MeasurementsTab({ client, measurements }) {
  return (
    <div className="detail-grid">
      <section className="personal-panel editor-panel">
        <div className="panel-heading"><h2>{t('Register measurement')}</h2></div>
        <PersonalMutation path="/api/personal/measurements" success="Measurement registered">
          {({ submit, busy }) => <MeasurementForm clientId={client.id} onSubmit={submit} busy={busy} />}
        </PersonalMutation>
      </section>
      <section className="personal-panel">
        <div className="panel-heading"><h2>{t('Measurement history')}</h2><span>{t('{0} entries', measurements.length)}</span></div>
        {measurements.length ? (
          <div className="table-scroll">
            <table className="detail-table">
              <caption>{t('Complete measurement history')}</caption>
              <thead><tr><th scope="col">{t('Date')}</th><th scope="col">{t('Measurement')}</th><th scope="col">{t('Value')}</th></tr></thead>
              <tbody>{measurements.map(item => (
                <tr key={item.id}>
                  <th scope="row">{fmtDate(item.observedAt, true)}</th>
                  <td>{t(measurementKindLabel(item.kind))}{item.side ? ` · ${t(item.side === 'left' ? 'Left' : 'Right')}` : ''}</td>
                  <td>{item.value.toLocaleString('pt-BR')} {item.unit}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyPersonal icon="scale" title={t('No measurements yet')} body={t('Register the first authorized measurement above.')} />}
      </section>
    </div>
  )
}

function ScheduleTab({ client, appointments, loadClient, timeZone }) {
  const open = appointment => useUI.getState().openSheet(close => <AppointmentSheet close={close} appointment={appointment} client={client} loadClient={loadClient} timeZone={timeZone} />)
  return (
    <section className="personal-panel">
      <div className="panel-heading"><h2>{t('Complete class history')}</h2><Button variant="primary" icon="plus" onClick={() => open(null)}>{t('Schedule class')}</Button></div>
      {appointments.length ? (
        <div className="appointment-list">
          {appointments.map(appointment => (
            <article className="appointment-row" key={appointment.id}>
              <div><strong>{fmtDate(dateInTimeZone(appointment.startsAt, timeZone), true)}</strong><span>{timeOf(appointment.startsAt, timeZone)}–{timeOf(appointment.endsAt, timeZone)}{appointment.note ? ` · ${appointment.note}` : ''}</span></div>
              <StatusBadge status={appointment.status}>{t(appointmentStatusLabel(appointment.status))}</StatusBadge>
              <div className="row-actions">
                <Button onClick={() => open(appointment)}>{t('Reschedule')}</Button>
                {appointment.status !== 'cancelled' ? (
                  <PersonalMutation path="/api/personal/appointment" method="PUT" success="Class cancelled" afterSave={() => loadClient(client.id)}>
                    {({ submit, busy }) => <Button variant="danger" disabled={busy} onClick={() => confirmSheet({
                      title: t('Cancel class?'),
                      message: t('This frees the time slot and keeps the class in history.'),
                      confirmText: t('Cancel class'),
                      danger: true,
                      onConfirm: () => submit({ ...appointment, status: 'cancelled' }),
                    })}>{t('Cancel')}</Button>}
                  </PersonalMutation>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : <EmptyPersonal icon="calendar" title={t('No classes yet')} body={t('Schedule the first class for this student.')} />}
    </section>
  )
}

function FinanceTab({ client, receivables, loadClient }) {
  const open = receivable => useUI.getState().openSheet(close => <ReceivableSheet close={close} receivable={receivable} client={client} loadClient={loadClient} />)
  return (
    <div className="finance-detail-layout">
      <MoneyBars months={client.finance?.months || []} />
      <section className="personal-panel">
        <div className="panel-heading"><h2>{t('Complete charge history')}</h2><Button variant="primary" icon="plus" onClick={() => open(null)}>{t('New charge')}</Button></div>
        {receivables.length ? (
          <div className="receivable-list">
            {receivables.map(receivable => {
              const status = receivableDisplayStatus(receivable)
              return (
                <article className="receivable-row" key={receivable.id}>
                  <div><strong>{receivable.period}</strong><span>{t('Due {0} · {1}', fmtDate(receivable.dueOn, true), formatMoneyBRL(receivable.amountCents))}</span></div>
                  <StatusBadge status={status}>{t(receivableStatusLabel(status))}</StatusBadge>
                  <div className="row-actions">
                    <Button onClick={() => open(receivable)}>{t('Edit')}</Button>
                    {receivable.status === 'open' ? (
                      <PersonalMutation path="/api/personal/receivable" method="PUT" success="Charge marked as paid" afterSave={() => loadClient(client.id)}>
                        {({ submit, busy }) => <Button disabled={busy} onClick={() => submit({ ...receivable, status: 'paid', paidAt: new Date().toISOString(), paymentMethod: 'manual' })}>{t('Mark paid')}</Button>}
                      </PersonalMutation>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : <EmptyPersonal icon="scale" title={t('No charges yet')} body={t('Create the first monthly charge for this student.')} />}
      </section>
    </div>
  )
}

export default function StudentDetail() {
  const { id, tab: requestedTab } = useParams()
  const tab = normalizeStudentTab(requestedTab)
  const detail = useCollaboration(state => state.detail)
  const selected = useCollaboration(state => state.selected)
  const loading = useCollaboration(state => state.loading)
  const error = useCollaboration(state => state.error)
  const message = useCollaboration(state => state.message)
  const loadClient = useCollaboration(state => state.loadClient)
  const timeZone = useCollaboration(state => state.profile?.timezone || 'America/Fortaleza')
  const current = selected === id && detail?.client?.id === id ? detail : null

  useEffect(() => {
    if (!id || current) return
    loadClient(id).catch(() => {})
  }, [current, id, loadClient])

  if (loading && !current) return <div className="empty" role="status">{t('Loading student…')}</div>
  if (!current) return (
    <main className="personal-page">
      <PersonalHeader title={t('Student unavailable')} backTo="/personal/alunos" />
      <EmptyPersonal icon="shield" title={t('Could not load student')} body={message || error || t('This record is unavailable or permission was revoked.')} action={id ? { label: t('Try again'), onClick: () => loadClient(id).catch(() => {}) } : null} />
    </main>
  )

  const { client, measurements = [], appointments = [], receivables = [], program } = current
  const progress = client.progress || {}
  const nextClass = client.nextAppointment ? `${fmtDate(dateInTimeZone(client.nextAppointment.startsAt, timeZone), true)} · ${timeOf(client.nextAppointment.startsAt, timeZone)}` : t('No class scheduled')
  const editClient = () => useUI.getState().openSheet(close => <ClientSheet close={close} client={client} />)

  return (
    <main className="personal-page student-detail">
      <PersonalHeader
        title={client.name}
        subtitle={client.goal || t('Goal not informed')}
        backTo="/personal/alunos"
        action={<Button icon="pencil" onClick={editClient}>{t('Edit record')}</Button>}
      />
      {message ? <p className="personal-notice" role="status">{message}</p> : null}

      <section className="student-context" aria-label={t('Student context')}>
        <div><span>{t('Goal')}</span><strong>{client.goal || t('Not informed')}</strong></div>
        <div><span>{t('Adherence')}</span><strong>{t('{0}%', progress.adherence || 0)}</strong></div>
        <div><span>{t('Next class')}</span><strong>{nextClass}</strong></div>
        <div><span>{t('Financial')}</span><FinanceStatus finance={client.finance} /></div>
      </section>

      <nav className="student-tabs" aria-label={t('Student record sections')}>
        {TABS.map(([value, label]) => (
          <Link key={value} to={`/personal/alunos/${encodeURIComponent(client.id)}/${value}`} aria-current={tab === value ? 'page' : undefined} className={tab === value ? 'on' : ''}>
            {t(label)}
          </Link>
        ))}
      </nav>

      <div className="detail-tab" key={tab}>
        {tab === 'resumo' ? <SummaryTab client={client} /> : null}
        {tab === 'treino' ? <TrainingTab client={client} program={program} /> : null}
        {tab === 'evolucao' ? <EvolutionTab client={client} measurements={measurements} /> : null}
        {tab === 'medidas' ? <MeasurementsTab client={client} measurements={measurements} /> : null}
        {tab === 'agenda' ? <ScheduleTab client={client} appointments={appointments} loadClient={loadClient} timeZone={timeZone} /> : null}
        {tab === 'financeiro' ? <FinanceTab client={client} receivables={receivables} loadClient={loadClient} /> : null}
      </div>
    </main>
  )
}
