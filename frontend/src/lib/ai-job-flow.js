import { api } from './api.js'

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

export function applyAiPlanToState(state, plan) {
  const manualRoutines = (state.routines || []).filter(routine => routine._aiGenerated !== true)
  const aiRoutines = (plan.routines || []).map(routine => ({
    ...routine,
    ex: (routine.exercises || []).map(frontendExercise),
    _aiGenerated: true,
    _aiGeneratedAt: plan.appliedAt
  }))
  return {
    ...state,
    routines: [...manualRoutines, ...aiRoutines],
    aiSchedule: structuredClone(plan.schedule || []),
    aiLastGeneration: {
      planId: plan.id,
      version: plan.version,
      name: `Plano IA v${plan.version}`,
      summary: plan.justification,
      justification: plan.justification,
      generatedAt: plan.appliedAt
    }
  }
}
