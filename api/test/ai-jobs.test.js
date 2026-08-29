import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAiJobService, createAiJobRoutes } from '../ai-jobs.js';
import { INITIAL_COLLABORATION, migrateCollaboration } from '../domain/schema.js';
import { createJsonStore } from '../lib/json-store.js';

const NOW = '2026-08-29T12:00:00.000Z';
const profile = {
  studentId: 'student-a', ageBand: 'adult', heightCm: 172, goal: 'Força', experience: 'intermediario',
  availableDays: [1, 3], minutesPerSession: 50, focusAreas: ['waist'], favoriteExerciseIds: ['0001'],
  avoidedExerciseIds: [], limitations: '', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: null,
  createdAt: NOW, updatedAt: NOW
};
const gym = { studentId: 'student-a', name: 'Gym', genericEquipment: ['body weight'], specificMachines: [], createdAt: NOW, updatedAt: NOW };
const measurement = { id: 'm1', clientId: null, studentUserId: 'student-a', kind: 'weight', side: null, value: 70, unit: 'kg', observedAt: '2026-08-28', recordedBy: 'student-a', createdAt: NOW };

function response() {
  return {
    justification: 'Plano seguro.',
    routines: [{
      routineRef: 'a', name: 'A', exercises: [{
        exerciseId: '0001', mode: 'reps', sets: 3, repMin: 8, repMax: 12,
        seconds: null, restSeconds: 90, progression: 'Progredir com técnica.', note: ''
      }]
    }],
    schedule: [{ day: 1, routineRef: 'a' }]
  };
}

function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-ai-jobs-'));
  const initial = {
    ...structuredClone(INITIAL_COLLABORATION),
    trainingProfiles: [profile], gymProfiles: [gym], measurements: [measurement],
    programs: [{ id: 'personal-plan', studentId: 'student-a', status: 'published' }],
    ...extra
  };
  const store = createJsonStore({ file: path.join(dir, 'collaboration.json'), initial, migrate: migrateCollaboration });
  let ids = 0;
  let providerCalls = 0;
  const usage = [];
  const service = createAiJobService({
    store,
    readState: () => ({
      week: { 1: 'manual-routine' }, routines: [{ id: 'manual-routine', name: 'Manual' }],
      workouts: [{ d: '2026-08-20', vol: 1200, ex: [{ id: '0001' }] }]
    }),
    getActiveProvider: () => ({ provider: 'openai', selectedModel: 'gpt-test' }),
    runStructured: async () => {
      providerCalls += 1;
      return { value: response(), usage: { provider: 'openai', model: 'gpt-test', inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
    },
    appendUsage: (entry, details) => usage.push({ entry, details }),
    now: () => NOW,
    randomId: () => `server-${++ids}`,
    defer: () => {}
  });
  return { dir, store, service, usage, providerCalls: () => providerCalls };
}

test('enqueue is idempotent and permits only one active job per student', () => {
  const { service } = fixture();
  const first = service.enqueue({ studentId: 'student-a', idempotencyKey: 'same-key' });
  const same = service.enqueue({ studentId: 'student-a', idempotencyKey: 'same-key' });
  const otherKey = service.enqueue({ studentId: 'student-a', idempotencyKey: 'other-key' });
  assert.deepEqual(same, first);
  assert.deepEqual(otherKey, first);
  assert.equal(first.status, 'queued');
  assert.equal(first.stage, 'organizing');
});

test('job transitions through persistent stages, calls provider once, records canonical usage and applies a versioned plan', async () => {
  const { service, store, usage, providerCalls } = fixture();
  const job = service.enqueue({ studentId: 'student-a', idempotencyKey: 'job-success' });
  await service.drain();

  const state = store.read();
  const finished = state.aiJobs.find(item => item.id === job.id);
  const plan = state.aiPlans.find(item => item.studentId === 'student-a');
  assert.equal(finished.status, 'applied');
  assert.equal(finished.stage, 'applying');
  assert.equal(finished.planVersion, 1);
  assert.equal(providerCalls(), 1);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].details.status, 'success');
  assert.equal(plan.status, 'applied');
  assert.equal(plan.source, 'ai');
  assert.deepEqual(plan.schedule, [{ day: 1, routineId: plan.routines[0].id }]);
  assert.equal(plan.routines[0]._aiGenerated, true);
  assert.equal(plan.routines[0].sourceType, 'ai');
  assert.equal('prompt' in finished, false);
  assert.equal('response' in plan, false);
  assert.equal(JSON.stringify(state).includes('request-only-secret'), false);
});

test('provider failure is recorded once without retry/fallback and preserves the current plan', async () => {
  const current = {
    id: 'current', studentId: 'student-a', version: 4, provider: 'openai', model: 'old', contextHash: 'old',
    justification: 'vigente', routines: [], schedule: [], source: 'ai', status: 'applied', createdAt: NOW, updatedAt: NOW, appliedAt: NOW
  };
  const fx = fixture({ aiPlans: [current] });
  let calls = 0;
  fx.service.setRunStructuredForTests(async () => {
    calls += 1;
    const error = new Error('SENTINEL_PROVIDER_PRIVATE_ERROR');
    error.usage = { provider: 'openai', model: 'gpt-test', inputTokens: 5, outputTokens: 0, totalTokens: 5 };
    throw error;
  });
  const job = fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'job-fail' });
  await fx.service.drain();

  const state = fx.store.read();
  assert.equal(calls, 1);
  assert.equal(state.aiJobs.find(item => item.id === job.id).status, 'failed');
  assert.match(state.aiJobs.find(item => item.id === job.id).publicError, /não foi possível/i);
  assert.equal(JSON.stringify(state).includes('SENTINEL_PROVIDER_PRIVATE_ERROR'), false);
  assert.deepEqual(state.aiPlans, [current]);
  assert.equal(fx.usage.length, 1);
  assert.equal(fx.usage[0].details.status, 'failed');
});

test('startup recovery fails stale running jobs without repeating provider calls', () => {
  const fx = fixture({
    aiJobs: [{ id: 'running', idempotencyKey: 'old', studentId: 'student-a', status: 'running', stage: 'generating', publicError: null, contextHash: 'hash', planVersion: null, createdAt: NOW, updatedAt: NOW }]
  });
  const recovered = fx.service.recoverInterrupted();
  assert.equal(recovered, 1);
  assert.equal(fx.store.read().aiJobs[0].status, 'failed');
  assert.match(fx.store.read().aiJobs[0].publicError, /interrompida/i);
  assert.equal(fx.providerCalls(), 0);
});

test('rollback activates the previous version and preserves Personal/manual data and all retained history', () => {
  const plans = [1, 2].map(version => ({
    id: `plan-${version}`, studentId: 'student-a', version, provider: 'openai', model: 'test', contextHash: `hash-${version}`,
    justification: `v${version}`, routines: [], schedule: [], source: 'ai', status: version === 2 ? 'applied' : 'superseded',
    createdAt: NOW, updatedAt: NOW, appliedAt: version === 2 ? NOW : null
  }));
  const fx = fixture({ aiPlans: plans });
  const rolledBack = fx.service.rollback({ studentId: 'student-a', planId: 'plan-1' });
  const state = fx.store.read();

  assert.equal(rolledBack.id, 'plan-1');
  assert.equal(state.aiPlans.find(item => item.id === 'plan-1').status, 'applied');
  assert.equal(state.aiPlans.find(item => item.id === 'plan-2').status, 'superseded');
  assert.equal(state.aiPlans.length, 2);
  assert.deepEqual(state.programs, [{ id: 'personal-plan', studentId: 'student-a', status: 'published' }]);
});

test('HTTP job routes enforce ownership and return the idempotent job quickly', async () => {
  const fx = fixture();
  const routes = createAiJobRoutes({
    service: fx.service,
    readSession: req => req.user || null,
    readBody: async req => req.body || {},
    requireTrustedWrite: () => true,
    json: (res, status, body) => Object.assign(res, { status, body })
  });
  const createRes = {};
  await routes['POST /api/ai/jobs']({ user: { id: 'student-a' }, headers: { 'idempotency-key': 'http-key' }, body: {} }, createRes);
  assert.equal(createRes.status, 202);
  assert.equal(createRes.body.job.status, 'queued');

  const ownerRes = {};
  await routes['GET /api/ai/job']({ user: { id: 'student-a' }, url: `/api/ai/job?id=${createRes.body.job.id}` }, ownerRes);
  assert.equal(ownerRes.status, 200);

  const strangerRes = {};
  await routes['GET /api/ai/job']({ user: { id: 'student-b' }, url: `/api/ai/job?id=${createRes.body.job.id}` }, strangerRes);
  assert.equal(strangerRes.status, 404);
});
