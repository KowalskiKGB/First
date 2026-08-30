import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashDevPassword } from '../dev-auth.js';

const API_DIR = path.resolve(import.meta.dirname, '..');
const ORIGIN = 'https://first.example';
const SECRET = 'a'.repeat(64);
const VALID_SALT = Buffer.from('0123456789abcdef').toString('base64url');

const canonicalDb = extra => ({
  users: [
    { id: 'admin-a', name: 'Admin', admin: true, sv: 0 },
    { id: 'student-a', name: 'Aluno', sv: 0 }
  ],
  creds: [],
  subs: [],
  invites: [],
  aiProviders: [],
  aiUsage: [],
  ...extra
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

async function startServer(t, { db = canonicalDb(), extraEnv = {} } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-server-hardening-'));
  writeFileSync(path.join(dataDir, 'secret'), SECRET);
  writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      NODE_ENV: 'test',
      ORIGIN,
      ...extraEnv
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
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return { child, dataDir, url };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`server did not start: ${stderr}`);
}

function adminCookie(version = 0) {
  const payload = `admin-a:${Date.now() + 60_000}:${version}`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}

const legacyMutations = [
  ['POST', '/api/logout', undefined, 200],
  ['PUT', '/api/data', { state: { _ts: 1 } }, 200],
  ['POST', '/api/push/test', {}, 200],
  ['POST', '/api/push/rest-timer', { seconds: 1 }, 200],
  ['POST', '/api/push/rest-timer/cancel', {}, 200],
  ['POST', '/api/activity', { active: false }, 200],
  ['POST', '/api/admin/user/disable', { id: 'student-a', disabled: true }, 200],
  ['POST', '/api/admin/invites/new', { note: 'Teste' }, 200],
  ['POST', '/api/admin/invites/revoke', { code: 'MISSING' }, 404],
  ['POST', '/api/push/subscribe', {
    subscription: { endpoint: 'https://push.invalid/fixture', keys: { p256dh: 'p', auth: 'a' } }
  }, 200],
  ['POST', '/api/push/unsubscribe', { endpoint: 'https://push.invalid/fixture' }, 200],
  ['POST', '/api/logout/all', {}, 200]
];

async function mutate(url, [method, route, body], headers) {
  return fetch(`${url}${route}`, {
    method,
    headers: {
      Cookie: adminCookie(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test('existing invalid primary DB fails closed and remains byte-for-byte unchanged', async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-invalid-db-'));
  const invalid = Buffer.from('{"users": [');
  writeFileSync(path.join(dataDir, 'secret'), SECRET);
  writeFileSync(path.join(dataDir, 'db.json'), invalid);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_DIR,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(await availablePort()), NODE_ENV: 'test', ORIGIN },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const exitCode = await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(() => resolve('still-running'), 750))
  ]);
  assert.notEqual(exitCode, 'still-running');
  assert.deepEqual(readFileSync(path.join(dataDir, 'db.json')), invalid);
});

test('primary DB rejects invalid canonical collections and preserves unknown valid fields', async t => {
  await assert.rejects(startServer(t, { db: canonicalDb({ users: {} }) }), /server exited/);

  const fixture = await startServer(t, { db: canonicalDb({ custom: { keep: true } }) });
  assert.deepEqual(JSON.parse(readFileSync(path.join(fixture.dataDir, 'db.json'), 'utf8')).custom, { keep: true });
});

test('all authenticated legacy mutations reject a wrong Origin', async t => {
  const { url } = await startServer(t);
  for (const mutation of legacyMutations) {
    const response = await mutate(url, mutation, { Origin: 'https://evil.example', 'X-First-Client': 'capacitor' });
    assert.equal(response.status, 403, `${mutation[0]} ${mutation[1]}`);
    assert.deepEqual(await response.json(), { error: 'invalid origin' });
  }
});

test('originless Capacitor mutations pass the common gate while WebAuthn entry points remain public', async t => {
  const { url } = await startServer(t);
  for (const mutation of legacyMutations) {
    const response = await mutate(url, mutation, { 'X-First-Client': 'capacitor' });
    assert.equal(response.status, mutation[3], `${mutation[0]} ${mutation[1]}`);
  }

  const register = await fetch(`${url}/api/register/options`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Novo aluno' })
  });
  const login = await fetch(`${url}/api/login/options`, { method: 'POST' });
  assert.equal(register.status, 200);
  assert.equal(login.status, 200);
});

test('Dev session hides the configured username until the second layer is unlocked', async t => {
  const username = 'first_dev_fixture';
  const password = 'fixture-password';
  const { url } = await startServer(t, {
    extraEnv: {
      DEV_PANEL_USER: username,
      DEV_PANEL_PASSWORD_HASH: hashDevPassword(password, VALID_SALT)
    }
  });

  const locked = await fetch(`${url}/api/dev/session`, { headers: { Cookie: adminCookie() } });
  assert.deepEqual(await locked.json(), { unlocked: false });

  const login = await fetch(`${url}/api/dev/login`, {
    method: 'POST',
    headers: { Cookie: adminCookie(), Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200);
  const devCookie = login.headers.get('set-cookie').split(';', 1)[0];
  const unlocked = await fetch(`${url}/api/dev/session`, {
    headers: { Cookie: `${adminCookie()}; ${devCookie}` }
  });
  assert.deepEqual(await unlocked.json(), { unlocked: true, username });
});

test('readiness reports only status and fails when collaboration storage becomes invalid', async t => {
  const { dataDir, url } = await startServer(t);
  const ready = await fetch(`${url}/api/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true });

  rmSync(path.join(dataDir, 'db.json'));
  const missingDb = await fetch(`${url}/api/ready`);
  assert.equal(missingDb.status, 503);
  assert.deepEqual(await missingDb.json(), { ok: false });
  writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(canonicalDb()));

  writeFileSync(path.join(dataDir, 'collaboration.json'), '{');
  const failed = await fetch(`${url}/api/ready`);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { ok: false });
});
