import { useState } from 'react'

import { BODYPARTS, EXDB, equipmentOf, exerciseMatchesQuery, searchKey } from '../lib/exercises.js'
import { exerciseName, t } from '../lib/i18n.js'
import { Thumb } from './Media.jsx'

const PAGE_SIZE = 40

export function ExerciseCatalogPicker({
  exercises = EXDB,
  selectedIds = [],
  onChange = () => {},
  readOnly = false,
  searchName,
  name,
  title,
  legend,
  error,
}) {
  const [query, setQuery] = useState('')
  const [bodyPart, setBodyPart] = useState('')
  const [equipment, setEquipment] = useState('')
  const [shown, setShown] = useState(PAGE_SIZE)
  const selected = new Set(selectedIds)
  const bodyParts = exercises === EXDB
    ? BODYPARTS
    : [...new Set(exercises.map(exercise => exercise.bp).filter(Boolean))].sort()
  const queryKey = searchKey(query).trim()
  const base = exercises.filter(exercise => (
    (!readOnly || selected.has(exercise.id))
    && (!bodyPart || exercise.bp === bodyPart)
    && exerciseMatchesQuery(exercise, queryKey)
  ))
  const equipmentOptions = equipmentOf(base)
  const activeEquipment = equipmentOptions.includes(equipment) ? equipment : ''
  const filtered = activeEquipment ? base.filter(exercise => exercise.eq === activeEquipment) : base
  const errorName = typeof error === 'object' ? error?.name : null
  const errorMessage = typeof error === 'object' ? error?.message : error
  const errorId = errorName ? `ai-error-${errorName}` : undefined
  const pickerTitle = title || legend
  const inputName = searchName || name || 'exercise-catalog-search'

  const resetResults = () => setShown(PAGE_SIZE)
  const toggle = id => {
    if (readOnly) return
    onChange(selected.has(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
  }

  return (
    <section className={`exercise-catalog-picker${readOnly ? ' read-only' : ''}`} aria-label={pickerTitle} aria-describedby={errorId}>
      {pickerTitle ? <h3 className="sec">{pickerTitle}</h3> : null}
      <div className="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          className="input"
          type="search"
          name={inputName}
          aria-label={t('Search exercises…')}
          autoComplete="off"
          placeholder={t('Search exercises…')}
          value={query}
          onChange={event => { setQuery(event.target.value); resetResults() }}
          aria-invalid={!!errorMessage}
          aria-describedby={errorId}
        />
      </div>
      <div className="chips">
        <button type="button" className={`chip nocap${bodyPart ? '' : ' on'}`} aria-pressed={!bodyPart} onClick={() => { setBodyPart(''); setEquipment(''); resetResults() }}>{t('All')}</button>
        {bodyParts.map(value => <button type="button" key={value} className={`chip${bodyPart === value ? ' on' : ''}`} aria-pressed={bodyPart === value} onClick={() => { setBodyPart(value); setEquipment(''); resetResults() }}>{t(value)}</button>)}
      </div>
      {equipmentOptions.length > 1 ? <div className="chips">
        <button type="button" className={`chip nocap${activeEquipment ? '' : ' on'}`} aria-pressed={!activeEquipment} onClick={() => { setEquipment(''); resetResults() }}>{t('Any equipment')}</button>
        {equipmentOptions.map(value => <button type="button" key={value} className={`chip${activeEquipment === value ? ' on' : ''}`} aria-pressed={activeEquipment === value} onClick={() => { setEquipment(value); resetResults() }}>{t(value)}</button>)}
      </div> : null}
      {errorMessage ? <span className="field-error" id={errorId}>{t(errorMessage)}</span> : null}
      <div className="list">
        {filtered.slice(0, shown).map(exercise => {
          const isSelected = selected.has(exercise.id)
          return <button type="button" key={exercise.id} className={`item${isSelected ? ' in-ss' : ''}`} data-exercise-id={exercise.id} aria-pressed={isSelected} disabled={readOnly} onClick={() => toggle(exercise.id)}>
            <Thumb ex={exercise} />
            <span className="grow"><span className="tt capitalize exercise-name">{exerciseName(exercise)}</span><span className="ss capitalize">{t(exercise.tg || exercise.bp)} · {t(exercise.eq)}</span></span>
            {isSelected ? <span className="tag acc" aria-hidden="true">✓</span> : null}
          </button>
        })}
        {!filtered.length ? <div className="empty">{t('No match')}</div> : null}
      </div>
      {filtered.length > shown ? <button type="button" className="btn" onClick={() => setShown(value => value + PAGE_SIZE)}>{t('Show more')}</button> : null}
    </section>
  )
}

export default ExerciseCatalogPicker
