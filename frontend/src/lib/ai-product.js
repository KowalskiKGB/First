import { EXDB } from './exercises-data.js'

const MEASUREMENT_FIELDS = Object.freeze({
  weight: 'weight', waist: 'waistCm', chest: 'chestCm', hip: 'hipCm',
  arm: 'armCm', thigh: 'thighCm', calf: 'calfCm',
})

const DEFAULT_DRAFT = Object.freeze({
  ageBand: '', heightCm: '', weight: '', waistCm: '', chestCm: '', hipCm: '', armCm: '', thighCm: '', calfCm: '',
  goal: '', experience: 'intermediario', availableDays: [], minutesPerSession: 60, focusAreas: [],
  gymName: '', genericEquipment: [], specificMachines: [], favoriteExerciseIds: [], avoidedExerciseIds: [],
  limitations: '', acuteRisk: false, medicalRestriction: false, consent: false, guardianConsent: false,
})

function weightInUnit(measurement, targetUnit) {
  const value = measurement?.value
  if (value == null) return ''
  const source = measurement?.unit === 'lb' ? 'lb' : 'kg'
  const target = targetUnit === 'lb' ? 'lb' : 'kg'
  if (source === target || !Number.isFinite(Number(value))) return value
  const converted = Number(value) * (target === 'lb' ? 2.2046226218 : 0.45359237)
  return Math.round(converted * 10) / 10
}

export function draftFromAiContext(context = {}, targetUnit = 'kg') {
  const profile = context.profile || {}
  const gym = context.gym || {}
  const measurements = context.measurements || {}
  const values = Object.fromEntries(Object.entries(MEASUREMENT_FIELDS).map(([kind, field]) => [field, measurements[kind]?.value ?? '']))
  return {
    ...DEFAULT_DRAFT,
    ...profile,
    ...values,
    weight: weightInUnit(measurements.weight, targetUnit),
    gymName: gym.name || '',
    genericEquipment: [...(gym.genericEquipment || [])],
    specificMachines: (gym.specificMachines || []).map(machine => ({ ...machine, exerciseIds: [...(machine.exerciseIds || [])] })),
    availableDays: [...(profile.availableDays || [])],
    focusAreas: [...(profile.focusAreas || [])],
    favoriteExerciseIds: [...(profile.favoriteExerciseIds || [])],
    avoidedExerciseIds: [...(profile.avoidedExerciseIds || [])],
  }
}

const required = (errors, field, condition, message) => condition || errors[field] ? errors : { ...errors, [field]: message }

const EXERCISE_IDS = new Set(EXDB.map(exercise => exercise.id))
const EQUIPMENT_IDS = new Set(EXDB.map(exercise => exercise.eq).filter(Boolean))
const OPTIONAL_MEASUREMENTS = ['waistCm', 'chestCm', 'hipCm', 'armCm', 'thighCm', 'calfCm']

const validStringList = (value, maxItems, maxLength, allowed) => Array.isArray(value)
  && value.length <= maxItems
  && value.every(item => typeof item === 'string' && item.trim() && item.length <= maxLength && (!allowed || allowed.has(item)))

const validOptionalMeasurement = value => value === '' || value == null
  || (Number.isFinite(Number(value)) && Number(value) >= 10 && Number(value) <= 250)

export function validateWizardStep(draft = {}, step, unit = 'kg') {
  let errors = {}
  if (step === 1) {
    errors = required(errors, 'ageBand', ['under14', '14to17', 'adult'].includes(draft.ageBand), 'Enter the age range.')
    const height = Number(draft.heightCm)
    errors = required(errors, 'heightCm', Number.isInteger(height) && height >= 80 && height <= 250, 'Enter a valid height.')
    const weightKg = Number(draft.weight) * (unit === 'lb' ? 0.45359237 : 1)
    errors = required(errors, 'weight', Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 350, 'Enter a valid weight.')
    OPTIONAL_MEASUREMENTS.forEach(field => {
      errors = required(errors, field, validOptionalMeasurement(draft[field]), 'Enter a valid optional measurement.')
    })
  }
  if (step === 2) {
    const goal = typeof draft.goal === 'string' ? draft.goal.trim() : ''
    errors = required(errors, 'goal', goal.length > 0, 'Enter the primary goal.')
    errors = required(errors, 'goal', goal.length <= 160, 'Keep the goal within 160 characters.')
    errors = required(errors, 'experience', ['iniciante', 'intermediario', 'avancado'].includes(draft.experience), 'Enter the experience level.')
    const days = draft.availableDays
    errors = required(errors, 'availableDays', Array.isArray(days) && days.length > 0, 'Choose at least one day.')
    errors = required(errors, 'availableDays', Array.isArray(days) && days.length <= 7 && days.every(day => Number.isInteger(day) && day >= 0 && day <= 6), 'Choose valid available days.')
    const minutes = Number(draft.minutesPerSession)
    errors = required(errors, 'minutesPerSession', Number.isInteger(minutes) && minutes >= 15 && minutes <= 180, 'Enter a duration between 15 and 180 minutes.')
    errors = required(errors, 'focusAreas', validStringList(draft.focusAreas, 12, 60), 'Choose up to 12 training priorities.')
  }
  if (step === 3) {
    const gymName = typeof draft.gymName === 'string' ? draft.gymName.trim() : ''
    errors = required(errors, 'gymName', gymName.length > 0 && gymName.length <= 120, 'Enter the gym.')
    const machines = Array.isArray(draft.specificMachines) ? draft.specificMachines : []
    errors = required(errors, 'specificMachines', Array.isArray(draft.specificMachines) && machines.length <= 40, 'Add no more than 40 specific machines.')
    machines.forEach((machine, index) => {
      const name = typeof machine?.name === 'string' ? machine.name.trim() : ''
      const category = machine?.category == null ? '' : machine.category
      errors = required(errors, `specificMachineName${index}`, name.length > 0 && name.length <= 100, 'Enter the machine name.')
      errors = required(errors, `specificMachineCategory${index}`, typeof category === 'string' && category.length <= 80, 'Enter a valid machine category.')
      errors = required(errors, `specificMachineExercises${index}`, validStringList(machine?.exerciseIds, 60, 100, EXERCISE_IDS) && machine.exerciseIds.length > 0, 'Choose at least one supported exercise.')
    })
    const validEquipment = validStringList(draft.genericEquipment, 60, 100, EQUIPMENT_IDS)
    errors = required(errors, 'genericEquipment', validEquipment, 'Choose valid available equipment.')
    const hasSpecific = machines.some(machine => String(machine?.name || '').trim() && validStringList(machine?.exerciseIds, 60, 100, EXERCISE_IDS) && machine.exerciseIds.length)
    errors = required(errors, 'genericEquipment', (validEquipment && draft.genericEquipment.length > 0) || hasSpecific, 'Choose at least one available equipment item.')
    errors = required(errors, 'favoriteExerciseIds', validStringList(draft.favoriteExerciseIds, 60, 100, EXERCISE_IDS), 'Choose up to 60 supported exercises.')
    errors = required(errors, 'avoidedExerciseIds', validStringList(draft.avoidedExerciseIds, 60, 100, EXERCISE_IDS), 'Choose up to 60 supported exercises.')
    errors = required(errors, 'limitations', typeof draft.limitations === 'string' && draft.limitations.length <= 1000, 'Enter up to 1,000 characters.')
  }
  if (step === 4) {
    errors = required(errors, 'consent', draft.consent === true, 'Confirm data use to generate the workout.')
    if (draft.ageBand === 'under14' || draft.ageBand === '14to17') {
      errors = required(errors, 'guardianConsent', draft.guardianConsent === true, 'Confirm guardian authorization.')
    }
    errors = required(errors, 'health', draft.acuteRisk !== true && draft.medicalRestriction !== true, 'Generation is blocked while an acute risk or medical restriction is active.')
  }
  return errors
}

export function validateWizardDraft(draft, unit = 'kg') {
  for (let step = 1; step <= 4; step += 1) {
    const errors = validateWizardStep(draft, step, unit)
    if (Object.keys(errors).length) return { step, errors }
  }
  return { step: null, errors: {} }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}

export function contextFingerprint(value) {
  const source = JSON.stringify(stable(value))
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `ctx-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function isAiContextStale(context, storedFingerprint) {
  if (!context?.plan) return false
  const canonical = { profile: context.profile || null, gym: context.gym || null, measurements: context.measurements || {} }
  const planTime = Date.parse(context.plan.appliedAt || context.plan.createdAt || '')
  const changedTimes = [
    context.profile?.updatedAt,
    context.gym?.updatedAt,
    ...Object.values(context.measurements || {}).map(item => item?.updatedAt || item?.observedAt),
  ].map(Date.parse).filter(Number.isFinite)
  return !!(
    (storedFingerprint && storedFingerprint !== contextFingerprint(canonical))
    || (context.job?.contextHash && context.plan.contextHash && context.job.contextHash !== context.plan.contextHash)
    || (Number.isFinite(planTime) && changedTimes.some(value => value > planTime))
  )
}

const JOB_PRESENTATION = Object.freeze({
  queued: ['Na fila', 'Queued'], organizing: ['Organizando contexto', 'Organizing context'],
  generating: ['Gerando treino', 'Generating workout'], validating: ['Validando plano', 'Validating plan'],
  applying: ['Aplicando treino', 'Applying workout'], applied: ['Aplicado', 'Applied'], failed: ['Falha na geração', 'Generation failed'],
})

const PROVIDER_NAMES = Object.freeze({ openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Anthropic' })

export function providerDisplayName(provider) {
  return PROVIDER_NAMES[provider] || String(provider || '')
}

export function jobPresentation(job) {
  const key = job?.status === 'queued' || job?.status === 'applied' || job?.status === 'failed' ? job.status : (job?.stage || job?.status || 'organizing')
  const [label, labelKey] = JOB_PRESENTATION[key] || JOB_PRESENTATION.organizing
  return { key, label, labelKey, active: job?.status === 'queued' || job?.status === 'running' }
}

export function canonicalDraftPayloads(draft, rev, observedAt, unit = 'kg') {
  return {
    profile: {
      rev, ageBand: draft.ageBand, heightCm: Number(draft.heightCm), goal: String(draft.goal || '').trim(),
      experience: draft.experience, availableDays: [...draft.availableDays], minutesPerSession: Number(draft.minutesPerSession),
      focusAreas: [...draft.focusAreas], favoriteExerciseIds: [...draft.favoriteExerciseIds], avoidedExerciseIds: [...draft.avoidedExerciseIds],
      limitations: String(draft.limitations || ''), acuteRisk: draft.acuteRisk === true, medicalRestriction: draft.medicalRestriction === true,
      consent: draft.consent === true, guardianConsent: draft.ageBand === 'adult' ? null : draft.guardianConsent === true,
    },
    gym: {
      name: String(draft.gymName || '').trim(), genericEquipment: [...draft.genericEquipment],
      specificMachines: draft.specificMachines.map(machine => ({
        ...machine, name: String(machine.name || '').trim(), category: String(machine.category || ''), exerciseIds: [...machine.exerciseIds],
      })),
    },
    measurements: [
      ['weight', draft.weight, unit === 'lb' ? 'lb' : 'kg'], ['waist', draft.waistCm, 'cm'], ['chest', draft.chestCm, 'cm'],
      ['hip', draft.hipCm, 'cm'], ['arm', draft.armCm, 'cm'], ['thigh', draft.thighCm, 'cm'], ['calf', draft.calfCm, 'cm'],
    ].filter(([, value]) => Number(value) > 0).map(([kind, value, measurementUnit]) => ({ kind, value: Number(value), unit: measurementUnit, observedAt })),
  }
}

export function generationSubmission(storage, userId, randomUUID = () => crypto.randomUUID()) {
  const storageKey = `first_ai_generation_${String(userId || 'anonymous')}`
  let current
  try { current = JSON.parse(storage.getItem(storageKey) || 'null') }
  catch { current = null }
  if (!current?.key) {
    current = { key: randomUUID(), jobId: null }
    storage.setItem(storageKey, JSON.stringify(current))
  }
  return {
    ...current,
    rememberJob(jobId) {
      current = { ...current, jobId }
      storage.setItem(storageKey, JSON.stringify(current))
    },
    clear() { storage.removeItem(storageKey) },
  }
}
