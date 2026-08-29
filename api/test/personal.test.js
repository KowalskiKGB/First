import test from 'node:test';
import assert from 'node:assert/strict';

import { INITIAL_COLLABORATION } from '../domain/schema.js';
import {
  authorize,
  ensureProfile,
  requestConnection,
  respondConnection,
  endConnection,
  createClient,
  saveProgram,
  recordMeasurement,
  saveAppointment,
  saveReceivable,
  buildWorkspace
} from '../personal.js';

const now = '2026-08-29T12:00:00.000Z';
const idSource = () => {
  let n = 0;
  return () => 'id' + (++n);
};

test('connection grants allow plans and deny revoked cross access immediately', () => {
  const randomId = idSource();
  let collaboration = structuredClone(INITIAL_COLLABORATION);

  collaboration = ensureProfile({ collaboration, userId: 'student1', now, randomId, randomShareCode: () => 'A'.repeat(32) }).collaboration;
  collaboration = ensureProfile({ collaboration, userId: 'trainer1', roles: ['trainer'], now, randomId, randomShareCode: () => 'B'.repeat(32) }).collaboration;

  const requested = requestConnection({
    collaboration,
    actorId: 'trainer1',
    actorRole: 'trainer',
    shareCode: collaboration.profiles[0].shareCode,
    now,
    randomId
  });
  collaboration = requested.collaboration;
  collaboration = respondConnection({
    collaboration,
    actorId: 'student1',
    connectionId: requested.connection.id,
    accept: true,
    grants: { plansWrite: true, measurementsWrite: false },
    now,
    randomId
  }).collaboration;

  const client = collaboration.clients.find(c => c.studentUserId === 'student1');
  assert.equal(authorize({ collaboration, actorId: 'trainer1', client, action: 'plans:write' }), true);
  assert.equal(authorize({ collaboration, actorId: 'trainer1', client, action: 'measurements:write' }), false);

  collaboration = endConnection({ collaboration, actorId: 'student1', connectionId: requested.connection.id, now, randomId }).collaboration;

  assert.equal(authorize({ collaboration, actorId: 'trainer1', client, action: 'plans:write' }), false);
});

test('trainer workspace summarizes clients, schedule, measures, programs and receivables', () => {
  const randomId = idSource();
  let collaboration = structuredClone(INITIAL_COLLABORATION);
  collaboration = ensureProfile({ collaboration, userId: 'trainer1', roles: ['trainer'], now, randomId }).collaboration;
  const created = createClient({
    collaboration,
    trainerId: 'trainer1',
    data: { name: 'Ana Souza', goal: 'Hipertrofia' },
    now,
    randomId
  });
  collaboration = created.collaboration;
  const clientId = created.client.id;

  collaboration = recordMeasurement({
    collaboration,
    actorId: 'trainer1',
    clientId,
    data: { kind: 'weight', value: 78.4, unit: 'kg', observedAt: '2026-08-28' },
    now,
    randomId
  }).collaboration;
  collaboration = saveProgram({
    collaboration,
    actorId: 'trainer1',
    clientId,
    data: { name: 'Upper/lower', routines: [{ name: 'Superior', ex: [] }] },
    now,
    randomId
  }).collaboration;
  collaboration = saveAppointment({
    collaboration,
    actorId: 'trainer1',
    clientId,
    data: { startsAt: '2026-08-29T14:00:00.000Z', endsAt: '2026-08-29T15:00:00.000Z', note: 'Forca' },
    now,
    randomId
  }).collaboration;
  collaboration = saveReceivable({
    collaboration,
    actorId: 'trainer1',
    clientId,
    data: { period: '2026-08', dueOn: '2026-08-25', amountCents: 35000, status: 'open' },
    now,
    randomId
  }).collaboration;

  const workspace = buildWorkspace({ collaboration, trainerId: 'trainer1', now, readState: () => ({ workouts: [] }) });

  assert.equal(workspace.kpis.activeClients, 1);
  assert.equal(workspace.finance.overdueCents, 35000);
  assert.equal(workspace.clients[0].priority, 'urgent');
  assert.equal(workspace.clients[0].latestMeasurement.value, 78.4);
  assert.equal(workspace.agenda.today.some(item => item.clientName === 'Ana Souza'), true);
});

test('schedule refuses overlapping active appointments and finance keeps clients isolated', () => {
  const randomId = idSource();
  let collaboration = structuredClone(INITIAL_COLLABORATION);
  collaboration = ensureProfile({ collaboration, userId: 'trainer1', roles: ['trainer'], now, randomId }).collaboration;
  collaboration = ensureProfile({ collaboration, userId: 'trainer2', roles: ['trainer'], now, randomId }).collaboration;

  const a = createClient({ collaboration, trainerId: 'trainer1', data: { name: 'Aluno A' }, now, randomId });
  collaboration = a.collaboration;
  const b = createClient({ collaboration, trainerId: 'trainer2', data: { name: 'Aluno B' }, now, randomId });
  collaboration = b.collaboration;

  collaboration = saveAppointment({
    collaboration,
    actorId: 'trainer1',
    clientId: a.client.id,
    data: { startsAt: '2026-08-29T14:00:00.000Z', endsAt: '2026-08-29T15:00:00.000Z' },
    now,
    randomId
  }).collaboration;

  assert.throws(() => saveAppointment({
    collaboration,
    actorId: 'trainer1',
    clientId: a.client.id,
    data: { startsAt: '2026-08-29T14:30:00.000Z', endsAt: '2026-08-29T15:30:00.000Z' },
    now,
    randomId
  }), /schedule conflict/);
  assert.throws(() => saveReceivable({
    collaboration,
    actorId: 'trainer1',
    clientId: b.client.id,
    data: { period: '2026-08', dueOn: '2026-08-30', amountCents: 10000 },
    now,
    randomId
  }), /forbidden/);
});
