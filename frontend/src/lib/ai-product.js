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

export function draftFromAiContext(context = {}) {
  const profile = context.profile || {}
  const gym = context.gym || {}
  const measurements = context.measurements || {}
  const values = Object.fromEntries(Object.entries(MEASUREMENT_FIELDS).map(([kind, field]) => [field, measurements[kind]?.value ?? '']))
  return {
    ...DEFAULT_DRAFT,
    ...profile,
    ...values,
    gymName: gym.name || '',
    genericEquipment: [...(gym.genericEquipment || [])],
    specificMachines: (gym.specificMachines || []).map(machine => ({ ...machine, exerciseIds: [...(machine.exerciseIds || [])] })),
    availableDays: [...(profile.availableDays || [])],
    focusAreas: [...(profile.focusAreas || [])],
    favoriteExerciseIds: [...(profile.favoriteExerciseIds || [])],
    avoidedExerciseIds: [...(profile.avoidedExerciseIds || [])],
  }
}

const required = (errors, field, condition, message) => condition ? errors : { ...errors, [field]: message }

export function validateWizardStep(draft, step) {
  let errors = {}
  if (step === 1) {
    errors = required(errors, 'ageBand', ['under14', '14to17', 'adult'].includes(draft.ageBand), 'Informe a faixa etária.')
    errors = required(errors, 'heightCm', Number(draft.heightCm) >= 80 && Number(draft.heightCm) <= 250, 'Informe uma altura válida.')
    errors = required(errors, 'weight', Number(draft.weight) > 0 && Number(draft.weight) <= 500, 'Informe um peso válido.')
  }
  if (step === 2) {
    errors = required(errors, 'goal', String(draft.goal || '').trim().length > 0, 'Informe o objetivo principal.')
    errors = required(errors, 'experience', ['iniciante', 'intermediario', 'avancado'].includes(draft.experience), 'Informe a experiência.')
    errors = required(errors, 'availableDays', Array.isArray(draft.availableDays) && draft.availableDays.length > 0, 'Escolha pelo menos um dia.')
    errors = required(errors, 'minutesPerSession', Number(draft.minutesPerSession) >= 15 && Number(draft.minutesPerSession) <= 180, 'Informe uma duração entre 15 e 180 minutos.')
  }
  if (step === 3) {
    errors = required(errors, 'gymName', String(draft.gymName || '').trim().length > 0, 'Informe a academia.')
    const hasSpecific = draft.specificMachines?.some(machine => machine.exerciseIds?.length)
    errors = required(errors, 'genericEquipment', draft.genericEquipment?.length > 0 || hasSpecific, 'Escolha pelo menos um aparelho disponível.')
  }
  if (step === 4) {
    errors = required(errors, 'consent', draft.consent === true, 'Confirme o uso dos dados para gerar o treino.')
    if (draft.ageBand === 'under14' || draft.ageBand === '14to17') {
      errors = required(errors, 'guardianConsent', draft.guardianConsent === true, 'Confirme a autorização do responsável.')
    }
  }
  return errors
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

const JOB_PRESENTATION = Object.freeze({
  queued: ['Na fila', 'Queued'], organizing: ['Organizando contexto', 'Organizing context'],
  generating: ['Gerando treino', 'Generating workout'], validating: ['Validando plano', 'Validating plan'],
  applying: ['Aplicando treino', 'Applying workout'], applied: ['Aplicado', 'Applied'], failed: ['Falha na geração', 'Generation failed'],
})

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
      specificMachines: draft.specificMachines.map(machine => ({ ...machine, exerciseIds: [...machine.exerciseIds] })),
    },
    measurements: [
      ['weight', draft.weight, unit === 'lb' ? 'lb' : 'kg'], ['waist', draft.waistCm, 'cm'], ['chest', draft.chestCm, 'cm'],
      ['hip', draft.hipCm, 'cm'], ['arm', draft.armCm, 'cm'], ['thigh', draft.thighCm, 'cm'], ['calf', draft.calfCm, 'cm'],
    ].filter(([, value]) => Number(value) > 0).map(([kind, value, measurementUnit]) => ({ kind, value: Number(value), unit: measurementUnit, observedAt })),
  }
}
