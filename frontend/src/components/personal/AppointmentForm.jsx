import { useEffect, useState } from 'react'

import { timeZoneFields, timeZoneInterval, todayInTimeZone } from '../../lib/personal-forms.js'
import { Button, TextArea } from '../ui.jsx'

const DURATIONS = [30, 45, 60, 90]
const STATUSES = [
  ['scheduled', 'Agendada'],
  ['confirmed', 'Confirmada'],
  ['completed', 'Concluída'],
  ['cancelled', 'Cancelada'],
  ['no_show', 'Aluno não compareceu'],
]

function initialDraft(appointment, clientId, fallbackClientId, timeZone) {
  const fields = timeZoneFields(appointment?.startsAt, timeZone)
  const duration = appointment?.startsAt && appointment?.endsAt
    ? Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60000)
    : 60
  return {
    clientId: appointment?.clientId || clientId || fallbackClientId,
    date: fields.date || todayInTimeZone(new Date(), timeZone),
    time: fields.time || '08:00',
    duration: DURATIONS.includes(duration) ? duration : 60,
    status: appointment?.status || 'scheduled',
    note: appointment?.note || '',
  }
}

export default function AppointmentForm({ appointment, clients = [], clientId = '', timeZone = 'UTC', onSubmit, busy = false }) {
  const fallbackClientId = clients[0]?.id || ''
  const [draft, setDraft] = useState(() => initialDraft(appointment, clientId, fallbackClientId, timeZone))
  const [error, setError] = useState('')

  useEffect(() => setDraft(initialDraft(appointment, clientId, fallbackClientId, timeZone)), [appointment, clientId, fallbackClientId, timeZone])

  const submit = event => {
    event.preventDefault()
    try {
      const interval = timeZoneInterval(draft.date, draft.time, draft.duration, timeZone)
      setError('')
      onSubmit?.({
        clientId: draft.clientId,
        ...(appointment?.id ? { id: appointment.id } : {}),
        ...interval,
        status: draft.status,
        note: draft.note.trim().slice(0, 240),
      })
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <form className="personal-form" onSubmit={submit} aria-label={appointment?.id ? 'Editar aula' : 'Agendar aula'}>
      <div className="personal-form-grid">
        <label className="form-field">
          <span>Aluno</span>
          <select className="field" name="appointmentClient" autoComplete="off" required value={draft.clientId} onChange={event => setDraft(current => ({ ...current, clientId: event.target.value }))} disabled={Boolean(clientId) && clients.length <= 1}>
            {!draft.clientId ? <option value="">Selecione um aluno</option> : null}
            {clients.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}
            {clientId && !clients.some(client => client.id === clientId) ? <option value={clientId}>Aluno selecionado</option> : null}
          </select>
        </label>

        <label className="form-field">
          <span>Data</span>
          <input className="field" type="date" name="appointmentDate" autoComplete="off" required value={draft.date} onChange={event => setDraft(current => ({ ...current, date: event.target.value }))} />
        </label>

        <label className="form-field">
          <span>Hora de início</span>
          <input className="field" type="time" name="appointmentTime" autoComplete="off" required step="900" value={draft.time} onChange={event => setDraft(current => ({ ...current, time: event.target.value }))} />
        </label>

        <label className="form-field">
          <span>Duração</span>
          <select className="field" name="appointmentDuration" autoComplete="off" value={draft.duration} onChange={event => setDraft(current => ({ ...current, duration: Number(event.target.value) }))}>
            {DURATIONS.map(duration => <option value={duration} key={duration}>{duration} minutos</option>)}
          </select>
        </label>

        <label className="form-field">
          <span>Status</span>
          <select className="field" name="appointmentStatus" autoComplete="off" value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}>
            {STATUSES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <label className="form-field">
        <span>Nota</span>
        <TextArea name="appointmentNote" autoComplete="off" maxLength="240" rows="3" value={draft.note} onChange={event => setDraft(current => ({ ...current, note: event.target.value }))} />
      </label>

      <p className="form-hint">Fuso horário: {timeZone}. Conflitos são confirmados ao salvar.</p>
      {error ? <p className="form-error" role="alert" aria-live="polite">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={busy || !draft.clientId}>
        {busy ? 'Salvando…' : 'Salvar aula'}
      </Button>
    </form>
  )
}
