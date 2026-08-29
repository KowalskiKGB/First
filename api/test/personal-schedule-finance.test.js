import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { INITIAL_COLLABORATION } from '../domain/schema.js';
import {
  buildWorkspace,
  createClient,
  createPersonalRoutes,
  saveAppointment,
  saveReceivable,
  updateClient
} from '../personal.js';

const NOW = '2026-08-29T12:00:00.000Z';
const profile = (userId, timezone = 'America/Fortaleza') => ({
  userId,
  roles: ['student', 'trainer'],
  shareCode: (userId.endsWith('a') ? 'A' : 'B').repeat(32),
  shareCodeExpiresAt: '2026-09-29T00:00:00.000Z',
  timezone,
  createdAt: NOW,
  updatedAt: NOW
});
const state = extra => ({ ...structuredClone(INITIAL_COLLABORATION), ...extra });
const ids = () => {
  let value = 0;
  return () => `generated-${++value}`;
};

function managedFixture() {
  const randomId = ids();
  let collaboration = state({ profiles: [profile('trainer-a')] });
  const created = createClient({
    collaboration, trainerId: 'trainer-a', data: { name: 'Aluno A' }, now: NOW, randomId
  });
  return { collaboration: created.collaboration, client: created.client, randomId };
}

function routeFixture(t, collaboration) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-personal-schedule-'));
  const file = path.join(dataDir, 'collaboration.json');
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const routes = createPersonalRoutes({
    dataDir,
    origin: 'https://first.example',
    readSession: req => req.user,
    readBody: async req => req.body,
    json: (res, status, body) => Object.assign(res, { status, body }),
    readState: () => null,
    sendPush: async () => {}
  });
  writeFileSync(file, JSON.stringify(collaboration));
  return { routes, file };
}

async function invoke(fixture, key, body, userId = 'trainer-a') {
  const handler = fixture.routes[key];
  assert.equal(typeof handler, 'function', `missing route ${key}`);
  const req = { url: key.slice(key.indexOf(' ') + 1), headers: {}, user: { id: userId }, body };
  const res = {};
  await handler(req, res);
  return res;
}

test('receivables require positive safe integer cents and persist BRL explicitly', () => {
  const { collaboration, client, randomId } = managedFixture();
  for (const amountCents of [undefined, null, '1000', 1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => saveReceivable({
      collaboration,
      actorId: 'trainer-a',
      clientId: client.id,
      data: { period: '2026-08', dueOn: '2026-08-31', amountCents },
      now: NOW,
      randomId
    }), /invalid amount/);
  }

  const saved = saveReceivable({
    collaboration,
    actorId: 'trainer-a',
    clientId: client.id,
    data: { period: '2026-08', dueOn: '2026-08-31', amountCents: 1000 },
    now: NOW,
    randomId
  });
  assert.equal(saved.receivable.amountCents, 1000);
  assert.equal(saved.receivable.currency, 'BRL');
});

test('paid receivables accept only real instants and normalize paidAt', () => {
  const { collaboration, client, randomId } = managedFixture();
  const data = {
    period: '2026-08', dueOn: '2026-08-31', amountCents: 1000, status: 'paid'
  };

  for (const paidAt of [{ nested: true }, 'not-a-date', '2026-02-30T12:00:00-03:00']) {
    assert.throws(() => saveReceivable({
      collaboration, actorId: 'trainer-a', clientId: client.id,
      data: { ...data, paidAt }, now: NOW, randomId
    }), /invalid paid date/);
  }

  const saved = saveReceivable({
    collaboration, actorId: 'trainer-a', clientId: client.id,
    data: { ...data, paidAt: '2026-08-29T09:00:00-03:00' }, now: NOW, randomId
  });
  assert.equal(saved.receivable.paidAt, '2026-08-29T12:00:00.000Z');
});

test('receivable calendar values must be real dates and months', () => {
  const { collaboration, client, randomId } = managedFixture();
  const base = { amountCents: 1000, status: 'open' };

  assert.throws(() => saveReceivable({
    collaboration, actorId: 'trainer-a', clientId: client.id,
    data: { ...base, period: '2026-02', dueOn: '2026-02-30' }, now: NOW, randomId
  }), /invalid receivable/);
  assert.throws(() => saveReceivable({
    collaboration, actorId: 'trainer-a', clientId: client.id,
    data: { ...base, period: '2026-13', dueOn: '2026-08-31' }, now: NOW, randomId
  }), /invalid receivable/);
});

test('a trainer cannot create duplicate receivables for the same client period', () => {
  const { collaboration, client, randomId } = managedFixture();
  const first = saveReceivable({
    collaboration,
    actorId: 'trainer-a',
    clientId: client.id,
    data: { period: '2026-08', dueOn: '2026-08-31', amountCents: 1000 },
    now: NOW,
    randomId
  });

  assert.throws(() => saveReceivable({
    collaboration: first.collaboration,
    actorId: 'trainer-a',
    clientId: client.id,
    data: { period: '2026-08', dueOn: '2026-08-30', amountCents: 2000 },
    now: NOW,
    randomId
  }), /receivable already exists/);
});

test('custom availability derives slots in the trainer timezone', () => {
  const collaboration = state({
    profiles: [profile('trainer-a', 'Europe/Lisbon')],
    availability: [{ trainerId: 'trainer-a', weekday: 1, start: '08:00', end: '10:00', slotMinutes: 30 }]
  });

  const workspace = buildWorkspace({
    collaboration,
    trainerId: 'trainer-a',
    now: '2026-08-31T07:15:00.000Z',
    readState: () => null
  });

  assert.deepEqual(workspace.availability, collaboration.availability);
  assert.equal(workspace.agenda.openSlots.length, 4);
  assert.equal(workspace.kpis.freeHoursToday, 2);
  assert.deepEqual(workspace.agenda.openSlots[0], {
    startsAt: '2026-08-31T07:00:00.000Z',
    endsAt: '2026-08-31T07:30:00.000Z'
  });
});

test('invalid trainer timezone falls back to the application timezone', () => {
  const collaboration = state({ profiles: [profile('trainer-a', 'Mars/Olympus')] });

  const workspace = buildWorkspace({
    collaboration,
    trainerId: 'trainer-a',
    now: NOW,
    readState: () => null
  });
  const expected = buildWorkspace({
    collaboration: state({ profiles: [profile('trainer-a', 'America/Fortaleza')] }),
    trainerId: 'trainer-a',
    now: NOW,
    readState: () => null
  });

  assert.deepEqual(workspace.agenda.openSlots, expected.agenda.openSlots);
});

test('active relationship authorizes trainer-owned operations independently from plansWrite', () => {
  const randomId = ids();
  const client = {
    id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'Aluno',
    targetSessionsPerWeek: 3, inactiveAfterDays: 7, createdAt: NOW, archivedAt: null
  };
  let collaboration = state({
    profiles: [profile('trainer-a')],
    clients: [client],
    connections: [{
      id: 'connection-a', trainerId: 'trainer-a', studentId: 'student-a', requestedBy: 'student-a',
      status: 'active', grants: { plansWrite: false, workoutsRead: false, progressRead: false }, createdAt: NOW
    }]
  });

  collaboration = updateClient({
    collaboration, actorId: 'trainer-a', clientId: client.id,
    data: { goal: 'Forca' }, now: NOW, randomId
  }).collaboration;
  collaboration = saveAppointment({
    collaboration, actorId: 'trainer-a', clientId: client.id,
    data: { startsAt: '2026-08-31T08:00:00-03:00', endsAt: '2026-08-31T09:00:00-03:00' },
    now: NOW, randomId
  }).collaboration;
  collaboration = saveReceivable({
    collaboration, actorId: 'trainer-a', clientId: client.id,
    data: { period: '2026-08', dueOn: '2026-08-31', amountCents: 1000 },
    now: NOW, randomId
  }).collaboration;

  assert.equal(collaboration.clients[0].goal, 'Forca');
  assert.equal(collaboration.appointments.length, 1);
  assert.equal(collaboration.receivables.length, 1);
});

test('appointments must be real timezone-aware instants inside availability', () => {
  const { collaboration, client, randomId } = managedFixture();
  const available = {
    ...collaboration,
    availability: [{ trainerId: 'trainer-a', weekday: 1, start: '08:00', end: '10:00', slotMinutes: 60 }]
  };

  assert.throws(() => saveAppointment({
    collaboration: available,
    actorId: 'trainer-a',
    clientId: client.id,
    data: { startsAt: '2026-08-31T10:00:00-03:00', endsAt: '2026-08-31T11:00:00-03:00' },
    now: NOW,
    randomId
  }), /outside availability/);
  assert.throws(() => saveAppointment({
    collaboration: available,
    actorId: 'trainer-a',
    clientId: client.id,
    data: { startsAt: 'not-a-date', endsAt: '2026-08-31T12:00:00.000Z' },
    now: NOW,
    randomId
  }), /invalid appointment/);

  const saved = saveAppointment({
    collaboration: available,
    actorId: 'trainer-a',
    clientId: client.id,
    data: { startsAt: '2026-08-31T08:00:00-03:00', endsAt: '2026-08-31T09:00:00-03:00' },
    now: NOW,
    randomId
  });
  assert.equal(saved.appointment.startsAt, '2026-08-31T11:00:00.000Z');
});

test('availability route validates intervals and replaces only the actor schedule', async t => {
  const initial = state({
    profiles: [profile('trainer-a'), profile('trainer-b')],
    availability: [{ trainerId: 'trainer-b', weekday: 2, start: '09:00', end: '12:00', slotMinutes: 60 }]
  });
  const fixture = routeFixture(t, initial);

  const malformed = await invoke(fixture, 'PUT /api/personal/availability', {
    rev: 0,
    availability: [{ weekday: 7, start: '08:00', end: '10:00', slotMinutes: 30 }]
  });
  assert.equal(malformed.status, 400);

  const invalid = await invoke(fixture, 'PUT /api/personal/availability', {
    rev: 0,
    availability: [
      { weekday: 1, start: '08:00', end: '10:00', slotMinutes: 30 },
      { weekday: 1, start: '09:00', end: '11:00', slotMinutes: 30 }
    ]
  });
  assert.equal(invalid.status, 400);

  const valid = await invoke(fixture, 'PUT /api/personal/availability', {
    rev: 0,
    availability: [{ weekday: 1, start: '08:00', end: '10:00', slotMinutes: 30 }]
  });
  assert.equal(valid.status, 200);
  const persisted = JSON.parse(readFileSync(fixture.file, 'utf8')).availability;
  assert.deepEqual(persisted, [
    { trainerId: 'trainer-b', weekday: 2, start: '09:00', end: '12:00', slotMinutes: 60 },
    { trainerId: 'trainer-a', weekday: 1, start: '08:00', end: '10:00', slotMinutes: 30 }
  ]);
});

test('POST ignores supplied resource IDs while PUT requires an owned matching resource', async t => {
  const initial = state({
    profiles: [profile('trainer-a'), profile('trainer-b')],
    clients: [
      { id: 'client-a', trainerId: 'trainer-a', studentUserId: null, name: 'A', archivedAt: null },
      { id: 'client-b', trainerId: 'trainer-b', studentUserId: null, name: 'B', archivedAt: null }
    ],
    appointments: [{
      id: 'appointment-b', trainerId: 'trainer-b', clientId: 'client-b',
      startsAt: '2026-08-31T12:00:00.000Z', endsAt: '2026-08-31T13:00:00.000Z',
      status: 'scheduled', createdBy: 'trainer-b', createdAt: NOW, updatedAt: NOW
    }],
    receivables: [{
      id: 'receivable-b', trainerId: 'trainer-b', clientId: 'client-b', period: '2026-08',
      dueOn: '2026-08-31', amountCents: 1000, currency: 'BRL', status: 'open',
      createdAt: NOW, updatedAt: NOW
    }]
  });
  const fixture = routeFixture(t, initial);

  const createdAppointment = await invoke(fixture, 'POST /api/personal/appointments', {
    rev: 0,
    id: 'attacker-appointed-id',
    clientId: 'client-a',
    startsAt: '2026-08-31T08:00:00-03:00',
    endsAt: '2026-08-31T09:00:00-03:00'
  });
  assert.equal(createdAppointment.status, 200);
  let persisted = JSON.parse(readFileSync(fixture.file, 'utf8'));
  assert.equal(persisted.appointments.some(item => item.id === 'attacker-appointed-id'), false);
  assert.equal(persisted.appointments.length, 2);

  const createdReceivable = await invoke(fixture, 'POST /api/personal/receivables', {
    rev: 1,
    id: 'attacker-receivable-id',
    clientId: 'client-a', period: '2026-08', dueOn: '2026-08-31', amountCents: 2000
  });
  assert.equal(createdReceivable.status, 200);
  persisted = JSON.parse(readFileSync(fixture.file, 'utf8'));
  assert.equal(persisted.receivables.some(item => item.id === 'attacker-receivable-id'), false);
  assert.equal(persisted.receivables.length, 2);

  const missingId = await invoke(fixture, 'PUT /api/personal/appointment', {
    rev: 2, clientId: 'client-a', startsAt: '2026-08-31T09:00:00-03:00', endsAt: '2026-08-31T10:00:00-03:00'
  });
  assert.equal(missingId.status, 400);

  const stolenAppointment = await invoke(fixture, 'PUT /api/personal/appointment', {
    rev: 2, id: 'appointment-b', clientId: 'client-a',
    startsAt: '2026-08-31T09:00:00-03:00', endsAt: '2026-08-31T10:00:00-03:00'
  });
  assert.equal(stolenAppointment.status, 404);

  const stolenReceivable = await invoke(fixture, 'PUT /api/personal/receivable', {
    rev: 2, id: 'receivable-b', clientId: 'client-a',
    period: '2026-08', dueOn: '2026-08-31', amountCents: 3000
  });
  assert.equal(stolenReceivable.status, 404);
  persisted = JSON.parse(readFileSync(fixture.file, 'utf8'));
  assert.equal(persisted.appointments.find(item => item.id === 'appointment-b').trainerId, 'trainer-b');
  assert.equal(persisted.receivables.find(item => item.id === 'receivable-b').amountCents, 1000);
});

test('workspace and finance remain isolated between trainers', () => {
  const collaboration = state({
    profiles: [profile('trainer-a'), profile('trainer-b')],
    clients: [
      { id: 'client-a', trainerId: 'trainer-a', studentUserId: null, name: 'A', archivedAt: null },
      { id: 'client-b', trainerId: 'trainer-b', studentUserId: null, name: 'B', archivedAt: null }
    ],
    receivables: [
      { id: 'ra', trainerId: 'trainer-a', clientId: 'client-a', period: '2026-08', dueOn: '2026-08-31', amountCents: 1000, status: 'open' },
      { id: 'rb', trainerId: 'trainer-b', clientId: 'client-b', period: '2026-08', dueOn: '2026-08-20', amountCents: 900000, status: 'open' }
    ]
  });

  const workspace = buildWorkspace({ collaboration, trainerId: 'trainer-a', now: NOW, readState: () => null });
  assert.deepEqual(workspace.clients.map(item => item.id), ['client-a']);
  assert.equal(workspace.finance.expectedCents, 1000);
  assert.equal(workspace.finance.overdueCents, 0);
});
