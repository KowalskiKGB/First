import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ExerciseCatalogPicker from '../components/ExerciseCatalogPicker.jsx'
import GymCard from '../components/gym/GymCard.jsx'
import GymDetail from '../components/gym/GymDetail.jsx'
import Icon from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { createGymRequestGate, filterGyms, gymCities, gymConflictRevision, gymInitialLocality, gymListPath, gymStates, rankGyms } from '../lib/gym-directory.js'
import { t } from '../lib/i18n.js'
import { requestBrowserLocation } from '../lib/mobile.js'

const FILTERS = [['all', 'All gyms'], ['nearby', 'Nearby'], ['favorites', 'Favorites'], ['trending', 'Trending']]
const EMPTY_GYM = Object.freeze({ name: '', state: '', city: '', address: '', openingHoursNote: '', exerciseIds: [] })

function openAccount() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent('first:account', { detail: { mode: 'login' } }))
}

function useMunicipalities(uf, gyms) {
  const [municipalities, setMunicipalities] = useState([])
  const [status, setStatus] = useState(uf ? 'loading' : 'idle')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!uf) { setMunicipalities([]); setStatus('idle'); setError(''); return undefined }
    let current = true
    setStatus('loading'); setError('')
    api(`/api/locations/municipalities?uf=${encodeURIComponent(uf)}`).then(result => {
      if (!current) return
      setMunicipalities(Array.isArray(result?.municipalities) ? result.municipalities : []); setStatus('ready')
    }).catch(requestError => {
      if (!current) return
      setMunicipalities([]); setStatus('error'); setError(requestError?.message || 'Could not load municipalities. Type it manually.')
    })
    return () => { current = false }
  }, [uf])
  return { cities: gymCities(gyms, uf, municipalities), status, error }
}

function MunicipalityField({ name, uf, city, onChange, locality }) {
  const loading = locality.status === 'loading'
  const placeholder = !uf ? 'Select a state first' : loading ? 'Loading municipalities…' : 'Select a municipality'
  return <label><span>{t('Municipality')}</span>{locality.status === 'error'
      ? <><input name={name} value={city} onChange={event => onChange(event.target.value)} maxLength={100} placeholder={`${t('Type the municipality')}…`} autoComplete="off" required /><span className="muted small" role="alert">{t(locality.error)}</span></>
    : <><select name={name} value={city} onChange={event => onChange(event.target.value)} disabled={!uf || loading} required><option value="">{t(placeholder)}</option>{locality.cities.map(value => <option key={value} value={value}>{value}</option>)}</select>{loading ? <span className="muted small" role="status">{t('Loading municipalities…')}</span> : null}</>}</label>
}

function NewGymForm({ value, states, locality, busy, onChange, onCancel, onSubmit }) {
  const change = event => onChange(current => ({ ...current, [event.target.name]: event.target.value }))
  return <form className="card gym-new-request" onSubmit={onSubmit}>
    <header><span className="personal-eyebrow">{t('Community contribution')}</span><h2>{t('Register a gym')}</h2><p>{t('It will appear publicly only after Dev review.')}</p></header>
    <label><span>{t('Gym name')}</span><input name="name" value={value.name} onChange={change} maxLength={120} autoComplete="off" required /></label>
    <div className="gym-locality-fields"><label><span>{t('State')}</span><select name="state" value={value.state} onChange={event => onChange(current => ({ ...current, state: event.target.value, city: '' }))} required><option value="">{t('Select a state')}</option>{states.map(state => <option key={state} value={state}>{state}</option>)}</select></label><MunicipalityField name="gym-request-city" uf={value.state} city={value.city} locality={locality} onChange={city => onChange(current => ({ ...current, city }))} /></div>
    <label><span>{t('Address')}</span><input name="address" value={value.address} onChange={change} maxLength={240} autoComplete="off" required /></label>
    <label><span>{t('Opening hours')}</span><textarea name="openingHoursNote" value={value.openingHoursNote} onChange={change} maxLength={300} autoComplete="off" placeholder={`${t('Example: Monday to Friday, 6:00 to 22:00')}…`} /></label>
    <section><h3>{t('Known equipment')}</h3><p className="muted small">{t('Choose exercises supported by the equipment at this gym.')}</p><ExerciseCatalogPicker selectedIds={value.exerciseIds} onChange={exerciseIds => onChange(current => ({ ...current, exerciseIds }))} searchName="new-gym-exercise-search" /></section>
    <div className="gym-request-buttons"><button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button><button type="submit" className="btn primary" disabled={busy}>{busy ? t('Sending…') : t('Send for review')}</button></div>
  </form>
}

export default function GymDirectory({ gyms: providedGyms, selectedGymId = null, onSelect = () => {}, onRequestEquipment, onRequestGym, authenticated = true }) {
  const initial = gymInitialLocality(providedGyms, selectedGymId)
  const [gyms, setGyms] = useState(() => Array.isArray(providedGyms) ? providedGyms : [])
  const [rev, setRev] = useState(0)
  const [state, setState] = useState(initial.state)
  const [city, setCity] = useState(initial.city)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [location, setLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState('idle')
  const [attribution, setAttribution] = useState('')
  const [detailId, setDetailId] = useState(selectedGymId)
  const [detailGym, setDetailGym] = useState(null)
  const [reviews, setReviews] = useState([])
  const [newGymOpen, setNewGymOpen] = useState(false)
  const [newGym, setNewGym] = useState(() => ({ ...EMPTY_GYM, state: initial.state, city: initial.city }))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const localityTouched = useRef(false)
  const returnFocus = useRef(null)
  const gymRequests = useRef(null)
  if (!gymRequests.current) gymRequests.current = createGymRequestGate()
  const states = useMemo(() => gymStates(), [])

  const loadGyms = useCallback(async () => {
    if (Array.isArray(providedGyms)) return
    const request = gymRequests.current.begin()
    const result = await api(gymListPath(), { signal: request.signal })
    if (!request.isCurrent()) return
    const nextGyms = Array.isArray(result?.gyms) ? result.gyms : []
    const locality = gymInitialLocality(nextGyms, selectedGymId)
    setGyms(nextGyms); setRev(Number(result?.rev) || 0)
    if (!localityTouched.current && locality.state && locality.city) { setState(locality.state); setCity(locality.city) }
  }, [providedGyms, selectedGymId])

  useEffect(() => {
    if (Array.isArray(providedGyms)) { setGyms(providedGyms); return undefined }
    let current = true
    loadGyms().catch(error => { if (current && error?.name !== 'AbortError') setMessage(t('Could not load gyms.')) })
    return () => { current = false; gymRequests.current.abort() }
  }, [loadGyms, providedGyms])

  const loadDetail = useCallback(async id => {
    try {
      const result = await api(`/api/gym?id=${encodeURIComponent(id)}`)
      setRev(Number(result?.rev) || 0)
      if (result?.gym) { setDetailGym(result.gym); setGyms(current => current.map(gym => gym.id === id ? { ...gym, ...result.gym } : gym)) }
      setReviews(Array.isArray(result?.reviews) ? result.reviews : [])
    } catch (error) {
      if (error?.status !== 404) setMessage(t(error?.message || 'Could not load gym details.'))
    }
  }, [])
  useEffect(() => {
    if (!detailId) { setDetailGym(null); setReviews([]); return }
    void loadDetail(detailId)
    requestAnimationFrame(() => document.getElementById('gym-detail-title')?.focus())
  }, [detailId, loadDetail])

  const restoreFocus = useCallback(() => {
    const gymId = returnFocus.current; returnFocus.current = null
    if (gymId) requestAnimationFrame(() => Array.from(document.querySelectorAll('[data-gym-id]')).find(element => element.dataset.gymId === gymId)?.focus())
  }, [])
  const closeDetail = useCallback(() => { setDetailId(null); setDetailGym(null); setReviews([]); setMessage(''); restoreFocus() }, [restoreFocus])
  const backToList = useCallback(() => {
    if (window.history.state?.firstGymDetail) window.history.back()
    else closeDetail()
  }, [closeDetail])
  useEffect(() => {
    const pop = () => { if (detailId) closeDetail() }
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop)
  }, [closeDetail, detailId])
  useEffect(() => {
    const back = event => {
      if (detailId) { event.preventDefault(); backToList(); return }
      if (newGymOpen) { event.preventDefault(); setNewGymOpen(false) }
    }
    window.addEventListener('first:native-back', back); return () => window.removeEventListener('first:native-back', back)
  }, [backToList, detailId, newGymOpen])

  const locality = useMunicipalities(state, gyms)
  const requestLocality = useMunicipalities(newGymOpen ? newGym.state : '', gyms)
  const localityReady = !!state && !!city
  const visibleGyms = useMemo(() => rankGyms(localityReady ? filterGyms(gyms, { state, city, query }) : [], { filter, location }), [city, filter, gyms, localityReady, location, query, state])
  const detail = detailGym || gyms.find(gym => gym.id === detailId) || null

  const openDetail = (gym, event) => {
    returnFocus.current = gym.id
    setDetailId(gym.id); setDetailGym(gym); setReviews([]); setMessage('')
    window.history.pushState({ firstGymDetail: gym.id }, '')
  }
  const changeState = event => { localityTouched.current = true; setState(event.target.value); setCity(''); setQuery(''); setDetailId(null) }
  const useLocation = async () => {
    if (locationStatus === 'loading') return
    setLocationStatus('loading'); setMessage('')
    try {
      const coordinates = await requestBrowserLocation()
      setLocation(coordinates)
      const localityResult = await api(`/api/location/reverse?latitude=${encodeURIComponent(coordinates.latitude)}&longitude=${encodeURIComponent(coordinates.longitude)}`)
      localityTouched.current = true; setState(localityResult.state || ''); setCity(localityResult.city || ''); setAttribution(localityResult.attribution || '')
      setLocationStatus('ready')
    } catch (error) {
      setLocationStatus('error'); setMessage(t(error?.code === 1 ? 'Location permission denied. Select it manually.' : error?.message || 'Could not identify your location. Select it manually.'))
    }
  }
  const requireAccount = action => {
    if (!authenticated) { openAccount(); return false }
    action?.(); return true
  }
  const recoverConflict = async (error, gymId = '') => {
    const conflictRev = gymConflictRevision(error)
    if (conflictRev === null) return false
    setRev(conflictRev)
    await Promise.allSettled([loadGyms(), gymId ? loadDetail(gymId) : Promise.resolve()])
    setMessage(t('Gym data changed. Your entries are still here; review and repeat the action.'))
    return true
  }
  const toggleFavorite = async () => {
    if (!detail || busy) return
    setBusy(true); setMessage('')
    try {
      const result = await api('/api/gym/favorite', { method: 'PUT', body: JSON.stringify({ rev, gymId: detail.id }) })
      const tags = result.favorite ? ['Preferida', ...(detail.tags || []).filter(tag => tag !== 'Preferida')] : (detail.tags || []).filter(tag => tag !== 'Preferida')
      setRev(Number(result.rev) || rev); setDetailGym(current => ({ ...current, tags })); setGyms(current => current.map(gym => gym.id === detail.id ? { ...gym, tags } : gym))
      setMessage(t(result.favorite ? 'Gym added to favorites.' : 'Gym removed from favorites.'))
    } catch (error) { if (error?.status === 401) openAccount(); else if (!await recoverConflict(error, detail.id)) setMessage(t(error?.message || 'Could not update favorite.')) } finally { setBusy(false) }
  }
  const submitReview = async payload => {
    if (!detail || busy || payload.rating < 1) return
    setBusy(true); setMessage('')
    try {
      const result = await api('/api/gym/review', { method: 'PUT', body: JSON.stringify({ rev, gymId: detail.id, ...payload }) })
      setRev(Number(result.rev) || rev); setMessage(t(result.review?.status === 'pending' ? 'Review sent for verification.' : 'Review published.')); await loadDetail(detail.id)
    } catch (error) { if (error?.status === 401) openAccount(); else if (!await recoverConflict(error, detail.id)) setMessage(t(error?.message || 'Could not publish review.')) } finally { setBusy(false) }
  }
  const submitContribution = async (kind, payload) => {
    if (!detail || busy) return
    setBusy(true); setMessage('')
    try {
      if (kind === 'equipment' && onRequestEquipment) await onRequestEquipment(detail, payload)
      else { const result = await api('/api/gym-requests', { method: 'POST', body: JSON.stringify({ rev, kind, gymId: detail.id, payload }) }); setRev(Number(result?.rev) || rev) }
      setMessage(t('Contribution sent. It is now under verification.'))
      return true
    } catch (error) { if (error?.status === 401) openAccount(); else if (!await recoverConflict(error, detail.id)) setMessage(t(error?.message || 'Could not send the request.')); return false } finally { setBusy(false) }
  }
  const openNewGym = () => requireAccount(() => { setMessage(''); setNewGym(current => ({ ...current, state: state || current.state, city: city || current.city })); setNewGymOpen(true) })
  const submitNewGym = async event => {
    event.preventDefault()
    if (busy || !newGym.name.trim() || !newGym.state || !newGym.city.trim() || !newGym.address.trim()) return
    const payload = { ...newGym, name: newGym.name.trim(), state: newGym.state.toUpperCase(), city: newGym.city.trim(), address: newGym.address.trim(), openingHours: [], openingHoursNote: newGym.openingHoursNote.trim(), exerciseIds: [...newGym.exerciseIds] }
    setBusy(true); setMessage('')
    try {
      if (onRequestGym) await onRequestGym(payload)
      else { const result = await api('/api/gym-requests', { method: 'POST', body: JSON.stringify({ rev, kind: 'gym', payload }) }); setRev(Number(result?.rev) || rev) }
      setNewGymOpen(false); setNewGym({ ...EMPTY_GYM, state, city }); setMessage(t('Gym request sent. It is now under verification.'))
    } catch (error) { if (error?.status === 401) openAccount(); else if (!await recoverConflict(error)) setMessage(t(error?.message || 'Could not send the request.')) } finally { setBusy(false) }
  }

  if (detail) return <main className="narrow gym-directory gym-directory-detail-view"><GymDetail gym={detail} reviews={reviews} selected={selectedGymId === detail.id} authenticated={authenticated} busy={busy} onBack={backToList} onSelect={onSelect} onToggleFavorite={toggleFavorite} onSubmitReview={submitReview} onSubmitContribution={submitContribution} onRequireLogin={openAccount} />{message ? <p className="gym-directory-message" role="status">{message}</p> : null}</main>

  return <main className="narrow gym-directory">
    <header className="hdr gym-directory-header"><div><span className="personal-eyebrow">{t('Gym directory')}</span><h1>{t('Find your gym')}</h1><p>{t('Train where the community knows the floor.')}</p></div></header>
    <section className="gym-discovery" aria-label={t('Location')}>
      <button type="button" className="gym-location-button" onClick={useLocation} disabled={locationStatus === 'loading'}><Icon name="target" /><span><strong>{locationStatus === 'loading' ? t('Locating…') : t('Use my location')}</strong><small>{t('Only while you choose. Never saved.')}</small></span></button>
      <div className="gym-locality-fields"><label><span>{t('State')}</span><select name="gym-state" value={state} onChange={changeState}><option value="">{t('Select a state')}</option>{states.map(value => <option key={value} value={value}>{value}</option>)}</select></label><MunicipalityField name="gym-city" uf={state} city={city} locality={locality} onChange={value => { localityTouched.current = true; setCity(value); setQuery('') }} /></div>
      <label className="gym-directory-search"><span className="sr-only">{t('Search gyms')}</span><span className="search"><Icon name="search" /><input name="gym-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`${t('Search name, network, neighborhood or address')}…`} autoComplete="off" disabled={!localityReady} /></span></label>
      {attribution ? <small className="gym-osm-attribution">{attribution}</small> : null}
    </section>
    <div className="gym-filter-chips" aria-label={t('Filter gyms')}>{FILTERS.map(([value, label]) => <button type="button" key={value} className={filter === value ? 'is-active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(label)}</button>)}</div>
    <section className="gym-results" aria-live="polite" aria-label={t('Gym results')}>{visibleGyms.map(gym => <GymCard key={gym.id} gym={gym} onOpen={event => openDetail(gym, event)} />)}{!localityReady ? <div className="card gym-empty"><Icon name="globe" /><p>{t('Choose a state and municipality to see nearby gyms.')}</p></div> : null}{localityReady && !visibleGyms.length ? <div className="card gym-empty"><Icon name="search" /><p>{t(filter === 'favorites' ? 'No favorite gyms here yet.' : filter === 'trending' ? 'No trending gyms here yet.' : filter === 'nearby' && !location ? 'Use your location to sort nearby gyms.' : 'No gyms found in this location.')}</p></div> : null}</section>
    <button type="button" className="gym-new-request-action" onClick={openNewGym}>{t('Could not find the gym? Create it here')}</button>
    {newGymOpen ? <NewGymForm value={newGym} states={states} locality={requestLocality} busy={busy} onChange={setNewGym} onCancel={() => setNewGymOpen(false)} onSubmit={submitNewGym} /> : null}
    {message ? <p className="gym-directory-message" role="status">{message}</p> : null}
  </main>
}
