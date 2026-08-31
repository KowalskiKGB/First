import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { INITIAL_COLLABORATION } from '../domain/schema.js';
import { createPersonalRoutes } from '../personal.js';

const NOW = '2026-08-29T12:00:00.000Z';
const profile = (userId, roles = ['student']) => ({
  userId, roles, name: userId, shareCode: (userId === 'student-a' ? 'A' : 'B').repeat(32),
  shareCodeExpiresAt: '2099-01-01T00:00:00.000Z', timezone: 'America/Fortaleza',
  createdAt: NOW, updatedAt: NOW
});
const state = (grants = {}) => ({
  ...structuredClone(INITIAL_COLLABORATION),
  profiles: [profile('student-a'), profile('trainer-a', ['student', 'trainer']), profile('trainer-b', ['student', 'trainer'])],
  clients: [{ id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'Aluno', archivedAt: null }],
  connections: [{ id: 'connection-a', trainerId: 'trainer-a', studentId: 'student-a', requestedBy: 'student-a', status: 'active', grants }]
});
const profileBody = {
  ageBand: 'adult', heightCm: 172, goal: 'Forca', experience: 'intermediario',
  availableDays: [1, 3, 5], minutesPerSession: 60, focusAreas: ['back'],
  favoriteExerciseIds: [], avoidedExerciseIds: [], limitations: '', acuteRisk: false,
  medicalRestriction: false, consent: true, guardianConsent: null
};
const gymBody = {
  name: 'Academia Centro', genericEquipment: ['barbell'],
  specificMachines: [{ name: 'Hack', category: 'legs', exerciseIds: ['hack-squat'] }]
};

function fixture(t, collaboration) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-ai-collaboration-'));
  const file = path.join(dataDir, 'collaboration.json');
  const pushes = [];
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const routes = createPersonalRoutes({
    dataDir,
    origin: 'https://first.example',
    readSession: req => req.user || null,
    readBody: async req => req.body || {},
    json: (res, status, body) => Object.assign(res, { status, body }),
    readState: () => null,
    sendPush: async (userId, payload) => { pushes.push({ userId, payload }); }
  });
  writeFileSync(file, JSON.stringify(collaboration));
  return { routes, file, pushes, read: () => JSON.parse(readFileSync(file, 'utf8')) };
}

async function invoke(fixtureValue, key, { user, body, origin, url } = {}) {
  assert.equal(typeof fixtureValue.routes[key], 'function', `missing route ${key}`);
  const req = { user, body, url: url || key.slice(key.indexOf(' ') + 1), headers: origin ? { origin } : {} };
  const res = {};
  await fixtureValue.routes[key](req, res);
  return res;
}

test('student persists profile, gym and measurements then reads only their AI context', async t => {
  const f = fixture(t, state());
  const user = { id: 'student-a', name: 'Aluno' };

  const savedProfile = await invoke(f, 'PUT /api/ai/profile', { user, body: { rev: 0, ...profileBody } });
  assert.equal(savedProfile.status, 200);
  assert.equal(savedProfile.body.profile.studentId, 'student-a');

  const savedGym = await invoke(f, 'PUT /api/ai/gym', { user, body: { rev: 1, ...gymBody } });
  assert.equal(savedGym.status, 200);

  const savedMeasurement = await invoke(f, 'POST /api/ai/measurements', {
    user, body: { rev: 2, kind: 'weight', value: 74.2, unit: 'kg', observedAt: '2026-08-29' }
  });
  assert.equal(savedMeasurement.status, 200);

  const context = await invoke(f, 'GET /api/ai/context', { user });
  assert.equal(context.status, 200);
  assert.equal(context.body.profile.goal, 'Forca');
  assert.equal(context.body.gym.name, 'Academia Centro');
  assert.equal(context.body.measurements.weight.value, 74.2);
  assert.equal(context.body.completeness.eligible, true);
});

test('catalogue-backed gym profiles retain up to two hundred exact exercise ids', async t => {
  const f = fixture(t, state());
  const exerciseIds = Array.from({ length: 120 }, (_, index) => `catalogue-${index}`);
  const body = {
    rev: 0,
    name: 'Academia Catálogo',
    genericEquipment: [],
    specificMachines: [{ name: 'Catálogo da academia', category: 'exercise-catalog', exerciseIds }],
    directoryGymId: 'gym-catalogue',
    directorySnapshot: {
      id: 'gym-catalogue', name: 'Academia Catálogo', state: 'CE', city: 'Fortaleza', address: 'Rua A, 10',
      status: 'unverified', openingHours: [{ day: 0, closed: true }], exerciseIds
    }
  };

  const response = await invoke(f, 'PUT /api/ai/gym', { user: { id: 'student-a' }, body });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.gym.specificMachines[0].exerciseIds, exerciseIds);
  assert.deepEqual(response.body.gym.directorySnapshot.openingHours, [{ day: 0, open: '', close: '', closed: true }]);
  assert.deepEqual(f.read().gymProfiles[0].specificMachines[0].exerciseIds, exerciseIds);
});

test('student AI context exposes only ten retained own AI versions in descending order', async t => {
  const aiPlans = Array.from({ length: 12 }, (_, index) => {
    const version = index + 1;
    return {
      id: `ai-${version}`, studentId: 'student-a', version, provider: 'openai', model: 'gpt-test', contextHash: `hash-${version}`,
      justification: `IA ${version}`, routines: [], schedule: [], source: 'ai', status: version === 12 ? 'applied' : 'superseded',
      createdAt: NOW, updatedAt: NOW, appliedAt: version === 12 ? NOW : null
    };
  });
  const personalPlan = {
    id: 'personal-private', studentId: 'student-a', version: 99, provider: 'personal', model: 'trainer', contextHash: 'personal',
    justification: 'Plano do Personal', routines: [], schedule: [], source: 'personal', status: 'applied',
    createdAt: NOW, updatedAt: NOW, appliedAt: NOW
  };
  const foreignPlan = { ...aiPlans[0], id: 'foreign-ai', studentId: 'student-b', version: 100 };
  const f = fixture(t, { ...state(), aiPlans: [...aiPlans, personalPlan, foreignPlan] });

  const context = await invoke(f, 'GET /api/ai/context', { user: { id: 'student-a' } });

  assert.equal(context.status, 200);
  assert.equal(context.body.plan.id, 'ai-12');
  assert.equal(context.body.planHistory.length, 10);
  assert.deepEqual(context.body.planHistory.map(plan => plan.version), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.ok(context.body.planHistory.every(plan => plan.studentId === 'student-a' && plan.source === 'ai'));
  assert.equal(JSON.stringify(context.body).includes('personal-private'), false);
  assert.equal(JSON.stringify(context.body).includes('foreign-ai'), false);
});

test('trainer mutations are non-enumerable and require role, ownership, link and trainingProfileWrite', async t => {
  const f = fixture(t, state({ trainingProfileWrite: true }));

  const saved = await invoke(f, 'PUT /api/personal/training-profile', {
    user: { id: 'trainer-a' }, body: { rev: 0, clientId: 'client-a', ...profileBody }
  });
  assert.equal(saved.status, 200);
  assert.equal(f.pushes.at(-1).userId, 'student-a');

  const gym = await invoke(f, 'PUT /api/personal/gym', {
    user: { id: 'trainer-a' }, body: { rev: 1, clientId: 'client-a', ...gymBody }
  });
  assert.equal(gym.status, 200);

  const foreign = await invoke(f, 'PUT /api/personal/gym', {
    user: { id: 'trainer-b' }, body: { rev: 2, clientId: 'client-a', ...gymBody }
  });
  assert.equal(foreign.status, 404);

  const noRole = await invoke(f, 'PUT /api/personal/training-profile', {
    user: { id: 'student-a' }, body: { rev: 2, clientId: 'client-a', ...profileBody }
  });
  assert.equal(noRole.status, 403);

  const denied = fixture(t, state({ trainingProfileWrite: false }));
  const noGrant = await invoke(denied, 'PUT /api/personal/training-profile', {
    user: { id: 'trainer-a' }, body: { rev: 0, clientId: 'client-a', ...profileBody }
  });
  assert.equal(noGrant.status, 403);
});

test('student grant mutation keeps the relationship active and trainers cannot widen access', async t => {
  const f = fixture(t, state({ trainingProfileWrite: false, aiPlanRead: false }));
  const student = await invoke(f, 'PUT /api/connections/grants', {
    user: { id: 'student-a' },
    body: { rev: 0, connectionId: 'connection-a', grants: { trainingProfileWrite: true, aiPlanRead: true } }
  });
  assert.equal(student.status, 200);
  assert.equal(student.body.connection.status, 'active');
  assert.equal(student.body.connection.grants.aiPlanRead, true);

  const trainer = await invoke(f, 'PUT /api/connections/grants', {
    user: { id: 'trainer-a' },
    body: { rev: 1, connectionId: 'connection-a', grants: { aiPlanRead: false } }
  });
  assert.equal(trainer.status, 403);
  assert.equal(f.read().connections[0].grants.aiPlanRead, true);
});

test('connection projections normalize every grant without exposing other relationships', async t => {
  const f = fixture(t, {
    ...state({ plansWrite: true }),
    connections: [
      { id: 'connection-a', trainerId: 'trainer-a', studentId: 'student-a', requestedBy: 'student-a', status: 'active', grants: { plansWrite: true } },
      { id: 'connection-private', trainerId: 'trainer-b', studentId: 'student-b', requestedBy: 'student-b', status: 'active', grants: { aiPlanRead: true } }
    ]
  });

  const response = await invoke(f, 'GET /api/collaboration', { user: { id: 'student-a' } });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.connections, [{
    id: 'connection-a', trainerId: 'trainer-a', studentId: 'student-a', requestedBy: 'student-a', status: 'active',
    grants: {
      plansWrite: true,
      workoutsRead: false,
      progressRead: false,
      measurementsWrite: false,
      liveActivityRead: false,
      trainingProfileWrite: false,
      aiPlanRead: false
    }
  }]);
  assert.equal(JSON.stringify(response.body).includes('connection-private'), false);
});

test('student AI writes enforce optimistic revision and production Origin', async t => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  const f = fixture(t, state());
  const wrongOrigin = await invoke(f, 'PUT /api/ai/profile', {
    user: { id: 'student-a' }, origin: 'https://evil.example', body: { rev: 0, ...profileBody }
  });
  assert.deepEqual({ status: wrongOrigin.status, body: wrongOrigin.body }, { status: 403, body: { error: 'invalid origin' } });

  const valid = await invoke(f, 'PUT /api/ai/profile', {
    user: { id: 'student-a' }, origin: 'https://first.example', body: { rev: 0, ...profileBody }
  });
  assert.equal(valid.status, 200);

  const stale = await invoke(f, 'PUT /api/ai/gym', {
    user: { id: 'student-a' }, origin: 'https://first.example', body: { rev: 0, ...gymBody }
  });
  assert.deepEqual({ status: stale.status, body: stale.body }, { status: 409, body: { error: 'stale revision', rev: 1 } });
});
