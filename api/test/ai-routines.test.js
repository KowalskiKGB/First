import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiRoutineService } from '../ai-routines.js';

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
