import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiRoutineRoutes, createAiRoutineService } from '../ai-routines.js';

const NOW = '2026-08-30T12:00:00.000Z';
const catalogue = [
  { id: 'leg-1', name: 'Agachamento livre', bp: 'upper legs', tg: 'quads', eq: 'body weight' },
  { id: 'push-1', name: 'Flexão de braços', bp: 'chest', tg: 'pectorals', eq: 'body weight' },
  { id: 'pull-1', name: 'Remada invertida', bp: 'back', tg: 'lats', eq: 'body weight' }
];

function generated(exerciseId = 'leg-1') {
  return {
    justification: 'Sessão compatível com o foco e os aparelhos disponíveis.',
    routines: [{
      routineRef: 'selected-focus',
      name: 'Dia de Pernas',
      exercises: [{
        exerciseId,
        mode: 'reps',
        sets: 3,
        repMin: 8,
        repMax: 12,
        seconds: null,
        restSeconds: 90,
        progression: 'Aumente as repetições mantendo boa técnica.',
        note: ''
      }]
    }],
    schedule: [{ day: 1, routineRef: 'selected-focus' }]
  };
}

function fixture(overrides = {}) {
  const collaboration = {
    trainingProfiles: [{
      studentId: 'student-a',
      ageBand: 'adult',
      heightCm: 177,
      goal: 'Ganhar massa',
      experience: 'intermediario',
      availableDays: [1, 3],
      minutesPerSession: 50,
      focusAreas: [],
      favoriteExerciseIds: [],
      avoidedExerciseIds: [],
      limitations: '',
      acuteRisk: false,
      medicalRestriction: false,
      consent: true,
      guardianConsent: null
    }],
    gymProfiles: [{
      studentId: 'student-a',
      name: 'Academia do aluno',
      genericEquipment: ['body weight'],
      specificMachines: []
    }],
    measurements: [{
      studentUserId: 'student-a', kind: 'weight', value: 82, observedAt: '2026-08-30'
    }]
  };
  const prompts = [];
  const usage = [];
  const service = createAiRoutineService({
    store: { read: () => structuredClone(collaboration) },
    readState: () => ({
      routines: [{ id: 'manual-routine', name: 'Manual', ex: [] }],
      workouts: []
    }),
    getActiveProvider: () => ({ provider: 'gemini', selectedModel: 'gemini-test' }),
    runStructured: async (_provider, request) => {
      prompts.push(request.prompt);
      return {
        value: generated(),
        usage: { provider: 'gemini', model: 'gemini-test', inputTokens: 10, outputTokens: 20, totalTokens: 30 }
      };
    },
    appendUsage: (entry, details) => usage.push({ entry, details }),
    catalogue,
    now: () => NOW,
    ...overrides
  });
  return { service, prompts, usage };
}

test('creates one editable AI-suggested routine limited to the selected focus', async () => {
  const { service, prompts, usage } = fixture();

  const result = await service.generate({ studentId: 'student-a', focus: 'legs' });

  assert.equal(result.routine.name, 'Dia de Pernas');
  assert.equal(result.routine._aiSuggested, true);
  assert.equal(result.routine._aiGenerated, undefined);
  assert.equal(result.routine.readOnly, false);
  assert.deepEqual(result.routine.ex.map(item => item.id), ['leg-1']);
  assert.notEqual(result.routine.id, 'manual-routine');
  assert.match(prompts[0], /leg-1/);
  assert.doesNotMatch(prompts[0], /push-1|pull-1/);
  assert.match(prompts[0], /exatamente uma rotina/i);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].details.status, 'success');
});

test('coalesces the same routine request only while it is in flight and gives later generations a new ID', async () => {
  let releaseProvider;
  let providerCalls = 0;
  let ids = 0;
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const { service, usage } = fixture({
    randomId: () => `request-${++ids}`,
    runStructured: async () => {
      providerCalls += 1;
      await providerGate;
      return {
        value: generated(),
        usage: { provider: 'gemini', model: 'gemini-test', inputTokens: 10, outputTokens: 20, totalTokens: 30 }
      };
    }
  });

  const firstRequest = service.generate({ studentId: 'student-a', focus: 'legs' });
  const duplicateRequest = service.generate({ studentId: 'student-a', focus: 'legs' });
  releaseProvider();
  const [first, duplicate] = await Promise.all([firstRequest, duplicateRequest]);

  assert.equal(providerCalls, 1);
  assert.equal(usage.length, 1);
  assert.equal(first.routine.id, duplicate.routine.id);
  assert.notEqual(first.routine.id, 'manual-routine');

  const later = await service.generate({ studentId: 'student-a', focus: 'legs' });
  assert.equal(providerCalls, 2);
  assert.equal(usage.length, 2);
  assert.notEqual(later.routine.id, first.routine.id);
});

test('rejects unsupported focus before calling the provider', async () => {
  let providerCalls = 0;
  const { service } = fixture({
    runStructured: async () => {
      providerCalls += 1;
      return { value: generated(), usage: {} };
    }
  });

  await assert.rejects(
    service.generate({ studentId: 'student-a', focus: 'anything' }),
    error => error?.status === 400 && /foco/i.test(error.message)
  );
  assert.equal(providerCalls, 0);
});

test('rejects a provider response containing an exercise outside the focused shortlist', async () => {
  const { service } = fixture({
    runStructured: async () => ({
      value: generated('push-1'),
      usage: { provider: 'gemini', model: 'gemini-test', inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    })
  });

  await assert.rejects(
    service.generate({ studentId: 'student-a', focus: 'legs' }),
    /não permitido|equipamento/i
  );
});

test('HTTP routine route requires a student session and never exposes provider errors', async () => {
  const responses = [];
  const json = (_res, status, body) => responses.push({ status, body });
  const anonymous = createAiRoutineRoutes({
    service: { generate: async () => { throw new Error('must not run'); } },
    readSession: () => null,
    readBody: async () => ({ focus: 'legs' }),
    json
  });
  await anonymous['POST /api/ai/routine']({}, {});
  assert.deepEqual(responses.pop(), { status: 401, body: { error: 'not signed in' } });

  const authenticated = createAiRoutineRoutes({
    service: { generate: async () => { throw new Error('SENTINEL_PROVIDER_PRIVATE_ERROR'); } },
    readSession: () => ({ id: 'student-a' }),
    readBody: async () => ({ focus: 'legs' }),
    json
  });
  await authenticated['POST /api/ai/routine']({}, {});
  assert.deepEqual(responses.pop(), {
    status: 400,
    body: { error: 'Não foi possível criar a rotina com IA.' }
  });
});

test('HTTP routine route can reject generation before reading the request body', async () => {
  let bodyReads = 0;
  let serviceCalls = 0;
  const responses = [];
  const routes = createAiRoutineRoutes({
    service: { generate: async () => { serviceCalls += 1; } },
    readSession: () => ({ id: 'student-a' }),
    readBody: async () => { bodyReads += 1; return { focus: 'legs' }; },
    json: (_res, status, body) => responses.push({ status, body }),
    beforeGenerate: (_req, res) => {
      responses.push({ status: 429, body: { error: 'rate limited' } });
      return false;
    }
  });

  await routes['POST /api/ai/routine']({}, {});

  assert.equal(bodyReads, 0);
  assert.equal(serviceCalls, 0);
  assert.deepEqual(responses.pop(), { status: 429, body: { error: 'rate limited' } });
});

test('HTTP routine route rate-limits authenticated generation before spending provider tokens', async () => {
  let calls = 0;
  const responses = [];
  const routes = createAiRoutineRoutes({
    service: { generate: async () => { calls += 1; } },
    readSession: () => ({ id: 'student-a' }),
    readBody: async () => ({ focus: 'legs' }),
    beforeGenerate: () => {
      responses.push({
        status: 429,
        body: { error: 'Limite de gerações atingido. Tente novamente mais tarde.' }
      });
      return false;
    },
    json: (_res, status, body) => responses.push({ status, body })
  });

  await routes['POST /api/ai/routine']({}, {});

  assert.equal(calls, 0);
  assert.deepEqual(responses.pop(), {
    status: 429,
    body: { error: 'Limite de gerações atingido. Tente novamente mais tarde.' }
  });
});
