import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_EXERCISES,
  applyAiWorkout,
  buildWorkoutPrompt,
  candidateExercises,
  decryptSecret,
  encryptSecret,
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
    equipment: ['barbell', 'cable']
  }
};

test('missingAiFields reports the minimum data needed for an AI plan', () => {
  assert.deepEqual(missingAiFields({ bodyweight: [], aiProfile: {} }), ['peso', 'altura', 'objetivo', 'aparelhos']);
  assert.deepEqual(missingAiFields(baseState), []);
});

test('candidateExercises limits the catalogue to selected equipment', () => {
  const rows = candidateExercises({ equipment: ['barbell'] }, AI_EXERCISES);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.eq === 'barbell'));
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
  assert.equal(next.week[2], 'new-ai');
  assert.equal(next.routines.find(routine => routine.id === 'new-ai')._aiGenerated, true);
});

test('encrypted provider secrets round-trip without storing plaintext', () => {
  const encrypted = encryptSecret('server-secret', 'sk-test-value');
  assert.notEqual(encrypted, 'sk-test-value');
  assert.equal(decryptSecret('server-secret', encrypted), 'sk-test-value');
});

test('parseModelJson handles fenced JSON responses', () => {
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true });
});
