import { useEffect, useMemo, useRef, useState } from 'react'

import { AiPlanOverview, AiWizard } from '../components/AiPlanExperience.jsx'
import { api } from '../lib/api.js'
import { applyAiPlanToState, persistAiWizardContext, pollExistingAiJob } from '../lib/ai-job-flow.js'
import { aiProfile, latestBodyWeight } from '../lib/ai-plan.js'
import { contextFingerprint, draftFromAiContext, generationSubmission, isAiContextStale, validateWizardDraft } from '../lib/ai-product.js'
import { uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { copyPersonalRoutine } from '../lib/personal-forms.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const activeJob = job => job?.status === 'queued' || job?.status === 'running'
const snapshot = context => ({ profile: context?.profile || null, gym: context?.gym || null, measurements: context?.measurements || {} })
const fingerprintKey = userId => `first_ai_context_${userId}`

function hasMaterializedPlan(state, plan) {
  const schedule = state.sourceSchedules?.ai?.find(item => item.active !== false && item.planId === plan.id && item.version === plan.version)
  if (!schedule) return false
  return (plan.routines || []).every(expected => (state.routines || []).some(routine => (
    routine.id === expected.id && routine._aiGenerated === true
    && routine._aiPlanId === plan.id && routine._aiVersion === plan.version
  )))
}

function legacyDraft(state) {
  const profile = aiProfile(state)
  const directorySnapshot = profile.directorySnapshot || state.selectedGym || null
  const directoryGymId = profile.directoryGymId || directorySnapshot?.directoryGymId || directorySnapshot?.id || ''
  const localMeasurements = Object.fromEntries([
    ['waist', profile.measurements?.waistCm], ['chest', profile.measurements?.chestCm],
    ['hip', profile.measurements?.hipCm], ['arm', profile.measurements?.armCm],
    ['thigh', profile.measurements?.thighCm], ['calf', profile.measurements?.calfCm],
  ].filter(([, value]) => Number.isFinite(Number(value))).map(([kind, value]) => [kind, { value: Number(value), unit: 'cm' }]))
  return draftFromAiContext({
    profile: {
      ageBand: profile.ageBand || '', heightCm: profile.heightCm, goal: profile.goal, experience: profile.experience,
      availableDays: profile.availableDays || [], minutesPerSession: profile.minutesPerSession, focusAreas: profile.targetAreas || [],
      favoriteExerciseIds: profile.favoriteExerciseIds || [], avoidedExerciseIds: profile.blockedExerciseIds || [],
      limitations: profile.limitations, acuteRisk: false, medicalRestriction: false, consent: profile.consent === true,
      guardianConsent: profile.guardianConsent === true,
    },
    gym: {
      name: profile.gymName, directoryGymId, directorySnapshot,
      availableExerciseIds: profile.availableExerciseIds || directorySnapshot?.exerciseIds || [],
      genericEquipment: profile.equipment || [], specificMachines: profile.specificMachines || [],
    },
    measurements: {
      ...localMeasurements,
      ...(latestBodyWeight(state) ? { weight: { value: latestBodyWeight(state).w, unit: state.unit || 'kg' } } : {}),
    },
  }, state.unit)
}

function draftWithLocalFallback(context, state) {
  const canonical = draftFromAiContext(context, state.unit)
  const local = legacyDraft(state)
  const hasProfile = context?.profile && Object.keys(context.profile).length > 0
  const hasGym = context?.gym && Object.keys(context.gym).length > 0
  const profileFields = ['ageBand', 'heightCm', 'goal', 'experience', 'availableDays', 'minutesPerSession', 'focusAreas', 'favoriteExerciseIds', 'avoidedExerciseIds', 'limitations', 'acuteRisk', 'medicalRestriction', 'consent', 'guardianConsent']
  const gymFields = ['gymName', 'directoryGymId', 'directorySnapshot', 'availableExerciseIds', 'genericEquipment', 'specificMachines']
  const measurementFields = { weight: 'weight', waist: 'waistCm', chest: 'chestCm', hip: 'hipCm', arm: 'armCm', thigh: 'thighCm', calf: 'calfCm' }
  const profileFallback = hasProfile ? {} : Object.fromEntries(profileFields.map(field => [field, local[field]]))
  const gymFallback = hasGym ? {} : Object.fromEntries(gymFields.map(field => [field, local[field]]))
  const measurementFallback = Object.fromEntries(Object.entries(measurementFields)
    .filter(([kind]) => context?.measurements?.[kind]?.value == null)
    .map(([, field]) => [field, local[field]]))
  return { ...canonical, ...profileFallback, ...gymFallback, ...measurementFallback }
}

const openAccount = () => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent('first:account', { detail: { mode: 'login' } }))
}

export default function AiPlanCard({ openSignal = null }) {
  const state = useStore(store => store.S)
  const user = useStore(store => store.user)
  const ready = useStore(store => store.ready)
  const replaceState = useStore(store => store.replaceState)
  const update = useStore(store => store.update)
  const toast = useUI(store => store.toast)
  const [context, setContext] = useState(null)
  const [status, setStatus] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [job, setJob] = useState(null)
  const [draft, setDraft] = useState(() => legacyDraft(state))
  const [wizard, setWizard] = useState(false)
  const [busy, setBusy] = useState(false)
  const pollController = useRef(null)
  const openedSignal = useRef(null)

  const applyContext = async (next, isCurrent = () => true) => {
    if (!isCurrent()) return false
    setContext(next); setJob(next.job || null); setDraft(draftWithLocalFallback(next, state))
    if (next.plan && !hasMaterializedPlan(useStore.getState().S, next.plan)) {
      replaceState(applyAiPlanToState(useStore.getState().S, next.plan), false)
      await useStore.getState().pushState()
      const key = fingerprintKey(user.id)
      if (!localStorage.getItem(key)) localStorage.setItem(key, contextFingerprint(snapshot(next)))
      return true
    }
    return false
  }
  const load = async () => {
    if (!user) return
    const [nextContext, nextStatus] = await Promise.all([api('/api/ai/context'), api('/api/ai/status')])
    setStatus(nextStatus)
    await applyContext(nextContext)
    setLoadError(null)
    return nextContext
  }
  useEffect(() => {
    let current = true
    if (!ready) return undefined
    if (!user) { setStatus({ configured: false }); setLoadError(null); return undefined }
    Promise.all([api('/api/ai/context'), api('/api/ai/status')]).then(async ([nextContext, nextStatus]) => {
      if (!current) return
      setStatus(nextStatus)
      await applyContext(nextContext, () => current)
      if (current) setLoadError(null)
    }).catch(() => current && setLoadError('Could not load AI workout data.'))
    return () => { current = false; pollController.current?.abort() }
  }, [ready, user?.id])

  useEffect(() => {
    const signalIdentity = openSignal && `${openSignal}:${user?.id || 'guest'}`
    if (!signalIdentity || openedSignal.current === signalIdentity) return
    openedSignal.current = signalIdentity
    if (!user) openAccount()
    else setWizard(true)
  }, [openSignal, user?.id])

  const finishJob = async (initialJob, submission, signal) => {
    try {
      const terminal = await pollExistingAiJob({ job: initialJob, signal, onUpdate: setJob })
      setJob(terminal)
      if (terminal.status === 'failed') throw new Error(terminal.publicError || t('Generation failed. Your previous plan is still active.'))
      if (terminal.status !== 'applied') throw new Error(t('Invalid generation status.'))
      const nextContext = await api('/api/ai/context')
      await applyContext(nextContext)
      localStorage.setItem(fingerprintKey(user.id), contextFingerprint(snapshot(nextContext)))
      submission.clear(); setWizard(false); toast(t('Weekly workout generated and applied.'))
    } catch (error) {
      if (error.name !== 'AbortError') { submission.clear(); toast(t(error.message || 'Workout generation failed.')) }
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!user || !activeJob(job) || pollController.current) return undefined
    const controller = new AbortController(); pollController.current = controller
    const submission = generationSubmission(localStorage, user.id)
    if (!submission.jobId) submission.rememberJob(job.id)
    finishJob(job, submission, controller.signal).finally(() => { if (pollController.current === controller) pollController.current = null })
    return () => controller.abort()
  }, [user?.id, job?.id])

  const generate = async completedDraft => {
    if (!user) { toast(t('Sign in to generate a workout with AI.')); return }
    const validation = validateWizardDraft(completedDraft, state.unit)
    if (validation.step) { toast(t(Object.values(validation.errors)[0])); return }
    setBusy(true)
    try {
      await useStore.getState().pushState()
      const current = await api('/api/ai/context')
      const { context: prepared, status: generationStatus } = await persistAiWizardContext({
        draft: completedDraft, rev: current.rev, observedAt: new Date().toISOString().slice(0, 10), unit: state.unit,
      })
      setContext(prepared); setStatus(generationStatus); setDraft(draftWithLocalFallback(prepared, state))
      if (!generationStatus.configured) throw new Error(t('No tested AI provider is active.'))
      if (prepared.completeness?.blockers?.length) throw new Error(t('Generation is blocked by the current health information.'))
      if (!prepared.completeness?.eligible) throw new Error(t('Review the required information before generating.'))
      const submission = generationSubmission(localStorage, user.id)
      const created = await api('/api/ai/jobs', { method: 'POST', headers: { 'Idempotency-Key': submission.key }, body: '{}' })
      submission.rememberJob(created.job.id); setJob(created.job)
      pollController.current?.abort()
      const controller = new AbortController(); pollController.current = controller
      await finishJob(created.job, submission, controller.signal)
      if (pollController.current === controller) pollController.current = null
    } catch (error) {
      setBusy(false); toast(t(error.message || 'Workout generation failed.'))
    }
  }

  const copy = () => {
    const managed = state.routines.filter(routine => routine._aiGenerated === true && (!context?.plan?.id || routine._aiPlanId === context.plan.id))
    if (!managed.length) return
    update(next => {
      const copies = managed.map(routine => ({ ...copyPersonalRoutine(routine, uid()), name: `${routine.name} · ${t('copy')}` }))
      next.routines = [...next.routines, ...copies]
    })
    toast(t('{0} routines copied to My workout.', managed.length))
  }
  const priorPlan = useMemo(() => {
    const current = context?.plan
    return (context?.planHistory || []).find(item => item.source === 'ai' && item.id !== current?.id && item.version < current?.version) || null
  }, [context?.plan, context?.planHistory])
  const rollback = async () => {
    if (!priorPlan) return
    setBusy(true)
    try {
      await api('/api/ai/plan/rollback', { method: 'POST', body: JSON.stringify({ planId: priorPlan.id }) })
      await load()
      toast(t('Previous AI version restored.'))
    } catch (error) { toast(t(error.message || 'The previous version could not be restored.')) }
    finally { setBusy(false) }
  }

  const storedFingerprint = user && globalThis.localStorage ? globalThis.localStorage.getItem(fingerprintKey(user.id)) : null
  const stale = isAiContextStale(context, storedFingerprint)

  const retryLoad = async () => { try { await load() } catch { setLoadError('Could not load AI workout data.') } }

  const openWizard = () => { if (!user) openAccount(); else setWizard(true) }

  return wizard ? <AiWizard draft={draft} onDraft={setDraft} onClose={() => setWizard(false)} onSubmit={generate} busy={busy} unit={state.unit} /> : <AiPlanOverview
    plan={context?.plan} status={status} job={job} stale={stale} onOpen={openWizard} signedIn={!!user}
    error={loadError} onRetry={retryLoad} onRollback={rollback} onCopy={copy} canRollback={!!priorPlan}
  />
}
