import { useEffect, useMemo, useState } from 'react'

import ExerciseCatalogPicker from '../components/ExerciseCatalogPicker.jsx'
import Icon from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { filterGyms, gymCities, gymInitialLocality, gymMonogram, gymStates } from '../lib/gym-directory.js'
import { t } from '../lib/i18n.js'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function openAccount() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent('first:account', { detail: { mode: 'login' } }))
}

function GymStatus({ status }) {
  const key = status === 'partner' ? 'Partner gym' : status === 'verified' ? 'Verified gym' : 'Unverified gym'
  return <span className={`gym-status gym-status-${status || 'unverified'}`}>{t(key)}</span>
}

function OpeningHours({ hours = [], note = '' }) {
  if (!hours.length && !note) return <p className="muted small">{t('Hours not informed')}</p>
  return <>
    {note ? <p className="muted small">{note}</p> : null}
    {hours.length ? <dl className="gym-opening-hours">
    {hours.map((entry, index) => <div key={`${entry.day}-${index}`}>
      <dt>{t(DAY_LABELS[entry.day] || 'Day')}</dt>
      <dd>{entry.closed ? t('Closed') : `${entry.open} \u2013 ${entry.close}`}</dd>
    </div>)}
    </dl> : null}
  </>
}

function openingHoursSummary(gym) {
  if (gym.openingHoursNote) return gym.openingHoursNote
  if (!gym.openingHours?.length) return t('Hours not informed')
  return gym.openingHours.map(entry => {
    const day = t(DAY_LABELS[entry.day] || 'Day')
    return entry.closed ? `${day}: ${t('Closed')}` : `${day}: ${entry.open}–${entry.close}`
  }).join(' · ')
}

function useMunicipalities(uf, gyms) {
  const [municipalities, setMunicipalities] = useState([])
  const [status, setStatus] = useState(uf ? 'loading' : 'idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!uf) {
      setMunicipalities([])
      setStatus('idle')
      setError('')
      return undefined
    }
    let current = true
    setStatus('loading')
    setError('')
    api(`/api/locations/municipalities?uf=${encodeURIComponent(uf)}`).then(result => {
      if (!current) return
      setMunicipalities(Array.isArray(result?.municipalities) ? result.municipalities : [])
      setStatus('ready')
    }).catch(requestError => {
      if (!current) return
      setMunicipalities([])
      setStatus('error')
      setError(requestError?.message || 'Could not load municipalities. Type it manually.')
    })
    return () => { current = false }
  }, [uf])

  return { cities: gymCities(gyms, uf, municipalities), status, error }
}

function MunicipalityField({ name, uf, city, onChange, locality }) {
  const loading = locality.status === 'loading'
  const placeholder = !uf ? 'Select a state first' : loading ? 'Loading municipalities…' : 'Select a municipality'
  return <label><span>{t('Municipality')}</span>
    {locality.status === 'error'
      ? <><input name={name} value={city} onChange={event => onChange(event.target.value)} maxLength={100} placeholder={t('Type the municipality')} required /><span className="muted small" role="alert">{t(locality.error)}</span></>
      : <><select name={name} value={city} onChange={event => onChange(event.target.value)} disabled={!uf || loading} required>
        <option value="">{t(placeholder)}</option>
        {locality.cities.map(value => <option key={value} value={value}>{value}</option>)}
      </select>{loading ? <span className="muted small" role="status">{t('Loading municipalities…')}</span> : null}</>}
  </label>
}

export default function GymDirectory({
  gyms: providedGyms,
  selectedGymId = null,
  onSelect = () => {},
  onRequestEquipment,
  onRequestGym,
  authenticated = true,
}) {
  const initial = gymInitialLocality(providedGyms, selectedGymId)
  const [gyms, setGyms] = useState(() => Array.isArray(providedGyms) ? providedGyms : [])
  const [rev, setRev] = useState(0)
  const [state, setState] = useState(initial.state)
  const [city, setCity] = useState(initial.city)
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState(selectedGymId)
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestIds, setRequestIds] = useState([])
  const [requestName, setRequestName] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [newGymOpen, setNewGymOpen] = useState(false)
  const [newGym, setNewGym] = useState({ name: '', state: initial.state, city: initial.city, address: '', openingHoursNote: '', exerciseIds: [] })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (Array.isArray(providedGyms)) {
      setGyms(providedGyms)
      return undefined
    }
    let current = true
    api('/api/gyms').then(result => {
      if (!current) return
      const nextGyms = Array.isArray(result?.gyms) ? result.gyms : []
      const locality = gymInitialLocality(nextGyms, selectedGymId)
      setGyms(nextGyms)
      setRev(Number(result?.rev) || 0)
      setState(value => value || locality.state)
      setCity(value => value || locality.city)
    }).catch(() => { if (current) setMessage(t('Could not load gyms.')) })
    return () => { current = false }
  }, [providedGyms])

  useEffect(() => { if (selectedGymId) setDetailId(selectedGymId) }, [selectedGymId])

  const locality = useMunicipalities(state, gyms)
  const requestLocality = useMunicipalities(newGymOpen ? newGym.state : '', gyms)
  const states = useMemo(() => gymStates(), [])
  const localityReady = !!state && !!city
  const visibleGyms = useMemo(() => localityReady ? filterGyms(gyms, { state, city, query }) : [], [gyms, state, city, query, localityReady])
  const detail = gyms.find(gym => gym.id === detailId) || null

  const changeState = event => {
    const nextState = event.target.value
    setState(nextState)
    setCity('')
    setDetailId(null)
  }

  const askForEquipment = () => {
    if (!authenticated) {
      openAccount()
      return
    }
    setMessage('')
    setRequestOpen(true)
  }

  const askForGym = () => {
    if (!authenticated) {
      openAccount()
      return
    }
    setMessage('')
    setNewGym(current => ({ ...current, state: state || current.state, city: city || current.city }))
    setNewGymOpen(true)
  }

  const submitRequest = async event => {
    event.preventDefault()
    if (!detail || requestIds.length === 0 || busy) return
    const payload = { name: requestName.trim(), note: requestNote.trim(), exerciseIds: [...requestIds] }
    setBusy(true)
    setMessage('')
    try {
      if (onRequestEquipment) {
        await onRequestEquipment(detail, payload)
      } else {
        const response = await api('/api/gym-requests', {
          method: 'POST',
          body: JSON.stringify({ rev, kind: 'equipment', gymId: detail.id, payload }),
        })
        setRev(Number(response?.rev) || rev)
      }
      setRequestOpen(false)
      setRequestIds([])
      setRequestName('')
      setRequestNote('')
      setMessage(t('Request sent for review.'))
    } catch (error) {
      if (error?.status === 401) openAccount()
      else setMessage(t(error?.message || 'Could not send the request.'))
    } finally {
      setBusy(false)
    }
  }


  const submitGymRequest = async event => {
    event.preventDefault()
    if (busy || !newGym.name.trim() || !newGym.state.trim() || !newGym.city.trim() || !newGym.address.trim()) return
    const payload = {
      name: newGym.name.trim(), state: newGym.state.trim().toLocaleUpperCase('pt-BR'), city: newGym.city.trim(),
      address: newGym.address.trim(), openingHours: [], openingHoursNote: newGym.openingHoursNote.trim(), exerciseIds: [...newGym.exerciseIds],
    }
    setBusy(true)
    setMessage('')
    try {
      if (onRequestGym) await onRequestGym(payload)
      else {
        const response = await api('/api/gym-requests', {
          method: 'POST', body: JSON.stringify({ rev, kind: 'gym', payload }),
        })
        setRev(Number(response?.rev) || rev)
      }
      setNewGymOpen(false)
      setNewGym({ name: '', state, city, address: '', openingHoursNote: '', exerciseIds: [] })
      setMessage(t('Gym request sent for review.'))
    } catch (error) {
      if (error?.status === 401) openAccount()
      else setMessage(t(error?.message || 'Could not send the request.'))
    } finally {
      setBusy(false)
    }
  }

  return <main className="narrow gym-directory">
    <header className="hdr gym-directory-header">
      <div>
        <span className="personal-eyebrow">{t('Gym directory')}</span>
        <h1>{t('Find your gym')}</h1>
      </div>
    </header>

    <section className="card gym-locality-card" aria-label={t('Location')}>
      <div className="section-heading"><div><h2>{t('Where do you train?')}</h2><p>{t('Choose your location to see gyms and available equipment.')}</p></div></div>
      <div className="gym-locality-fields">
        <label><span>{t('State')}</span>
          <select name="gym-state" value={state} onChange={changeState}>
            <option value="">{t('Select a state')}</option>
            {states.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <MunicipalityField name="gym-city" uf={state} city={city} locality={locality} onChange={value => { setCity(value); setDetailId(null) }} />
      </div>
      <label className="gym-directory-search"><span>{t('Search gyms')}</span>
        <span className="search"><Icon name="search" /><input name="gym-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search by name or address')} disabled={!localityReady} /></span>
      </label>
    </section>

    <section className="gym-results" aria-live="polite">
      {visibleGyms.map(gym => <button type="button" className={`card gym-result${gym.id === detailId ? ' is-open' : ''}`} key={gym.id} onClick={() => { setDetailId(gym.id); setRequestOpen(false); setMessage('') }}>
        <span className="gym-monogram" aria-hidden="true">{gymMonogram(gym.name)}</span>
        <span className="gym-result-copy"><strong>{gym.name}</strong><span>{gym.address}</span><span>{gym.city} / {gym.state}</span><span className="gym-result-hours">{openingHoursSummary(gym)}</span></span>
        <GymStatus status={gym.status} />
        <Icon name="chevronRight" />
      </button>)}
      {!localityReady ? <div className="card gym-empty"><Icon name="globe" /><p>{t('Choose a state and municipality to see nearby gyms.')}</p></div> : null}
      {localityReady && !visibleGyms.length ? <div className="card gym-empty"><Icon name="search" /><p>{t('No gyms found in this location.')}</p></div> : null}
    </section>

    <button type="button" className="text-action gym-new-request-action" onClick={askForGym}>{t('Could not find your gym? Request its registration')}</button>
    {newGymOpen ? <form className="card gym-new-request" onSubmit={submitGymRequest}>
      <div className="section-heading"><div><h2>{t('Register a gym')}</h2><p>{t('It will appear publicly only after Dev review.')}</p></div></div>
      <label><span>{t('Gym name')}</span><input name="gym-request-gym-name" value={newGym.name} onChange={event => setNewGym(current => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
      <div className="gym-locality-fields">
        <label><span>{t('State')}</span><select name="gym-request-state" value={newGym.state} onChange={event => setNewGym(current => ({ ...current, state: event.target.value, city: '' }))} required>
          <option value="">{t('Select a state')}</option>
          {states.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <MunicipalityField name="gym-request-city" uf={newGym.state} city={newGym.city} locality={requestLocality} onChange={value => setNewGym(current => ({ ...current, city: value }))} />
      </div>
      <label><span>{t('Address')}</span><input name="gym-request-address" value={newGym.address} onChange={event => setNewGym(current => ({ ...current, address: event.target.value }))} maxLength={180} required /></label>
      <label><span>{t('Opening hours')}</span><textarea name="gym-request-opening-hours" value={newGym.openingHoursNote} onChange={event => setNewGym(current => ({ ...current, openingHoursNote: event.target.value }))} maxLength={300} placeholder={t('Example: Monday to Friday, 6:00 to 22:00')} /></label>
      <div><h3>{t('Known equipment')}</h3><p className="muted small">{t('Choose exercises supported by the equipment at this gym.')}</p></div>
      <ExerciseCatalogPicker selectedIds={newGym.exerciseIds} onChange={exerciseIds => setNewGym(current => ({ ...current, exerciseIds }))} searchName="new-gym-exercise-search" />
      <div className="row gym-request-buttons">
        <button type="button" className="btn" onClick={() => setNewGymOpen(false)}>{t('Cancel')}</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? t('Sending...') : t('Send for review')}</button>
      </div>
    </form> : null}

    {detail ? <section className="card gym-detail" aria-labelledby="gym-detail-title">
      <div className="gym-detail-heading">
        <span className="gym-monogram" aria-hidden="true">{gymMonogram(detail.name)}</span>
        <div><h2 id="gym-detail-title">{detail.name}</h2><p>{detail.address}</p><GymStatus status={detail.status} /></div>
      </div>
      <div className="gym-hours-block"><h3>{t('Opening hours')}</h3><OpeningHours hours={detail.openingHours} note={detail.openingHoursNote} /></div>
      <div className="gym-inventory">
        <h3>{t('Available exercises')}</h3>
        <ExerciseCatalogPicker selectedIds={detail.exerciseIds || []} readOnly searchName="gym-exercise-search" />
      </div>
      <button type="button" className="btn primary gym-select-action" onClick={() => onSelect(detail)}>
        <Icon name="check" />{t('Select this gym')}
      </button>
      <button type="button" className="text-action gym-request-action" onClick={askForEquipment}>{t('Could not find your equipment? Click here to register it')}</button>

      {requestOpen ? <form className="gym-equipment-request" onSubmit={submitRequest}>
        <div className="section-heading"><div><h3>{t('Request equipment')}</h3><p>{t('Choose it from the exercise catalogue. The Dev team reviews it before publishing.')}</p></div></div>
        <label><span>{t('Equipment name')}</span><input name="gym-request-name" value={requestName} onChange={event => setRequestName(event.target.value)} maxLength={100} /></label>
        <ExerciseCatalogPicker selectedIds={requestIds} onChange={setRequestIds} searchName="gym-request-exercise-search" />
        <label><span>{t('Additional information')}</span><textarea name="gym-request-note" value={requestNote} onChange={event => setRequestNote(event.target.value)} maxLength={500} /></label>
        <div className="row gym-request-buttons">
          <button type="button" className="btn" onClick={() => setRequestOpen(false)}>{t('Cancel')}</button>
          <button type="submit" className="btn primary" disabled={busy || requestIds.length === 0}>{busy ? t('Sending...') : t('Send for review')}</button>
        </div>
      </form> : null}
    </section> : null}

    {message ? <p className="gym-directory-message" role="status">{message}</p> : null}
  </main>
}
