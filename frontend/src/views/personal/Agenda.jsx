import AppointmentForm from '../../components/personal/AppointmentForm.jsx'
import AvailabilityForm from '../../components/personal/AvailabilityForm.jsx'
import { Button } from '../../components/ui.jsx'
import { fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import { appointmentStatusLabel, dateInTimeZone, upcomingFromClients } from '../../lib/personal-view.js'
import { useCollaboration } from '../../store/useCollaboration.js'
import { useUI } from '../../store/useUI.js'
import { confirmSheet } from '../../sheets.jsx'
import {
  AgendaRail,
  EmptyPersonal,
  PersonalHeader,
  PersonalMutation,
  StatusBadge,
  timeOf,
} from './components.jsx'

function AppointmentSheet({ close, appointment, clients, timeZone }) {
  const editing = Boolean(appointment?.id)
  return (
    <>
      <h3>{t(editing ? 'Edit class' : 'Schedule class')}</h3>
      <p className="sheet-intro">{t('Times use the trainer’s configured timezone. Conflicts are checked when saving.')}</p>
      <PersonalMutation
        path={editing ? '/api/personal/appointment' : '/api/personal/appointments'}
        method={editing ? 'PUT' : 'POST'}
        success={editing ? 'Class updated' : 'Class scheduled'}
        close={close}
      >
        {({ submit, busy }) => <AppointmentForm appointment={appointment} clients={clients} timeZone={timeZone} onSubmit={submit} busy={busy} />}
      </PersonalMutation>
    </>
  )
}

function AvailabilitySheet({ close, availability }) {
  return (
    <>
      <h3>{t('Weekly availability')}</h3>
      <PersonalMutation path="/api/personal/availability" method="PUT" success="Availability updated" close={close}>
        {({ submit, busy }) => <AvailabilityForm availability={availability} onSubmit={submit} busy={busy} />}
      </PersonalMutation>
    </>
  )
}

const openAppointment = (appointment, clients, timeZone) => useUI.getState().openSheet(close => (
  <AppointmentSheet close={close} appointment={appointment} clients={clients} timeZone={timeZone} />
))

export default function Agenda() {
  const workspace = useCollaboration(state => state.workspace)
  const loading = useCollaboration(state => state.loading)
  const error = useCollaboration(state => state.error)
  const message = useCollaboration(state => state.message)
  const timeZone = useCollaboration(state => state.profile?.timezone || 'America/Fortaleza')
  const reloadWorkspace = useCollaboration(state => state.reloadWorkspace)
  const clients = workspace?.clients || []
  const upcoming = upcomingFromClients(clients)

  if (loading && !workspace) return <div className="empty" role="status">{t('Loading schedule…')}</div>
  if (!workspace) return <EmptyPersonal icon="shield" title={t('Schedule unavailable')} body={message || error || t('Your professional access may have changed.')} />

  const editAvailability = () => useUI.getState().openSheet(close => <AvailabilitySheet close={close} availability={workspace.availability} />)

  return (
    <main className="personal-page">
      <PersonalHeader
        title={t('Schedule')}
        subtitle={t('Today’s capacity and each student’s next real class.')}
        backTo="/personal"
        action={<Button variant="primary" icon="plus" onClick={() => openAppointment(null, clients, timeZone)}>{t('Schedule class')}</Button>}
      />
      {message ? <p className="personal-notice" role="status">{message}</p> : null}

      <div className="agenda-layout">
        <AgendaRail
          agenda={workspace.agenda}
          onEdit={appointment => openAppointment(appointment, clients, timeZone)}
          onBook={slot => openAppointment({ ...slot, status: 'scheduled' }, clients, timeZone)}
        />

        <section className="personal-panel" aria-labelledby="upcoming-title">
          <div className="panel-heading"><h2 id="upcoming-title">{t('Next classes by student')}</h2><span>{t('{0} scheduled', upcoming.length)}</span></div>
          {upcoming.length ? (
            <div className="appointment-list">
              {upcoming.map(appointment => (
                <article className="appointment-row" key={appointment.id || `${appointment.clientId}-${appointment.startsAt}`}>
                  <div>
                    <strong>{appointment.clientName}</strong>
                    <span>{fmtDate(dateInTimeZone(appointment.startsAt, timeZone), true)} · {timeOf(appointment.startsAt, timeZone)}–{timeOf(appointment.endsAt, timeZone)}</span>
                  </div>
                  <StatusBadge status={appointment.status}>{t(appointmentStatusLabel(appointment.status))}</StatusBadge>
                  <div className="row-actions">
                    <Button onClick={() => openAppointment(appointment, clients)}>{t('Reschedule')}</Button>
                    {appointment.status !== 'cancelled' ? (
                      <PersonalMutation path="/api/personal/appointment" method="PUT" success="Class cancelled">
                        {({ submit, busy }) => (
                          <Button variant="danger" disabled={busy} onClick={() => confirmSheet({
                            title: t('Cancel class?'),
                            message: t('This frees the time slot and keeps the class in history.'),
                            confirmText: t('Cancel class'),
                            danger: true,
                            onConfirm: () => submit({ ...appointment, status: 'cancelled' }),
                          })}>{t('Cancel')}</Button>
                        )}
                      </PersonalMutation>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <EmptyPersonal icon="calendar" title={t('No next classes')} body={t('Only the next class provided by each student record appears here.')} />}
        </section>

        <section className="personal-panel availability-summary" aria-labelledby="availability-title">
          <div className="panel-heading">
            <h2 id="availability-title">{t('Weekly availability')}</h2>
            <Button onClick={editAvailability}>{t('Edit')}</Button>
          </div>
          <p>{t('{0} service windows configured', workspace.availability?.length || 0)}</p>
          <p className="panel-note">{t('Today shows only slots returned by the API; future availability is not projected here.')}</p>
        </section>
      </div>

      {error ? <p className="form-error" role="alert">{error} <button className="text-action" onClick={() => reloadWorkspace().catch(() => {})}>{t('Try again')}</button></p> : null}
    </main>
  )
}
