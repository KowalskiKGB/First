const AGE_BANDS = new Set(['under14', '14to17', 'adult']);
const EXPERIENCES = new Set(['iniciante', 'intermediario', 'avancado']);
export const AI_PLAN_SOURCES = Object.freeze(['ai', 'personal']);
export const AI_PLAN_STATUSES = Object.freeze(['applied', 'superseded']);
export const AI_JOB_STATUSES = Object.freeze(['queued', 'running', 'applied', 'failed']);
const PLAN_SOURCES = new Set(AI_PLAN_SOURCES);
const PLAN_STATUSES = new Set(AI_PLAN_STATUSES);
const JOB_STATUSES = new Set(AI_JOB_STATUSES);
const USAGE_STATUSES = new Set(['success', 'failed']);
const CONNECTION_GRANTS = [
  'plansWrite', 'workoutsRead', 'progressRead', 'measurementsWrite',
  'liveActivityRead', 'trainingProfileWrite', 'aiPlanRead'
];

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const timestamp = value => text(value, 40) || null;
const nonNegativeInteger = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const stringList = (value, maxItems, maxLength = 100) => [...new Set(
  (Array.isArray(value) ? value : []).slice(0, maxItems).map(item => text(item, maxLength)).filter(Boolean)
)];
const days = value => [...new Set((Array.isArray(value) ? value : [])
  .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].slice(0, 7).sort((a, b) => a - b);

function normalizeTrainingProfile(value) {
  const studentId = text(value?.studentId, 100);
  if (!studentId || !AGE_BANDS.has(value?.ageBand)) return null;
  const height = Number(value.heightCm);
  return {
    studentId,
    ageBand: value.ageBand,
    heightCm: Number.isFinite(height) ? Math.max(80, Math.min(250, Math.round(height))) : null,
    goal: text(value.goal, 160),
    experience: EXPERIENCES.has(value.experience) ? value.experience : 'intermediario',
    availableDays: days(value.availableDays),
    minutesPerSession: Number.isInteger(value.minutesPerSession)
      ? Math.max(15, Math.min(180, value.minutesPerSession))
      : null,
    focusAreas: stringList(value.focusAreas, 12, 60),
    favoriteExerciseIds: stringList(value.favoriteExerciseIds, 60),
    avoidedExerciseIds: stringList(value.avoidedExerciseIds, 60),
    limitations: text(value.limitations, 1000),
    acuteRisk: value.acuteRisk === true,
    medicalRestriction: value.medicalRestriction === true,
    consent: value.consent === true,
    guardianConsent: typeof value.guardianConsent === 'boolean' ? value.guardianConsent : null,
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt)
  };
}

function normalizeGymProfile(value) {
  const studentId = text(value?.studentId, 100);
  if (!studentId) return null;
  return {
    studentId,
    name: text(value.name, 120),
    genericEquipment: stringList(value.genericEquipment, 60),
    specificMachines: (Array.isArray(value.specificMachines) ? value.specificMachines : []).slice(0, 40).flatMap(machine => {
      const name = text(machine?.name, 100);
      if (!name) return [];
      return [{
        name,
        category: text(machine.category, 80),
        exerciseIds: stringList(machine.exerciseIds, 60)
      }];
    }),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt)
  };
}

function normalizeRoutine(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = text(value.id || `routine-${index + 1}`, 100);
  const legacyExercises = (Array.isArray(value.ex) ? value.ex : []).slice(0, 30).flatMap(exercise => {
    const exerciseId = text(exercise?.id, 100);
    if (!exerciseId) return [];
    return [{
      id: exerciseId,
      sets: Number.isInteger(exercise.sets) ? Math.max(1, Math.min(20, exercise.sets)) : 3,
      reps: text(exercise.reps, 30),
      rest: Number.isInteger(exercise.rest) ? Math.max(0, Math.min(1800, exercise.rest)) : 60,
      note: text(exercise.note, 240)
    }];
  });
  const exercises = (Array.isArray(value.exercises) ? value.exercises : []).slice(0, 30).flatMap((exercise, exerciseIndex) => {
    const exerciseId = text(exercise?.exerciseId, 100);
    if (!exerciseId || !['reps', 'time', 'cardio'].includes(exercise.mode)) return [];
    return [{
      id: text(exercise.id || `${id}-exercise-${exerciseIndex + 1}`, 100),
      exerciseId,
      mode: exercise.mode,
      sets: Number.isInteger(exercise.sets) ? exercise.sets : 1,
      repMin: Number.isInteger(exercise.repMin) ? exercise.repMin : null,
      repMax: Number.isInteger(exercise.repMax) ? exercise.repMax : null,
      seconds: Number.isInteger(exercise.seconds) ? exercise.seconds : null,
      restSeconds: Number.isInteger(exercise.restSeconds) ? exercise.restSeconds : 60,
      progression: text(exercise.progression, 500),
      note: text(exercise.note, 300)
    }];
  });
  return {
    id,
    name: text(value.name, 100),
    ...(exercises.length ? { exercises } : { ex: legacyExercises }),
    ...(value._aiGenerated === true ? { _aiGenerated: true } : {}),
    ...(value.sourceType === 'ai' ? { sourceType: 'ai' } : {}),
    ...(text(value.planId, 100) ? { planId: text(value.planId, 100) } : {}),
    ...(Number.isInteger(value.version) && value.version > 0 ? { version: value.version } : {}),
    ...(value.readOnly === true ? { readOnly: true } : {})
  };
}

function normalizeSchedule(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 7).flatMap(entry => Number.isInteger(entry?.day) && entry.day >= 0 && entry.day <= 6
      ? [{ day: entry.day, routineId: text(entry.routineId, 100) }]
      : []);
  }
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).slice(0, 7)
    .filter(([day, routineId]) => /^[0-6]$/.test(day) && typeof routineId === 'string')
    .map(([day, routineId]) => [day, text(routineId, 100)]));
}

function normalizeAiPlan(value) {
  const id = text(value?.id, 100);
  const studentId = text(value?.studentId, 100);
  if (!id || !studentId || !Number.isInteger(value.version) || value.version < 1) return null;
  const legacySource = value.source === 'generated' ? 'ai' : value.source;
  const source = PLAN_SOURCES.has(legacySource) ? legacySource : 'ai';
  const legacyStatus = ['completed', 'active'].includes(value.status) ? 'applied'
    : ['draft', 'inactive', 'archived'].includes(value.status) ? 'superseded'
      : value.status;
  const status = PLAN_STATUSES.has(legacyStatus) ? legacyStatus : 'superseded';
  return {
    id,
    studentId,
    version: value.version,
    provider: text(value.provider, 40),
    model: text(value.model, 120),
    contextHash: text(value.contextHash, 128),
    justification: text(value.justification, 2000),
    routines: (Array.isArray(value.routines) ? value.routines : []).slice(0, 14)
      .map(normalizeRoutine).filter(Boolean),
    schedule: normalizeSchedule(value.schedule),
    source,
    status,
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
    appliedAt: timestamp(value.appliedAt)
  };
}

function normalizeAiJob(value) {
  const id = text(value?.id, 100);
  const studentId = text(value?.studentId, 100);
  const idempotencyKey = text(value?.idempotencyKey, 160);
  const legacyStatus = value?.status === 'completed' ? 'applied' : value?.status === 'cancelled' ? 'failed' : value?.status;
  if (!id || !studentId || !idempotencyKey || !JOB_STATUSES.has(legacyStatus)) return null;
  return {
    id,
    idempotencyKey,
    studentId,
    status: legacyStatus,
    stage: text(value.stage, 80),
    publicError: text(value.publicError, 240) || null,
    contextHash: text(value.contextHash, 128),
    planVersion: Number.isInteger(value.planVersion) && value.planVersion > 0 ? value.planVersion : null,
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt)
  };
}

function normalizeAiUsage(value) {
  const provider = text(value?.provider, 40);
  const model = text(value?.model, 120);
  if (!provider || !model || !USAGE_STATUSES.has(value.status)) return null;
  const studentId = text(value.studentId, 100);
  return {
    provider,
    model,
    inputTokens: nonNegativeInteger(value.inputTokens),
    outputTokens: nonNegativeInteger(value.outputTokens),
    totalTokens: nonNegativeInteger(value.totalTokens),
    latencyMs: nonNegativeInteger(value.latencyMs),
    status: value.status,
    ...(studentId ? { studentId } : {}),
    timestamp: timestamp(value.timestamp)
  };
}

function onePerStudent(values, normalize) {
  const byStudent = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalize(value);
    if (normalized) byStudent.set(normalized.studentId, normalized);
  }
  return [...byStudent.values()];
}

function normalizeConnection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return {
    ...value,
    grants: Object.fromEntries(CONNECTION_GRANTS.map(key => [key, value.grants?.[key] === true]))
  };
}

function retainedPlans(values) {
  const byStudent = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeAiPlan(value);
    if (!normalized) continue;
    const plans = byStudent.get(normalized.studentId) || [];
    byStudent.set(normalized.studentId, [...plans, normalized]);
  }
  const compare = (a, b) => a.version - b.version ||
    String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || '')) ||
    a.id.localeCompare(b.id);
  return [...byStudent.values()].flatMap(plans => plans.sort(compare).slice(-10));
}

export const INITIAL_COLLABORATION = {
  schemaVersion: 2,
  rev: 0,
  profiles: [],
  connections: [],
  clients: [],
  notifications: [],
  audit: [],
  programs: [],
  measurements: [],
  availability: [],
  appointments: [],
  receivables: [],
  trainingProfiles: [],
  gymProfiles: [],
  aiPlans: [],
  aiJobs: [],
  aiUsage: []
};

export function migrateCollaboration(value) {
  const collaboration = value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};
  const legacyCollections = Object.keys(INITIAL_COLLABORATION)
    .filter(key => !['schemaVersion', 'rev', 'connections', 'trainingProfiles', 'gymProfiles', 'aiPlans', 'aiJobs', 'aiUsage'].includes(key));

  return {
    ...collaboration,
    schemaVersion: 2,
    rev: Number.isInteger(collaboration.rev) && collaboration.rev >= 0 ? collaboration.rev : 0,
    ...Object.fromEntries(legacyCollections.map(key => [key, Array.isArray(collaboration[key]) ? collaboration[key] : []])),
    connections: (Array.isArray(collaboration.connections) ? collaboration.connections : []).map(normalizeConnection),
    trainingProfiles: onePerStudent(collaboration.trainingProfiles, normalizeTrainingProfile),
    gymProfiles: onePerStudent(collaboration.gymProfiles, normalizeGymProfile),
    aiPlans: retainedPlans(collaboration.aiPlans),
    aiJobs: (Array.isArray(collaboration.aiJobs) ? collaboration.aiJobs : []).map(normalizeAiJob).filter(Boolean).slice(-2000),
    aiUsage: (Array.isArray(collaboration.aiUsage) ? collaboration.aiUsage : []).map(normalizeAiUsage).filter(Boolean).slice(-2000)
  };
}
