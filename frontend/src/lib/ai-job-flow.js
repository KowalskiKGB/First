import { api } from './api.js'
import { canonicalDraftPayloads, validateWizardDraft } from './ai-product.js'

const ACTIVE = new Set(['queued', 'running'])
const waitFor = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export function canonicalAiMissingFields({ profile = {}, weight }) {
  const missing = []
  if (!weight) missing.push('peso')
  if (!profile.heightCm) missing.push('altura')
  if (!String(profile.goal || '').trim()) missing.push('objetivo')
  if (!['under14', '14to17', 'adult'].includes(profile.ageBand)) missing.push('faixa etária')
  if (profile.consent !== true) missing.push('consentimento')
  if (['under14', '14to17'].includes(profile.ageBand) && profile.guardianConsent !== true) missing.push('autorização do responsável')
  if (!Array.isArray(profile.availableDays) || profile.availableDays.length === 0) missing.push('dias disponíveis')
  if (!String(profile.gymName || '').trim()) missing.push('academia')
  if (!Array.isArray(profile.equipment) || profile.equipment.length === 0) missing.push('aparelhos')
  return missing
}

const jsonBody = value => JSON.stringify(value)

function wizardValidationError(step, errors) {
  return Object.assign(new Error(Object.values(errors)[0]), { name: 'AiWizardValidationError', step, errors })
}

function validObservedAt(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value
    && value <= new Date().toISOString().slice(0, 10)
}

function canonicalProfile(profile, rev) {
  return {
    rev,
    ageBand: profile.ageBand,
    heightCm: Number(profile.heightCm),
    goal: String(profile.goal || '').trim(),
    experience: profile.experience,
    availableDays: [...(profile.availableDays || [])],
    minutesPerSession: Number(profile.minutesPerSession),
    focusAreas: [...(profile.targetAreas || [])],
    favoriteExerciseIds: [...(profile.favoriteExerciseIds || [])],
    avoidedExerciseIds: [...(profile.blockedExerciseIds || [])],
    limitations: String(profile.limitations || ''),
    acuteRisk: profile.acuteRisk === true,
    medicalRestriction: profile.medicalRestriction === true,
    consent: profile.consent === true,
    guardianConsent: profile.ageBand === 'adult' ? null : profile.guardianConsent === true
  }
}

export async function persistCanonicalAiContext({
  request = api,
  profile,
  weight,
  weightUnit = 'kg',
  observedAt = new Date().toISOString().slice(0, 10)
}) {
  const current = await request('/api/ai/context')
  const savedProfile = await request('/api/ai/profile', {
    method: 'PUT', body: jsonBody(canonicalProfile(profile, current.rev))
  })
  const savedGym = await request('/api/ai/gym', {
    method: 'PUT',
    body: jsonBody({
      rev: savedProfile.rev,
      name: String(profile.gymName || '').trim(),
      genericEquipment: [...(profile.equipment || [])],
      specificMachines: []
    })
  })
  await request('/api/ai/measurements', {
    method: 'POST',
    body: jsonBody({
      rev: savedGym.rev,
      kind: 'weight',
      value: Number(weight),
      unit: weightUnit === 'lb' ? 'lb' : 'kg',
      observedAt
    })
  })
  const [context, status] = await Promise.all([
    request('/api/ai/context'),
    request('/api/ai/status')
  ])
  return { context, status }
}

export async function generateAiWorkout({
  request = api,
  idempotencyKey,
  wait = waitFor,
  pollIntervalMs = 750,
  maxPolls = 120
}) {
  const created = await request('/api/ai/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: '{}'
  })
  let job = created.job
  for (let poll = 0; job && ACTIVE.has(job.status) && poll < maxPolls; poll += 1) {
    await wait(pollIntervalMs)
    const result = await request(`/api/ai/job?id=${encodeURIComponent(job.id)}`)
    job = result.job
  }
  if (!job || ACTIVE.has(job.status)) throw new Error('A geração demorou mais que o esperado. Consulte o status novamente.')
  if (job.status === 'failed') throw new Error(job.publicError || 'Não foi possível gerar o treino.')
  if (job.status !== 'applied') throw new Error('Status de geração inválido.')
  const context = await request('/api/ai/context')
  if (!context.plan || (job.planVersion != null && context.plan.version !== job.planVersion)) {
    throw new Error('O plano gerado ainda não está disponível.')
  }
  return { job, context }
}

function aborted() {
  return Object.assign(new Error('AI job polling cancelled'), { name: 'AbortError' })
}

export async function pollExistingAiJob({
  request = api, job, wait = waitFor, signal, onUpdate = () => {}, maxPolls = 120,
}) {
  let current = job
  for (let poll = 0; current && ACTIVE.has(current.status) && poll < maxPolls; poll += 1) {
    if (signal?.aborted) throw aborted()
    await wait(Math.min(3000, 700 + poll * 150))
    if (signal?.aborted) throw aborted()
    const result = await request(`/api/ai/job?id=${encodeURIComponent(current.id)}`)
    current = result.job
    onUpdate(current)
  }
  if (!current || ACTIVE.has(current.status)) {
    throw new Error('Workout generation is taking longer than expected. Check the status again.')
  }
  return current
}

export async function persistAiWizardContext({
  request = api, draft, rev, observedAt = new Date().toISOString().slice(0, 10), unit = 'kg',
}) {
  const validation = validateWizardDraft(draft, unit)
  if (validation.step) throw wizardValidationError(validation.step, validation.errors)
  if (!validObservedAt(observedAt)) throw wizardValidationError(1, { observedAt: 'Enter a valid measurement date.' })
  const payloads = canonicalDraftPayloads(draft, rev, observedAt, unit)
  const savedProfile = await request('/api/ai/profile', { method: 'PUT', body: JSON.stringify(payloads.profile) })
  const savedGym = await request('/api/ai/gym', { method: 'PUT', body: JSON.stringify({ ...payloads.gym, rev: savedProfile.rev }) })
  let currentRev = savedGym.rev
  for (const measurement of payloads.measurements) {
    const saved = await request('/api/ai/measurements', { method: 'POST', body: JSON.stringify({ ...measurement, rev: currentRev }) })
    currentRev = saved.rev
  }
  const [context, status] = await Promise.all([request('/api/ai/context'), request('/api/ai/status')])
  return { context, status }
}

function frontendExercise(exercise) {
  return {
    id: exercise.exerciseId,
    _aiExerciseId: exercise.id,
    mode: exercise.mode,
    sets: exercise.sets,
    reps: exercise.mode === 'reps' ? exercise.repMin : undefined,
    repsMin: exercise.mode === 'reps' ? exercise.repMin : undefined,
    repsMax: exercise.mode === 'reps' ? exercise.repMax : undefined,
    sec: exercise.mode === 'time' ? exercise.seconds : undefined,
    min: exercise.mode === 'cardio' ? Math.max(1, Math.round(exercise.seconds / 60)) : undefined,
    rest: exercise.restSeconds,
    weight: 0,
    note: exercise.note,
    progression: exercise.progression
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmptyId = value => typeof value === 'string' && value.trim().length > 0

function materializedExercises(routine) {
  const canonical = Array.isArray(routine.exercises)
    ? routine.exercises.filter(exercise => record(exercise) && nonEmptyId(exercise.exerciseId)).map(frontendExercise)
    : []
  const legacy = Array.isArray(routine.ex)
    ? routine.ex.filter(exercise => record(exercise) && nonEmptyId(exercise.id)).map(exercise => ({ ...exercise }))
    : []
  return canonical.length > 0 ? canonical : legacy
}

function materializedRoutines(plan) {
  const seen = new Set()
  return (Array.isArray(plan.routines) ? plan.routines : [])
    .filter(routine => {
      if (!record(routine) || !nonEmptyId(routine.id) || seen.has(routine.id)) return false
      seen.add(routine.id)
      return true
    })
    .map(routine => ({
      ...routine,
      ex: materializedExercises(routine),
      _aiGenerated: true,
      _aiPlanId: plan.id,
      _aiVersion: plan.version,
      _aiGeneratedAt: plan.appliedAt
    }))
}

function materializedSchedule(schedule, routineIds) {
  const entries = Array.isArray(schedule)
    ? schedule
    : record(schedule)
      ? Object.entries(schedule).flatMap(([day, value]) => (Array.isArray(value) ? value : [value]).map(routineId => ({ day, routineId })))
      : []
  const seen = new Set()
  return entries.flatMap(item => {
    if (!record(item) || !['number', 'string'].includes(typeof item.day)) return []
    const day = Number(item.day)
    if (!Number.isInteger(day) || day < 0 || day > 6 || !nonEmptyId(item.routineId) || !routineIds.has(item.routineId)) return []
    const key = `${day}\u0000${item.routineId}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ day, routineId: item.routineId }]
  })
}

export function applyAiPlanToState(state = {}, plan) {
  if (!record(plan) || !nonEmptyId(plan.id)) return state
  const manualRoutines = (Array.isArray(state.routines) ? state.routines : []).filter(routine => routine?._aiGenerated !== true)
  const aiRoutines = materializedRoutines(plan)
  const aiSchedule = materializedSchedule(plan.schedule, new Set(aiRoutines.map(routine => routine.id)))
  const week = aiSchedule.reduce((result, item) => {
    const current = result[item.day]
    const routines = current == null ? [] : Array.isArray(current) ? current : [current]
    const next = routines.includes(item.routineId) ? routines : [...routines, item.routineId]
    return { ...result, [item.day]: next.length === 1 ? next[0] : next }
  }, {})
  const currentAi = (Array.isArray(state.sourceSchedules?.ai) ? state.sourceSchedules.ai : []).find(schedule => schedule.active !== false)
  const priorHistory = [...(Array.isArray(state.aiPlanHistory) ? state.aiPlanHistory : [])]
  if (currentAi?.planId && !priorHistory.some(item => item.planId === currentAi.planId)) {
    priorHistory.push({ planId: currentAi.planId, version: currentAi.version, label: currentAi.label, appliedAt: currentAi.updatedAt || null })
  }
  const aiPlanHistory = [...priorHistory.filter(item => item.planId !== plan.id), {
    planId: plan.id, version: plan.version, label: `Plano IA v${plan.version}`, appliedAt: plan.appliedAt,
  }].slice(-10)
  return {
    ...state,
    routines: [...manualRoutines, ...aiRoutines],
    aiSchedule,
    sourceSchedules: {
      ...(state.sourceSchedules || {}),
      ai: [{
        sourceType: 'ai', planId: plan.id, version: plan.version,
        label: `Plano IA v${plan.version}`, active: true, updatedAt: plan.appliedAt,
        week,
      }],
    },
    aiLastGeneration: {
      planId: plan.id,
      version: plan.version,
      name: `Plano IA v${plan.version}`,
      summary: plan.justification,
      justification: plan.justification,
      generatedAt: plan.appliedAt
    },
    aiPlanHistory,
  }
}
