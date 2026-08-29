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
    title: 'Você tem 3 sessões disponíveis',
    body: 'Escolha qual treino iniciar.',
    tag: 'day-reminder',
    data: { url: '#/workout' }
  });
});

test('web reminder keeps the existing single-session copy and ignores inactive or missing entries', () => {
  const state = {
    routines: [{ id: 'manual', name: 'Manual', emoji: 'M' }],
    week: { 1: 'manual' },
    sourceSchedules: {
      personal: [{ sourceType: 'personal', planId: 'inactive', active: false, week: { 1: 'missing' } }],
      ai: [{ sourceType: 'ai', planId: 'missing', active: true, week: { 1: ['missing', ''] } }]
    }
  };

  assert.deepEqual(reminderForState(state, '2026-08-31'), {
    optionCount: 1,
    title: 'M Manual today',
    body: "It's on your plan — let's go 💪",
    tag: 'day-reminder',
    data: { url: '#/workout' }
  });
  assert.equal(reminderForState({ routines: [], week: {} }, '2026-08-31'), null);
});
