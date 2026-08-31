import { useState } from 'react'

import ExerciseCatalogPicker from '../ExerciseCatalogPicker.jsx'
import { t } from '../../lib/i18n.js'

const EMPTY = Object.freeze({ note: '', name: '', networkName: '', address: '', neighborhood: '', exerciseIds: [] })

export default function GymContributionForm({ kind, gym, busy = false, onCancel, onSubmit }) {
  const [values, setValues] = useState(() => ({ ...EMPTY, name: gym.name || '', networkName: gym.networkName || '', address: gym.address || '', neighborhood: gym.neighborhood || '' }))
  const change = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }))
  const submit = event => {
    event.preventDefault()
    if (kind === 'equipment') {
      onSubmit({ name: values.name.trim(), note: values.note.trim(), exerciseIds: [...values.exerciseIds] })
      return
    }
    if (kind === 'closure') {
      onSubmit({ note: values.note.trim() })
      return
    }
    onSubmit(Object.fromEntries(Object.entries({
      name: values.name.trim(), networkName: values.networkName.trim(), address: values.address.trim(),
      neighborhood: values.neighborhood.trim(), note: values.note.trim(),
    }).filter(([, value]) => value)))
  }

  return <form className="gym-contribution" onSubmit={submit}>
    <header><span>{t('Community contribution')}</span><h3>{t(kind === 'equipment' ? 'Add equipment' : kind === 'closure' ? 'Report closure' : 'Suggest a correction')}</h3><p>{t('The public record changes only after Dev review.')}</p></header>
    {kind === 'correction' ? <>
      <label><span>{t('Gym name')}</span><input name="name" value={values.name} onChange={change} maxLength={120} autoComplete="off" /></label>
      <label><span>{t('Network')}</span><input name="networkName" value={values.networkName} onChange={change} maxLength={120} autoComplete="off" /></label>
      <label><span>{t('Address')}</span><input name="address" value={values.address} onChange={change} maxLength={240} autoComplete="off" /></label>
      <label><span>{t('Neighborhood')}</span><input name="neighborhood" value={values.neighborhood} onChange={change} maxLength={120} autoComplete="off" /></label>
    </> : null}
    {kind === 'equipment' ? <>
      <label><span>{t('Equipment name')}</span><input name="name" value={values.name} onChange={change} maxLength={100} autoComplete="off" /></label>
      <ExerciseCatalogPicker selectedIds={values.exerciseIds} onChange={exerciseIds => setValues(current => ({ ...current, exerciseIds }))} searchName="gym-contribution-exercise-search" />
    </> : null}
    <label><span>{t(kind === 'closure' ? 'Why do you believe it closed?' : 'Additional information')}</span><textarea name="note" value={values.note} onChange={change} maxLength={500} required={kind === 'closure'} autoComplete="off" /></label>
    <div className="gym-request-buttons">
      <button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button>
      <button type="submit" className="btn primary" disabled={busy || (kind === 'equipment' && !values.exerciseIds.length) || (kind === 'closure' && !values.note.trim())}>{busy ? t('Sending…') : t('Send for review')}</button>
    </div>
  </form>
}
