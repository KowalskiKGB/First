import { useEffect, useState } from 'react'

import { BILATERAL_KINDS, MEASUREMENTS, measurementPayload, todayFortaleza } from '../../lib/personal-forms.js'
import { Button, NumberField } from '../ui.jsx'

const TYPES = [
  ['weight', 'Peso'],
  ['waist', 'Cintura'],
  ['chest', 'Peito'],
  ['hip', 'Quadril'],
  ['neck', 'Pescoço'],
  ['arm', 'Braço'],
  ['thigh', 'Coxa'],
  ['calf', 'Panturrilha'],
  ['bodyFat', 'Gordura corporal'],
]

const initialDraft = measurement => ({
  kind: measurement?.kind || 'weight',
  side: measurement?.side || 'left',
  value: measurement?.value ?? '',
  observedAt: measurement?.observedAt || todayFortaleza(),
})

export default function MeasurementForm({ clientId, measurement, onSubmit, busy = false }) {
  const [draft, setDraft] = useState(() => initialDraft(measurement))
  const [error, setError] = useState('')

  useEffect(() => setDraft(initialDraft(measurement)), [measurement])

  const definition = MEASUREMENTS[draft.kind]
  const bilateral = BILATERAL_KINDS.has(draft.kind)
  const submit = event => {
    event.preventDefault()
    try {
      const payload = measurementPayload({ clientId, ...draft })
      setError('')
      onSubmit?.(payload)
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <form className="personal-form" onSubmit={submit} aria-label="Registrar medida do aluno">
      <div className="personal-form-grid">
        <label className="form-field">
          <span>Tipo de medida</span>
          <select className="field" name="measurementKind" autoComplete="off" value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value }))}>
            {TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>

        {bilateral ? (
          <label className="form-field">
            <span>Lado</span>
            <select className="field" name="measurementSide" autoComplete="off" value={draft.side} onChange={event => setDraft(current => ({ ...current, side: event.target.value }))}>
              <option value="left">Esquerdo</option>
              <option value="right">Direito</option>
            </select>
          </label>
        ) : null}

        <label className="form-field">
          <span>Valor ({definition.unit})</span>
          <NumberField
            name="measurementValue"
            required
            autoComplete="off"
            nullable
            value={draft.value}
            onChange={value => setDraft(current => ({ ...current, value }))}
            aria-describedby="measurement-range"
          />
          <small id="measurement-range" className="form-hint">Entre {definition.min} e {definition.max} {definition.unit}</small>
        </label>

        <label className="form-field">
          <span>Data da medida</span>
          <input className="field" type="date" name="observedAt" autoComplete="off" required max={todayFortaleza()} value={draft.observedAt} onChange={event => setDraft(current => ({ ...current, observedAt: event.target.value }))} />
        </label>
      </div>

      {error ? <p className="form-error" role="alert" aria-live="polite">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={busy || !clientId}>
        {busy ? 'Registrando…' : 'Registrar medida'}
      </Button>
    </form>
  )
}
