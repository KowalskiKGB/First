import { useEffect, useState } from 'react'

import { t } from '../../lib/i18n.js'
import { Button } from '../ui.jsx'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const draftOf = availability => DAYS.map((_, weekday) => {
  const entry = (Array.isArray(availability) ? availability : []).find(item => item.weekday === weekday)
  return {
    weekday,
    enabled: Boolean(entry),
    start: entry?.start || (weekday === 6 ? '07:00' : '06:00'),
    end: entry?.end || (weekday === 6 ? '13:00' : '21:00'),
    slotMinutes: entry?.slotMinutes || 60,
  }
})

export default function AvailabilityForm({ availability, onSubmit, busy = false }) {
  const [days, setDays] = useState(() => draftOf(availability))

  useEffect(() => setDays(draftOf(availability)), [availability])

  const patchDay = (weekday, patch) => setDays(current => current.map(day => day.weekday === weekday ? { ...day, ...patch } : day))
  const submit = event => {
    event.preventDefault()
    onSubmit?.({
      availability: days.filter(day => day.enabled).map(({ weekday, start, end, slotMinutes }) => ({
        weekday,
        start,
        end,
        slotMinutes: Number(slotMinutes),
      })),
    })
  }

  return (
    <form className="personal-form" onSubmit={submit} aria-label={t('Edit weekly availability')}>
      <p className="form-hint">{t('Use one service window per day. Existing classes must remain inside it.')}</p>
      <div className="availability-list">
        {days.map(day => (
          <fieldset className="availability-day" key={day.weekday}>
            <legend className="sr-only">{t(DAYS[day.weekday])}</legend>
            <label className="availability-toggle">
              <input name={`availabilityEnabled-${day.weekday}`} autoComplete="off" type="checkbox" checked={day.enabled} onChange={event => patchDay(day.weekday, { enabled: event.target.checked })} />
              <span>{t(DAYS[day.weekday])}</span>
            </label>
            <label className="form-field compact-field">
              <span>{t('Starts')}</span>
              <input className="field" name={`availabilityStart-${day.weekday}`} autoComplete="off" type="time" value={day.start} disabled={!day.enabled} onChange={event => patchDay(day.weekday, { start: event.target.value })} />
            </label>
            <label className="form-field compact-field">
              <span>{t('Ends')}</span>
              <input className="field" name={`availabilityEnd-${day.weekday}`} autoComplete="off" type="time" value={day.end} disabled={!day.enabled} onChange={event => patchDay(day.weekday, { end: event.target.value })} />
            </label>
            <label className="form-field compact-field">
              <span>{t('Slot')}</span>
              <select className="field" name={`availabilitySlot-${day.weekday}`} autoComplete="off" value={day.slotMinutes} disabled={!day.enabled} onChange={event => patchDay(day.weekday, { slotMinutes: Number(event.target.value) })}>
                {[30, 45, 60, 90].map(minutes => <option key={minutes} value={minutes}>{t('{0} min', minutes)}</option>)}
              </select>
            </label>
          </fieldset>
        ))}
      </div>
      <Button type="submit" variant="primary" disabled={busy || !days.some(day => day.enabled)}>
        {busy ? t('Saving…') : t('Save availability')}
      </Button>
    </form>
  )
}
