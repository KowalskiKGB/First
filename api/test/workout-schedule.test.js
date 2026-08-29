import test from 'node:test';
import assert from 'node:assert/strict';

import { reminderForState } from '../lib/workout-schedule.js';

test('web reminder reports N available sessions and targets the workout selector', () => {
  const state = {
    routines: [{ id: 'manual', name: 'Manual' }, { id: 'personal', name: 'Personal' }, { id: 'ai', name: 'IA' }],
    week: { 1: 'manual' },
    sourceSchedules: {
      personal: [{ sourceType: 'personal', planId: 'p1', active: true, week: { 1: 'personal' } }],
      ai: [{ sourceType: 'ai', planId: 'a1', active: true, week: { 1: 'ai' } }]
    }
  };

  assert.deepEqual(reminderForState(state, '2026-08-31'), {
    optionCount: 3,
    title: 'VocÃª tem 3 sessÃµes disponÃ­veis',
    body: 'Escolha qual treino iniciar.',
    tag: 'day-reminder',
    data: { url: '#/workout' }
  });
});
