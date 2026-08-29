import { useEffect, useState } from 'react'

import { t } from '../../lib/i18n.js'
import { Button, NumberField, TextArea, TextField } from '../ui.jsx'

const draftOf = client => ({
  name: client?.name || '',
  goal: client?.goal || '',
  phone: client?.phone || '',
  notes: client?.notes || '',
  targetSessionsPerWeek: client?.targetSessionsPerWeek || 3,
  inactiveAfterDays: client?.inactiveAfterDays || 7,
})

export default function ClientForm({ client, onSubmit, busy = false }) {
  const [draft, setDraft] = useState(() => draftOf(client))

  useEffect(() => setDraft(draftOf(client)), [client])

  const submit = event => {
    event.preventDefault()
    onSubmit?.({
      ...(client?.id ? { clientId: client.id } : {}),
      name: draft.name.trim().slice(0, 80),
      goal: draft.goal.trim().slice(0, 160),
      phone: draft.phone.trim().slice(0, 40),
      notes: draft.notes.trim().slice(0, 600),
      targetSessionsPerWeek: Math.min(14, Math.max(1, Math.round(Number(draft.targetSessionsPerWeek) || 3))),
      inactiveAfterDays: Math.min(90, Math.max(1, Math.round(Number(draft.inactiveAfterDays) || 7))),
    })
  }

  return (
    <form className="personal-form" onSubmit={submit} aria-label={client ? t('Edit student record') : t('Create managed student')}>
      <div className="personal-form-grid">
        <label className="form-field">
          <span>{t('Full name')}</span>
          <TextField name="clientName" autoComplete="name" required maxLength="80" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
        </label>
        <label className="form-field">
          <span>{t('Goal')}</span>
          <TextField name="clientGoal" autoComplete="off" maxLength="160" value={draft.goal} onChange={event => setDraft(current => ({ ...current, goal: event.target.value }))} />
        </label>
        <label className="form-field">
          <span>{t('Phone')}</span>
          <TextField name="clientPhone" type="tel" inputMode="tel" autoComplete="tel" maxLength="40" value={draft.phone} onChange={event => setDraft(current => ({ ...current, phone: event.target.value }))} />
        </label>
        <label className="form-field">
          <span>{t('Target sessions per week')}</span>
          <NumberField name="targetSessionsPerWeek" decimal={false} min="1" max="14" value={draft.targetSessionsPerWeek} onChange={value => setDraft(current => ({ ...current, targetSessionsPerWeek: value }))} />
        </label>
        <label className="form-field">
          <span>{t('Inactivity alert after days')}</span>
          <NumberField name="inactiveAfterDays" decimal={false} min="1" max="90" value={draft.inactiveAfterDays} onChange={value => setDraft(current => ({ ...current, inactiveAfterDays: value }))} />
        </label>
      </div>
      <label className="form-field">
        <span>{t('Notes')}</span>
        <TextArea name="clientNotes" autoComplete="off" maxLength="600" rows="4" value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} />
      </label>
      <Button type="submit" variant="primary" disabled={busy || !draft.name.trim()}>
        {busy ? t('Saving…') : client ? t('Save student') : t('Create student')}
      </Button>
    </form>
  )
}
