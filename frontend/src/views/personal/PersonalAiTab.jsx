import { useEffect, useState } from 'react'

import { MachineEditor } from '../../components/AiPlanExperience.jsx'
import Icon from '../../components/Icon.jsx'
import { Button, NumberField, TextArea, TextField } from '../../components/ui.jsx'
import { AI_EQUIPMENT, AI_EXPERIENCE, AI_TARGET_AREAS } from '../../lib/ai-plan.js'
import { providerDisplayName } from '../../lib/ai-product.js'
import { DAYN, fmtDate } from '../../lib/format.js'
import { dateLocale, t } from '../../lib/i18n.js'
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

const gymDraft = gym => ({
  name: gym?.name || '', genericEquipment: [...(gym?.genericEquipment || [])],
  specificMachines: (gym?.specificMachines || []).map(machine => ({ ...machine, exerciseIds: [...(machine.exerciseIds || [])] })),
})

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
          <label className="form-field"><span>{t('Primary goal')}</span><TextField name="personal-ai-goal" autoComplete="off" value={draft.goal} onChange={event => setDraft({ ...draft, goal: event.target.value })} required /></label>
          <label className="form-field"><span>{t('Experience')}</span><select className="field" name="personal-ai-experience" autoComplete="off" value={draft.experience} onChange={event => setDraft({ ...draft, experience: event.target.value })}>{AI_EXPERIENCE.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label className="form-field"><span>{t('Minutes per session')}</span><NumberField name="personal-ai-minutes" value={draft.minutesPerSession} decimal={false} onChange={minutesPerSession => setDraft({ ...draft, minutesPerSession })} required /></label>
        </div>
        <fieldset className="ai-choice-group"><legend>{t('Available days')}</legend><div className="ai-days">{[1, 2, 3, 4, 5, 6, 0].map(day => <button type="button" key={day} aria-pressed={draft.availableDays.includes(day)} onClick={() => toggleDay(day)}>{t(DAYN[day])}</button>)}</div></fieldset>
        <ToggleGrid label={t('Training priorities')} values={draft.focusAreas} options={AI_TARGET_AREAS} onChange={focusAreas => setDraft({ ...draft, focusAreas })} />
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
  return (
    <PersonalMutation path="/api/personal/gym" method="PUT" success="Gym updated">
      {({ submit, busy }) => <form className="personal-form ai-personal-form" aria-label={t('Edit student gym')} onSubmit={event => { event.preventDefault(); submit({ clientId: client.id, ...draft }) }}>
        <label className="form-field"><span>{t('Gym')}</span><TextField name="personal-ai-gym" autoComplete="off" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label>
        <ToggleGrid label={t('Available equipment')} values={draft.genericEquipment} options={AI_EQUIPMENT.map(([value, label]) => [value, label])} onChange={genericEquipment => setDraft({ ...draft, genericEquipment })} className="equipment-compact" />
        <MachineEditor machines={draft.specificMachines} onChange={specificMachines => setDraft({ ...draft, specificMachines })} />
        <Button variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Save gym')}</Button>
      </form>}
    </PersonalMutation>
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
