import crypto from 'node:crypto';
import path from 'node:path';
import { createJsonStore, RevisionConflictError } from './lib/json-store.js';
import { INITIAL_COLLABORATION, migrateCollaboration } from './domain/schema.js';
const DEFAULT_GRANTS = {
  plansWrite: false,
  workoutsRead: false,
  progressRead: false,
  measurementsWrite: false,
  liveActivityRead: false,
  trainingProfileWrite: false,
  aiPlanRead: false
};
const ACTION_GRANT = {
  'plans:write': 'plansWrite',
  'workouts:read': 'workoutsRead',
  'progress:read': 'progressRead',
  'measurements:write': 'measurementsWrite',
  'liveActivity:read': 'liveActivityRead',
  'training-profile:write': 'trainingProfileWrite',
  'ai-plan:read': 'aiPlanRead'
};
const RELATIONSHIP_ACTION = 'relationship:manage';
const ACTIVE_APPOINTMENT = new Set(['scheduled', 'confirmed']);
const COMMON_BODY = 32 * 1024;
const PROGRAM_BODY = 256 * 1024;
const DEFAULT_AVAILABILITY = [
  ...[1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '06:00', end: '21:00', slotMinutes: 60 })),
  { weekday: 6, start: '07:00', end: '13:00', slotMinutes: 60 }
];
const isoDate = value => String(value || '').slice(0, 10);
const text = (value, max = 160) => String(value || '').trim().slice(0, max);
const money = value => {
  if (!Number.isSafeInteger(value) || value <= 0) throw fail('invalid amount');
  return value;
};
const fail = (message, status = 400) => {
  const error = new Error(message);
  error.expose = true;
  error.status = status;
  return error;
};
const isDate = value => {
  const source = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return false;
  const [year, month, day] = source.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === source;
};
const isMonth = value => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
};
const isInstant = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  isDate(value.slice(0, 10)) && Number.isFinite(new Date(value).getTime());
const boundedInteger = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
};
const explicitGrants = grants => Object.fromEntries(
  Object.keys(DEFAULT_GRANTS).map(key => [key, grants?.[key] === true])
);
const projectConnection = connection => ({ ...connection, grants: explicitGrants(connection.grants) });
const requireText = (value, name, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(`invalid ${name}`);
  return value.trim();
};
const requireStringList = (value, name, maxItems, maxLength = 100) => {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || !item.trim() || item.length > maxLength)) {
    throw fail(`invalid ${name}`);
  }
  return [...new Set(value.map(item => item.trim()))];
};
function trainingProfilePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('invalid training profile');
  if (!['under14', '14to17', 'adult'].includes(data.ageBand)) throw fail('invalid age band');
  if (!Number.isInteger(data.heightCm) || data.heightCm < 80 || data.heightCm > 250) throw fail('invalid height');
  if (!['iniciante', 'intermediario', 'avancado'].includes(data.experience)) throw fail('invalid experience');
  if (!Array.isArray(data.availableDays) || data.availableDays.length > 7 || data.availableDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw fail('invalid available days');
  }
  if (!Number.isInteger(data.minutesPerSession) || data.minutesPerSession < 15 || data.minutesPerSession > 180) throw fail('invalid session duration');
  if (typeof data.acuteRisk !== 'boolean' || typeof data.medicalRestriction !== 'boolean' || typeof data.consent !== 'boolean') {
    throw fail('invalid consent');
  }
  if (data.guardianConsent !== null && typeof data.guardianConsent !== 'boolean') throw fail('invalid guardian consent');
  return {
    ageBand: data.ageBand,
    heightCm: data.heightCm,
    goal: requireText(data.goal, 'goal', 160, true),
    experience: data.experience,
    availableDays: [...new Set(data.availableDays)].sort((a, b) => a - b),
    minutesPerSession: data.minutesPerSession,
    focusAreas: requireStringList(data.focusAreas, 'focus areas', 12, 60),
    favoriteExerciseIds: requireStringList(data.favoriteExerciseIds, 'favorite exercises', 60),
    avoidedExerciseIds: requireStringList(data.avoidedExerciseIds, 'avoided exercises', 60),
    limitations: requireText(data.limitations, 'limitations', 1000),
    acuteRisk: data.acuteRisk,
    medicalRestriction: data.medicalRestriction,
    consent: data.consent,
    guardianConsent: data.guardianConsent
  };
}
function gymProfilePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('invalid gym profile');
  if (!Array.isArray(data.specificMachines) || data.specificMachines.length > 40) throw fail('invalid specific machines');
  return {
    name: requireText(data.name, 'gym name', 120, true),
    genericEquipment: requireStringList(data.genericEquipment, 'generic equipment', 60),
    specificMachines: data.specificMachines.map(machine => {
      if (!machine || typeof machine !== 'object' || Array.isArray(machine)) throw fail('invalid specific machine');
      return {
        name: requireText(machine.name, 'machine name', 100, true),
        category: requireText(machine.category, 'machine category', 80),
        exerciseIds: requireStringList(machine.exerciseIds, 'machine exercises', 60)
      };
    })
  };
}
const projectTrainingProfile = profile => profile ? {
  studentId: profile.studentId,
  ageBand: profile.ageBand,
  heightCm: profile.heightCm,
  goal: profile.goal,
  experience: profile.experience,
  availableDays: [...profile.availableDays],
  minutesPerSession: profile.minutesPerSession,
  focusAreas: [...profile.focusAreas],
  favoriteExerciseIds: [...profile.favoriteExerciseIds],
  avoidedExerciseIds: [...profile.avoidedExerciseIds],
  limitations: profile.limitations,
  acuteRisk: profile.acuteRisk,
  medicalRestriction: profile.medicalRestriction,
  consent: profile.consent,
  guardianConsent: profile.guardianConsent,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt
} : null;
const projectGymProfile = gym => gym ? {
  studentId: gym.studentId,
  name: gym.name,
  genericEquipment: [...gym.genericEquipment],
  specificMachines: gym.specificMachines.map(machine => ({ ...machine, exerciseIds: [...machine.exerciseIds] })),
  createdAt: gym.createdAt,
  updatedAt: gym.updatedAt
} : null;
const projectAiPlan = plan => plan ? {
  id: plan.id,
  studentId: plan.studentId,
  version: plan.version,
  provider: plan.provider,
  model: plan.model,
  contextHash: plan.contextHash,
  justification: plan.justification,
  routines: structuredClone(plan.routines || []),
  schedule: structuredClone(plan.schedule || {}),
  source: plan.source,
  status: plan.status,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
  appliedAt: plan.appliedAt || null
} : null;
const projectAiJob = job => job ? {
  id: job.id,
  status: job.status,
  stage: job.stage,
  publicError: job.publicError || null,
  contextHash: job.contextHash,
  planVersion: job.planVersion || null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt
} : null;
function appendAudit(collaboration, entry) {
  return {
    ...collaboration,
    audit: [...collaboration.audit, { id: entry.id, actorId: entry.actorId, action: entry.action, entity: entry.entity, entityId: entry.entityId, clientId: entry.clientId || null, createdAt: entry.now }]
  };
}
function notify(collaboration, randomId, userId, title, body, resourceId, now) {
  if (!userId) return collaboration;
  return {
    ...collaboration,
    notifications: [...collaboration.notifications, { id: randomId(), userId, type: 'personal', title, body, resourceId, createdAt: now, readAt: null }]
  };
}
export { INITIAL_COLLABORATION };
export function createCollaborationStore(dataDir) {
  return createJsonStore({
    file: path.join(dataDir, 'collaboration.json'),
    initial: INITIAL_COLLABORATION,
    migrate: migrateCollaboration
  });
}
export function ensureProfile({ collaboration, userId, roles = [], name, now, randomId, randomShareCode = randomId }) {
  const existing = collaboration.profiles.find(profile => profile.userId === userId);
  const nextRoles = [...new Set(['student', ...(existing?.roles || []), ...roles])].filter(role => role === 'student' || role === 'trainer');
  const shareCodeExpired = !/^[A-F0-9]{32}$/.test(existing?.shareCode || '') ||
    !Number.isFinite(new Date(existing.shareCodeExpiresAt).getTime()) ||
    new Date(existing.shareCodeExpiresAt).getTime() <= new Date(now).getTime();
  const profile = {
    userId,
    roles: nextRoles,
    name: text(name || existing?.name || '', 60),
    shareCode: shareCodeExpired ? randomShareCode().toUpperCase() : existing.shareCode,
    shareCodeExpiresAt: shareCodeExpired ? new Date(new Date(now).getTime() + 30 * 86400000).toISOString() : existing.shareCodeExpiresAt,
    timezone: existing?.timezone || 'America/Fortaleza',
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  return {
    profile,
    collaboration: {
      ...collaboration,
      profiles: existing
        ? collaboration.profiles.map(item => item.userId === userId ? profile : item)
        : [...collaboration.profiles, profile]
    }
  };
}
function clientFor(collaboration, clientId) {
  const client = collaboration.clients.find(item => item.id === clientId && !item.archivedAt);
  if (!client) throw fail('client not found', 404);
  return client;
}
function activeConnection(collaboration, client) {
  if (!client.studentUserId) return null;
  return collaboration.connections.find(item =>
    item.status === 'active' &&
    item.studentId === client.studentUserId &&
    item.trainerId === client.trainerId
  ) || null;
}
export function authorize({ collaboration, actorId, client, action }) {
  if (!actorId || !client) return false;
  if (client.trainerId === actorId && !client.studentUserId) return true;
  if (client.studentUserId === actorId && ['workouts:read', 'progress:read'].includes(action)) return true;
  const connection = activeConnection(collaboration, client);
  if (action === RELATIONSHIP_ACTION) return !!(connection && connection.trainerId === actorId);
  const grant = ACTION_GRANT[action];
  return !!(connection && connection.trainerId === actorId && grant && connection.grants?.[grant] === true);
}
function requireTrainerAccess(collaboration, actorId, clientId, action = RELATIONSHIP_ACTION, hideForeign = true) {
  const client = clientFor(collaboration, clientId);
  if (client.trainerId !== actorId) throw fail(hideForeign ? 'client not found' : 'forbidden', hideForeign ? 404 : 403);
  if (!authorize({ collaboration, actorId, client, action })) throw fail('forbidden', 403);
  return client;
}
export function requestConnection({ collaboration, actorId, actorRole, shareCode, grants = {}, now, randomId }) {
  const actor = collaboration.profiles.find(profile => profile.userId === actorId);
  if (!['student', 'trainer'].includes(actorRole) || !actor?.roles?.includes(actorRole)) throw fail('actor role required');
  const counterpartRole = actorRole === 'student' ? 'trainer' : 'student';
  const code = text(shareCode, 80).toUpperCase();
  const target = collaboration.profiles.find(profile =>
    /^[A-F0-9]{32}$/.test(profile.shareCode || '') &&
    profile.shareCode === code &&
    new Date(profile.shareCodeExpiresAt).getTime() > new Date(now).getTime() &&
    profile.roles?.includes(counterpartRole)
  );
  if (!target || target.userId === actorId) throw fail('invalid share code');
  const actorIsTrainer = actorRole === 'trainer';
  const studentId = actorIsTrainer ? target.userId : actorId;
  const trainerId = actorIsTrainer ? actorId : target.userId;
  if (collaboration.connections.some(item => item.studentId === studentId && item.status === 'active')) throw fail('student already linked');
  const connection = {
    id: randomId(),
    studentId,
    trainerId,
    requestedBy: actorId,
    status: 'pending',
    grants: explicitGrants(actorIsTrainer ? {} : grants),
    createdAt: now,
    respondedAt: null,
    endedAt: null
  };
  let next = { ...collaboration, connections: [...collaboration.connections, connection] };
  next = notify(next, randomId, actorId === studentId ? trainerId : studentId, 'Solicitação de vínculo', 'Um novo vínculo com Personal aguarda resposta.', connection.id, now);
  return { collaboration: next, connection };
}
export function respondConnection({ collaboration, actorId, connectionId, accept, grants = {}, now, randomId }) {
  const connection = collaboration.connections.find(item => item.id === connectionId && item.status === 'pending');
  if (!connection) throw fail('connection not found', 404);
  const participants = [connection.studentId, connection.trainerId];
  if (!participants.includes(actorId)) throw fail('forbidden', 403);
  if (!participants.includes(connection.requestedBy)) throw fail('invalid connection state', 409);
  if (connection.requestedBy === actorId) throw fail('forbidden', 403);
  if (accept && collaboration.connections.some(item =>
    item.id !== connection.id && item.studentId === connection.studentId && item.status === 'active'
  )) throw fail('student already linked', 409);
  const merged = actorId === connection.studentId
    ? explicitGrants(grants)
    : explicitGrants(connection.grants);
  const status = accept ? 'active' : 'ended';
  let nextConnection = { ...connection, status, grants: merged, respondedAt: now, endedAt: accept ? null : now };
  let clients = collaboration.clients;
  if (accept) {
    const existing = clients.find(item => item.trainerId === connection.trainerId && item.studentUserId === connection.studentId);
    const studentProfile = collaboration.profiles.find(item => item.userId === connection.studentId);
    const client = {
      ...(existing || {}),
      id: existing?.id || randomId(),
      trainerId: connection.trainerId,
      studentUserId: connection.studentId,
      name: existing?.name || studentProfile?.name || 'Aluno First',
      goal: existing?.goal || '',
      phone: existing?.phone || '',
      notes: existing?.notes || '',
      targetSessionsPerWeek: existing?.targetSessionsPerWeek || 3,
      inactiveAfterDays: existing?.inactiveAfterDays || 7,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      archivedAt: null
    };
    clients = existing ? clients.map(item => item.id === existing.id ? client : item) : [...clients, client];
  }
  let next = { ...collaboration, clients, connections: collaboration.connections.map(item => item.id === connection.id ? nextConnection : item) };
  next = notify(next, randomId, actorId === connection.studentId ? connection.trainerId : connection.studentId, accept ? 'Vínculo aceito' : 'Vínculo recusado', accept ? 'O aluno agora aparece no painel do Personal.' : 'A solicitação foi encerrada.', connection.id, now);
  return { collaboration: next, connection: nextConnection };
}
export function endConnection({ collaboration, actorId, connectionId, now, randomId }) {
  const connection = collaboration.connections.find(item => item.id === connectionId && item.status === 'active');
  if (!connection) throw fail('connection not found', 404);
  if (![connection.studentId, connection.trainerId].includes(actorId)) throw fail('forbidden', 403);
  const nextConnection = { ...connection, status: 'ended', endedAt: now };
  let next = { ...collaboration, connections: collaboration.connections.map(item => item.id === connection.id ? nextConnection : item) };
  next = notify(next, randomId, actorId === connection.studentId ? connection.trainerId : connection.studentId, 'Vínculo encerrado', 'As permissões compartilhadas foram revogadas.', connection.id, now);
  return { collaboration: next, connection: nextConnection };
}
export function updateConnectionGrants({ collaboration, actorId, connectionId, grants, now, randomId }) {
  const connection = collaboration.connections.find(item => item.id === connectionId && item.status === 'active');
  if (!connection) throw fail('connection not found', 404);
  if (connection.studentId !== actorId) throw fail('forbidden', 403);
  const nextConnection = { ...connection, grants: explicitGrants(grants), grantsUpdatedAt: now };
  let next = {
    ...collaboration,
    connections: collaboration.connections.map(item => item.id === connection.id ? nextConnection : item)
  };
  next = appendAudit(next, {
    id: randomId(), actorId, action: 'connection.grants.update', entity: 'connection',
    entityId: connection.id, now
  });
  return { collaboration: next, connection: nextConnection };
}
export function createClient({ collaboration, trainerId, data, now, randomId }) {
  const name = text(data.name, 80);
  if (!name) throw fail('name required');
  const client = {
    id: randomId(),
    trainerId,
    studentUserId: null,
    name,
    goal: text(data.goal, 160),
    phone: text(data.phone, 40),
    notes: text(data.notes, 600),
    targetSessionsPerWeek: Math.max(1, Math.min(14, Math.round(Number(data.targetSessionsPerWeek) || 3))),
    inactiveAfterDays: Math.max(1, Math.min(90, Math.round(Number(data.inactiveAfterDays) || 7))),
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  };
  let next = { ...collaboration, clients: [...collaboration.clients, client] };
  next = appendAudit(next, { id: randomId(), actorId: trainerId, action: 'client.create', entity: 'client', entityId: client.id, clientId: client.id, now });
  return { collaboration: next, client };
}
export function updateClient({ collaboration, actorId, clientId, data, now, randomId }) {
  const client = requireTrainerAccess(collaboration, actorId, clientId);
  const updated = {
    ...client,
    name: text(data.name || client.name, 80),
    goal: text(data.goal ?? client.goal, 160),
    phone: text(data.phone ?? client.phone, 40),
    notes: text(data.notes ?? client.notes, 600),
    targetSessionsPerWeek: Math.max(1, Math.min(14, Math.round(Number(data.targetSessionsPerWeek ?? client.targetSessionsPerWeek) || 3))),
    inactiveAfterDays: Math.max(1, Math.min(90, Math.round(Number(data.inactiveAfterDays ?? client.inactiveAfterDays) || 7))),
    updatedAt: now
  };
  let next = { ...collaboration, clients: collaboration.clients.map(item => item.id === clientId ? updated : item) };
  next = appendAudit(next, { id: randomId(), actorId, action: 'client.update', entity: 'client', entityId: clientId, clientId, now });
  return { collaboration: next, client: updated };
}
function normalizeProgram(data) {
  const seen = new Set();
  const routines = (Array.isArray(data.routines) ? data.routines : []).slice(0, 12).map((routine, index) => {
    const candidate = text(routine?.id || `routine-${index + 1}`, 80);
    const id = seen.has(candidate) ? `${candidate}-${index + 1}`.slice(0, 80) : candidate;
    seen.add(id);
    return {
      id,
      name: text(routine?.name || `Rotina ${index + 1}`, 80),
      ex: (Array.isArray(routine?.ex) ? routine.ex : []).slice(0, 30).flatMap(exercise => {
        const exerciseId = text(exercise?.id, 100);
        if (!exerciseId) return [];
        return [{
          id: exerciseId,
          sets: boundedInteger(exercise.sets, 1, 20, 3),
          reps: text(exercise.reps, 30),
          rest: boundedInteger(exercise.rest, 0, 1800, 60),
          note: text(exercise.note, 240)
        }];
      })
    };
  });
  const routineIds = new Set(routines.map(item => item.id));
  const week = Object.fromEntries(Object.entries(data.week && typeof data.week === 'object' && !Array.isArray(data.week) ? data.week : {})
    .filter(([weekday, routineId]) => /^[0-6]$/.test(weekday) && typeof routineId === 'string' && routineIds.has(routineId))
    .map(([weekday, routineId]) => [weekday, routineId]));
  return { routines, week };
}
export function saveProgram({ collaboration, actorId, clientId, data, now, randomId }) {
  const client = requireTrainerAccess(collaboration, actorId, clientId, 'plans:write');
  const existing = collaboration.programs.find(item => item.id === data.id && item.clientId === clientId) ||
    collaboration.programs.find(item => item.clientId === clientId && item.trainerId === actorId);
  const version = (existing?.version || 0) + 1;
  const { routines, week } = normalizeProgram(data);
  const versions = [...(existing?.versions || []), { version, routines, week, publishedAt: now, publishedBy: actorId }].slice(-20);
  const program = {
    id: existing?.id || randomId(),
    trainerId: actorId,
    clientId,
    name: text(data.name || existing?.name || 'Treino do Personal', 90),
    version,
    status: 'published',
    routines,
    week,
    versions,
    publishedAt: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  let next = {
    ...collaboration,
    programs: existing ? collaboration.programs.map(item => item.id === existing.id ? program : item) : [...collaboration.programs, program]
  };
  next = appendAudit(next, { id: randomId(), actorId, action: 'program.publish', entity: 'program', entityId: program.id, clientId, now });
  next = notify(next, randomId, client.studentUserId, existing ? 'Treino atualizado' : 'Treino publicado', existing ? 'Seu Personal atualizou seu treino.' : 'Seu Personal publicou um novo treino para você.', program.id, now);
  return { collaboration: next, program };
}
function normalizeMeasurement(data, now) {
  const kind = text(data.kind, 40);
  if (!['weight', 'waist', 'chest', 'hip', 'neck', 'arm', 'thigh', 'calf', 'bodyFat'].includes(kind)) throw fail('invalid measurement');
  const side = ['arm', 'thigh', 'calf'].includes(kind) ? (['left', 'right'].includes(data.side) ? data.side : null) : null;
  const observedAt = isoDate(data.observedAt || now);
  if (!isDate(observedAt) || observedAt > isoDate(now)) throw fail('invalid date');
  let value = Number(data.value);
  if (!Number.isFinite(value)) throw fail('invalid measurement');
  let unit = kind === 'weight' ? 'kg' : kind === 'bodyFat' ? '%' : 'cm';
  if (kind === 'weight' && data.unit === 'lb') value *= 0.45359237;
  if (!['weight', 'bodyFat'].includes(kind) && data.unit === 'in') value *= 2.54;
  value = Math.round(value * 10) / 10;
  const range = kind === 'weight' ? [20, 350] : kind === 'bodyFat' ? [1, 75] : [10, 250];
  if (value < range[0] || value > range[1]) throw fail('invalid measurement');
  return { kind, side, value, unit, observedAt };
}
export function recordMeasurement({ collaboration, actorId, clientId, data, now, randomId }) {
  const client = requireTrainerAccess(collaboration, actorId, clientId, 'measurements:write');
  if (client.studentUserId && client.trainerId !== actorId && !authorize({ collaboration, actorId, client, action: 'measurements:write' })) throw fail('forbidden');
  const measurement = {
    id: randomId(),
    clientId,
    studentUserId: client.studentUserId,
    ...normalizeMeasurement(data, now),
    recordedBy: actorId,
    createdAt: now,
    correctedAt: null
  };
  let next = { ...collaboration, measurements: [...collaboration.measurements, measurement] };
  next = appendAudit(next, { id: randomId(), actorId, action: 'measurement.record', entity: 'measurement', entityId: measurement.id, clientId, now });
  return { collaboration: next, measurement };
}
export function saveTrainingProfile({ collaboration, actorId, studentId, clientId, data, now, randomId }) {
  if (typeof studentId !== 'string' || !studentId || studentId.length > 100) throw fail('client not found', 404);
  if (actorId !== studentId) {
    const client = requireTrainerAccess(collaboration, actorId, clientId, 'training-profile:write');
    if (client.studentUserId !== studentId) throw fail('client not found', 404);
  }
  const existing = collaboration.trainingProfiles.find(item => item.studentId === studentId);
  const profile = {
    studentId,
    ...trainingProfilePayload(data),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  let next = {
    ...collaboration,
    trainingProfiles: existing
      ? collaboration.trainingProfiles.map(item => item.studentId === studentId ? profile : item)
      : [...collaboration.trainingProfiles, profile]
  };
  next = appendAudit(next, {
    id: randomId(), actorId, action: 'training-profile.update', entity: 'trainingProfile',
    entityId: studentId, clientId, now
  });
  if (actorId !== studentId) {
    next = notify(next, randomId, studentId, 'Perfil de treino atualizado', 'Seu Personal atualizou seu perfil de treino.', studentId, now);
  }
  return { collaboration: next, profile };
}
export function saveGymProfile({ collaboration, actorId, studentId, clientId, data, now, randomId }) {
  if (typeof studentId !== 'string' || !studentId || studentId.length > 100) throw fail('client not found', 404);
  if (actorId !== studentId) {
    const client = requireTrainerAccess(collaboration, actorId, clientId, 'training-profile:write');
    if (client.studentUserId !== studentId) throw fail('client not found', 404);
  }
  const existing = collaboration.gymProfiles.find(item => item.studentId === studentId);
  const gym = {
    studentId,
    ...gymProfilePayload(data),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  let next = {
    ...collaboration,
    gymProfiles: existing
      ? collaboration.gymProfiles.map(item => item.studentId === studentId ? gym : item)
      : [...collaboration.gymProfiles, gym]
  };
  next = appendAudit(next, {
    id: randomId(), actorId, action: 'gym-profile.update', entity: 'gymProfile',
    entityId: studentId, clientId, now
  });
  if (actorId !== studentId) {
    next = notify(next, randomId, studentId, 'Academia atualizada', 'Seu Personal atualizou os equipamentos da sua academia.', studentId, now);
  }
  return { collaboration: next, gym };
}
export function recordStudentMeasurement({ collaboration, studentId, data, now, randomId }) {
  const client = collaboration.clients.find(item => item.studentUserId === studentId && activeConnection(collaboration, item));
  const measurement = {
    id: randomId(),
    clientId: client?.id || null,
    studentUserId: studentId,
    ...normalizeMeasurement(data, now),
    recordedBy: studentId,
    createdAt: now,
    correctedAt: null
  };
  let next = { ...collaboration, measurements: [...collaboration.measurements, measurement] };
  next = appendAudit(next, {
    id: randomId(), actorId: studentId, action: 'measurement.record', entity: 'measurement',
    entityId: measurement.id, clientId: client?.id || null, now
  });
  return { collaboration: next, measurement };
}
function latestByVersion(values) {
  return values.slice().sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0) ||
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0] || null;
}
function currentMeasurements(collaboration, studentId) {
  const clientIds = new Set(collaboration.clients.filter(item => item.studentUserId === studentId).map(item => item.id));
  const measurements = collaboration.measurements.filter(item =>
    item.studentUserId === studentId || (item.studentUserId == null && clientIds.has(item.clientId))
  ).slice().sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)) ||
    String(b.createdAt).localeCompare(String(a.createdAt)));
  const result = {};
  for (const measurement of measurements) {
    const key = measurement.side ? `${measurement.kind}:${measurement.side}` : measurement.kind;
    if (!(key in result)) result[key] = { ...measurement };
  }
  return result;
}
function contextCompleteness(profile, gym, measurements) {
  const missing = [];
  if (!profile) missing.push('profile');
  else {
    if (!profile.heightCm) missing.push('heightCm');
    if (!profile.goal) missing.push('goal');
    if (!profile.availableDays?.length) missing.push('availableDays');
    if (!profile.minutesPerSession) missing.push('minutesPerSession');
    if (!profile.consent) missing.push('consent');
    if (profile.ageBand !== 'adult' && profile.guardianConsent !== true) missing.push('guardianConsent');
  }
  if (!gym) missing.push('gym');
  else {
    if (!gym.name) missing.push('gymName');
    const hasSpecificExercise = gym.specificMachines?.some(machine => machine.exerciseIds?.length);
    if (!gym.genericEquipment?.length && !hasSpecificExercise) missing.push('equipment');
  }
  if (!measurements.weight) missing.push('weight');
  const blockers = [
    ...(profile?.acuteRisk ? ['acuteRisk'] : []),
    ...(profile?.medicalRestriction ? ['medicalRestriction'] : [])
  ];
  return {
    eligible: missing.length === 0 && blockers.length === 0,
    missing,
    blockers,
    conservative: profile?.ageBand === 'under14'
  };
}
export function buildAiContext({ collaboration, studentId }) {
  const profile = projectTrainingProfile(collaboration.trainingProfiles.find(item => item.studentId === studentId));
  const gym = projectGymProfile(collaboration.gymProfiles.find(item => item.studentId === studentId));
  const measurements = currentMeasurements(collaboration, studentId);
  const plan = latestByVersion(collaboration.aiPlans.filter(item => item.studentId === studentId && item.status === 'applied'));
  const job = collaboration.aiJobs.filter(item => item.studentId === studentId).slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0] || null;
  return {
    rev: collaboration.rev,
    profile,
    gym,
    measurements,
    completeness: contextCompleteness(profile, gym, measurements),
    plan: projectAiPlan(plan),
    job: projectAiJob(job)
  };
}
export function buildAiGenerationStatus({ collaboration, studentId, provider, configured }) {
  const context = buildAiContext({ collaboration, studentId });
  const providerReady = configured === true && !!provider;
  return {
    configured: providerReady,
    eligible: providerReady && context.completeness.eligible,
    missing: [...context.completeness.missing],
    blockers: [...context.completeness.blockers],
    conservative: context.completeness.conservative,
    provider: provider ? { provider: provider.provider, selectedModel: provider.selectedModel } : null
  };
}
export function notifyAiPlanApplied({ collaboration, studentId, planId, now, randomId }) {
  return collaboration.connections
    .filter(item => item.studentId === studentId && item.status === 'active' && item.grants?.aiPlanRead === true)
    .reduce((next, connection) => notify(
      next, randomId, connection.trainerId, 'Novo treino IA aplicado',
      'O aluno aplicou uma nova versao de treino gerada por IA.', planId, now
    ), collaboration);
}
function timezoneFor(collaboration, trainerId) {
  const timezone = collaboration.profiles.find(item => item.userId === trainerId)?.timezone || 'America/Fortaleza';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'America/Fortaleza';
  }
}
function zonedParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(value));
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}
function localDate(value, timezone) {
  const parts = zonedParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function zonedInstant(dayIso, hhmm, timezone) {
  if (!isDate(dayIso) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw fail('invalid availability');
  const [year, month, day] = dayIso.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(guess, timezone);
    const observed = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    guess += target - observed;
  }
  const result = zonedParts(guess, timezone);
  if (result.year !== year || result.month !== month || result.day !== day || result.hour !== hour || result.minute !== minute) {
    throw fail('invalid availability');
  }
  return new Date(guess);
}

function availabilityFor(collaboration, trainerId) {
  const saved = collaboration.availability.filter(item => item.trainerId === trainerId);
  return saved.length ? saved : DEFAULT_AVAILABILITY.map(item => ({ trainerId, ...item }));
}

function normalizeAvailability(entries, trainerId) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 14) throw fail('invalid availability');
  const normalized = entries.map(entry => {
    const weekday = Number(entry?.weekday);
    const slotMinutes = Number(entry?.slotMinutes);
    const start = String(entry?.start || '');
    const end = String(entry?.end || '');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
        start >= end || !Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 240) {
      throw fail('invalid availability');
    }
    return { trainerId, weekday, start, end, slotMinutes };
  }).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  if (normalized.some((entry, index) => index > 0 && normalized[index - 1].weekday === entry.weekday && normalized[index - 1].end > entry.start)) {
    throw fail('invalid availability');
  }
  return normalized;
}

export function saveAvailability({ collaboration, actorId, data, now, randomId }) {
  const availability = normalizeAvailability(data.availability, actorId);
  let next = {
    ...collaboration,
    availability: [...collaboration.availability.filter(item => item.trainerId !== actorId), ...availability]
  };
  next = appendAudit(next, { id: randomId(), actorId, action: 'availability.update', entity: 'availability', entityId: actorId, now });
  return { collaboration: next, availability };
}

function availabilityWindows(collaboration, trainerId, dayIso) {
  const timezone = timezoneFor(collaboration, trainerId);
  const weekday = new Date(`${dayIso}T12:00:00.000Z`).getUTCDay();
  return availabilityFor(collaboration, trainerId).filter(item => item.weekday === weekday).map(item => ({
    ...item,
    from: zonedInstant(dayIso, item.start, timezone),
    to: zonedInstant(dayIso, item.end, timezone)
  }));
}

function withinAvailability(collaboration, trainerId, startsAt, endsAt) {
  const timezone = timezoneFor(collaboration, trainerId);
  return availabilityWindows(collaboration, trainerId, localDate(startsAt, timezone))
    .some(window => startsAt >= window.from && endsAt <= window.to);
}

export function saveAppointment({ collaboration, actorId, clientId, data, now, randomId, create = !data.id }) {
  const client = requireTrainerAccess(collaboration, actorId, clientId);
  if (!isInstant(data.startsAt) || !isInstant(data.endsAt)) throw fail('invalid appointment');
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw fail('invalid appointment');
  if (!create && !text(data.id, 100)) throw fail('appointment id required');
  const existing = create ? null : collaboration.appointments.find(item =>
    item.id === data.id && item.trainerId === actorId && item.clientId === clientId
  );
  if (!create && !existing) throw fail('appointment not found', 404);
  const id = create ? randomId() : existing.id;
  const status = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(data.status) ? data.status : 'scheduled';
  if (ACTIVE_APPOINTMENT.has(status) && !withinAvailability(collaboration, client.trainerId, startsAt, endsAt)) throw fail('outside availability');
  const conflict = ACTIVE_APPOINTMENT.has(status) && collaboration.appointments.some(item =>
    item.id !== id &&
    item.trainerId === client.trainerId &&
    ACTIVE_APPOINTMENT.has(item.status) &&
    new Date(item.startsAt) < endsAt &&
    new Date(item.endsAt) > startsAt
  );
  if (conflict) throw fail('schedule conflict');
  const appointment = {
    id,
    trainerId: client.trainerId,
    clientId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    status,
    note: text(data.note, 240),
    createdBy: existing?.createdBy || actorId,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  let next = { ...collaboration, appointments: existing ? collaboration.appointments.map(item => item.id === id ? appointment : item) : [...collaboration.appointments, appointment] };
  next = appendAudit(next, { id: randomId(), actorId, action: 'appointment.save', entity: 'appointment', entityId: appointment.id, clientId, now });
  return { collaboration: next, appointment };
}

export function saveReceivable({ collaboration, actorId, clientId, data, now, randomId, create = !data.id, hideForeign = false }) {
  const client = requireTrainerAccess(collaboration, actorId, clientId, RELATIONSHIP_ACTION, hideForeign);
  if (!create && !text(data.id, 100)) throw fail('receivable id required');
  const existing = create ? null : collaboration.receivables.find(item =>
    item.id === data.id && item.trainerId === actorId && item.clientId === clientId
  );
  if (!create && !existing) throw fail('receivable not found', 404);
  const id = create ? randomId() : existing.id;
  const period = text(data.period ?? existing?.period, 7);
  const dueOn = isoDate(data.dueOn ?? existing?.dueOn);
  if (!isMonth(period) || !isDate(dueOn)) throw fail('invalid receivable');
  if (collaboration.receivables.some(item => item.id !== id && item.trainerId === actorId && item.clientId === clientId && item.period === period)) {
    throw fail('receivable already exists');
  }
  const status = ['open', 'paid', 'waived'].includes(data.status) ? data.status : existing?.status || 'open';
  const paidAtSource = data.paidAt ?? existing?.paidAt ?? now;
  if (status === 'paid' && !isInstant(paidAtSource)) throw fail('invalid paid date');
  const receivable = {
    id,
    trainerId: client.trainerId,
    clientId,
    period,
    dueOn,
    amountCents: money(data.amountCents ?? existing?.amountCents),
    currency: 'BRL',
    status,
    paidAt: status === 'paid' ? new Date(paidAtSource).toISOString() : null,
    paymentMethod: status === 'paid' ? text(data.paymentMethod ?? existing?.paymentMethod ?? 'manual', 40) : null,
    note: text(data.note ?? existing?.note, 240),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  let next = { ...collaboration, receivables: existing ? collaboration.receivables.map(item => item.id === id ? receivable : item) : [...collaboration.receivables, receivable] };
  next = appendAudit(next, { id: randomId(), actorId, action: 'receivable.save', entity: 'receivable', entityId: receivable.id, clientId, now });
  return { collaboration: next, receivable };
}

function summarizeProgress(client, state, now) {
  const workouts = Array.isArray(state?.workouts) ? state.workouts : [];
  const today = new Date(isoDate(now) + 'T12:00:00.000Z');
  const since = new Date(today);
  since.setDate(since.getDate() - 28);
  const recent = workouts.filter(workout => new Date(workout.d + 'T12:00:00.000Z') >= since);
  const target = Math.max(1, (client.targetSessionsPerWeek || 3) * 4);
  const adherenceDays = new Set(recent.map(workout => workout.d).filter(Boolean)).size;
  const adherence = Math.min(100, Math.round((adherenceDays / target) * 100));
  const last = workouts.slice().sort((a, b) => String(b.d).localeCompare(String(a.d)))[0] || null;
  return {
    adherence,
    workouts28d: recent.length,
    volume28d: Math.round(recent.reduce((sum, workout) => sum + (Number(workout.vol) || 0), 0)),
    lastActivity: last?.d || null,
    recentWorkouts: recent.slice(-8).reverse()
  };
}

function summarizeFinance(receivables, now) {
  const month = isoDate(now).slice(0, 7);
  const scoped = receivables.filter(item => item.period === month);
  return {
    expectedCents: scoped.reduce((sum, item) => sum + item.amountCents, 0),
    receivedCents: scoped.filter(item => item.status === 'paid').reduce((sum, item) => sum + item.amountCents, 0),
    openCents: scoped.filter(item => item.status === 'open').reduce((sum, item) => sum + item.amountCents, 0),
    overdueCents: receivables.filter(item => item.status === 'open' && item.dueOn < isoDate(now)).reduce((sum, item) => sum + item.amountCents, 0),
    months: Array.from({ length: 6 }, (_, index) => {
      const d = new Date(isoDate(now) + 'T12:00:00.000Z');
      d.setMonth(d.getMonth() - (5 - index));
      const period = d.toISOString().slice(0, 7);
      const rows = receivables.filter(item => item.period === period);
      return {
        period,
        expectedCents: rows.reduce((sum, item) => sum + item.amountCents, 0),
        receivedCents: rows.filter(item => item.status === 'paid').reduce((sum, item) => sum + item.amountCents, 0)
      };
    })
  };
}

function priorityFor({ client, progress, receivables, appointments, program, latestMeasurement, now }) {
  const reasons = [];
  if (receivables.some(item => item.status === 'open' && item.dueOn < isoDate(now))) reasons.push('Pagamento vencido');
  const next24 = new Date(new Date(now).getTime() + 86400000);
  if (!program && appointments.some(item => ACTIVE_APPOINTMENT.has(item.status) && new Date(item.startsAt) <= next24)) reasons.push('Aula nas proximas 24h sem treino publicado');
  if (progress?.lastActivity) {
    const days = (new Date(isoDate(now)) - new Date(progress.lastActivity)) / 86400000;
    if (days > (client.inactiveAfterDays || 7)) reasons.push('Aluno inativo');
  }
  if (reasons.length) return { priority: 'urgent', reasons };
  if (progress?.adherence < 70) reasons.push('Aderencia abaixo de 70%');
  if (!latestMeasurement) reasons.push('Medidas ainda não registradas');
  else if ((new Date(isoDate(now)) - new Date(isoDate(latestMeasurement.observedAt))) / 86400000 > 30) reasons.push('Medidas sem atualização há mais de 30 dias');
  if (receivables.some(item => item.status === 'open' && item.dueOn <= isoDate(new Date(new Date(now).getTime() + 3 * 86400000).toISOString()))) reasons.push('Cobranca a vencer');
  return reasons.length ? { priority: 'attention', reasons } : { priority: 'ok', reasons: ['Em dia'] };
}

function openSlotsFor(dayIso, appointments, collaboration, trainerId) {
  const slots = [];
  for (const window of availabilityWindows(collaboration, trainerId, dayIso)) {
    for (let from = window.from; from.getTime() + window.slotMinutes * 60000 <= window.to.getTime(); from = new Date(from.getTime() + window.slotMinutes * 60000)) {
      const to = new Date(from.getTime() + window.slotMinutes * 60000);
      const busy = appointments.some(item => ACTIVE_APPOINTMENT.has(item.status) && new Date(item.startsAt) < to && new Date(item.endsAt) > from);
      if (!busy) slots.push({ startsAt: from.toISOString(), endsAt: to.toISOString() });
    }
  }
  return slots;
}

export function buildWorkspace({ collaboration, trainerId, now, readState }) {
  const clients = collaboration.clients.filter(client =>
    client.trainerId === trainerId && !client.archivedAt && (!client.studentUserId || activeConnection(collaboration, client))
  );
  const appointments = collaboration.appointments.filter(item => item.trainerId === trainerId);
  const receivables = collaboration.receivables.filter(item => item.trainerId === trainerId);
  const timezone = timezoneFor(collaboration, trainerId);
  const today = localDate(now, timezone);
  const rows = clients.map(client => {
    const connection = activeConnection(collaboration, client);
    const workoutsRead = !client.studentUserId || connection?.grants?.workoutsRead === true;
    const progressRead = !client.studentUserId || connection?.grants?.progressRead === true;
    const trainingProfileWrite = !!client.studentUserId && connection?.grants?.trainingProfileWrite === true;
    const aiPlanRead = !!client.studentUserId && connection?.grants?.aiPlanRead === true;
    const studentState = client.studentUserId && (workoutsRead || progressRead) ? readState(client.studentUserId) : null;
    const fullProgress = summarizeProgress(client, studentState, now);
    const progress = !client.studentUserId ? fullProgress : {
      ...(progressRead ? {
        adherence: fullProgress.adherence,
        workouts28d: fullProgress.workouts28d,
        volume28d: fullProgress.volume28d,
        lastActivity: fullProgress.lastActivity
      } : {}),
      ...(workoutsRead ? { recentWorkouts: fullProgress.recentWorkouts } : {})
    };
    const clientReceivables = receivables.filter(item => item.clientId === client.id);
    const clientAppointments = appointments.filter(item => item.clientId === client.id);
    const program = collaboration.programs.find(item => item.clientId === client.id && item.status === 'published') || null;
    const latestMeasurement = collaboration.measurements.filter(item => item.clientId === client.id).slice().sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)))[0] || null;
    return {
      ...client,
      ...(client.studentUserId && !workoutsRead && !progressRead ? {} : { progress }),
      ...(trainingProfileWrite ? {
        trainingProfile: projectTrainingProfile(collaboration.trainingProfiles.find(item => item.studentId === client.studentUserId)),
        gymProfile: projectGymProfile(collaboration.gymProfiles.find(item => item.studentId === client.studentUserId))
      } : {}),
      ...(aiPlanRead ? {
        aiPlan: projectAiPlan(latestByVersion(collaboration.aiPlans.filter(item =>
          item.studentId === client.studentUserId && item.status === 'applied'
        )))
      } : {}),
      latestMeasurement,
      program,
      nextAppointment: clientAppointments.filter(item => ACTIVE_APPOINTMENT.has(item.status) && item.startsAt >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] || null,
      finance: summarizeFinance(clientReceivables, now),
      ...priorityFor({ client, progress: progressRead ? fullProgress : null, receivables: clientReceivables, appointments: clientAppointments, program, latestMeasurement, now })
    };
  }).sort((a, b) => ({ urgent: 0, attention: 1, ok: 2 }[a.priority] - { urgent: 0, attention: 1, ok: 2 }[b.priority] || a.name.localeCompare(b.name)));

  const todayAppointments = appointments
    .filter(item => localDate(item.startsAt, timezone) === today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map(item => ({ ...item, clientName: clients.find(client => client.id === item.clientId)?.name || 'Aluno' }));
  const finance = summarizeFinance(receivables, now);
  const openSlots = openSlotsFor(today, appointments, collaboration, trainerId);
  return {
    rev: collaboration.rev,
    kpis: {
      activeClients: clients.length,
      appointmentsToday: todayAppointments.filter(item => ACTIVE_APPOINTMENT.has(item.status)).length,
      appointments7d: appointments.filter(item => ACTIVE_APPOINTMENT.has(item.status) && item.startsAt >= now && item.startsAt < new Date(new Date(now).getTime() + 7 * 86400000).toISOString()).length,
      freeHoursToday: openSlots.reduce((hours, slot) => hours + (new Date(slot.endsAt) - new Date(slot.startsAt)) / 3600000, 0),
      averageAdherence: rows.length ? Math.round(rows.reduce((sum, item) => sum + (item.progress?.adherence || 0), 0) / rows.length) : 0,
      priorities: {
        urgent: rows.filter(item => item.priority === 'urgent').length,
        attention: rows.filter(item => item.priority === 'attention').length,
        ok: rows.filter(item => item.priority === 'ok').length
      }
    },
    finance,
    availability: availabilityFor(collaboration, trainerId),
    agenda: { today: todayAppointments, openSlots: openSlots.slice(0, 8) },
    clients: rows
  };
}

export function buildClientDetail({ collaboration, trainerId, clientId, now, readState }) {
  const workspace = buildWorkspace({ collaboration, trainerId, now, readState });
  const summary = workspace.clients.find(client => client.id === clientId);
  if (!summary) throw fail('client not found', 404);
  return {
    rev: collaboration.rev,
    client: summary,
    measurements: collaboration.measurements.filter(item => item.clientId === clientId).slice().sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt))),
    appointments: collaboration.appointments.filter(item => item.clientId === clientId).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    receivables: collaboration.receivables.filter(item => item.clientId === clientId).slice().sort((a, b) => b.period.localeCompare(a.period)),
    program: collaboration.programs.find(item => item.clientId === clientId && item.status === 'published') || null
  };
}
export function createPersonalRoutes({ dataDir, origin, readSession, readBody, json, readState, sendPush, store: providedStore }) {
  const randomId = () => crypto.randomBytes(16).toString('base64url');
  const randomShareCode = () => crypto.randomBytes(16).toString('hex').toUpperCase();
  const store = providedStore || createCollaborationStore(dataDir);
  const now = () => new Date().toISOString();
  const write = (req, body, reducer) => {
    const mobileClient = req.headers?.['x-first-client'] === 'capacitor';
    const trustedOrigin = req.headers?.origin === origin;
    if (process.env.NODE_ENV === 'production' && !trustedOrigin && !(mobileClient && !req.headers?.origin)) throw fail('invalid origin', 403);
    if (!Number.isInteger(body.rev)) throw fail('rev required');
    return store.update(body.rev, reducer);
  };
  const pushNotification = notification => {
    if (!notification || typeof sendPush !== 'function') return;
    try { Promise.resolve(sendPush(notification.userId, { title: notification.title, body: notification.body, tag: 'personal' })).catch(() => {}); }
    catch {}
  };
  const writeAndPush = (req, body, reducer) => {
    let notification;
    const result = write(req, body, state => {
      const next = reducer(state);
      if (next.notifications.length > state.notifications.length) notification = next.notifications.at(-1);
      return next;
    });
    pushNotification(notification);
    return result;
  };
  const withUser = async (req, res, handler) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try { await handler(user); }
    catch (error) {
      if (error instanceof RevisionConflictError) return json(res, 409, { error: 'stale revision', rev: store.read().rev });
      const status = error.expose && Number.isInteger(error.status) ? error.status : 500;
      json(res, status, { error: error.expose ? error.message : 'server error' });
    }
  };
  const ensure = user => {
    let collaboration = store.read();
    const profile = collaboration.profiles.find(item => item.userId === user.id);
    if (/^[A-F0-9]{32}$/.test(profile?.shareCode || '') && new Date(profile.shareCodeExpiresAt).getTime() > Date.now()) return collaboration;
    collaboration = store.update(collaboration.rev, state => ensureProfile({
      collaboration: state, userId: user.id, name: user.name, now: now(), randomId, randomShareCode
    }).collaboration);
    return collaboration;
  };
  const requireTrainer = user => {
    const collaboration = ensure(user);
    const profile = collaboration.profiles.find(item => item.userId === user.id);
    if (!profile?.roles?.includes('trainer')) throw fail('trainer role required', 403);
    return collaboration;
  };
  const trainerWorkspace = user => buildWorkspace({ collaboration: requireTrainer(user), trainerId: user.id, now: now(), readState });
  const readTrainerBody = async (user, req, max = COMMON_BODY) => {
    requireTrainer(user);
    return readBody(req, max);
  };
  return {
    'GET /api/collaboration': (req, res) => withUser(req, res, user => {
      const collaboration = ensure(user);
      const profile = collaboration.profiles.find(item => item.userId === user.id);
      const clientIds = new Set(collaboration.clients
        .filter(item => item.studentUserId === user.id && activeConnection(collaboration, item))
        .map(item => item.id));
      json(res, 200, {
        rev: collaboration.rev,
        profile,
        connections: collaboration.connections
          .filter(item => item.studentId === user.id || item.trainerId === user.id)
          .map(projectConnection),
        notifications: collaboration.notifications.filter(item => item.userId === user.id).slice(-40).reverse(),
        programs: collaboration.programs.filter(item => item.status === 'published' && clientIds.has(item.clientId))
      });
    }),
    'PUT /api/profile/roles': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const roles = Array.isArray(body.roles) ? body.roles : [];
      const collaboration = write(req, body, state => ensureProfile({
        collaboration: state, userId: user.id, name: user.name, roles, now: now(), randomId, randomShareCode
      }).collaboration);
      json(res, 200, { rev: collaboration.rev, profile: collaboration.profiles.find(item => item.userId === user.id) });
    }),
    'POST /api/connections/request': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const result = writeAndPush(req, body, state => requestConnection({ collaboration: state, actorId: user.id, actorRole: body.actorRole, shareCode: body.shareCode, grants: body.grants || {}, now: now(), randomId }).collaboration);
      json(res, 200, { rev: result.rev, connections: result.connections.filter(item => item.studentId === user.id || item.trainerId === user.id).map(projectConnection) });
    }),
    'POST /api/connections/respond': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const result = writeAndPush(req, body, state => respondConnection({ collaboration: state, actorId: user.id, connectionId: body.connectionId, accept: !!body.accept, grants: body.grants || {}, now: now(), randomId }).collaboration);
      json(res, 200, { rev: result.rev, connections: result.connections.filter(item => item.studentId === user.id || item.trainerId === user.id).map(projectConnection) });
    }),
    'POST /api/connections/end': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const result = writeAndPush(req, body, state => endConnection({ collaboration: state, actorId: user.id, connectionId: body.connectionId, now: now(), randomId }).collaboration);
      json(res, 200, { rev: result.rev });
    }),
    'PUT /api/connections/grants': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const result = write(req, body, state => updateConnectionGrants({
        collaboration: state, actorId: user.id, connectionId: body.connectionId,
        grants: body.grants || {}, now: now(), randomId
      }).collaboration);
      json(res, 200, {
        rev: result.rev,
        connection: projectConnection(result.connections.find(item => item.id === body.connectionId && item.studentId === user.id))
      });
    }),
    'POST /api/notifications/read': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const result = write(req, body, state => ({ ...state, notifications: state.notifications.map(item => item.userId === user.id ? { ...item, readAt: item.readAt || now() } : item) }));
      json(res, 200, { rev: result.rev });
    }),
    'GET /api/ai/context': (req, res) => withUser(req, res, user => {
      json(res, 200, buildAiContext({ collaboration: ensure(user), studentId: user.id }));
    }),
    'PUT /api/ai/profile': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const result = write(req, body, state => saveTrainingProfile({
        collaboration: state, actorId: user.id, studentId: user.id, clientId: null,
        data: body, now: now(), randomId
      }).collaboration);
      json(res, 200, {
        rev: result.rev,
        profile: projectTrainingProfile(result.trainingProfiles.find(item => item.studentId === user.id))
      });
    }),
    'PUT /api/ai/gym': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      const result = write(req, body, state => saveGymProfile({
        collaboration: state, actorId: user.id, studentId: user.id, clientId: null,
        data: body, now: now(), randomId
      }).collaboration);
      json(res, 200, {
        rev: result.rev,
        gym: projectGymProfile(result.gymProfiles.find(item => item.studentId === user.id))
      });
    }),
    'POST /api/ai/measurements': async (req, res) => withUser(req, res, async user => {
      const body = await readBody(req, COMMON_BODY);
      let measurement;
      const result = write(req, body, state => {
        const saved = recordStudentMeasurement({ collaboration: state, studentId: user.id, data: body, now: now(), randomId });
        measurement = saved.measurement;
        return saved.collaboration;
      });
      json(res, 200, { rev: result.rev, measurement });
    }),
    'GET /api/personal/workspace': (req, res) => withUser(req, res, user => json(res, 200, trainerWorkspace(user))),
    'GET /api/personal/client': (req, res) => withUser(req, res, user => {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      const collaboration = requireTrainer(user);
      json(res, 200, buildClientDetail({ collaboration, trainerId: user.id, clientId: id, now: now(), readState }));
    }),
    'POST /api/personal/clients': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => createClient({ collaboration: state, trainerId: user.id, data: body, now: now(), randomId }).collaboration);
      json(res, 200, buildWorkspace({ collaboration: result, trainerId: user.id, now: now(), readState }));
    }),
    'PUT /api/personal/client': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => updateClient({ collaboration: state, actorId: user.id, clientId: body.clientId, data: body, now: now(), randomId }).collaboration);
      json(res, 200, buildClientDetail({ collaboration: result, trainerId: user.id, clientId: body.clientId, now: now(), readState }));
    }),
    'PUT /api/personal/program': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req, PROGRAM_BODY);
      const result = writeAndPush(req, body, state => saveProgram({ collaboration: state, actorId: user.id, clientId: body.clientId, data: body, now: now(), randomId }).collaboration);
      json(res, 200, buildClientDetail({ collaboration: result, trainerId: user.id, clientId: body.clientId, now: now(), readState }));
    }),
    'PUT /api/personal/training-profile': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = writeAndPush(req, body, state => {
        const client = clientFor(state, body.clientId);
        return saveTrainingProfile({
          collaboration: state, actorId: user.id, studentId: client.studentUserId,
          clientId: body.clientId, data: body, now: now(), randomId
        }).collaboration;
      });
      json(res, 200, buildClientDetail({ collaboration: result, trainerId: user.id, clientId: body.clientId, now: now(), readState }));
    }),
    'PUT /api/personal/gym': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = writeAndPush(req, body, state => {
        const client = clientFor(state, body.clientId);
        return saveGymProfile({
          collaboration: state, actorId: user.id, studentId: client.studentUserId,
          clientId: body.clientId, data: body, now: now(), randomId
        }).collaboration;
      });
      json(res, 200, buildClientDetail({ collaboration: result, trainerId: user.id, clientId: body.clientId, now: now(), readState }));
    }),
    'POST /api/personal/measurements': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => recordMeasurement({ collaboration: state, actorId: user.id, clientId: body.clientId, data: body, now: now(), randomId }).collaboration);
      json(res, 200, buildClientDetail({ collaboration: result, trainerId: user.id, clientId: body.clientId, now: now(), readState }));
    }),
    'PUT /api/personal/availability': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => saveAvailability({ collaboration: state, actorId: user.id, data: body, now: now(), randomId }).collaboration);
      json(res, 200, buildWorkspace({ collaboration: result, trainerId: user.id, now: now(), readState }));
    }),
    'POST /api/personal/appointments': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => saveAppointment({ collaboration: state, actorId: user.id, clientId: body.clientId, data: body, now: now(), randomId, create: true }).collaboration);
      json(res, 200, buildWorkspace({ collaboration: result, trainerId: user.id, now: now(), readState }));
    }),
    'PUT /api/personal/appointment': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => saveAppointment({ collaboration: state, actorId: user.id, clientId: body.clientId, data: body, now: now(), randomId, create: false }).collaboration);
      json(res, 200, buildWorkspace({ collaboration: result, trainerId: user.id, now: now(), readState }));
    }),
    'POST /api/personal/receivables': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => saveReceivable({ collaboration: state, actorId: user.id, clientId: body.clientId, data: body, now: now(), randomId, create: true, hideForeign: true }).collaboration);
      json(res, 200, buildWorkspace({ collaboration: result, trainerId: user.id, now: now(), readState }));
    }),
    'PUT /api/personal/receivable': async (req, res) => withUser(req, res, async user => {
      const body = await readTrainerBody(user, req);
      const result = write(req, body, state => saveReceivable({ collaboration: state, actorId: user.id, clientId: body.clientId, data: body, now: now(), randomId, create: false, hideForeign: true }).collaboration);
      json(res, 200, buildWorkspace({ collaboration: result, trainerId: user.id, now: now(), readState }));
    })
  };
}
