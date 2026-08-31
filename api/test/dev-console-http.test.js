import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashDevPassword } from '../dev-auth.js';
import { INITIAL_COLLABORATION } from '../personal.js';

const API_DIR = path.resolve(import.meta.dirname, '..');
const ORIGIN = 'https://first.example';
const SECRET = 'd'.repeat(64);
const DEV_USER = 'first_dev_fixture';
const DEV_PASSWORD = 'fixture-password';
const DEV_SALT = Buffer.from('0123456789abcdef').toString('base64url');
const DEV_PASSWORD_HASH = hashDevPassword(DEV_PASSWORD, DEV_SALT);

const USERS = [
  {
    id: 'admin-a', name: 'Admin do app', email: 'admin@example.com', admin: true, sv: 0,
    passwordHash: 'user-record-secret', created: '2026-08-01T10:00:00.000Z'
  },
  {
    id: 'student-a', name: 'Maria Aluna', email: 'maria@example.com', admin: false, sv: 0,
    passwordHash: 'another-user-record-secret', created: '2026-08-02T10:00:00.000Z',
    lastAccessAt: Date.parse('2026-08-29T10:00:00.000Z'), lastLoginAt: Date.parse('2026-08-29T09:00:00.000Z')
  }
];

const DB = {
  users: USERS,
  creds: [
    { userId: 'student-a', passwordHash: 'scrypt:credential-secret' },
    { userId: 'admin-a', credentialID: 'passkey-credential-secret', publicKey: 'passkey-public-secret' }
  ],
  subs: [],
  invites: [],
  aiProviders: [],
  aiUsage: []
};

const GYM = {
  id: 'gym-a', name: 'Academia Centro', state: 'CE', city: 'Fortaleza',
  address: 'Rua ABC, 123', status: 'unverified', openingHours: [],
  exerciseIds: ['exercise-a'], createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z'
};

const REQUEST = {
  id: 'request-a', kind: 'equipment', status: 'pending', gymId: GYM.id,
  submittedByUserId: 'student-a', payload: { exerciseIds: ['exercise-b'], note: 'Máquina nova' },
  createdAt: '2026-08-29T12:00:00.000Z'
};

const collaborationFixture = () => ({
  ...structuredClone(INITIAL_COLLABORATION),
  profiles: [{
    userId: 'student-a', roles: ['student'], name: 'Maria Aluna',
    shareCode: 'A'.repeat(32), shareCodeExpiresAt: '2027-08-01T00:00:00.000Z',
    timezone: 'America/Fortaleza', createdAt: '2026-08-02T10:00:00.000Z', updatedAt: '2026-08-29T10:00:00.000Z'
  }],
  trainingProfiles: [{
    studentId: 'student-a', ageBand: 'adult', heightCm: 177, goal: 'weight_loss',
    experience: 'iniciante', availableDays: [1, 3, 5], minutesPerSession: 50,
    focusAreas: ['full_body'], favoriteExerciseIds: ['exercise-a'], avoidedExerciseIds: [],
    limitations: '', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: null,
    createdAt: '2026-08-02T10:00:00.000Z', updatedAt: '2026-08-29T10:00:00.000Z'
  }],
  gymProfiles: [{
    studentId: 'student-a', name: GYM.name, genericEquipment: ['body weight'], specificMachines: [],
    createdAt: '2026-08-02T10:00:00.000Z', updatedAt: '2026-08-29T10:00:00.000Z'
  }],
  measurements: [{
    id: 'measurement-waist', clientId: null, studentUserId: 'student-a', kind: 'waist', side: null,
    value: 81.5, unit: 'cm', observedAt: '2026-08-28', recordedBy: 'student-a', createdAt: '2026-08-28T12:00:00.000Z'
  }],
  gymDirectory: [GYM],
  gymRequests: [REQUEST]
});

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startServer(t) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-dev-console-'));
  writeFileSync(path.join(dataDir, 'secret'), SECRET);
  writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(DB));
  writeFileSync(path.join(dataDir, 'collaboration.json'), JSON.stringify(collaborationFixture()));
  writeFileSync(path.join(dataDir, 'state-student-a.json'), JSON.stringify({
    unit: 'kg', _ts: 123,
    bodyweight: [{ d: '2026-08-29', w: 72.4 }],
    routines: [{ id: 'routine-a', name: 'Treino A', emoji: 'A', ex: [{ id: 'exercise-a' }] }],
    workouts: [{ id: 'workout-a', d: '2026-08-29', routineId: 'routine-a' }]
  }));

  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      NODE_ENV: 'test',
      ORIGIN,
      INVITE_ONLY: '0',
      DEV_PANEL_USER: DEV_USER,
      DEV_PANEL_PASSWORD_HASH: DEV_PASSWORD_HASH
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => {
    child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return { dataDir, url };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`server did not start: ${stderr}`);
}

function appCookie(userId) {
  const payload = `${userId}:${Date.now() + 60_000}:0`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}

function cookieFrom(response, name) {
  const value = response.headers.get('set-cookie')?.split(';', 1)[0] || '';
  assert.match(value, new RegExp(`^${name}=`));
  return value;
}

async function devCookie(url) {
  const response = await fetch(`${url}/api/dev/login`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: DEV_USER, password: DEV_PASSWORD })
  });
  assert.equal(response.status, 200);
  return cookieFrom(response, 'firstdev');
}

test('successful Dev logins do not consume the failed-login budget', async t => {
  const { url } = await startServer(t);
  const login = password => fetch(`${url}/api/dev/login`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: DEV_USER, password })
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await login(DEV_PASSWORD)).status, 200, `successful attempt ${attempt + 1}`);
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal((await login(`wrong-${attempt}`)).status, 401, `failed attempt ${attempt + 1}`);
  }
  assert.equal((await login('wrong-throttled')).status, 429);
});

const devReads = [
  '/api/dev/users',
  '/api/dev/user?id=student-a',
  '/api/dev/gym-requests',
  '/api/dev/gyms',
  '/api/dev/gym-reviews'
];

test('Dev console endpoints reject anonymous, student and app-admin sessions', async t => {
  const { url } = await startServer(t);

  for (const route of devReads) {
    assert.equal((await fetch(`${url}${route}`)).status, 401, `anonymous ${route}`);
    assert.equal((await fetch(`${url}${route}`, { headers: { Cookie: appCookie('student-a') } })).status, 401, `student ${route}`);
    assert.equal((await fetch(`${url}${route}`, { headers: { Cookie: appCookie('admin-a') } })).status, 401, `app admin ${route}`);
  }

  for (const cookie of ['', appCookie('student-a'), appCookie('admin-a')]) {
    const response = await fetch(`${url}/api/dev/gym-requests/review`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ id: REQUEST.id, decision: 'approve' })
    });
    assert.equal(response.status, 401);
  }

  const developerCookie = await devCookie(url);
  assert.equal((await fetch(`${url}/api/admin/users`, { headers: { Cookie: developerCookie } })).status, 401);
});

test('Dev user list exposes useful account status without leaking account credentials', async t => {
  const { url } = await startServer(t);
  const cookie = await devCookie(url);
  const response = await fetch(`${url}/api/dev/users`, { headers: { Cookie: cookie } });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(Array.isArray(body.users), true);
  const student = body.users.find(user => user.id === 'student-a');
  assert.equal(student.name, 'Maria Aluna');
  assert.equal(student.email, 'maria@example.com');
  assert.equal(typeof student.online, 'boolean');
  assert.equal(student.lastAccessAt, USERS[1].lastAccessAt);
  assert.equal(student.lastLoginAt, USERS[1].lastLoginAt);
  assert.deepEqual(student.roles, ['student']);
  assert.equal(student.role, 'student');

  const serialized = JSON.stringify(body);
  for (const secret of [
    'user-record-secret', 'another-user-record-secret', 'scrypt:credential-secret',
    'passkey-credential-secret', 'passkey-public-secret'
  ]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('credentialID'), false);
  assert.equal(serialized.includes('publicKey'), false);
  assert.equal(serialized.includes('creds'), false);
});

test('Dev user detail joins student profile, gym and workout data with a safe projection', async t => {
  const { url } = await startServer(t);
  const cookie = await devCookie(url);
  const response = await fetch(`${url}/api/dev/user?id=student-a`, { headers: { Cookie: cookie } });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, 'student-a');
  assert.equal(body.user.name, 'Maria Aluna');
  assert.equal(body.trainingProfile.goal, 'weight_loss');
  assert.equal(body.trainingProfile.heightCm, 177);
  assert.equal(body.gymProfile.name, 'Academia Centro');
  assert.deepEqual(body.measurements, [{
    id: 'measurement-waist', kind: 'waist', side: null, value: 81.5, unit: 'cm',
    observedAt: '2026-08-28', createdAt: '2026-08-28T12:00:00.000Z'
  }]);
  assert.deepEqual(body.bodyweight, [{ d: '2026-08-29', w: 72.4 }]);
  assert.equal(body.routines[0].name, 'Treino A');
  assert.equal(body.workouts[0].id, 'workout-a');

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('credential-secret'), false);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('shareCode'), false);

  const missing = await fetch(`${url}/api/dev/user?id=missing-user`, { headers: { Cookie: cookie } });
  assert.equal(missing.status, 404);
});

test('Dev request queue identifies the submitter and gym without exposing credentials', async t => {
  const { url } = await startServer(t);
  const cookie = await devCookie(url);
  const response = await fetch(`${url}/api/dev/gym-requests`, { headers: { Cookie: cookie } });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].id, REQUEST.id);
  assert.deepEqual(body.requests[0].submittedBy, {
    id: 'student-a', name: 'Maria Aluna', email: 'maria@example.com'
  });
  assert.deepEqual(body.requests[0].gym, { id: GYM.id, name: GYM.name });

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('credential-secret'), false);
  assert.equal(serialized.includes('passwordHash'), false);
});

test('Dev request review requires an exact trusted Origin and persists reviewer metadata', async t => {
  const { dataDir, url } = await startServer(t);
  const cookie = await devCookie(url);
  const request = headers => fetch(`${url}/api/dev/gym-requests/review`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ id: REQUEST.id, decision: 'approve' })
  });

  assert.equal((await request({})).status, 403);
  assert.equal((await request({ Origin: 'https://evil.example' })).status, 403);
  const unchanged = JSON.parse(readFileSync(path.join(dataDir, 'collaboration.json'), 'utf8'));
  assert.equal(unchanged.gymRequests.find(item => item.id === REQUEST.id).status, 'pending');

  const approved = await request({ Origin: ORIGIN });
  assert.equal(approved.status, 200);
  const body = await approved.json();
  assert.equal(body.request.id, REQUEST.id);
  assert.equal(body.request.status, 'approved');
  assert.equal(body.request.reviewedBy, DEV_USER);
  assert.equal(Number.isFinite(Date.parse(body.request.reviewedAt)), true);

  const persisted = JSON.parse(readFileSync(path.join(dataDir, 'collaboration.json'), 'utf8'));
  const reviewed = persisted.gymRequests.find(item => item.id === REQUEST.id);
  assert.equal(reviewed.status, 'approved');
  assert.equal(reviewed.reviewedBy, DEV_USER);
  assert.equal(Number.isFinite(Date.parse(reviewed.reviewedAt)), true);
});

test('social gym writes require the app session and trusted Origin while Dev moderation stays isolated', async t => {
  const { dataDir, url } = await startServer(t);
  const directory = await fetch(`${url}/api/gyms`);
  const initialRev = (await directory.json()).rev;
  const favorite = headers => fetch(`${url}/api/gym/favorite`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ rev: initialRev, gymId: GYM.id })
  });
  assert.equal((await favorite({ Origin: ORIGIN })).status, 401);
  assert.equal((await favorite({ Cookie: appCookie('student-a') })).status, 403);
  const savedFavorite = await favorite({ Cookie: appCookie('student-a'), Origin: ORIGIN });
  assert.equal(savedFavorite.status, 200);
  const favoriteBody = await savedFavorite.json();
  assert.equal(favoriteBody.favorite, true);

  const submitted = await fetch(`${url}/api/gym/review`, {
    method: 'PUT', headers: { Cookie: appCookie('student-a'), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: favoriteBody.rev, gymId: GYM.id, rating: 5, comment: 'Meu telefone é 99999-9999' })
  });
  assert.equal(submitted.status, 200);
  const submittedBody = await submitted.json();
  const review = submittedBody.review;
  assert.equal(review.status, 'pending');
  assert.equal('userId' in review, false);

  const dev = await devCookie(url);
  const published = await fetch(`${url}/api/dev/gym-review`, {
    method: 'PUT', headers: { Cookie: dev, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: submittedBody.rev, id: review.id, status: 'published', reason: 'Seguro' })
  });
  assert.equal(published.status, 200);
  const publicGym = await fetch(`${url}/api/gym?id=${GYM.id}`);
  assert.equal(publicGym.status, 200);
  const body = await publicGym.json();
  assert.equal(body.reviews[0].displayName, 'Maria A.');
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('student-a'), false);
  assert.equal(serialized.includes('maria@example.com'), false);

  const persisted = JSON.parse(readFileSync(path.join(dataDir, 'collaboration.json'), 'utf8'));
  assert.equal(persisted.gymReviews[0].moderatedBy, DEV_USER);
});
