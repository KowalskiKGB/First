import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { INITIAL_COLLABORATION } from '../domain/schema.js';
import {
  buildWorkspace,
  createPersonalRoutes,
  ensureProfile,
  requestConnection,
  respondConnection
} from '../personal.js';

const NOW = '2026-08-29T12:00:00.000Z';
const FUTURE = '2026-09-28T12:00:00.000Z';

const profile = (userId, roles = ['student'], extra = {}) => ({
  userId,
  roles,
  name: userId,
  shareCode: (userId.startsWith('trainer') ? 'A' : userId.startsWith('student') ? 'B' : 'C').repeat(32),
  shareCodeExpiresAt: FUTURE,
  timezone: 'America/Fortaleza',
  createdAt: NOW,
  updatedAt: NOW,
  ...extra
});

const collaboration = extra => ({ ...structuredClone(INITIAL_COLLABORATION), ...extra });

function routeFixture(t, state, options = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-personal-routes-'));
  const file = path.join(dataDir, 'collaboration.json');
  const limits = [];
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const routes = createPersonalRoutes({
    dataDir,
    origin: 'https://first.example',
    readSession: req => req.user || null,
    readBody: async (req, max) => {
      limits.push(max);
      return req.body || {};
    },
    json: (res, status, body) => Object.assign(res, { status, body }),
    readState: options.readState || (() => null),
    sendPush: async () => {}
  });
  writeFileSync(file, JSON.stringify(state));

  return {
    file,
    limits,
    routes,
    read: () => JSON.parse(readFileSync(file, 'utf8'))
  };
}

async function invoke(fixture, key, { user, body, origin, url } = {}) {
  const handler = fixture.routes[key];
  assert.equal(typeof handler, 'function', `missing route ${key}`);
  const req = {
    url: url || key.slice(key.indexOf(' ') + 1),
    headers: origin === undefined ? {} : { origin },
    user,
    body
  };
  const res = {};
  await handler(req, res);
  return res;
}

test('stale writes return only a safe revision projection', async t => {
  const fixture = routeFixture(t, collaboration({
    rev: 4,
    profiles: [profile('trainer-a', ['student', 'trainer'])]
  }));

  const res = await invoke(fixture, 'POST /api/personal/clients', {
    user: { id: 'trainer-a', name: 'A' },
    body: { rev: 3, name: 'Aluno' }
  });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'stale revision', rev: 4 });
  assert.equal('collaboration' in res.body, false);
});

test('production writes accept only the exact configured Origin', async t => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });

  await t.test('correct Origin', async t2 => {
    const fixture = routeFixture(t2, collaboration({ profiles: [profile('trainer-a', ['student', 'trainer'])] }));
    const res = await invoke(fixture, 'POST /api/personal/clients', {
      user: { id: 'trainer-a' },
      origin: 'https://first.example',
      body: { rev: 0, name: 'Aluno' }
    });
    assert.equal(res.status, 200);
  });

  for (const [label, origin] of [['wrong Origin', 'https://evil.example'], ['missing Origin', undefined]]) {
    await t.test(label, async t2 => {
      const fixture = routeFixture(t2, collaboration({ profiles: [profile('trainer-a', ['student', 'trainer'])] }));
      const res = await invoke(fixture, 'POST /api/personal/clients', {
        user: { id: 'trainer-a' }, origin, body: { rev: 0, name: 'Aluno' }
      });
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: 'invalid origin' });
    });
  }
});

test('every personal mutation requires an explicit trainer role, including admins', async t => {
  const mutations = [
    ['POST /api/personal/clients', { name: 'Aluno' }],
    ['PUT /api/personal/client', { clientId: 'client-a' }],
    ['PUT /api/personal/program', { clientId: 'client-a', routines: [] }],
    ['POST /api/personal/measurements', { clientId: 'client-a' }],
    ['PUT /api/personal/availability', { availability: [] }],
    ['POST /api/personal/appointments', { clientId: 'client-a' }],
    ['PUT /api/personal/appointment', { clientId: 'client-a', id: 'appointment-a' }],
    ['POST /api/personal/receivables', { clientId: 'client-a' }],
    ['PUT /api/personal/receivable', { clientId: 'client-a', id: 'receivable-a' }]
  ];

  for (const [key, payload] of mutations) {
    await t.test(key, async t2 => {
      const fixture = routeFixture(t2, collaboration({ profiles: [profile('admin-a')] }));
      const res = await invoke(fixture, key, {
        user: { id: 'admin-a', admin: true },
        body: { rev: 0, ...payload }
      });
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: 'trainer role required' });
    });
  }
});

test('only the counterpart to requestedBy can accept or refuse a connection', () => {
  const pending = {
    id: 'connection-a',
    studentId: 'student-a',
    trainerId: 'trainer-a',
    requestedBy: 'trainer-a',
    status: 'pending',
    grants: { plansWrite: true },
    createdAt: NOW,
    respondedAt: null,
    endedAt: null
  };
  const state = collaboration({
    profiles: [profile('student-a'), profile('trainer-a', ['student', 'trainer'])],
    connections: [pending]
  });

  assert.throws(() => respondConnection({
    collaboration: state,
    actorId: 'trainer-a',
    connectionId: pending.id,
    accept: true,
    now: NOW,
    randomId: () => 'id-a'
  }), /forbidden/);

  const accepted = respondConnection({
    collaboration: state,
    actorId: 'student-a',
    connectionId: pending.id,
    accept: true,
    now: NOW,
    randomId: () => 'id-a'
  });
  assert.equal(accepted.connection.status, 'active');
});

test('trainer accepting a student request cannot widen student grants', () => {
  const randomId = (() => {
    let value = 0;
    return () => `id-${++value}`;
  })();
  let current = collaboration({
    profiles: [
      profile('student-a'),
      profile('trainer-a', ['student', 'trainer'], { shareCode: 'A'.repeat(32) })
    ]
  });
  const requested = requestConnection({
    collaboration: current,
    actorId: 'student-a',
    shareCode: 'A'.repeat(32),
    now: NOW,
    randomId
  });
  current = requested.collaboration;

  const accepted = respondConnection({
    collaboration: current,
    actorId: 'trainer-a',
    connectionId: requested.connection.id,
    accept: true,
    grants: { measurementsWrite: true, liveActivityRead: true },
    now: NOW,
    randomId
  });

  assert.equal(accepted.connection.grants.measurementsWrite, false);
  assert.equal(accepted.connection.grants.liveActivityRead, false);
});

test('linked clients require an active connection and state projections honor each read grant', async t => {
  const client = {
    id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'Aluno',
    targetSessionsPerWeek: 3, inactiveAfterDays: 7, createdAt: NOW, archivedAt: null
  };
  const connection = {
    id: 'connection-a', studentId: 'student-a', trainerId: 'trainer-a', requestedBy: 'student-a',
    status: 'active', grants: { workoutsRead: false, progressRead: false }, createdAt: NOW
  };
  const state = collaboration({ clients: [client], connections: [connection] });
  let reads = 0;
  const readState = () => {
    reads += 1;
    return { workouts: [{ d: '2026-08-28', vol: 1200 }] };
  };

  const denied = buildWorkspace({ collaboration: state, trainerId: 'trainer-a', now: NOW, readState });
  assert.equal(reads, 0);
  assert.equal(denied.clients.length, 1);
  assert.equal(denied.clients[0].progress, undefined);

  const workoutsOnly = buildWorkspace({
    collaboration: { ...state, connections: [{ ...connection, grants: { workoutsRead: true, progressRead: false } }] },
    trainerId: 'trainer-a', now: NOW, readState
  });
  assert.deepEqual(Object.keys(workoutsOnly.clients[0].progress), ['recentWorkouts']);

  const progressOnly = buildWorkspace({
    collaboration: { ...state, connections: [{ ...connection, grants: { workoutsRead: false, progressRead: true } }] },
    trainerId: 'trainer-a', now: NOW, readState
  });
  assert.equal(progressOnly.clients[0].progress.adherence, 8);
  assert.equal('recentWorkouts' in progressOnly.clients[0].progress, false);

  const ended = buildWorkspace({
    collaboration: { ...state, connections: [{ ...connection, status: 'ended', endedAt: NOW }] },
    trainerId: 'trainer-a', now: NOW, readState
  });
  assert.equal(ended.clients.length, 0);
  assert.equal(reads, 2);
});

test('collaboration projection includes only published programs assigned to the signed-in student', async t => {
  const fixture = routeFixture(t, collaboration({
    profiles: [profile('student-a')],
    clients: [
      { id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'A', archivedAt: null },
      { id: 'client-b', trainerId: 'trainer-b', studentUserId: 'student-b', name: 'B', archivedAt: null }
    ],
    programs: [
      { id: 'program-a', trainerId: 'trainer-a', clientId: 'client-a', name: 'A', status: 'published', routines: [] },
      { id: 'program-b', trainerId: 'trainer-b', clientId: 'client-b', name: 'B', status: 'published', routines: [{ secret: true }] },
      { id: 'draft-a', trainerId: 'trainer-a', clientId: 'client-a', name: 'Draft', status: 'draft', routines: [] }
    ]
  }));

  const res = await invoke(fixture, 'GET /api/collaboration', { user: { id: 'student-a' } });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.programs.map(item => item.id), ['program-a']);
  assert.equal(JSON.stringify(res.body).includes('program-b'), false);
  assert.equal(JSON.stringify(res.body).includes('secret'), false);
});

test('foreign trainer client IDs are non-enumerable on reads and writes', async t => {
  const fixture = routeFixture(t, collaboration({
    profiles: [profile('trainer-a', ['student', 'trainer']), profile('trainer-b', ['student', 'trainer'])],
    clients: [{
      id: 'client-b', trainerId: 'trainer-b', studentUserId: null, name: 'Privado',
      notes: 'segredo', createdAt: NOW, updatedAt: NOW, archivedAt: null
    }]
  }));

  const read = await invoke(fixture, 'GET /api/personal/client', {
    user: { id: 'trainer-a' }, url: '/api/personal/client?id=client-b'
  });
  assert.equal(read.status, 404);

  const write = await invoke(fixture, 'PUT /api/personal/client', {
    user: { id: 'trainer-a' },
    body: { rev: 0, clientId: 'client-b', name: 'Tomado' }
  });
  assert.equal(write.status, 404);
  assert.equal(fixture.read().clients[0].name, 'Privado');
});

test('share codes carry 128 bits and expired codes renew without exposing lookup state', async t => {
  await t.test('new profile', async t2 => {
    const fixture = routeFixture(t2, collaboration({}));
    const res = await invoke(fixture, 'GET /api/collaboration', { user: { id: 'student-a', name: 'A' } });
    assert.match(res.body.profile.shareCode, /^[A-F0-9]{32}$/);
  });

  await t.test('expired profile', async t2 => {
    const fixture = routeFixture(t2, collaboration({
      profiles: [profile('student-a', ['student'], {
        shareCode: 'EXPIRED',
        shareCodeExpiresAt: '2026-08-01T00:00:00.000Z'
      })]
    }));
    const res = await invoke(fixture, 'GET /api/collaboration', { user: { id: 'student-a', name: 'A' } });
    assert.notEqual(res.body.profile.shareCode, 'EXPIRED');
    assert.match(res.body.profile.shareCode, /^[A-F0-9]{32}$/);
  });

  await t.test('legacy weak profile', async t2 => {
    const fixture = routeFixture(t2, collaboration({
      profiles: [profile('student-a', ['student'], {
        shareCode: 'ABCD1234',
        shareCodeExpiresAt: FUTURE
      })]
    }));
    const res = await invoke(fixture, 'GET /api/collaboration', { user: { id: 'student-a', name: 'A' } });
    assert.notEqual(res.body.profile.shareCode, 'ABCD1234');
    assert.match(res.body.profile.shareCode, /^[A-F0-9]{32}$/);
  });

  const renewed = ensureProfile({
    collaboration: collaboration({ profiles: [profile('student-a', ['student'], {
      shareCode: 'EXPIRED', shareCodeExpiresAt: '2026-08-01T00:00:00.000Z'
    })] }),
    userId: 'student-a', now: NOW,
    randomId: () => '0123456789abcdef0123456789abcdef'
  });
  assert.equal(renewed.profile.shareCode, '0123456789ABCDEF0123456789ABCDEF');
});

test('invalid, expired and legacy share codes return the same non-enumerating response', async t => {
  const base = collaboration({
    profiles: [
      profile('trainer-a', ['student', 'trainer']),
      profile('student-a', ['student'], { shareCode: 'EXPIRED', shareCodeExpiresAt: '2026-08-01T00:00:00.000Z' })
    ]
  });
  const missingFixture = routeFixture(t, base);
  const expiredFixture = routeFixture(t, base);
  const legacyFixture = routeFixture(t, collaboration({
    profiles: [
      profile('trainer-a', ['student', 'trainer']),
      profile('student-a', ['student'], { shareCode: 'ABCD1234', shareCodeExpiresAt: FUTURE })
    ]
  }));

  const missing = await invoke(missingFixture, 'POST /api/connections/request', {
    user: { id: 'trainer-a' }, body: { rev: 0, shareCode: 'MISSING' }
  });
  const expired = await invoke(expiredFixture, 'POST /api/connections/request', {
    user: { id: 'trainer-a' }, body: { rev: 0, shareCode: 'EXPIRED' }
  });
  const legacy = await invoke(legacyFixture, 'POST /api/connections/request', {
    user: { id: 'trainer-a' }, body: { rev: 0, shareCode: 'ABCD1234' }
  });

  assert.deepEqual({ status: missing.status, body: missing.body }, { status: 400, body: { error: 'invalid share code' } });
  assert.deepEqual({ status: expired.status, body: expired.body }, { status: 400, body: { error: 'invalid share code' } });
  assert.deepEqual({ status: legacy.status, body: legacy.body }, { status: 400, body: { error: 'invalid share code' } });
});
