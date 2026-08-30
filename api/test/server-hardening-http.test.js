import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashDevPassword } from '../dev-auth.js';
import { INITIAL_COLLABORATION } from '../personal.js';

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

async function startServer(t, { db = canonicalDb(), omitDb = false, prepareData, extraEnv = {} } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-server-hardening-'));
  writeFileSync(path.join(dataDir, 'secret'), SECRET);
  if (!omitDb) writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  prepareData?.(dataDir);
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

test('a legacy volume atomically bootstraps one canonical primary DB when it is absent at startup', async t => {
  const sentinel = Buffer.from('preserve-existing-temporary-file');
  const collaboration = { ...structuredClone(INITIAL_COLLABORATION), rev: 7 };
  const fixture = await startServer(t, {
    omitDb: true,
    prepareData(dataDir) {
      writeFileSync(path.join(dataDir, 'collaboration.json'), JSON.stringify(collaboration));
      writeFileSync(path.join(dataDir, 'db.json.tmp'), sentinel);
    }
  });

  assert.deepEqual(JSON.parse(readFileSync(path.join(fixture.dataDir, 'db.json'), 'utf8')), {
    users: [],
    creds: [],
    subs: [],
    invites: [],
    aiProviders: []
  });
  assert.deepEqual(readFileSync(path.join(fixture.dataDir, 'db.json.tmp')), sentinel);
  assert.equal(readdirSync(fixture.dataDir).some(name => name.startsWith('db.json.bootstrap-')), false);
  const persistedCollaboration = JSON.parse(readFileSync(path.join(fixture.dataDir, 'collaboration.json'), 'utf8'));
  assert.equal(persistedCollaboration.schemaVersion, collaboration.schemaVersion);
  assert.equal(persistedCollaboration.rev >= collaboration.rev, true);

  const ready = await fetch(`${fixture.url}/api/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true });
});

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
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => {
    child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`invalid DB server did not exit within 10s: ${stderr}`));
    }, 10_000);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(new Error(`invalid DB server spawn failed: ${error.message}; ${stderr}`));
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  assert.equal(Number.isInteger(exitCode) && exitCode !== 0, true, `unexpected exit ${exitCode}: ${stderr}`);
  assert.deepEqual(readFileSync(path.join(dataDir, 'db.json')), invalid);
});

test('primary DB startup I/O errors fail closed instead of being treated as an absent legacy DB', async t => {
  await assert.rejects(startServer(t, {
    omitDb: true,
    prepareData(dataDir) { mkdirSync(path.join(dataDir, 'db.json')); }
  }), /server exited/);
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

  const writeWhileMissing = await mutate(
    url,
    ['POST', '/api/admin/invites/new', { note: 'Não recriar banco removido' }],
    { Origin: ORIGIN }
  );
  assert.equal(writeWhileMissing.status, 500);
  assert.deepEqual(await writeWhileMissing.json(), { error: 'server error' });
  assert.throws(() => readFileSync(path.join(dataDir, 'db.json')), error => error.code === 'ENOENT');

  writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(canonicalDb()));

  writeFileSync(path.join(dataDir, 'collaboration.json'), '{');
  const failed = await fetch(`${url}/api/ready`);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { ok: false });
});

test('corrupt individual state fails readiness and authenticated reads and writes closed until recovery', async t => {
  const { dataDir, url } = await startServer(t);
  const file = path.join(dataDir, 'state-admin-a.json');
  const corrupt = Buffer.from('{"routines": [');
  writeFileSync(file, corrupt);

  const ready = await fetch(`${url}/api/ready`);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { ok: false });

  const read = await fetch(`${url}/api/data`, { headers: { Cookie: adminCookie() } });
  assert.equal(read.status, 500);
  assert.deepEqual(await read.json(), { error: 'server error' });

  const write = await mutate(url, ['PUT', '/api/data', { state: { _ts: 2 } }], { Origin: ORIGIN });
  assert.equal(write.status, 500);
  assert.deepEqual(await write.json(), { error: 'server error' });
  assert.deepEqual(readFileSync(file), corrupt);

  const recoveredState = { _ts: 3, routines: [] };
  writeFileSync(file, JSON.stringify(recoveredState));
  const recoveredReady = await fetch(`${url}/api/ready`);
  assert.equal(recoveredReady.status, 200);
  assert.deepEqual(await recoveredReady.json(), { ok: true });
  const recoveredRead = await fetch(`${url}/api/data`, { headers: { Cookie: adminCookie() } });
  assert.equal(recoveredRead.status, 200);
  assert.deepEqual(await recoveredRead.json(), { state: recoveredState });
});

test('individual state I/O errors fail readiness and cannot be overwritten through the API', async t => {
  const { dataDir, url } = await startServer(t);
  const file = path.join(dataDir, 'state-admin-a.json');
  mkdirSync(file);

  const ready = await fetch(`${url}/api/ready`);
  assert.equal(ready.status, 503);

  const read = await fetch(`${url}/api/data`, { headers: { Cookie: adminCookie() } });
  assert.equal(read.status, 500);

  const write = await mutate(url, ['PUT', '/api/data', { state: { _ts: 4 } }], { Origin: ORIGIN });
  assert.equal(write.status, 500);
  assert.equal(statSync(file).isDirectory(), true);

  rmSync(file, { recursive: true });
  writeFileSync(file, JSON.stringify({ _ts: 5 }));
  const recovered = await fetch(`${url}/api/ready`);
  assert.equal(recovered.status, 200);
});

test('state writes reject JSON arrays without poisoning readiness', async t => {
  const { dataDir, url } = await startServer(t);
  const missing = await fetch(`${url}/api/data`, { headers: { Cookie: adminCookie() } });
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), { state: null });

  const write = await mutate(url, ['PUT', '/api/data', { state: [] }], { Origin: ORIGIN });
  assert.equal(write.status, 400);
  assert.deepEqual(await write.json(), { error: 'state required' });
  assert.throws(() => readFileSync(path.join(dataDir, 'state-admin-a.json')), error => error.code === 'ENOENT');

  const ready = await fetch(`${url}/api/ready`);
  assert.equal(ready.status, 200);
});
