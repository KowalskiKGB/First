import { useEffect, useMemo, useRef, useState } from 'react'

import { EXDB } from '../lib/exercises-data.js'
import { AI_EQUIPMENT, AI_EXPERIENCE, AI_TARGET_AREAS } from '../lib/ai-plan.js'
import { jobPresentation, providerDisplayName, validateWizardStep } from '../lib/ai-product.js'
import { DAYN } from '../lib/format.js'
import { dateLocale, exerciseName, t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button, NumberField, SearchField, Segmented, TextArea, TextField } from './ui.jsx'

const STEPS = [
  ['Data and measurements', 'Body data used to calibrate the week.'],
  ['Goal and availability', 'Define the training rhythm and priorities.'],
  ['Gym and preferences', 'Only available exercises can enter the plan.'],
  ['Review and consent', 'Confirm the context before generating and applying.'],
]

function FieldError({ errors, name }) {
  return errors[name] ? <span className="field-error" id={`ai-error-${name}`}>{t(errors[name])}</span> : null
}

function ToggleGrid({ legend, values, options, onChange, error }) {
  const toggle = value => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value])
  return (
    <fieldset className="ai-choice-group" aria-describedby={error ? `ai-error-${error.name}` : undefined}>
      <legend>{legend}</legend>
      <div className="ai-toggle-grid">{options.map(([value, label]) => <button type="button" key={value} aria-pressed={values.includes(value)} onClick={() => toggle(value)}>{t(label)}</button>)}</div>
      {error ? <FieldError errors={{ [error.name]: error.message }} name={error.name} /> : null}
    </fieldset>
  )
}

function ExercisePicker({ title, name, selected, onChange, error }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR')
    if (needle.length < 2) return []
    return EXDB.filter(exercise => `${exerciseName(exercise)} ${exercise.n}`.toLocaleLowerCase('pt-BR').includes(needle)).slice(0, 12)
  }, [query])
  const toggle = id => onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id])
  return (
    <div className="exercise-preference-picker">
      <label><span>{title}</span><SearchField name={name} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={t('Clear search')} autoComplete="off" placeholder={t('Search exercise…')} aria-invalid={!!error} aria-describedby={error ? `ai-error-${error.name}` : undefined} />{error ? <FieldError errors={{ [error.name]: error.message }} name={error.name} /> : null}</label>
      {results.length ? <div className="exercise-preference-results">{results.map(exercise => <button type="button" key={exercise.id} aria-pressed={selected.includes(exercise.id)} onClick={() => toggle(exercise.id)}>{exerciseName(exercise)}</button>)}</div> : null}
      {selected.length ? <p>{t('{0} selected', selected.length)}</p> : null}
    </div>
  )
}

export function MachineEditor({ machines, onChange, errors = {} }) {
  const add = () => onChange([...machines, { name: '', category: '', exerciseIds: [] }])
  const patch = (index, value) => onChange(machines.map((machine, current) => current === index ? { ...machine, ...value } : machine))
  return (
    <section className="machine-editor" aria-labelledby="machine-editor-title" aria-describedby={errors.specificMachines ? 'ai-error-specificMachines' : undefined}>
      <div className="row between"><div><span className="personal-eyebrow">{t('Optional')}</span><h3 id="machine-editor-title">{t('Specific machines')}</h3></div><Button type="button" size="sm" icon="plus" onClick={add}>{t('Add machine')}</Button></div>
      <FieldError errors={errors} name="specificMachines" />
      {machines.map((machine, index) => {
        const nameError = errors[`specificMachineName${index}`]
        const categoryError = errors[`specificMachineCategory${index}`]
        const exerciseError = errors[`specificMachineExercises${index}`]
        return (
          <div className="machine-row" key={index}>
            <label><span>{t('Machine name')}</span><TextField name={`specific-machine-name-${index}`} autoComplete="off" value={machine.name} onChange={event => patch(index, { name: event.target.value })} aria-invalid={!!nameError} aria-describedby={nameError ? `ai-error-specificMachineName${index}` : undefined} /><FieldError errors={errors} name={`specificMachineName${index}`} /></label>
            <label><span>{t('Category')}</span><TextField name={`specific-machine-category-${index}`} autoComplete="off" value={machine.category} onChange={event => patch(index, { category: event.target.value })} aria-invalid={!!categoryError} aria-describedby={categoryError ? `ai-error-specificMachineCategory${index}` : undefined} /><FieldError errors={errors} name={`specificMachineCategory${index}`} /></label>
            <ExercisePicker name={`specific-machine-exercises-${index}`} title={t('Supported exercises')} selected={machine.exerciseIds} onChange={exerciseIds => patch(index, { exerciseIds })} error={exerciseError ? { name: `specificMachineExercises${index}`, message: exerciseError } : null} />
            <button type="button" className="text-action" onClick={() => onChange(machines.filter((_, current) => current !== index))}>{t('Remove machine')}</button>
          </div>
        )
      })}
    </section>
  )
}

function StepOne({ draft, onDraft, errors }) {
  const measures = [
    ['waistCm', 'Waist'], ['chestCm', 'Chest'], ['hipCm', 'Hips'], ['armCm', 'Arms'], ['thighCm', 'Thighs'], ['calfCm', 'Calves'],
  ]
  return <div className="ai-wizard-fields">
    <fieldset className="ai-choice-group" aria-describedby={errors.ageBand ? 'ai-error-ageBand' : undefined}><legend>{t('Age range')}</legend><Segmented value={draft.ageBand} onChange={ageBand => onDraft({ ageBand })} options={[{ value: 'under14', label: t('Under 14') }, { value: '14to17', label: t('14 to 17') }, { value: 'adult', label: t('18 or older') }]} /><FieldError errors={errors} name="ageBand" /></fieldset>
    <div className="ai-form-grid">
      <label><span>{t('Height (cm)')}</span><NumberField name="ai-height" autoComplete="off" value={draft.heightCm} decimal={false} onChange={heightCm => onDraft({ heightCm })} aria-invalid={!!errors.heightCm} aria-describedby={errors.heightCm ? 'ai-error-heightCm' : undefined} /><FieldError errors={errors} name="heightCm" /></label>
      <label><span>{t('Current weight')}</span><NumberField name="ai-weight" autoComplete="off" value={draft.weight} onChange={weight => onDraft({ weight })} aria-invalid={!!errors.weight} aria-describedby={errors.weight ? 'ai-error-weight' : undefined} /><FieldError errors={errors} name="weight" /></label>
      {measures.map(([field, label]) => <label key={field}><span>{t(label)} (cm)</span><NumberField name={`ai-${field}`} autoComplete="off" value={draft[field]} nullable onChange={value => onDraft({ [field]: value || '' })} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `ai-error-${field}` : undefined} /><FieldError errors={errors} name={field} /></label>)}
    </div>
  </div>
}

function StepTwo({ draft, onDraft, errors }) {
  const toggleDay = day => onDraft({ availableDays: draft.availableDays.includes(day) ? draft.availableDays.filter(value => value !== day) : [...draft.availableDays, day].sort() })
  return <div className="ai-wizard-fields">
    <label><span>{t('Primary goal')}</span><TextField name="ai-goal" autoComplete="off" value={draft.goal} onChange={event => onDraft({ goal: event.target.value })} aria-invalid={!!errors.goal} aria-describedby={errors.goal ? 'ai-error-goal' : undefined} /><FieldError errors={errors} name="goal" /></label>
    <fieldset className="ai-choice-group" aria-describedby={errors.experience ? 'ai-error-experience' : undefined}><legend>{t('Experience')}</legend><Segmented value={draft.experience} onChange={experience => onDraft({ experience })} options={AI_EXPERIENCE.map(([value, label]) => ({ value, label: t(label) }))} /><FieldError errors={errors} name="experience" /></fieldset>
    <fieldset className="ai-choice-group" aria-describedby={errors.availableDays ? 'ai-error-availableDays' : undefined}><legend>{t('Available days')}</legend><div className="ai-days">{[1, 2, 3, 4, 5, 6, 0].map(day => <button type="button" key={day} aria-pressed={draft.availableDays.includes(day)} onClick={() => toggleDay(day)}>{t(DAYN[day])}</button>)}</div><FieldError errors={errors} name="availableDays" /></fieldset>
    <label><span>{t('Minutes per session')}</span><NumberField name="ai-minutes" autoComplete="off" value={draft.minutesPerSession} decimal={false} onChange={minutesPerSession => onDraft({ minutesPerSession })} aria-invalid={!!errors.minutesPerSession} aria-describedby={errors.minutesPerSession ? 'ai-error-minutesPerSession' : undefined} /><FieldError errors={errors} name="minutesPerSession" /></label>
    <ToggleGrid legend={t('Training priorities')} values={draft.focusAreas} options={AI_TARGET_AREAS} onChange={focusAreas => onDraft({ focusAreas })} error={errors.focusAreas ? { name: 'focusAreas', message: errors.focusAreas } : null} />
  </div>
}

function StepThree({ draft, onDraft, errors }) {
  return <div className="ai-wizard-fields">
    <label><span>{t('Gym')}</span><TextField name="ai-gym-name" autoComplete="off" value={draft.gymName} onChange={event => onDraft({ gymName: event.target.value })} aria-invalid={!!errors.gymName} aria-describedby={errors.gymName ? 'ai-error-gymName' : undefined} /><FieldError errors={errors} name="gymName" /></label>
    <ToggleGrid legend={t('Available equipment')} values={draft.genericEquipment} options={AI_EQUIPMENT.map(([value, label]) => [value, label])} onChange={genericEquipment => onDraft({ genericEquipment })} error={errors.genericEquipment ? { name: 'genericEquipment', message: errors.genericEquipment } : null} />
    <MachineEditor machines={draft.specificMachines} onChange={specificMachines => onDraft({ specificMachines })} errors={errors} />
    <div className="exercise-picker-grid"><ExercisePicker name="ai-favorite-exercises" title={t('Favorite exercises')} selected={draft.favoriteExerciseIds} onChange={favoriteExerciseIds => onDraft({ favoriteExerciseIds })} error={errors.favoriteExerciseIds ? { name: 'favoriteExerciseIds', message: errors.favoriteExerciseIds } : null} /><ExercisePicker name="ai-avoided-exercises" title={t('Exercises to avoid')} selected={draft.avoidedExerciseIds} onChange={avoidedExerciseIds => onDraft({ avoidedExerciseIds })} error={errors.avoidedExerciseIds ? { name: 'avoidedExerciseIds', message: errors.avoidedExerciseIds } : null} /></div>
    <label><span>{t('Limitations and observations')}</span><TextArea name="ai-limitations" autoComplete="off" value={draft.limitations} onChange={event => onDraft({ limitations: event.target.value })} aria-invalid={!!errors.limitations} aria-describedby={errors.limitations ? 'ai-error-limitations' : undefined} /><FieldError errors={errors} name="limitations" /></label>
  </div>
}

function StepFour({ draft, onDraft, errors }) {
  return <div className="ai-wizard-fields">
    <div className="ai-review-grid"><div><span>{t('Goal')}</span><strong>{draft.goal}</strong></div><div><span>{t('Schedule')}</span><strong>{t('{0} days · {1} min', draft.availableDays.length, draft.minutesPerSession)}</strong></div><div><span>{t('Gym')}</span><strong>{draft.gymName}</strong></div><div><span>{t('Equipment')}</span><strong>{t('{0} categories', draft.genericEquipment.length)}</strong></div></div>
    <div className="ai-safety-note"><Icon name="shield" /><p>{draft.ageBand === 'under14' ? t('The plan will prioritize technique, supervision and conservative loads.') : t('The model never defines absolute loads; progression uses your training history.')}</p></div>
    <label className="consent-row"><input type="checkbox" name="ai-consent" checked={draft.consent} onChange={event => onDraft({ consent: event.target.checked })} aria-invalid={!!errors.consent} aria-describedby={errors.consent ? 'ai-error-consent' : undefined} /><span><strong>{t('I authorize these data to be used for this generation.')}</strong><small>{t('Name, contact, finances and private Personal notes are not sent.')}</small></span></label><FieldError errors={errors} name="consent" />
    {draft.ageBand !== 'adult' ? <><label className="consent-row"><input type="checkbox" name="ai-guardian-consent" checked={draft.guardianConsent === true} onChange={event => onDraft({ guardianConsent: event.target.checked })} aria-invalid={!!errors.guardianConsent} aria-describedby={errors.guardianConsent ? 'ai-error-guardianConsent' : undefined} /><span><strong>{t('Guardian confirmation')}</strong><small>{t('A responsible adult confirmed this training request.')}</small></span></label><FieldError errors={errors} name="guardianConsent" /></> : null}
    <div className="health-flags"><label><input type="checkbox" name="ai-acute-risk" checked={draft.acuteRisk} onChange={event => onDraft({ acuteRisk: event.target.checked })} />{t('Acute pain or risk now')}</label><label><input type="checkbox" name="ai-medical-restriction" checked={draft.medicalRestriction} onChange={event => onDraft({ medicalRestriction: event.target.checked })} />{t('Medical restriction awaiting clearance')}</label></div>
    {draft.acuteRisk || draft.medicalRestriction ? <p className="form-error" role="alert">{t('Generation is blocked while an acute risk or medical restriction is active.')}</p> : null}
  </div>
}

export function AiWizard({ draft, onDraft, onClose, onSubmit, busy, unit = 'kg' }) {
  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState({})
  const heading = useRef(null)
  const form = useRef(null)
  useEffect(() => { heading.current?.focus() }, [step])
  const patch = value => onDraft({ ...draft, ...value })
  const focusFirstInvalid = () => requestAnimationFrame(() => {
    const invalid = form.current?.querySelector('[aria-invalid="true"], fieldset[aria-describedby^="ai-error-"] button, fieldset[aria-describedby^="ai-error-"] input, input:invalid')
    if (invalid) invalid.focus()
    else heading.current?.focus()
  })
  const validate = target => {
    const next = validateWizardStep(draft, target, unit); setErrors(next)
    if (Object.keys(next).length) focusFirstInvalid()
    return Object.keys(next).length === 0
  }
  const next = event => { event.preventDefault(); if (validate(step)) setStep(value => Math.min(4, value + 1)) }
  const submit = event => {
    event.preventDefault()
    for (let target = 1; target <= 4; target += 1) {
      const nextErrors = validateWizardStep(draft, target, unit)
      if (Object.keys(nextErrors).length) { setStep(target); setErrors(nextErrors); focusFirstInvalid(); return }
    }
    if (!draft.acuteRisk && !draft.medicalRestriction) onSubmit(draft)
  }
  const Step = [null, StepOne, StepTwo, StepThree, StepFour][step]
  return (
    <section className="ai-wizard" aria-labelledby="ai-wizard-title">
      <div className="ai-wizard-top"><div><span className="personal-eyebrow">{t('Step {0} of 4', step)}</span><h2 id="ai-wizard-title" tabIndex="-1" ref={heading}>{t(STEPS[step - 1][0])}</h2><p>{t(STEPS[step - 1][1])}</p></div><button type="button" className="iconbtn" onClick={onClose} aria-label={t('Close wizard')}><Icon name="xmark" /></button></div>
      <ol className="ai-step-rail" aria-label={t('Generation steps')}>{STEPS.map(([label], index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}><span>{index + 1}</span><small>{t(label)}</small></li>)}</ol>
      {Object.keys(errors).length ? <div className="form-error-summary" role="alert" aria-live="assertive"><strong>{t('Review the highlighted fields.')}</strong><span>{Object.values(errors).map(t).join(' ')}</span></div> : null}
      <form ref={form} onSubmit={submit} noValidate><Step draft={draft} onDraft={patch} errors={errors} />
        <div className="ai-wizard-actions">{step > 1 ? <Button type="button" onClick={() => { setErrors({}); setStep(value => value - 1) }}>{t('Back')}</Button> : <span />}{step < 4 ? <Button type="button" variant="primary" onClick={next}>{t('Continue')}</Button> : <Button variant="primary" icon="sparkles" disabled={busy || draft.acuteRisk || draft.medicalRestriction}>{busy ? t('Generating…') : t('Generate and apply')}</Button>}</div>
      </form>
    </section>
  )
}

export function AiPlanOverview({ plan, status, job, stale, error, onRetry, onOpen, onRollback, onCopy, canRollback }) {
  const jobState = job ? jobPresentation(job) : null
  const configured = status?.configured === true
  return (
    <section className="ai-plan-overview" aria-labelledby="ai-overview-title">
      <div className="ai-card-head"><span className="ai-icon"><Icon name="sparkles" /></span><div className="grow"><span className="personal-eyebrow">{t('Adaptive weekly plan')}</span><h2 id="ai-overview-title">{t('Weekly workout with AI')}</h2><p>{t('Your goals, measurements and available equipment define the week.')}</p></div><span className={`plan-source-badge source-ai`}>IA</span></div>
      {error ? <div className="form-error-summary" role="alert"><strong>{t(error)}</strong><Button type="button" onClick={onRetry}>{t('Try again')}</Button></div> : null}
      {jobState?.active ? <div className="ai-job-state" role="status" aria-live="polite"><span className="ai-job-pulse" aria-hidden="true" /><div><strong>{t(jobState.labelKey)}</strong><span>{t('You can leave this screen; generation continues on the server.')}</span></div></div> : null}
      {job?.status === 'failed' ? <p className="form-error" role="alert">{job.publicError || t('Generation failed. Your previous plan is still active.')}</p> : null}
      {stale ? <div className="ai-stale-notice"><Icon name="info" /><div><strong>{t('Your workout can be updated')}</strong><span>{t('Your measurements, gym or preferences changed. Generate only when you choose.')}</span></div></div> : null}
      {plan ? <div className="ai-plan-result">
        <div className="ai-plan-result-head"><div><span>{t('Version {0}', plan.version)}</span><strong translate="no">{providerDisplayName(plan.provider)} · {plan.model}</strong></div><time dateTime={plan.appliedAt}>{plan.appliedAt ? new Date(plan.appliedAt).toLocaleDateString(dateLocale()) : ''}</time></div>
        <p><span>{t('Why this plan')}</span>{plan.justification}</p>
        <div className="ai-managed-actions"><Button onClick={onCopy} icon="clipboard">{t('Copy and customize')}</Button>{canRollback ? <Button onClick={onRollback} icon="reset">{t('Undo generation')}</Button> : null}</div>
      </div> : !error && status != null ? <p className="ai-empty-copy">{configured ? t('Complete four short steps to generate and apply your first AI week.') : t('AI generation will be available after a provider is configured by the administrator.')}</p> : null}
      {!error && status != null ? <Button variant="primary" icon="sparkles" onClick={onOpen} disabled={!configured || jobState?.active}>{plan ? t('Review data and generate again') : t('Set up my AI workout')}</Button> : null}
    </section>
  )
}
