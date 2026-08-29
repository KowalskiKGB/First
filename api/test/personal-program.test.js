import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_COLLABORATION } from '../domain/schema.js';
import { createClient, saveProgram } from '../personal.js';

const NOW = '2026-08-29T12:00:00.000Z';
const randomId = (() => {
  let value = 0;
  return () => `id-${++value}`;
})();

function fixture() {
  const created = createClient({
    collaboration: structuredClone(INITIAL_COLLABORATION),
    trainerId: 'trainer-a',
    data: { name: 'Aluno' },
    now: NOW,
    randomId
  });
  return created;
}

test('programs discard arbitrary nested input and normalize bounded routines and week', () => {
  const { collaboration, client } = fixture();
  const exercise = {
    id: 'exercise-a',
    sets: 3,
    reps: '8-12',
    rest: 90,
    note: 'Controle',
    secret: { arbitrarily: { deep: true } }
  };
  const routine = {
    id: 'routine-a',
    name: 'Superior',
    ex: Array.from({ length: 40 }, () => exercise),
    arbitrary: { nested: true }
  };

  const saved = saveProgram({
    collaboration,
    actorId: 'trainer-a',
    clientId: client.id,
    data: {
      name: 'Programa',
      routines: Array.from({ length: 20 }, (_, index) => ({ ...routine, id: `routine-${index}` })),
      week: { 0: 'routine-0', 1: 'routine-1', 7: 'routine-7', malicious: { deep: true } }
    },
    now: NOW,
    randomId
  });

  assert.equal(saved.program.routines.length, 12);
  assert.equal(saved.program.routines[0].ex.length, 30);
  assert.deepEqual(saved.program.routines[0].ex[0], {
    id: 'exercise-a', sets: 3, reps: '8-12', rest: 90, note: 'Controle'
  });
  assert.equal('arbitrary' in saved.program.routines[0], false);
  assert.deepEqual(saved.program.week, { 0: 'routine-0', 1: 'routine-1' });
  assert.equal(JSON.stringify(saved.program).includes('secret'), false);
});

test('program history keeps only the latest twenty bounded versions', () => {
  let { collaboration, client } = fixture();
  for (let index = 1; index <= 25; index += 1) {
    collaboration = saveProgram({
      collaboration,
      actorId: 'trainer-a',
      clientId: client.id,
      data: { name: `Programa ${index}`, routines: [], week: {} },
      now: new Date(new Date(NOW).getTime() + index * 1000).toISOString(),
      randomId
    }).collaboration;
  }

  const program = collaboration.programs[0];
  assert.equal(program.version, 25);
  assert.equal(program.versions.length, 20);
  assert.deepEqual(program.versions.map(item => item.version), Array.from({ length: 20 }, (_, index) => index + 6));
});
