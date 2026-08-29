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
    sendPush: options.sendPush || (async () => {})
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

test('malformed pending connection cannot be accepted when requestedBy is not a participant', () => {
  const pending = {
    id: 'connection-malformed',
    studentId: 'student-a',
    trainerId: 'trainer-a',
    requestedBy: 'stranger-a',
    status: 'pending',
    grants: { plansWrite: true },
    createdAt: NOW,
    respondedAt: null,
    endedAt: null
  };
  const state = collaboration({ connections: [pending] });

  assert.throws(() => respondConnection({
    collaboration: state,
    actorId: 'student-a',
    connectionId: pending.id,
    accept: true,
    grants: { plansWrite: true },
    now: NOW,
    randomId: () => 'id-a'
  }), error => error.status === 409 && error.message === 'invalid connection state');
  assert.equal(state.connections[0].status, 'pending');
});

test('connection response route does not persist a malformed pending transition', async t => {
  const pending = {
    id: 'connection-malformed',
    studentId: 'student-a',
    trainerId: 'trainer-a',
    requestedBy: 'stranger-a',
    status: 'pending',
    grants: { plansWrite: true },
    createdAt: NOW,
    respondedAt: null,
    endedAt: null
  };
  const fixture = routeFixture(t, collaboration({
    profiles: [profile('student-a'), profile('trainer-a', ['student', 'trainer'])],
    connections: [pending]
  }));

  const res = await invoke(fixture, 'POST /api/connections/respond', {
    user: { id: 'student-a' },
    body: { rev: 0, connectionId: pending.id, accept: true, grants: { plansWrite: true } }
  });

  assert.deepEqual({ status: res.status, body: res.body }, {
    status: 409,
    body: { error: 'invalid connection state' }
  });
  assert.equal(fixture.read().rev, 0);
  assert.equal(fixture.read().connections[0].status, 'pending');
  assert.equal(fixture.read().clients.length, 0);
});

test('dual-role actor can request as student with explicit grants that trainer cannot widen', async t => {
  const fixture = routeFixture(t, collaboration({
    profiles: [
      profile('student-a', ['student', 'trainer']),
      profile('trainer-a', ['student', 'trainer'], { shareCode: 'A'.repeat(32) })
    ]
  }));

  const requested = await invoke(fixture, 'POST /api/connections/request', {
    user: { id: 'student-a' },
    body: {
      rev: 0,
      actorRole: 'student',
      shareCode: 'A'.repeat(32),
      grants: { plansWrite: false, workoutsRead: true, measurementsWrite: 'yes', unknown: true }
    }
  });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.connections[0].studentId, 'student-a');
  assert.equal(requested.body.connections[0].trainerId, 'trainer-a');
  assert.deepEqual(requested.body.connections[0].grants, {
    plansWrite: false,
    workoutsRead: true,
    progressRead: false,
    measurementsWrite: false,
    liveActivityRead: false
  });

  const accepted = await invoke(fixture, 'POST /api/connections/respond', {
    user: { id: 'trainer-a' },
    body: {
      rev: 1,
      connectionId: requested.body.connections[0].id,
      accept: true,
      grants: { plansWrite: true, measurementsWrite: true, liveActivityRead: true }
    }
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body.connections[0].grants, requested.body.connections[0].grants);

  const ended = await invoke(fixture, 'POST /api/connections/end', {
    user: { id: 'trainer-a' },
    body: { rev: 2, connectionId: requested.body.connections[0].id }
  });
  assert.deepEqual({ status: ended.status, body: ended.body }, { status: 200, body: { rev: 3 } });
  assert.equal(fixture.read().connections[0].status, 'ended');
});

test('relationship inbox events also push only to the counterpart', async t => {
  const pushes = [];
  const fixture = routeFixture(t, collaboration({
    profiles: [
      profile('student-a'),
      profile('trainer-a', ['student', 'trainer'], { shareCode: 'A'.repeat(32) })
    ]
  }), {
    sendPush: async (userId, payload) => pushes.push({ userId, payload })
  });

  const requested = await invoke(fixture, 'POST /api/connections/request', {
    user: { id: 'student-a' },
    body: {
      rev: 0,
      actorRole: 'student',
      shareCode: 'A'.repeat(32),
      grants: { plansWrite: true }
    }
  });
  const connectionId = requested.body.connections[0].id;

  await invoke(fixture, 'POST /api/connections/respond', {
    user: { id: 'trainer-a' },
    body: { rev: 1, connectionId, accept: true }
  });
  await invoke(fixture, 'POST /api/connections/end', {
    user: { id: 'student-a' },
    body: { rev: 2, connectionId }
  });

  assert.deepEqual(fixture.read().notifications.map(item => ({
    userId: item.userId,
    title: item.title,
    resourceId: item.resourceId
  })), [
    { userId: 'trainer-a', title: 'Solicitação de vínculo', resourceId: connectionId },
    { userId: 'student-a', title: 'Vínculo aceito', resourceId: connectionId },
    { userId: 'trainer-a', title: 'Vínculo encerrado', resourceId: connectionId }
  ]);
  assert.deepEqual(pushes, [
    {
      userId: 'trainer-a',
      payload: { title: 'Solicitação de vínculo', body: 'Um novo vínculo com Personal aguarda resposta.', tag: 'personal' }
    },
    {
      userId: 'student-a',
      payload: { title: 'Vínculo aceito', body: 'O aluno agora aparece no painel do Personal.', tag: 'personal' }
    },
    {
      userId: 'trainer-a',
      payload: { title: 'Vínculo encerrado', body: 'As permissões compartilhadas foram revogadas.', tag: 'personal' }
    }
  ]);
});

test('program publishing and updates persist generic student alerts and push them', async t => {
  const pushes = [];
  const fixture = routeFixture(t, collaboration({
    profiles: [profile('student-a'), profile('trainer-a', ['student', 'trainer'])],
    connections: [{
      id: 'connection-a', studentId: 'student-a', trainerId: 'trainer-a', requestedBy: 'student-a',
      status: 'active', grants: { plansWrite: true }, createdAt: NOW, respondedAt: NOW, endedAt: null
    }],
    clients: [{
      id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'Nome privado',
      targetSessionsPerWeek: 3, inactiveAfterDays: 7, createdAt: NOW, updatedAt: NOW, archivedAt: null
    }]
  }), {
    sendPush: async (userId, payload) => pushes.push({ userId, payload })
  });

  await invoke(fixture, 'PUT /api/personal/program', {
    user: { id: 'trainer-a' },
    body: { rev: 0, clientId: 'client-a', name: 'Treino privado', routines: [] }
  });
  await invoke(fixture, 'PUT /api/personal/program', {
    user: { id: 'trainer-a' },
    body: { rev: 1, clientId: 'client-a', name: 'Treino privado alterado', routines: [] }
  });

  const state = fixture.read();
  assert.deepEqual(state.notifications.map(item => ({ userId: item.userId, title: item.title, resourceId: item.resourceId })), [
    { userId: 'student-a', title: 'Treino publicado', resourceId: state.programs[0].id },
    { userId: 'student-a', title: 'Treino atualizado', resourceId: state.programs[0].id }
  ]);
  assert.deepEqual(pushes, [
    {
      userId: 'student-a',
      payload: { title: 'Treino publicado', body: 'Seu Personal publicou um novo treino para você.', tag: 'personal' }
    },
    {
      userId: 'student-a',
      payload: { title: 'Treino atualizado', body: 'Seu Personal atualizou seu treino.', tag: 'personal' }
    }
  ]);
  assert.equal(JSON.stringify(pushes).includes('Nome privado'), false);
  assert.equal(JSON.stringify(pushes).includes('Treino privado'), false);
});

test('push failure never rolls back a persisted Personal mutation', async t => {
  let attempts = 0;
  const fixture = routeFixture(t, collaboration({
    profiles: [
      profile('student-a'),
      profile('trainer-a', ['student', 'trainer'], { shareCode: 'A'.repeat(32) })
    ]
  }), {
    sendPush: async () => {
      attempts += 1;
      throw new Error('provider unavailable');
    }
  });

  const response = await invoke(fixture, 'POST /api/connections/request', {
    user: { id: 'student-a' },
    body: { rev: 0, actorRole: 'student', shareCode: 'A'.repeat(32) }
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response.status, 200);
  assert.equal(attempts, 1);
  assert.equal(fixture.read().rev, 1);
  assert.equal(fixture.read().notifications.length, 1);
});

test('dual-role actor can request as trainer and receives only student consent on accept', async t => {
  const fixture = routeFixture(t, collaboration({
    profiles: [
      profile('student-a', ['student'], { shareCode: 'B'.repeat(32) }),
      profile('trainer-a', ['student', 'trainer'])
    ]
  }));

  const requested = await invoke(fixture, 'POST /api/connections/request', {
    user: { id: 'trainer-a' },
    body: {
      rev: 0,
      actorRole: 'trainer',
      shareCode: 'B'.repeat(32),
      grants: { plansWrite: true, workoutsRead: true, measurementsWrite: true }
    }
  });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.connections[0].studentId, 'student-a');
  assert.equal(requested.body.connections[0].trainerId, 'trainer-a');
  assert.deepEqual(requested.body.connections[0].grants, {
    plansWrite: false,
    workoutsRead: false,
    progressRead: false,
    measurementsWrite: false,
    liveActivityRead: false
  });

  const accepted = await invoke(fixture, 'POST /api/connections/respond', {
    user: { id: 'student-a' },
    body: {
      rev: 1,
      connectionId: requested.body.connections[0].id,
      accept: true,
      grants: { plansWrite: true, workoutsRead: 'yes', measurementsWrite: false }
    }
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body.connections[0].grants, {
    plansWrite: true,
    workoutsRead: false,
    progressRead: false,
    measurementsWrite: false,
    liveActivityRead: false
  });
});

test('connection request rejects ambiguous, unowned, invalid and unmatched actor roles', async t => {
  const cases = [
    {
      name: 'dual-role actor omits actorRole',
      actor: profile('actor-a', ['student', 'trainer']),
      target: profile('target-a', ['student'], { shareCode: 'D'.repeat(32) }),
      body: { shareCode: 'D'.repeat(32) },
      error: 'actor role required'
    },
    {
      name: 'actorRole is not a collaboration role',
      actor: profile('actor-b', ['student', 'trainer']),
      target: profile('target-b', ['student'], { shareCode: 'E'.repeat(32) }),
      body: { actorRole: 'admin', shareCode: 'E'.repeat(32) },
      error: 'actor role required'
    },
    {
      name: 'actor does not own requested role',
      actor: profile('actor-c', ['student']),
      target: profile('target-c', ['student', 'trainer'], { shareCode: 'F'.repeat(32) }),
      body: { actorRole: 'trainer', shareCode: 'F'.repeat(32) },
      error: 'actor role required'
    },
    {
      name: 'target does not own counterpart role',
      actor: profile('actor-d', ['student', 'trainer']),
      target: profile('target-d', ['trainer'], { shareCode: '1'.repeat(32) }),
      body: { actorRole: 'trainer', shareCode: '1'.repeat(32) },
      error: 'invalid share code'
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async t2 => {
      const fixture = routeFixture(t2, collaboration({ profiles: [item.actor, item.target] }));
      const res = await invoke(fixture, 'POST /api/connections/request', {
        user: { id: item.actor.userId },
        body: { rev: 0, ...item.body }
      });

      assert.deepEqual({ status: res.status, body: res.body }, { status: 400, body: { error: item.error } });
      assert.equal(fixture.read().connections.length, 0);
    });
  }
});

test('accept revalidates that the student has no other active trainer', async t => {
  const active = {
    id: 'connection-active', studentId: 'student-a', trainerId: 'trainer-a', requestedBy: 'student-a',
    status: 'active', grants: { plansWrite: true }, createdAt: NOW, respondedAt: NOW, endedAt: null
  };
  const pending = {
    id: 'connection-pending', studentId: 'student-a', trainerId: 'trainer-b', requestedBy: 'trainer-b',
    status: 'pending', grants: {}, createdAt: NOW, respondedAt: null, endedAt: null
  };
  const fixture = routeFixture(t, collaboration({
    profiles: [
      profile('student-a'),
      profile('trainer-a', ['student', 'trainer']),
      profile('trainer-b', ['student', 'trainer'])
    ],
    connections: [active, pending]
  }));

  const res = await invoke(fixture, 'POST /api/connections/respond', {
    user: { id: 'student-a' },
    body: { rev: 0, connectionId: pending.id, accept: true, grants: { plansWrite: true } }
  });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'student already linked' });
  assert.equal(fixture.read().rev, 0);
  assert.equal(fixture.read().connections.find(item => item.id === pending.id).status, 'pending');
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

test('priority does not infer hidden adherence without progress consent', () => {
  const client = {
    id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'Aluno',
    targetSessionsPerWeek: 3, inactiveAfterDays: 7, createdAt: NOW, archivedAt: null
  };
  const state = collaboration({
    clients: [client],
    connections: [{
      id: 'connection-a', studentId: 'student-a', trainerId: 'trainer-a', requestedBy: 'student-a',
      status: 'active', grants: { workoutsRead: false, progressRead: false }, createdAt: NOW
    }],
    measurements: [{ id: 'measurement-a', clientId: 'client-a', observedAt: '2026-08-28' }]
  });

  const workspace = buildWorkspace({
    collaboration: state,
    trainerId: 'trainer-a',
    now: NOW,
    readState: () => ({ workouts: [] })
  });

  assert.equal(workspace.clients[0].progress, undefined);
  assert.equal(workspace.clients[0].priority, 'ok');
  assert.deepEqual(workspace.clients[0].reasons, ['Em dia']);
});

test('collaboration projection includes only published programs behind an active student connection', async t => {
  const fixture = routeFixture(t, collaboration({
    profiles: [profile('student-a')],
    clients: [
      { id: 'client-a', trainerId: 'trainer-a', studentUserId: 'student-a', name: 'A', archivedAt: null },
      { id: 'client-ended', trainerId: 'trainer-ended', studentUserId: 'student-a', name: 'Ended', archivedAt: null },
      { id: 'client-pending', trainerId: 'trainer-pending', studentUserId: 'student-a', name: 'Pending', archivedAt: null },
      { id: 'client-b', trainerId: 'trainer-b', studentUserId: 'student-b', name: 'B', archivedAt: null }
    ],
    connections: [
      { id: 'active', trainerId: 'trainer-a', studentId: 'student-a', status: 'active', grants: {} },
      { id: 'ended', trainerId: 'trainer-ended', studentId: 'student-a', status: 'ended', grants: {} },
      { id: 'pending', trainerId: 'trainer-pending', studentId: 'student-a', status: 'pending', grants: {} }
    ],
    programs: [
      { id: 'program-a', trainerId: 'trainer-a', clientId: 'client-a', name: 'A', status: 'published', routines: [] },
      { id: 'program-ended', trainerId: 'trainer-ended', clientId: 'client-ended', name: 'Ended', status: 'published', routines: [] },
      { id: 'program-pending', trainerId: 'trainer-pending', clientId: 'client-pending', name: 'Pending', status: 'published', routines: [] },
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

test('route errors and successful personal detail writes exercise safe HTTP projections', async t => {
  const client = {
    id: 'client-a', trainerId: 'trainer-a', studentUserId: null, name: 'Aluno',
    goal: '', phone: '', notes: '', targetSessionsPerWeek: 3, inactiveAfterDays: 7,
    createdAt: NOW, updatedAt: NOW, archivedAt: null
  };
  const fixture = routeFixture(t, collaboration({
    profiles: [profile('trainer-a', ['student', 'trainer'])],
    clients: [client],
    notifications: [{ id: 'notification-a', userId: 'trainer-a', readAt: null }]
  }));

  const unauthenticated = await invoke(fixture, 'GET /api/personal/workspace');
  assert.deepEqual({ status: unauthenticated.status, body: unauthenticated.body }, {
    status: 401, body: { error: 'not signed in' }
  });

  const measurement = await invoke(fixture, 'POST /api/personal/measurements', {
    user: { id: 'trainer-a' },
    body: { rev: 0, clientId: client.id, kind: 'weight', value: 75, unit: 'kg', observedAt: '2026-08-29' }
  });
  assert.equal(measurement.status, 200);
  assert.equal(measurement.body.measurements[0].value, 75);

  const detail = await invoke(fixture, 'GET /api/personal/client', {
    user: { id: 'trainer-a' }, url: `/api/personal/client?id=${client.id}`
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.client.id, client.id);

  const notifications = await invoke(fixture, 'POST /api/notifications/read', {
    user: { id: 'trainer-a' }, body: { rev: 1 }
  });
  assert.equal(notifications.status, 200);
  assert.equal(fixture.read().notifications[0].readAt !== null, true);
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
    user: { id: 'trainer-a' }, body: { rev: 0, actorRole: 'trainer', shareCode: 'MISSING' }
  });
  const expired = await invoke(expiredFixture, 'POST /api/connections/request', {
    user: { id: 'trainer-a' }, body: { rev: 0, actorRole: 'trainer', shareCode: 'EXPIRED' }
  });
  const legacy = await invoke(legacyFixture, 'POST /api/connections/request', {
    user: { id: 'trainer-a' }, body: { rev: 0, actorRole: 'trainer', shareCode: 'ABCD1234' }
  });

  assert.deepEqual({ status: missing.status, body: missing.body }, { status: 400, body: { error: 'invalid share code' } });
  assert.deepEqual({ status: expired.status, body: expired.body }, { status: 400, body: { error: 'invalid share code' } });
  assert.deepEqual({ status: legacy.status, body: legacy.body }, { status: 400, body: { error: 'invalid share code' } });
});
