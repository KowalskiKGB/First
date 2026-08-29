import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_EXERCISES,
  applyAiWorkout,
  buildWorkoutPrompt,
  candidateExercises,
  missingAiFields,
  normalizeAiWorkout,
  parseModelJson
} from '../ai.js';

const baseState = {
  unit: 'kg',
  bodyweight: [{ d: '2026-08-29', w: 82 }],
  routines: [{ id: 'manual', name: 'Manual', ex: [] }, { id: 'old-ai', name: 'IA antiga', _aiGenerated: true, ex: [] }],
  week: { 1: 'manual', 2: 'old-ai' },
  aiProfile: {
    heightCm: 178,
    goal: 'hipertrofia com foco em costas',
    gymName: 'Academia de teste',
    equipment: ['barbell', 'cable']
  }
};

test('missingAiFields reports the minimum data needed for an AI plan', () => {
  assert.deepEqual(missingAiFields({ bodyweight: [], aiProfile: {} }), ['peso', 'altura', 'objetivo', 'academia', 'aparelhos']);
  assert.deepEqual(missingAiFields(baseState), []);
});

test('candidateExercises limits the catalogue to selected equipment', () => {
  const rows = candidateExercises({ equipment: ['barbell'] }, AI_EXERCISES);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.eq === 'barbell'));
  const fallback = candidateExercises({ equipment: ['not-in-catalogue'] }, AI_EXERCISES);
  assert.ok(fallback.every(row => row.eq === 'body weight'));
});

test('buildWorkoutPrompt produces a compact markdown request with allowed exercise ids', () => {
  const candidates = candidateExercises(baseState.aiProfile, AI_EXERCISES);
  const prompt = buildWorkoutPrompt({ state: baseState, profile: baseState.aiProfile, candidates, generatedAt: '2026-08-29T12:00:00.000Z' });
  assert.match(prompt, /# Pedido de treino semanal/);
  assert.match(prompt, /exerciciosPermitidos/);
  assert.match(prompt, new RegExp(candidates[0].id));
});

test('normalizeAiWorkout rejects exercises outside the allowed catalogue', () => {
  assert.throws(() => normalizeAiWorkout({
    name: 'Inválido',
    summary: 'usa exercício inventado',
    routines: [{ id: 'x', name: 'A', ex: [{ id: 'nao-existe', sets: 3, reps: '8', rest: 90, note: '' }] }],
    week: { 1: 'x' }
  }, candidateExercises(baseState.aiProfile, AI_EXERCISES)), /not allowed/);
});

test('applyAiWorkout replaces old AI routines and preserves manual routines', () => {
  const candidates = candidateExercises(baseState.aiProfile, AI_EXERCISES);
  const normalized = normalizeAiWorkout({
    name: 'Semana IA',
    summary: 'plano seguro',
    routines: [{ id: 'new-ai', name: 'Costas IA', ex: [{ id: candidates[0].id, sets: 3, reps: '8-12', rest: 90, note: 'controle' }] }],
    week: { 2: 'new-ai' }
  }, candidates);
  const next = applyAiWorkout(baseState, normalized, '2026-08-29T12:00:00.000Z');
  assert.ok(next.routines.some(routine => routine.id === 'manual'));
  assert.ok(!next.routines.some(routine => routine.id === 'old-ai'));
  assert.equal(next.week[1], 'manual');
  const generated = next.routines.find(routine => routine._aiSourceRoutineId === 'new-ai');
  assert.equal(next.week[2], generated.id);
  assert.equal(generated._aiGenerated, true);
});

test('applyAiWorkout never overwrites manual or Personal schedule assignments', () => {
  const state = {
    ...baseState,
    routines: [
      ...baseState.routines,
      { id: 'personal', name: 'Prescrito', _personalProgramId: 'program-1', ex: [] }
    ],
    week: { 1: 'manual', 2: 'old-ai', 3: 'personal' }
  };
  const normalized = {
    name: 'Semana IA', summary: 'segura',
    routines: [
      { id: 'ai-a', name: 'A', _aiGenerated: true, ex: [{ id: '0025' }] },
      { id: 'ai-b', name: 'B', _aiGenerated: true, ex: [{ id: '0047' }] },
      { id: 'ai-c', name: 'C', _aiGenerated: true, ex: [{ id: '0334' }] }
    ],
    week: { 1: 'ai-a', 2: 'ai-b', 3: 'ai-c' }
  };

  const next = applyAiWorkout(state, normalized, '2026-08-29T12:00:00.000Z');

  assert.equal(next.week[1], 'manual');
  assert.equal(next.week[2], 'ai-b');
  assert.equal(next.week[3], 'personal');
});

test('normalizeAiWorkout always replaces model routine ids with collision-free server ids', () => {
  const candidates = candidateExercises(baseState.aiProfile, AI_EXERCISES);
  const suppliedIds = ['manual', 'manual', 'personal'];
  let sequence = 0;
  const normalized = normalizeAiWorkout({
    name: 'Semana IA', summary: 'ids hostis',
    routines: suppliedIds.map((id, index) => ({
      id,
      name: `Treino ${index}`,
      ex: [{ id: candidates[index].id, sets: 3, reps: '8', rest: 90, note: '' }]
    })),
    week: suppliedIds.map((routineId, day) => ({ day: day + 1, routineId }))
  }, candidates, {
    existingIds: ['manual', 'personal', 'ai-fixed-1'],
    idFactory: () => sequence++ === 0 ? 'manual' : `server-${sequence}`
  });

  assert.equal(new Set(normalized.routines.map(routine => routine.id)).size, 3);
  assert.ok(normalized.routines.every(routine => routine.id.startsWith('server-')));
  assert.ok(normalized.routines.every(routine => !suppliedIds.includes(routine.id)));
});

test('normalizeAiWorkout creates a safe fallback week when provider mappings are invalid', () => {
  const candidates = candidateExercises(baseState.aiProfile, AI_EXERCISES);
  const normalized = normalizeAiWorkout({
    name: '', summary: '',
    routines: [{ id: 'source', name: '', ex: [{ id: candidates[0].id }] }],
    week: [{ day: 9, routineId: 'missing' }]
  }, candidates, { idFactory: () => 'server-routine' });
  assert.deepEqual(normalized.week, { 1: 'server-routine' });
  assert.equal(normalized.name, 'Treino da semana com IA');
});

test('parseModelJson handles fenced JSON responses', () => {
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseModelJson({ ok: true }), { ok: true });
});
