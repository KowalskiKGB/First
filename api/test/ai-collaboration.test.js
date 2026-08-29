import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_COLLABORATION, migrateCollaboration } from '../domain/schema.js';
import {
  buildAiContext,
  buildWorkspace,
  notifyAiPlanApplied,
  saveGymProfile,
  saveTrainingProfile,
  updateConnectionGrants
} from '../personal.js';

const NOW = '2026-08-29T12:00:00.000Z';
const idSource = () => {
  let id = 0;
  return () => `id-${++id}`;
};
const base = extra => ({ ...structuredClone(INITIAL_COLLABORATION), ...extra });
const linked = (grants = {}, extra = {}) => base({
  profiles: [
    { userId: 'student-a', roles: ['student'] },
    { userId: 'trainer-a', roles: ['student', 'trainer'] },
    { userId: 'trainer-b', roles: ['student', 'trainer'] }
  ],
  clients: [
    { id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'Aluno A', archivedAt: null },
    { id: 'client-b', trainerId: 'trainer-b', studentUserId: 'student-b', name: 'Aluno B', archivedAt: null }
  ],
  connections: [
    { id: 'connection-a', trainerId: 'trainer-a', studentId: 'student-a', status: 'active', grants },
    { id: 'connection-b', trainerId: 'trainer-b', studentId: 'student-b', status: 'active', grants: { trainingProfileWrite: true, aiPlanRead: true } }
  ],
  ...extra
});

const profileData = {
  ageBand: 'adult',
  heightCm: 172,
  goal: 'Ganhar forca',
  experience: 'intermediario',
  availableDays: [1, 3, 5],
  minutesPerSession: 60,
  focusAreas: ['back'],
  favoriteExerciseIds: ['barbell-bench-press'],
  avoidedExerciseIds: ['unsafe-id'],
  limitations: 'Sem saltos',
  acuteRisk: false,
  medicalRestriction: false,
  consent: true,
  guardianConsent: null
};
const gymData = {
  name: 'Academia Centro',
  genericEquipment: ['barbell', 'dumbbell'],
  specificMachines: [{ name: 'Hack squat', category: 'legs', exerciseIds: ['hack-squat'] }]
};

test('collaboration migration preserves legacy data, is idempotent and enforces AI retention', () => {
  const legacyPlans = Array.from({ length: 14 }, (_, index) => ({
    id: `plan-a-${index}`, studentId: 'student-a', version: index + 1,
    provider: 'openai', model: 'gpt-test', contextHash: `hash-${index}`,
    justification: 'safe', routines: [], schedule: {}, source: 'generated', status: 'applied',
    createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, updatedAt: NOW,
    prompt: 'must disappear', response: 'must disappear'
  }));
  const legacyUsage = Array.from({ length: 2005 }, (_, index) => ({
    id: `usage-${index}`, provider: 'openai', model: 'gpt-test', inputTokens: 1,
    outputTokens: 2, totalTokens: 3, latencyMs: 20, status: 'success',
    studentId: index % 2 ? 'student-a' : undefined, timestamp: NOW,
    prompt: 'private', response: 'private'
  }));
  const legacy = {
    schemaVersion: 1,
    rev: 7,
    legacyFlag: { keep: true },
    profiles: [{ userId: 'legacy-user', custom: 'keep' }],
    connections: [{ id: 'legacy-connection' }],
    clients: [{ id: 'legacy-client' }],
    notifications: [{ id: 'legacy-notification' }],
    audit: [{ id: 'legacy-audit' }],
    programs: [{ id: 'legacy-program' }],
    measurements: [{ id: 'legacy-measurement' }],
    availability: [{ trainerId: 'legacy-trainer' }],
    appointments: [{ id: 'legacy-appointment' }],
    receivables: [{ id: 'legacy-receivable' }],
    trainingProfiles: [{ studentId: 'student-a', ...profileData, createdAt: NOW, updatedAt: NOW }],
    gymProfiles: [{ studentId: 'student-a', ...gymData, createdAt: NOW, updatedAt: NOW }],
    aiPlans: legacyPlans,
    aiJobs: [{ id: 'job-a', idempotencyKey: 'key-a', studentId: 'student-a', status: 'queued', stage: 'queued', publicError: null, contextHash: 'hash', planVersion: null, createdAt: NOW, updatedAt: NOW }],
    aiUsage: legacyUsage
  };

  const migrated = migrateCollaboration(legacy);

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.rev, 7);
  assert.deepEqual(migrated.legacyFlag, { keep: true });
  for (const key of ['profiles', 'connections', 'clients', 'notifications', 'audit', 'programs', 'measurements', 'availability', 'appointments', 'receivables']) {
    assert.deepEqual(migrated[key], legacy[key], `legacy collection ${key} changed`);
  }
  assert.equal(migrated.aiPlans.filter(item => item.studentId === 'student-a').length, 10);
  assert.deepEqual(migrated.aiPlans.map(item => item.version), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(migrated.aiUsage.length, 2000);
  assert.equal(JSON.stringify({ plans: migrated.aiPlans, usage: migrated.aiUsage }).includes('private'), false);
  assert.equal(JSON.stringify({ plans: migrated.aiPlans, usage: migrated.aiUsage }).includes('must disappear'), false);
  assert.deepEqual(migrateCollaboration(migrated), migrated);
});

test('only the student can change grants on an active relationship', () => {
  const randomId = idSource();
  const state = linked({ trainingProfileWrite: false, aiPlanRead: false });
  const updated = updateConnectionGrants({
    collaboration: state,
    actorId: 'student-a',
    connectionId: 'connection-a',
    grants: { trainingProfileWrite: true, aiPlanRead: true, unknown: true },
    now: NOW,
    randomId
  });

  assert.equal(updated.connection.status, 'active');
  assert.deepEqual(updated.connection.grants, {
    plansWrite: false,
    workoutsRead: false,
    progressRead: false,
    measurementsWrite: false,
    liveActivityRead: false,
    trainingProfileWrite: true,
    aiPlanRead: true
  });
  assert.throws(() => updateConnectionGrants({
    collaboration: state, actorId: 'trainer-a', connectionId: 'connection-a',
    grants: { trainingProfileWrite: true }, now: NOW, randomId
  }), /forbidden/);
});

test('trainer profile and gym writes require ownership, active link and trainingProfileWrite', () => {
  const randomId = idSource();
  const allowed = linked({ trainingProfileWrite: true });
  const profiled = saveTrainingProfile({
    collaboration: allowed, actorId: 'trainer-a', studentId: 'student-a', clientId: 'client-a',
    data: profileData, now: NOW, randomId
  });
  const gymmed = saveGymProfile({
    collaboration: profiled.collaboration, actorId: 'trainer-a', studentId: 'student-a', clientId: 'client-a',
    data: gymData, now: NOW, randomId
  });

  assert.equal(profiled.profile.studentId, 'student-a');
  assert.equal(gymmed.gym.studentId, 'student-a');
  assert.equal(gymmed.collaboration.notifications.at(-2).userId, 'student-a');
  assert.equal(gymmed.collaboration.notifications.at(-1).userId, 'student-a');
  assert.throws(() => saveTrainingProfile({
    collaboration: linked({ trainingProfileWrite: false }), actorId: 'trainer-a', studentId: 'student-a', clientId: 'client-a',
    data: profileData, now: NOW, randomId
  }), /forbidden/);
  assert.throws(() => saveGymProfile({
    collaboration: allowed, actorId: 'trainer-b', studentId: 'student-a', clientId: 'client-a',
    data: gymData, now: NOW, randomId
  }), /client not found/);

  const manualClient = base({
    profiles: [{ userId: 'trainer-a', roles: ['student', 'trainer'] }],
    clients: [{ id: 'manual-client', trainerId: 'trainer-a', studentUserId: null, name: 'Manual', archivedAt: null }]
  });
  assert.throws(() => saveTrainingProfile({
    collaboration: manualClient, actorId: 'trainer-a', studentId: null, clientId: 'manual-client',
    data: profileData, now: NOW, randomId
  }), /client not found/);
});

test('trainer workspace projects profile and AI plan through separate grants and isolates trainers', () => {
  const plans = [
    { id: 'plan-a', studentId: 'student-a', version: 1, provider: 'openai', model: 'gpt-test', contextHash: 'hash-a', justification: 'A', routines: [], schedule: {}, source: 'generated', status: 'applied', createdAt: NOW, updatedAt: NOW, prompt: 'secret-a' },
    { id: 'plan-b', studentId: 'student-b', version: 1, provider: 'gemini', model: 'gemini-test', contextHash: 'hash-b', justification: 'B', routines: [{ private: true }], schedule: {}, source: 'generated', status: 'applied', createdAt: NOW, updatedAt: NOW }
  ];
  const extra = {
    trainingProfiles: [
      { studentId: 'student-a', ...profileData, createdAt: NOW, updatedAt: NOW },
      { studentId: 'student-b', ...profileData, goal: 'Secret B', createdAt: NOW, updatedAt: NOW }
    ],
    gymProfiles: [
      { studentId: 'student-a', ...gymData, createdAt: NOW, updatedAt: NOW },
      { studentId: 'student-b', ...gymData, name: 'Secret B', createdAt: NOW, updatedAt: NOW }
    ],
    aiPlans: plans
  };
  const denied = buildWorkspace({ collaboration: linked({}, extra), trainerId: 'trainer-a', now: NOW, readState: () => null });
  assert.equal(denied.clients[0].trainingProfile, undefined);
  assert.equal(denied.clients[0].gymProfile, undefined);
  assert.equal(denied.clients[0].aiPlan, undefined);

  const profileOnly = buildWorkspace({ collaboration: linked({ trainingProfileWrite: true }, extra), trainerId: 'trainer-a', now: NOW, readState: () => null });
  assert.equal(profileOnly.clients[0].trainingProfile.goal, 'Ganhar forca');
  assert.equal(profileOnly.clients[0].gymProfile.name, 'Academia Centro');
  assert.equal(profileOnly.clients[0].aiPlan, undefined);

  const planOnly = buildWorkspace({ collaboration: linked({ aiPlanRead: true }, extra), trainerId: 'trainer-a', now: NOW, readState: () => null });
  assert.equal(planOnly.clients[0].trainingProfile, undefined);
  assert.equal(planOnly.clients[0].aiPlan.contextHash, 'hash-a');
  assert.equal(JSON.stringify(planOnly).includes('secret-a'), false);
  assert.equal(JSON.stringify(planOnly).includes('Secret B'), false);
  assert.equal(JSON.stringify(planOnly).includes('hash-b'), false);
});

test('student AI context is isolated, safe, complete-aware and exposes current measurements', () => {
  const state = linked({}, {
    trainingProfiles: [{ studentId: 'student-a', ...profileData, ageBand: '14to17', guardianConsent: false, createdAt: NOW, updatedAt: NOW }],
    gymProfiles: [{ studentId: 'student-a', ...gymData, createdAt: NOW, updatedAt: NOW }],
    measurements: [
      { id: 'measure-a-old', clientId: 'client-a', studentUserId: 'student-a', kind: 'weight', side: null, value: 70, unit: 'kg', observedAt: '2026-08-20', recordedBy: 'student-a', createdAt: NOW },
      { id: 'measure-a-new', clientId: 'client-a', studentUserId: 'student-a', kind: 'weight', side: null, value: 71, unit: 'kg', observedAt: '2026-08-28', recordedBy: 'student-a', createdAt: NOW },
      { id: 'measure-b', clientId: 'client-b', studentUserId: 'student-b', kind: 'weight', value: 99, unit: 'kg', observedAt: '2026-08-29', recordedBy: 'student-b', createdAt: NOW }
    ],
    aiPlans: [
      { id: 'plan-a', studentId: 'student-a', version: 2, provider: 'openai', model: 'gpt-test', contextHash: 'hash-a', justification: 'safe', routines: [], schedule: {}, source: 'generated', status: 'applied', createdAt: NOW, updatedAt: NOW, prompt: 'private' },
      { id: 'plan-b', studentId: 'student-b', version: 5, provider: 'gemini', model: 'private-model', contextHash: 'hash-b', justification: 'private', routines: [], schedule: {}, source: 'generated', status: 'applied', createdAt: NOW, updatedAt: NOW }
    ],
    aiJobs: [
      { id: 'job-a', idempotencyKey: 'key-a', studentId: 'student-a', status: 'completed', stage: 'done', publicError: null, contextHash: 'hash-a', planVersion: 2, createdAt: NOW, updatedAt: NOW },
      { id: 'job-b', idempotencyKey: 'key-b', studentId: 'student-b', status: 'failed', stage: 'secret', publicError: 'private', contextHash: 'hash-b', planVersion: null, createdAt: NOW, updatedAt: NOW }
    ]
  });

  const context = buildAiContext({ collaboration: state, studentId: 'student-a' });

  assert.equal(context.measurements.weight.value, 71);
  assert.equal(context.plan.version, 2);
  assert.equal(context.job.id, 'job-a');
  assert.equal(context.completeness.eligible, false);
  assert.equal(context.completeness.missing.includes('guardianConsent'), true);
  assert.equal(context.completeness.conservative, false);
  assert.equal(JSON.stringify(context).includes('private-model'), false);
  assert.equal(JSON.stringify(context).includes('hash-b'), false);
  assert.equal(JSON.stringify(context).includes('prompt'), false);

  const under14 = buildAiContext({
    collaboration: {
      ...state,
      trainingProfiles: [{ ...state.trainingProfiles[0], ageBand: 'under14', guardianConsent: true }]
    },
    studentId: 'student-a'
  });
  assert.equal(under14.completeness.conservative, true);
});

test('AI plan notifications target only active trainers with aiPlanRead', () => {
  const randomId = idSource();
  const state = linked({ aiPlanRead: true }, {
    connections: [
      { id: 'connection-a', trainerId: 'trainer-a', studentId: 'student-a', status: 'active', grants: { aiPlanRead: true } },
      { id: 'connection-ended', trainerId: 'trainer-b', studentId: 'student-a', status: 'ended', grants: { aiPlanRead: true } },
      { id: 'connection-denied', trainerId: 'trainer-c', studentId: 'student-a', status: 'active', grants: { aiPlanRead: false } }
    ]
  });

  const notified = notifyAiPlanApplied({ collaboration: state, studentId: 'student-a', planId: 'plan-a', now: NOW, randomId });

  assert.deepEqual(notified.notifications.map(item => item.userId), ['trainer-a']);
});
