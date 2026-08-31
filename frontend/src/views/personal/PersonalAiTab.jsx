import { useEffect, useState } from 'react'

import { MachineEditor } from '../../components/AiPlanExperience.jsx'
import ExerciseCatalogPicker from '../../components/ExerciseCatalogPicker.jsx'
import Icon from '../../components/Icon.jsx'
import { Button, NumberField, TextArea, TextField } from '../../components/ui.jsx'
import { AI_EXPERIENCE, AI_GOALS, AI_TARGET_AREAS, catalogExerciseIds, editableSpecificMachines, withCatalogExerciseIds } from '../../lib/ai-plan.js'
import { providerDisplayName } from '../../lib/ai-product.js'
import { EXDB } from '../../lib/exercises-data.js'
import { DAYN, fmtDate } from '../../lib/format.js'
import { dateLocale, exerciseName, t } from '../../lib/i18n.js'
import { measurementKindLabel } from '../../lib/personal-view.js'
import { PersonalMutation, StatusBadge } from './components.jsx'

const profileDraft = profile => ({
  ageBand: profile?.ageBand || 'adult', heightCm: profile?.heightCm || '', goal: profile?.goal || '',
  experience: profile?.experience || 'intermediario', availableDays: [...(profile?.availableDays || [])],
  minutesPerSession: profile?.minutesPerSession || 60, focusAreas: [...(profile?.focusAreas || [])],
  favoriteExerciseIds: [...(profile?.favoriteExerciseIds || [])], avoidedExerciseIds: [...(profile?.avoidedExerciseIds || [])],
  limitations: profile?.limitations || '', acuteRisk: profile?.acuteRisk === true, medicalRestriction: profile?.medicalRestriction === true,
  consent: profile?.consent === true, guardianConsent: profile?.ageBand === 'adult' ? null : profile?.guardianConsent === true,
})

const cloneDirectorySnapshot = snapshot => snapshot ? {
  ...snapshot,
  openingHours: (Array.isArray(snapshot.openingHours) ? snapshot.openingHours : []).map(entry => ({ ...entry })),
  exerciseIds: [...(Array.isArray(snapshot.exerciseIds) ? snapshot.exerciseIds : [])],
} : null

const gymDraft = gym => {
  const specificMachines = (gym?.specificMachines || []).map(machine => ({ ...machine, exerciseIds: [...(machine.exerciseIds || [])] }))
  const directorySnapshot = cloneDirectorySnapshot(gym?.directorySnapshot)
  const linkedExerciseIds = catalogExerciseIds({ ...gym, specificMachines })
  const availableExerciseIds = linkedExerciseIds.length ? linkedExerciseIds : [...(directorySnapshot?.exerciseIds || [])]
  return {
    name: gym?.name || '', directoryGymId: gym?.directoryGymId || directorySnapshot?.id || '', directorySnapshot,
    availableExerciseIds, genericEquipment: availableExerciseIds.length ? [] : [...(gym?.genericEquipment || [])],
    specificMachines: withCatalogExerciseIds(specificMachines, availableExerciseIds),
  }
}

const GOAL_VALUES = new Set(AI_GOALS.map(([value]) => value))

function ToggleGrid({ label, values, options, onChange, className = '' }) {
  const toggle = value => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value])
  return (
    <fieldset className={`ai-choice-group ${className}`}><legend>{label}</legend><div className="ai-toggle-grid">
      {options.map(([value, optionLabel]) => <button type="button" key={value} aria-pressed={values.includes(value)} onClick={() => toggle(value)}>{t(optionLabel)}</button>)}
    </div></fieldset>
  )
}

function ProfileEditor({ client, profile }) {
  const [draft, setDraft] = useState(() => profileDraft(profile))
  useEffect(() => { setDraft(profileDraft(profile)) }, [profile?.updatedAt])
  const toggleDay = day => setDraft(value => ({ ...value, availableDays: value.availableDays.includes(day) ? value.availableDays.filter(item => item !== day) : [...value.availableDays, day].sort() }))
  return (
    <PersonalMutation path="/api/personal/training-profile" method="PUT" success="Training profile updated">
      {({ submit, busy }) => <form className="personal-form ai-personal-form" aria-label={t('Edit AI training profile')} onSubmit={event => { event.preventDefault(); submit({ clientId: client.id, ...draft }) }}>
        <div className="personal-form-grid">
          <label className="form-field"><span>{t('Age range')}</span><select className="field" name="personal-ai-age-band" autoComplete="off" value={draft.ageBand} onChange={event => setDraft({ ...draft, ageBand: event.target.value, guardianConsent: event.target.value === 'adult' ? null : draft.guardianConsent ?? false })}><option value="under14">{t('Under 14')}</option><option value="14to17">{t('14 to 17')}</option><option value="adult">{t('18 or older')}</option></select></label>
          <label className="form-field"><span>{t('Height (cm)')}</span><NumberField name="personal-ai-height" value={draft.heightCm} decimal={false} onChange={heightCm => setDraft({ ...draft, heightCm })} required /></label>
          <fieldset className="ai-choice-group personal-ai-goal-group">
            <legend>{t('Primary goal')}</legend>
            <div className="ai-toggle-grid">
              {AI_GOALS.map(([value, label]) => <button type="button" key={value} aria-pressed={draft.goal === value} onClick={() => setDraft({ ...draft, goal: value })}>{t(label)}</button>)}
            </div>
            {draft.goal && !GOAL_VALUES.has(draft.goal) ? <p className="muted small">{t('Current goal')}: {t(draft.goal)}</p> : null}
          </fieldset>
          <label className="form-field"><span>{t('Experience')}</span><select className="field" name="personal-ai-experience" autoComplete="off" value={draft.experience} onChange={event => setDraft({ ...draft, experience: event.target.value })}>{AI_EXPERIENCE.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label className="form-field"><span>{t('Minutes per session')}</span><NumberField name="personal-ai-minutes" value={draft.minutesPerSession} decimal={false} onChange={minutesPerSession => setDraft({ ...draft, minutesPerSession })} required /></label>
        </div>
        <fieldset className="ai-choice-group"><legend>{t('Available days')}</legend><div className="ai-days">{[1, 2, 3, 4, 5, 6, 0].map(day => <button type="button" key={day} aria-pressed={draft.availableDays.includes(day)} onClick={() => toggleDay(day)}>{t(DAYN[day])}</button>)}</div></fieldset>
        <ToggleGrid label={t('Training priorities')} values={draft.focusAreas} options={AI_TARGET_AREAS} onChange={focusAreas => setDraft({ ...draft, focusAreas })} />
        <div className="exercise-picker-grid">
          <ExerciseCatalogPicker title={t('Favorite exercises')} searchName="personal-ai-favorite-exercises" selectedIds={draft.favoriteExerciseIds} onChange={favoriteExerciseIds => setDraft(value => ({ ...value, favoriteExerciseIds, avoidedExerciseIds: value.avoidedExerciseIds.filter(id => !favoriteExerciseIds.includes(id)) }))} />
          <ExerciseCatalogPicker title={t('Exercises to avoid')} searchName="personal-ai-avoided-exercises" selectedIds={draft.avoidedExerciseIds} onChange={avoidedExerciseIds => setDraft(value => ({ ...value, avoidedExerciseIds, favoriteExerciseIds: value.favoriteExerciseIds.filter(id => !avoidedExerciseIds.includes(id)) }))} />
        </div>
        <label className="form-field"><span>{t('Limitations')}</span><TextArea name="personal-ai-limitations" autoComplete="off" value={draft.limitations} onChange={event => setDraft({ ...draft, limitations: event.target.value })} /></label>
        <div className="consent-checks">
          <label><input type="checkbox" name="personal-ai-consent" checked={draft.consent} onChange={event => setDraft({ ...draft, consent: event.target.checked })} />{t('Student consent confirmed')}</label>
          {draft.ageBand !== 'adult' ? <label><input type="checkbox" name="personal-ai-guardian-consent" checked={draft.guardianConsent === true} onChange={event => setDraft({ ...draft, guardianConsent: event.target.checked })} />{t('Guardian confirmation')}</label> : null}
          <label><input type="checkbox" name="personal-ai-acute-risk" checked={draft.acuteRisk} onChange={event => setDraft({ ...draft, acuteRisk: event.target.checked })} />{t('Acute risk reported')}</label>
          <label><input type="checkbox" name="personal-ai-medical-restriction" checked={draft.medicalRestriction} onChange={event => setDraft({ ...draft, medicalRestriction: event.target.checked })} />{t('Medical restriction reported')}</label>
        </div>
        <Button variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Save training profile')}</Button>
      </form>}
    </PersonalMutation>
  )
}

function GymEditor({ client, gym }) {
  const [draft, setDraft] = useState(() => gymDraft(gym))
  useEffect(() => { setDraft(gymDraft(gym)) }, [gym?.updatedAt])
  const selectAvailableExercises = availableExerciseIds => setDraft({
    ...draft, availableExerciseIds: [...availableExerciseIds], genericEquipment: [],
    specificMachines: withCatalogExerciseIds(draft.specificMachines, availableExerciseIds),
  })
  const updateSpecificMachines = machines => setDraft({
    ...draft, specificMachines: withCatalogExerciseIds(machines, draft.availableExerciseIds),
  })
  const payload = {
    clientId: client.id, name: draft.name,
    genericEquipment: draft.availableExerciseIds.length ? [] : [...draft.genericEquipment],
    specificMachines: draft.specificMachines,
    ...(draft.directoryGymId ? { directoryGymId: draft.directoryGymId } : {}),
    ...(draft.directorySnapshot ? { directorySnapshot: draft.directorySnapshot } : {}),
  }
  return (
    <PersonalMutation path="/api/personal/gym" method="PUT" success="Gym updated">
      {({ submit, busy }) => <form className="personal-form ai-personal-form" aria-label={t('Edit student gym')} onSubmit={event => { event.preventDefault(); submit(payload) }}>
        <label className="form-field"><span>{t('Gym')}</span><TextField name="personal-ai-gym" autoComplete="off" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label>
        <ExerciseCatalogPicker title={t('Available equipment')} searchName="personal-ai-equipment-search" selectedIds={draft.availableExerciseIds} onChange={selectAvailableExercises} />
        <MachineEditor machines={editableSpecificMachines(draft.specificMachines)} onChange={updateSpecificMachines} />
        <Button variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Save gym')}</Button>
      </form>}
    </PersonalMutation>
  )
}

const scheduleEntries = plan => Array.isArray(plan?.schedule)
  ? plan.schedule
  : Object.entries(plan?.schedule || {}).map(([day, routineId]) => ({ day: Number(day), routineId }))

const exercisePrescription = exercise => exercise.mode === 'time'
  ? `${exercise.sets} × ${exercise.seconds} s`
  : `${exercise.sets} × ${exercise.repMin}${exercise.repMax !== exercise.repMin ? `–${exercise.repMax}` : ''}`

function PlanDetails({ plan }) {
  const routines = Array.isArray(plan.routines) ? plan.routines : []
  const routineById = new Map(routines.map(routine => [routine.id, routine]))
  const schedule = [...scheduleEntries(plan)].sort((a, b) => (a.day || 7) - (b.day || 7))
  if (!routines.length) return null
  return (
    <>
      {schedule.length ? <div className="measurement-used"><span className="personal-eyebrow">{t('Weekly schedule')}</span><div>{schedule.map(entry => <span key={`${entry.day}-${entry.routineId}`}>{t(DAYN[entry.day])} <b>{routineById.get(entry.routineId)?.name || entry.routineId}</b></span>)}</div></div> : null}
      <div className="plan-routine-heading"><h4 className="sec">{t('Routines')}</h4></div>
      {routines.map((routine, routineIndex) => <section key={routine.id || routineIndex} aria-labelledby={`personal-ai-routine-${routineIndex}`}>
        <h4 id={`personal-ai-routine-${routineIndex}`}>{routine.name}</h4>
        <ol className="list">
          {(routine.exercises || []).map((exercise, exerciseIndex) => {
            const catalogueExercise = EXDB.find(item => item.id === exercise.exerciseId) || { id: exercise.exerciseId, n: exercise.exerciseId }
            return <li className="item" key={exercise.id || `${exercise.exerciseId}-${exerciseIndex}`}>
              <span className="lrow-i"><Icon name="barbell" /></span>
              <div className="grow"><div className="tt">{exerciseName(catalogueExercise)}</div><div className="ss">{exercisePrescription(exercise)} · {t('Rest {0} s', exercise.restSeconds)}</div>
                <p className="ss"><strong>{t('Progression')}:</strong> {exercise.progression}</p>
                {exercise.note ? <p className="ss"><strong>{t('Note')}:</strong> {exercise.note}</p> : null}
              </div>
            </li>
          })}
        </ol>
      </section>)}
    </>
  )
}

function PlanSummary({ plan, client }) {
  if (!plan) return <div className="empty personal-empty"><div className="ico"><Icon name="sparkles" /></div><strong>{t('No AI plan applied')}</strong><p>{t('The student has not applied an AI-generated plan yet.')}</p></div>
  const changedAt = [client.trainingProfile?.updatedAt, client.gymProfile?.updatedAt].filter(Boolean).sort().at(-1)
  const stale = changedAt && plan.appliedAt && changedAt > plan.appliedAt
  return (
    <div className="ai-plan-dossier">
      <div className="panel-heading"><div><span className="plan-source-badge source-ai">IA</span><h3>{t('Version {0}', plan.version)}</h3></div><StatusBadge status={stale ? 'attention' : 'confirmed'}>{stale ? t('Update recommended') : t('Current')}</StatusBadge></div>
      <dl className="detail-list">
        <div><dt>{t('Provider')}</dt><dd translate="no">{providerDisplayName(plan.provider)} · {plan.model}</dd></div>
        <div><dt>{t('Applied')}</dt><dd>{plan.appliedAt ? fmtDate(plan.appliedAt.slice(0, 10), true) : '—'}</dd></div>
        <div><dt>{t('Context')}</dt><dd><code translate="no">{String(plan.contextHash || '').slice(0, 16) || '—'}</code></dd></div>
      </dl>
      <p className="plan-rationale"><span>{t('Why this plan')}</span>{plan.justification}</p>
      <PlanDetails plan={plan} />
    </div>
  )
}

export default function PersonalAiTab({ client, measurements, grants }) {
  if (!grants.trainingProfileWrite && !grants.aiPlanRead) return (
    <section className="personal-panel permission-panel"><Icon name="shield" /><div><h2>{t('Permission required')}</h2><p>{t('The student must allow profile editing or AI plan reading. No private AI data is shown without these permissions.')}</p></div></section>
  )
  return (
    <div className="personal-ai-layout">
      <section className="personal-panel ai-permission-summary">
        <div className="panel-heading"><h2>{t('Shared access')}</h2></div>
        <p>{grants.trainingProfileWrite ? t('You can edit the training profile and gym.') : t('Training profile editing is not allowed.')}</p>
        <p>{grants.aiPlanRead ? t('You can read the applied AI plan.') : t('AI plan reading is not allowed.')}</p>
      </section>
      {grants.aiPlanRead ? <section className="personal-panel"><div className="panel-heading"><h2>{t('Applied AI plan')}</h2></div><PlanSummary plan={client.aiPlan} client={client} />
        {measurements.length ? <div className="measurement-used"><span className="personal-eyebrow">{t('Latest measurements available')}</span><div>{measurements.slice(0, 6).map(item => <span key={item.id}>{t(measurementKindLabel(item.kind))} <b>{item.value.toLocaleString(dateLocale())} {item.unit}</b></span>)}</div></div> : null}
      </section> : null}
      {grants.trainingProfileWrite ? <>
        <section className="personal-panel editor-panel"><div className="panel-heading"><h2>{t('Training profile and priorities')}</h2></div><ProfileEditor client={client} profile={client.trainingProfile} /></section>
        <section className="personal-panel editor-panel"><div className="panel-heading"><h2>{t('Gym and equipment')}</h2></div><GymEditor client={client} gym={client.gymProfile} /></section>
      </> : null}
    </div>
  )
}
