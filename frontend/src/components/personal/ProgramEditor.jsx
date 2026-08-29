import { useEffect, useMemo, useState } from 'react'

import { EXDB, EXIDX } from '../../lib/exercises.js'
import { exerciseName, ptExerciseName, t } from '../../lib/i18n.js'
import { normalizeProgram, PROGRAM_LIMITS, reorderItem, searchExerciseCatalog } from '../../lib/personal-forms.js'
import { Button, NumberField, TextArea, TextField } from '../ui.jsx'

const DAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
const localId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

export default function ProgramEditor({ program, clientId, onPublish, busy = false }) {
  const [draft, setDraft] = useState(() => normalizeProgram(program))
  const [activeRoutineId, setActiveRoutineId] = useState(() => draft.routines[0]?.id || '')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const next = normalizeProgram(program)
    setDraft(next)
    setActiveRoutineId(current => next.routines.some(routine => routine.id === current) ? current : next.routines[0]?.id || '')
  }, [program])

  const selectedRoutineId = draft.routines.some(routine => routine.id === activeRoutineId)
    ? activeRoutineId
    : draft.routines[0]?.id || ''
  const results = useMemo(() => query.trim()
    ? searchExerciseCatalog(EXDB, query, ptExerciseName).slice(0, 20)
    : [], [query])

  const updateRoutine = (routineId, update) => setDraft(current => ({
    ...current,
    routines: current.routines.map(routine => routine.id === routineId ? update(routine) : routine),
  }))

  const createRoutine = () => {
    if (draft.routines.length >= PROGRAM_LIMITS.routines) return
    const routine = { id: localId('routine'), name: `Rotina ${draft.routines.length + 1}`, ex: [] }
    setDraft(current => ({ ...current, routines: [...current.routines, routine] }))
    setActiveRoutineId(routine.id)
  }

  const removeRoutine = routineId => setDraft(current => ({
    ...current,
    routines: current.routines.filter(routine => routine.id !== routineId),
    week: Object.fromEntries(Object.entries(current.week).filter(([, id]) => id !== routineId)),
  }))

  const addExercise = exerciseId => {
    if (!selectedRoutineId) return
    updateRoutine(selectedRoutineId, routine => routine.ex.length >= PROGRAM_LIMITS.exercises ? routine : ({
      ...routine,
      ex: [...routine.ex, { id: exerciseId, sets: 3, reps: 10, rest: 60, note: '' }],
    }))
  }

  const updateExercise = (routineId, index, patch) => updateRoutine(routineId, routine => ({
    ...routine,
    ex: routine.ex.map((exercise, exerciseIndex) => exerciseIndex === index ? { ...exercise, ...patch } : exercise),
  }))

  const removeExercise = (routineId, index) => updateRoutine(routineId, routine => ({
    ...routine,
    ex: routine.ex.filter((_, exerciseIndex) => exerciseIndex !== index),
  }))

  const moveExercise = (routineId, from, to) => updateRoutine(routineId, routine => ({
    ...routine,
    ex: reorderItem(routine.ex, from, to),
  }))

  const setWeekday = (day, routineId) => setDraft(current => {
    const week = { ...current.week }
    if (routineId) week[day] = routineId
    else delete week[day]
    return { ...current, week }
  })

  const publish = event => {
    event.preventDefault()
    onPublish?.({ clientId, ...normalizeProgram(draft) })
  }

  return (
    <form className="personal-form program-editor" onSubmit={publish} aria-label="Editor do programa de treino">
      <label className="form-field">
        <span>Nome do programa</span>
        <TextField
          name="programName"
          required
          autoComplete="off"
          maxLength={PROGRAM_LIMITS.name}
          value={draft.name}
          onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
        />
      </label>

      <fieldset className="personal-fieldset">
        <legend>Rotinas</legend>
        <div className="form-actions">
          <Button type="button" variant="soft" onClick={createRoutine} disabled={draft.routines.length >= PROGRAM_LIMITS.routines}>
            Criar rotina
          </Button>
          <span className="form-hint">{draft.routines.length} de {PROGRAM_LIMITS.routines}</span>
        </div>

        {draft.routines.length === 0 ? (
          <p className="empty small">Crie uma rotina para adicionar exercícios.</p>
        ) : draft.routines.map((routine, routineIndex) => (
          <section className="program-routine" key={routine.id} aria-labelledby={`routine-${routine.id}`}>
            <div className="program-routine-head">
              <label className="form-field" id={`routine-${routine.id}`}>
                <span>Nome da rotina {routineIndex + 1}</span>
                <TextField
                  name={`routineName-${routine.id}`}
                  required
                  autoComplete="off"
                  maxLength={PROGRAM_LIMITS.routineName}
                  value={routine.name}
                  onChange={event => updateRoutine(routine.id, current => ({ ...current, name: event.target.value }))}
                />
              </label>
              <Button type="button" variant="danger" onClick={() => removeRoutine(routine.id)} aria-label={`Remover rotina ${routine.name}`}>
                Remover
              </Button>
            </div>

            <ol className="program-exercises">
              {routine.ex.map((exercise, exerciseIndex) => {
                const catalogueExercise = EXIDX[exercise.id]
                const name = catalogueExercise ? exerciseName(catalogueExercise) : t('Unknown exercise')
                return (
                  <li className="program-exercise" key={`${exercise.id}-${exerciseIndex}`}>
                    <div className="program-exercise-head">
                      <strong>{name || exercise.id}</strong>
                      <div className="form-actions">
                        <Button type="button" onClick={() => moveExercise(routine.id, exerciseIndex, exerciseIndex - 1)} disabled={exerciseIndex === 0} aria-label={`Mover ${name} para cima`}>Subir</Button>
                        <Button type="button" onClick={() => moveExercise(routine.id, exerciseIndex, exerciseIndex + 1)} disabled={exerciseIndex === routine.ex.length - 1} aria-label={`Mover ${name} para baixo`}>Descer</Button>
                        <Button type="button" variant="danger" onClick={() => removeExercise(routine.id, exerciseIndex)} aria-label={`Remover ${name}`}>Remover</Button>
                      </div>
                    </div>
                    <div className="personal-form-grid compact">
                      <label className="form-field">
                        <span>Séries</span>
                        <NumberField name={`sets-${routine.id}-${exerciseIndex}`} autoComplete="off" decimal={false} min="1" max="20" value={exercise.sets} onChange={sets => updateExercise(routine.id, exerciseIndex, { sets })} />
                      </label>
                      <label className="form-field">
                        <span>Repetições</span>
                        <TextField
                          name={`reps-${routine.id}-${exerciseIndex}`}
                          autoComplete="off"
                          inputMode="text"
                          required
                          maxLength="7"
                          pattern="[0-9]{1,3}(-[0-9]{1,3})?"
                          title="Use um inteiro ou intervalo, como 8-12"
                          value={exercise.reps}
                          onChange={event => updateExercise(routine.id, exerciseIndex, { reps: event.target.value })}
                        />
                      </label>
                      <label className="form-field">
                        <span>Descanso (segundos)</span>
                        <NumberField name={`rest-${routine.id}-${exerciseIndex}`} autoComplete="off" decimal={false} min="0" max="1800" value={exercise.rest} onChange={rest => updateExercise(routine.id, exerciseIndex, { rest })} />
                      </label>
                    </div>
                    <label className="form-field">
                      <span>Nota do exercício</span>
                      <TextArea name={`note-${routine.id}-${exerciseIndex}`} autoComplete="off" maxLength={PROGRAM_LIMITS.note} rows="2" value={exercise.note} onChange={event => updateExercise(routine.id, exerciseIndex, { note: event.target.value })} />
                    </label>
                  </li>
                )
              })}
            </ol>
            {routine.ex.length === 0 ? <p className="form-hint">Nenhum exercício nesta rotina.</p> : null}
          </section>
        ))}
      </fieldset>

      <fieldset className="personal-fieldset" disabled={!selectedRoutineId}>
        <legend>Adicionar exercício</legend>
        <label className="form-field">
          <span>Rotina de destino</span>
          <select className="field" name="targetRoutine" autoComplete="off" value={selectedRoutineId} onChange={event => setActiveRoutineId(event.target.value)}>
            {draft.routines.map(routine => <option value={routine.id} key={routine.id}>{routine.name}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Buscar no catálogo</span>
          <input className="field" type="search" name="exerciseSearch" value={query} onChange={event => setQuery(event.target.value)} placeholder="Ex.: elevação lateral…" autoComplete="off" />
        </label>
        {query.trim() && results.length === 0 ? <p className="form-hint">Nenhum exercício encontrado.</p> : null}
        {results.length > 0 ? (
          <ul className="exercise-search-results" aria-label="Resultados da busca">
            {results.map(exercise => (
              <li key={exercise.id}>
                <button type="button" className="lrow tap" onClick={() => addExercise(exercise.id)}>
                  <span className="lrow-m"><span className="lrow-t">{exerciseName(exercise)}</span><span className="lrow-s">{exercise.n}</span></span>
                  <span aria-hidden="true">Adicionar</span>
                  <span className="sr-only">Adicionar {exerciseName(exercise)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      <fieldset className="personal-fieldset">
        <legend>Semana (opcional)</legend>
        <div className="personal-form-grid">
          {DAYS.map((day, weekday) => (
            <label className="form-field" key={day}>
              <span>{day}</span>
              <select className="field" name={`weekday-${weekday}`} autoComplete="off" value={draft.week[weekday] || ''} onChange={event => setWeekday(weekday, event.target.value)}>
                <option value="">Sem rotina</option>
                {draft.routines.map(routine => <option value={routine.id} key={routine.id}>{routine.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" variant="primary" disabled={busy || !clientId || draft.routines.length === 0}>
        {busy ? 'Publicando…' : 'Publicar programa'}
      </Button>
    </form>
  )
}
