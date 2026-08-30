import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAiJobService, createAiJobRoutes, summarizeRecentTraining } from '../ai-jobs.js';
import { runStructuredOutput, upsertProvider } from '../ai-providers.js';
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

function fixture(extra = {}, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-ai-jobs-'));
  const initial = {
    ...structuredClone(INITIAL_COLLABORATION),
    trainingProfiles: [profile], gymProfiles: [gym], measurements: [measurement],
    programs: [{ id: 'personal-plan', studentId: 'student-a', status: 'published' }],
    ...extra
  };
  const store = createJsonStore({ file: path.join(dir, 'collaboration.json'), initial, migrate: migrateCollaboration });
  const serviceStore = typeof options.wrapStore === 'function' ? options.wrapStore(store) : store;
  let ids = 0;
  let providerCalls = 0;
  const usage = [];
  const service = createAiJobService({
    store: serviceStore,
    readState: options.readState || (() => ({
      week: { 1: 'manual-routine' }, routines: [{ id: 'manual-routine', name: 'Manual' }],
      workouts: [{ d: '2026-08-20', vol: 1200, ex: [{ id: '0001' }] }]
    })),
    getActiveProvider: options.getActiveProvider || (() => ({ provider: 'openai', selectedModel: 'gpt-test' })),
    runStructured: options.runStructured || (async () => {
      providerCalls += 1;
      return { value: response(), usage: { provider: 'openai', model: 'gpt-test', inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
    }),
    appendUsage: (entry, details) => usage.push({ entry, details }),
    now: () => NOW,
    randomId: () => `server-${++ids}`,
    defer: () => {}
  });
  return { dir, store, service, usage, providerCalls: () => providerCalls };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
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

test('recent training reads the completed workout entries used by the app', () => {
  const summary = summarizeRecentTraining({
    workouts: [{
      d: '2026-08-28', vol: 600,
      entries: [{ id: '0001', sets: [{ done: true }] }, { id: '0002', sets: [{ done: true }] }]
    }]
  }, NOW);

  assert.deepEqual(summary, { windowDays: 28, frequency: 1, volume: 600, exerciseIds: ['0001', '0002'] });
});

test('recent training supports legacy exercise rows and ignores malformed or stale history', () => {
  const summary = summarizeRecentTraining({
    workouts: [
      { d: '2026-08-28', vol: -10, ex: [{ exerciseId: 'legacy-ex' }, null] },
      { d: '2026-08-27', vol: '25', exercises: [{ id: 'legacy-ex' }, { exerciseId: 'legacy-full' }] },
      { d: '2026-08-26', vol: 10, entries: 'malformed' },
      { d: '2026-01-01', vol: 999, entries: [{ id: 'stale' }] },
      { d: 'invalid', vol: 999, entries: [{ id: 'invalid-date' }] }
    ]
  }, NOW);

  assert.deepEqual(summary, {
    windowDays: 28,
    frequency: 3,
    volume: 35,
    exerciseIds: ['legacy-ex', 'legacy-full']
  });
  assert.deepEqual(summarizeRecentTraining({ workouts: 'not-an-array' }, NOW), {
    windowDays: 28, frequency: 0, volume: 0, exerciseIds: []
  });
});

test('collaboration writes stop after the bounded revision-conflict retry', () => {
  let attempts = 0;
  const conflict = Object.assign(new Error('conflict'), { name: 'RevisionConflictError' });
  const service = createAiJobService({
    store: {
      read: () => ({ rev: 0, aiJobs: [] }),
      update: () => {
        attempts += 1;
        throw conflict;
      }
    },
    now: () => NOW,
    defer: () => {}
  });

  assert.throws(() => service.enqueue({ studentId: 'student-a', idempotencyKey: 'retry' }), /conflict/);
  assert.equal(attempts, 3);
  assert.throws(() => createAiJobService({ store: { read: () => ({}) } }), /store required/i);
});

test('enqueue revalidates a competing active job inside a revision-conflict retry', async () => {
  const fx = fixture();
  const competing = {
    id: 'competing-job', idempotencyKey: 'competing-key', studentId: 'student-a', status: 'queued', stage: 'organizing',
    publicError: null, contextHash: '', planVersion: null, createdAt: NOW, updatedAt: NOW
  };
  let injected = false;
  const conflictStore = {
    read: () => fx.store.read(),
    update(expectedRev, reducer) {
      if (!injected) {
        injected = true;
        const current = fx.store.read();
        fx.store.update(current.rev, state => ({ ...state, aiJobs: [...state.aiJobs, competing] }));
      }
      return fx.store.update(expectedRev, reducer);
    }
  };
  let calls = 0;
  const service = createAiJobService({
    store: conflictStore,
    readState: () => ({ workouts: [] }),
    getActiveProvider: () => ({ provider: 'openai', selectedModel: 'gpt-test' }),
    runStructured: async () => {
      calls += 1;
      return { value: response(), usage: { provider: 'openai', model: 'gpt-test', inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
    appendUsage: () => {},
    now: () => NOW,
    randomId: () => 'new-job',
    defer: () => {}
  });

  const selected = service.enqueue({ studentId: 'student-a', idempotencyKey: 'other-key' });
  await service.drain();

  const state = fx.store.read();
  assert.equal(selected.id, competing.id);
  assert.equal(state.aiJobs.length, 1);
  assert.equal(state.aiJobs.filter(job => ['queued', 'running'].includes(job.status)).length, 0);
  assert.equal(state.aiPlans.length, 1);
  assert.equal(calls, 1);
});

test('enqueue preserves the six-per-hour generation limit after idempotency checks', () => {
  const aiJobs = Array.from({ length: 6 }, (_, index) => ({
    id: `recent-${index}`, idempotencyKey: `key-${index}`, studentId: 'student-a', status: 'failed', stage: 'generating',
    publicError: 'safe', contextHash: '', planVersion: null, createdAt: NOW, updatedAt: NOW
  }));
  const fx = fixture({ aiJobs });
  assert.deepEqual(fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'key-0' }).id, 'recent-0');
  assert.throws(() => fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'seventh' }), error => error.status === 429);
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
  let calls = 0;
  const fx = fixture({ aiPlans: [current] }, {
    runStructured: async () => {
      calls += 1;
      const error = new Error('SENTINEL_PROVIDER_PRIVATE_ERROR');
      error.usage = { provider: 'openai', model: 'gpt-test', inputTokens: 5, outputTokens: 0, totalTokens: 5 };
      throw error;
    }
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

test('a medical restriction enabled while the provider is running fails the job without replacing the current plan', async () => {
  const providerStarted = deferred();
  const providerResult = deferred();
  const current = {
    id: 'current-medical', studentId: 'student-a', version: 4, provider: 'openai', model: 'old', contextHash: 'old',
    justification: 'vigente', routines: [], schedule: [], source: 'ai', status: 'applied', createdAt: NOW, updatedAt: NOW, appliedAt: NOW
  };
  let calls = 0;
  const fx = fixture({ aiPlans: [current] }, {
    runStructured: async () => {
      calls += 1;
      providerStarted.resolve();
      return providerResult.promise;
    }
  });

  const job = fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'medical-race' });
  const draining = fx.service.drain();
  await providerStarted.promise;
  const beforeChange = fx.store.read();
  fx.store.update(beforeChange.rev, state => ({
    ...state,
    trainingProfiles: state.trainingProfiles.map(item => item.studentId === 'student-a'
      ? { ...item, medicalRestriction: true, updatedAt: '2026-08-29T12:01:00.000Z' }
      : item)
  }));
  providerResult.resolve({ value: response(), usage: { provider: 'openai', model: 'gpt-test', inputTokens: 10, outputTokens: 20, totalTokens: 30 } });
  await draining;

  const state = fx.store.read();
  assert.equal(calls, 1);
  assert.equal(state.aiJobs.find(item => item.id === job.id).status, 'failed');
  assert.deepEqual(state.aiPlans, [current]);
  assert.equal(fx.usage.length, 1);
  assert.equal(fx.usage[0].details.status, 'failed');
});

test('an equipment change while the provider is running rejects exercises from the stale shortlist', async () => {
  const providerStarted = deferred();
  const providerResult = deferred();
  const fx = fixture({}, {
    runStructured: async () => {
      providerStarted.resolve();
      return providerResult.promise;
    }
  });

  const job = fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'equipment-race' });
  const draining = fx.service.drain();
  await providerStarted.promise;
  const beforeChange = fx.store.read();
  fx.store.update(beforeChange.rev, state => ({
    ...state,
    gymProfiles: state.gymProfiles.map(item => item.studentId === 'student-a'
      ? { ...item, genericEquipment: ['dumbbell'], updatedAt: '2026-08-29T12:01:00.000Z' }
      : item)
  }));
  providerResult.resolve({ value: response(), usage: { provider: 'openai', model: 'gpt-test', inputTokens: 10, outputTokens: 20, totalTokens: 30 } });
  await draining;

  const state = fx.store.read();
  assert.equal(state.aiJobs.find(item => item.id === job.id).status, 'failed');
  assert.equal(state.aiPlans.length, 0);
  assert.equal(fx.usage.length, 1);
  assert.equal(fx.usage[0].details.status, 'failed');
});

test('a revision conflict after final validation recomputes the plan version and generated IDs', async () => {
  const competing = {
    id: 'competing-plan', studentId: 'student-a', version: 9, provider: 'openai', model: 'other', contextHash: 'other',
    justification: 'concorrente', routines: [], schedule: [], source: 'ai', status: 'applied', createdAt: NOW, updatedAt: NOW, appliedAt: NOW
  };
  let injected = false;
  const fx = fixture({}, {
    wrapStore: store => ({
      read: () => store.read(),
      update(expectedRev, reducer) {
        const current = store.read();
        const preview = reducer(current);
        const isFinalApply = preview.aiJobs.some(item => item.status === 'applied');
        if (!injected && isFinalApply) {
          injected = true;
          store.update(current.rev, state => ({ ...state, aiPlans: [...state.aiPlans, competing] }));
        }
        return store.update(expectedRev, reducer);
      }
    })
  });

  const job = fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'version-conflict' });
  await fx.service.drain();

  const state = fx.store.read();
  const generated = state.aiPlans.find(item => item.id !== competing.id);
  assert.equal(injected, true);
  assert.equal(state.aiJobs.find(item => item.id === job.id).status, 'applied');
  assert.equal(state.aiJobs.find(item => item.id === job.id).planVersion, 10);
  assert.equal(generated.version, 10);
  assert.notEqual(generated.id, competing.id);
  assert.equal(new Set(state.aiPlans.flatMap(item => [item.id, ...item.routines.map(routine => routine.id)])).size, 3);
  assert.equal(fx.usage.length, 1);
});

test('generated routine IDs never collide with manual routines in the student state', async () => {
  const baseline = fixture();
  baseline.service.enqueue({ studentId: 'student-a', idempotencyKey: 'baseline-id' });
  await baseline.service.drain();
  const collidingId = baseline.store.read().aiPlans[0].routines[0].id;

  const fx = fixture({}, {
    readState: () => ({
      week: { 1: collidingId }, routines: [{ id: collidingId, name: 'Manual' }],
      workouts: [{ d: '2026-08-20', vol: 1200, ex: [{ id: '0001' }] }]
    })
  });
  const job = fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'manual-collision' });
  await fx.service.drain();

  const state = fx.store.read();
  const generated = state.aiPlans[0];
  assert.equal(state.aiJobs.find(item => item.id === job.id).status, 'applied');
  assert.notEqual(generated.routines[0].id, collidingId);
});

test('real structured adapter failures retain billed usage for the failed job', async () => {
  const masterKey = '44'.repeat(32);
  const slot = upsertProvider([], {
    provider: 'openai', selectedModel: 'gpt-usage', apiKey: 'complete-test-key'
  }, masterKey, NOW).records[0];
  let calls = 0;
  const fx = fixture({}, {
    getActiveProvider: () => slot,
    runStructured: (provider, input) => runStructuredOutput(provider, {
      ...input,
      masterKey,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          status: 'completed',
          output_text: 'SENTINEL_RAW_PROVIDER_RESPONSE not-json',
          usage: { input_tokens: 17, output_tokens: 4, total_tokens: 21 }
        }), { status: 200 });
      }
    })
  });

  const job = fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'real-adapter-failure' });
  await fx.service.drain();

  assert.equal(calls, 1);
  assert.equal(fx.store.read().aiJobs.find(item => item.id === job.id).status, 'failed');
  assert.equal(fx.usage.length, 1);
  assert.deepEqual(fx.usage[0].entry, {
    provider: 'openai', model: 'gpt-usage', inputTokens: 17, outputTokens: 4, totalTokens: 21
  });
  assert.equal(fx.usage[0].details.studentId, 'student-a');
  assert.ok(Number.isInteger(fx.usage[0].details.latencyMs));
  assert.equal(JSON.stringify(fx.store.read()).includes('SENTINEL_RAW_PROVIDER_RESPONSE'), false);
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

test('organizing failures block before tokens for risk, unavailable candidates and missing provider', async () => {
  const cases = [
    fixture({ trainingProfiles: [{ ...profile, acuteRisk: true }] }),
    fixture({ gymProfiles: [{ ...gym, genericEquipment: ['unknown-equipment'] }] }),
    fixture({}, { getActiveProvider: () => null })
  ];
  for (const [index, fx] of cases.entries()) {
    const job = fx.service.enqueue({ studentId: 'student-a', idempotencyKey: `blocked-${index}` });
    await fx.service.drain();
    const failed = fx.store.read().aiJobs.find(item => item.id === job.id);
    assert.equal(failed.status, 'failed');
    assert.equal(fx.providerCalls(), 0);
    assert.equal(fx.usage.length, 0);
    assert.equal(JSON.stringify(failed).includes('prompt'), false);
  }
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

test('AI application and rollback never supersede or activate a source:personal plan', async () => {
  const plans = [
    {
      id: 'ai-old', studentId: 'student-a', version: 1, provider: 'openai', model: 'test', contextHash: 'ai-old',
      justification: 'IA anterior', routines: [], schedule: [], source: 'ai', status: 'applied', createdAt: NOW, updatedAt: NOW, appliedAt: NOW
    },
    {
      id: 'personal-source', studentId: 'student-a', version: 2, provider: 'personal', model: 'trainer', contextHash: 'personal',
      justification: 'Prescrição Personal', routines: [], schedule: [], source: 'personal', status: 'applied', createdAt: NOW, updatedAt: NOW, appliedAt: NOW
    }
  ];
  const fx = fixture({ aiPlans: plans });
  fx.service.enqueue({ studentId: 'student-a', idempotencyKey: 'preserve-personal' });
  await fx.service.drain();
  assert.equal(fx.store.read().aiPlans.find(item => item.id === 'personal-source').status, 'applied');
  assert.equal(fx.store.read().aiPlans.find(item => item.id === 'ai-old').status, 'superseded');
  assert.throws(() => fx.service.rollback({ studentId: 'student-a', planId: 'personal-source' }), /não encontrado/i);
  assert.equal(fx.store.read().aiPlans.find(item => item.id === 'personal-source').status, 'applied');
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

test('HTTP rollback route switches only an owned retained plan', async () => {
  const plans = [1, 2].map(version => ({
    id: `http-plan-${version}`, studentId: 'student-a', version, provider: 'openai', model: 'test', contextHash: `hash-${version}`,
    justification: `v${version}`, routines: [], schedule: [], source: 'ai', status: version === 2 ? 'applied' : 'superseded',
    createdAt: NOW, updatedAt: NOW, appliedAt: version === 2 ? NOW : null
  }));
  const fx = fixture({ aiPlans: plans });
  const routes = createAiJobRoutes({
    service: fx.service,
    readSession: req => req.user || null,
    readBody: async req => req.body || {},
    requireTrustedWrite: () => true,
    json: (res, status, body) => Object.assign(res, { status, body })
  });
  const res = {};
  await routes['POST /api/ai/plan/rollback']({ user: { id: 'student-a' }, body: { planId: 'http-plan-1' } }, res);
  assert.equal(res.status, 200);
  assert.equal(res.body.plan.id, 'http-plan-1');
  assert.equal(fx.store.read().aiPlans.find(item => item.id === 'http-plan-1').status, 'applied');
});

test('HTTP job routes fail closed for anonymous, untrusted and missing-idempotency requests', async () => {
  const fx = fixture();
  const json = (res, status, body) => Object.assign(res, { status, body });
  const anonymousRoutes = createAiJobRoutes({ service: fx.service, readSession: () => null, readBody: async () => ({}), json, requireTrustedWrite: () => true });
  const anonymous = {};
  await anonymousRoutes['POST /api/ai/jobs']({ headers: {} }, anonymous);
  assert.equal(anonymous.status, 401);

  const untrustedRoutes = createAiJobRoutes({ service: fx.service, readSession: () => ({ id: 'student-a' }), readBody: async () => ({}), json, requireTrustedWrite: (req, res) => { json(res, 403, { error: 'invalid origin' }); return false; } });
  const untrusted = {};
  await untrustedRoutes['POST /api/ai/jobs']({ headers: {} }, untrusted);
  assert.equal(untrusted.status, 403);

  const missingRoutes = createAiJobRoutes({ service: fx.service, readSession: () => ({ id: 'student-a' }), readBody: async () => ({}), json, requireTrustedWrite: () => true });
  const missing = {};
  await missingRoutes['POST /api/ai/jobs']({ headers: {} }, missing);
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /idempotency/i);
});
