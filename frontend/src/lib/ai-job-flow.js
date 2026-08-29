import { api } from './api.js'

const ACTIVE = new Set(['queued', 'running'])
const waitFor = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

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
