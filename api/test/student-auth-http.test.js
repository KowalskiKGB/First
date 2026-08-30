import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { hashDevPassword } from '../dev-auth.js';
import { encryptProviderKey } from '../ai-providers.js';

const API_DIR = path.resolve(import.meta.dirname, '..');
const ORIGIN = 'https://first.example';
const SECRET = 's'.repeat(64);
const AI_MASTER_KEY = '11'.repeat(32);
const DEV_SALT = Buffer.from('0123456789abcdef').toString('base64url');

const emptyDb = () => ({
  users: [], creds: [], subs: [], invites: [], aiProviders: [], aiUsage: []
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

async function startServer(t, { db = emptyDb(), extraEnv = {} } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-student-auth-'));
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
      INVITE_ONLY: '0',
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

function post(url, route, body, headers = {}) {
  return fetch(`${url}${route}`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function put(url, route, body, headers = {}) {
  return fetch(`${url}${route}`, {
    method: 'PUT',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function cookieFrom(response, name) {
  const value = response.headers.get('set-cookie')?.split(';', 1)[0] || '';
  assert.match(value, new RegExp(`^${name}=`));
  return value;
}

function appCookie(userId, version = 0) {
  const payload = `${userId}:${Date.now() + 60_000}:${version}`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}

const completeStudent = {
  email: '  ALUNA@example.com ',
  fullName: '  Maria da Silva  ',
  password: 'treino123',
  weightKg: 72.4,
  targetWeightKg: 65,
  heightCm: 177,
  measurements: { waistCm: 82, hipCm: 101, armCm: 31, thighCm: 58 },
  goal: 'both'
};

test('student registers with email/password and optional training profile without leaking the password', async t => {
  const { dataDir, url } = await startServer(t);
  const response = await post(url, '/api/auth/register', completeStudent);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(response.headers.get('set-cookie') || '', /gymsid=.*HttpOnly.*Secure.*SameSite=Lax/i);
  assert.deepEqual(body.user, {
    id: body.user.id,
    name: 'Maria da Silva',
    email: 'aluna@example.com',
    admin: false
  });
  assert.deepEqual(body.profile, {
    weightKg: 72.4,
    targetWeightKg: 65,
    heightCm: 177,
    measurements: { waistCm: 82, hipCm: 101, armCm: 31, thighCm: 58 },
    goal: 'both'
  });
  assert.equal('password' in body, false);
  assert.equal('passwordHash' in body, false);

  const persisted = readFileSync(path.join(dataDir, 'db.json'), 'utf8');
  assert.equal(persisted.includes('treino123'), false);
  assert.match(persisted, /scrypt:/);
  assert.equal(JSON.parse(persisted).users[0].email, 'aluna@example.com');
  const state = JSON.parse(readFileSync(path.join(dataDir, `state-${body.user.id}.json`), 'utf8'));
  assert.equal(state.bodyweight.at(-1).w, 72.4);
  assert.equal(state.targetW, 65);
  assert.equal(state.aiProfile.heightCm, 177);
});

test('student can log in case-insensitively and duplicate email registration is rejected', async t => {
  const { url } = await startServer(t);
  const registered = await post(url, '/api/auth/register', {
    email: 'maria@example.com', fullName: 'Maria', password: 'abc123'
  });
  assert.equal(registered.status, 200);

  const duplicate = await post(url, '/api/auth/register', {
    email: ' MARIA@example.com ', fullName: 'Outra Maria', password: 'abc123'
  });
  assert.equal(duplicate.status, 409);

  const wrong = await post(url, '/api/auth/login', { email: 'maria@example.com', password: 'errada' });
  assert.equal(wrong.status, 401);

  const login = await post(url, '/api/auth/login', { email: ' MARIA@EXAMPLE.COM ', password: 'abc123' });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login, 'gymsid');
  assert.deepEqual(await login.json(), {
    user: { id: (await (await fetch(`${url}/api/me`, { headers: { Cookie: cookie } })).json()).user.id, name: 'Maria', email: 'maria@example.com', admin: false }
  });
});

test('authenticated student reads and edits only safe fields of their own profile', async t => {
  const { url } = await startServer(t);
  const registered = await post(url, '/api/auth/register', {
    email: 'perfil@example.com', fullName: 'Nome Inicial', password: 'abc123'
  });
  assert.equal(registered.status, 200);
  const cookie = cookieFrom(registered, 'gymsid');
  const registeredBody = await registered.json();

  const anonymous = await fetch(`${url}/api/profile`);
  assert.equal(anonymous.status, 401);

  const update = await put(url, '/api/profile', {
    fullName: 'Nome Atualizado',
    weightKg: 68.5,
    measurements: { waistCm: 77, chestCm: 93 },
    goal: 'weight_loss'
  }, { Cookie: cookie });
  assert.equal(update.status, 200);
  assert.deepEqual(await update.json(), {
    user: { id: registeredBody.user.id, name: 'Nome Atualizado', email: 'perfil@example.com', admin: false },
    profile: { weightKg: 68.5, measurements: { waistCm: 77, chestCm: 93 }, goal: 'weight_loss' }
  });

  const unsafe = await put(url, '/api/profile', {
    id: 'admin-a', admin: true, passwordHash: 'plaintext', fullName: 'Ataque'
  }, { Cookie: cookie });
  assert.equal(unsafe.status, 400);

  const profile = await fetch(`${url}/api/profile`, { headers: { Cookie: cookie } });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), {
    user: { id: registeredBody.user.id, name: 'Nome Atualizado', email: 'perfil@example.com', admin: false },
    profile: { weightKg: 68.5, measurements: { waistCm: 77, chestCm: 93 }, goal: 'weight_loss' }
  });
});

test('password auth mutations reject untrusted origins and throttle repeated login failures', async t => {
  const { url } = await startServer(t);
  const evilRegistration = await post(url, '/api/auth/register', {
    email: 'origem@example.com', fullName: 'Origem', password: 'abc123'
  }, { Origin: 'https://evil.example' });
  assert.equal(evilRegistration.status, 403);

  const registered = await post(url, '/api/auth/register', {
    email: 'limite@example.com', fullName: 'Limite', password: 'abc123'
  });
  assert.equal(registered.status, 200);

  const evilLogin = await post(url, '/api/auth/login', {
    email: 'limite@example.com', password: 'abc123'
  }, { Origin: 'https://evil.example' });
  assert.equal(evilLogin.status, 403);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const failed = await post(url, '/api/auth/login', {
      email: 'limite@example.com', password: `errada-${attempt}`
    }, { 'X-Real-IP': '203.0.113.10' });
    assert.equal(failed.status, 401, `attempt ${attempt + 1}`);
  }
  const throttled = await post(url, '/api/auth/login', {
    email: 'limite@example.com', password: 'abc123'
  }, { 'X-Real-IP': '203.0.113.10' });
  assert.equal(throttled.status, 429);

  const otherClient = await post(url, '/api/auth/login', {
    email: 'limite@example.com', password: 'abc123'
  }, { 'X-Real-IP': '198.51.100.22' });
  assert.equal(otherClient.status, 200);
});

test('email and password changes require the current password and rotate login credentials', async t => {
  const { url } = await startServer(t);
  const registered = await post(url, '/api/auth/register', {
    email: 'antigo@example.com', fullName: 'Conta Protegida', password: 'senha123'
  });
  assert.equal(registered.status, 200);
  const cookie = cookieFrom(registered, 'gymsid');

  const denied = await put(url, '/api/profile', {
    email: 'novo@example.com', currentPassword: 'incorreta'
  }, { Cookie: cookie });
  assert.equal(denied.status, 401);

  const emailChanged = await put(url, '/api/profile', {
    email: 'novo@example.com', currentPassword: 'senha123'
  }, { Cookie: cookie });
  assert.equal(emailChanged.status, 200);
  const emailRotatedCookie = cookieFrom(emailChanged, 'gymsid');

  const staleAfterEmail = await fetch(`${url}/api/profile`, { headers: { Cookie: cookie } });
  assert.equal(staleAfterEmail.status, 401);
  const currentAfterEmail = await fetch(`${url}/api/profile`, { headers: { Cookie: emailRotatedCookie } });
  assert.equal(currentAfterEmail.status, 200);

  const changed = await put(url, '/api/profile', {
    currentPassword: 'senha123', newPassword: 'nova456'
  }, { Cookie: emailRotatedCookie });
  assert.equal(changed.status, 200);
  const changedBody = await changed.json();
  assert.equal(changedBody.user.email, 'novo@example.com');
  assert.equal('passwordHash' in changedBody.user, false);
  const rotatedCookie = cookieFrom(changed, 'gymsid');

  const staleSession = await fetch(`${url}/api/profile`, { headers: { Cookie: emailRotatedCookie } });
  assert.equal(staleSession.status, 401);
  const currentSession = await fetch(`${url}/api/profile`, { headers: { Cookie: rotatedCookie } });
  assert.equal(currentSession.status, 200);

  const previousLogin = await post(url, '/api/auth/login', { email: 'antigo@example.com', password: 'senha123' });
  assert.equal(previousLogin.status, 401);
  const currentLogin = await post(url, '/api/auth/login', { email: 'novo@example.com', password: 'nova456' });
  assert.equal(currentLogin.status, 200);
});

test('legacy passkey-only profiles can edit body data but cannot add a password without email', async t => {
  const legacy = { id: 'legacy-passkey', name: 'Perfil Legado', admin: false };
  const { url } = await startServer(t, { db: { ...emptyDb(), users: [legacy] } });
  const cookie = appCookie(legacy.id);

  const bodyOnly = await put(url, '/api/profile', { fullName: 'Perfil Legado', weightKg: 80 }, { Cookie: cookie });
  assert.equal(bodyOnly.status, 200);

  const passwordOnly = await put(url, '/api/profile', { fullName: 'Perfil Legado', newPassword: 'senha123' }, { Cookie: cookie });
  assert.equal(passwordOnly.status, 400);

  const credential = await put(url, '/api/profile', {
    fullName: 'Perfil Legado',
    email: 'legado@example.com',
    newPassword: 'senha123'
  }, { Cookie: cookie });
  assert.equal(credential.status, 200);
  const body = await credential.json();
  assert.equal(body.user.email, 'legado@example.com');
  assert.equal('passwordHash' in body.user, false);
});

test('AI remains unavailable anonymously and becomes available to a password-authenticated student', async t => {
  const { url } = await startServer(t);
  const anonymous = await fetch(`${url}/api/ai/status`);
  assert.equal(anonymous.status, 401);

  const registered = await post(url, '/api/auth/register', {
    email: 'ia@example.com', fullName: 'Aluna IA', password: 'abc123'
  });
  assert.equal(registered.status, 200);
  const authenticated = await fetch(`${url}/api/ai/status`, {
    headers: { Cookie: cookieFrom(registered, 'gymsid') }
  });
  assert.equal(authenticated.status, 200);
});

test('Dev authentication is isolated from app sessions and the Dev cookie alone unlocks provider APIs', async t => {
  const username = 'first_dev_fixture';
  const password = 'fixture-password';
  const { url } = await startServer(t, {
    db: { ...emptyDb(), users: [{ id: 'student-a', name: 'Aluno', email: 'aluno@example.com', sv: 0 }] },
    extraEnv: {
      DEV_PANEL_USER: username,
      DEV_PANEL_PASSWORD_HASH: hashDevPassword(password, DEV_SALT)
    }
  });

  const publicSession = await fetch(`${url}/api/dev/session`);
  assert.equal(publicSession.status, 200);
  assert.deepEqual(await publicSession.json(), { unlocked: false });

  const appOnly = await fetch(`${url}/api/dev/ai/providers`, {
    headers: { Cookie: appCookie('student-a') }
  });
  assert.equal(appOnly.status, 401);

  const login = await post(url, '/api/dev/login', { username, password });
  assert.equal(login.status, 200);
  const devCookie = cookieFrom(login, 'firstdev');

  const unlocked = await fetch(`${url}/api/dev/session`, { headers: { Cookie: devCookie } });
  assert.equal(unlocked.status, 200);
  assert.deepEqual(await unlocked.json(), { unlocked: true, username });

  const providers = await fetch(`${url}/api/dev/ai/providers`, { headers: { Cookie: devCookie } });
  assert.equal(providers.status, 200);
  assert.equal(Array.isArray((await providers.json()).providers), true);
});

test('Dev can deactivate every AI provider with provider null', async t => {
  const username = 'first_dev_fixture';
  const password = 'fixture-password';
  const { url } = await startServer(t, {
    db: {
      ...emptyDb(),
      aiProviders: [{
        provider: 'gemini',
        selectedModel: 'gemini-2.5-flash',
        apiKeyEnc: encryptProviderKey(AI_MASTER_KEY, 'key-b'),
        keyFingerprint: 'sha256:test',
        testedAt: '2026-08-30T00:00:00.000Z',
        testStatus: 'success',
        active: true
      }]
    },
    extraEnv: {
      AI_CONFIG_MASTER_KEY: AI_MASTER_KEY,
      DEV_PANEL_USER: username,
      DEV_PANEL_PASSWORD_HASH: hashDevPassword(password, DEV_SALT)
    }
  });
  const login = await post(url, '/api/dev/login', { username, password });
  const devCookie = cookieFrom(login, 'firstdev');

  const disabled = await put(url, '/api/dev/ai/active', { provider: null }, { Cookie: devCookie });

  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).provider, null);
  const providers = await fetch(`${url}/api/dev/ai/providers`, { headers: { Cookie: devCookie } });
  assert.equal((await providers.json()).providers.find(slot => slot.provider === 'gemini').active, false);
});

test('Dev Gemini model upstream failures become safe actionable responses', async t => {
  const username = 'first_dev_fixture';
  const password = 'fixture-password';
  const mockDir = mkdtempSync(path.join(tmpdir(), 'first-gemini-fetch-'));
  const mockFile = path.join(mockDir, 'mock-fetch.mjs');
  writeFileSync(mockFile, `
globalThis.fetch = async url => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
    return new Response(JSON.stringify({ error: { message: 'SENTINEL_UPSTREAM_DETAIL' } }), { status: 403 });
  }
  throw new Error('unexpected fetch ' + url);
};
`);
  t.after(() => rmSync(mockDir, { recursive: true, force: true }));
  const { url } = await startServer(t, {
    db: {
      ...emptyDb(),
      aiProviders: [{
        provider: 'gemini',
        selectedModel: 'gemini-2.5-flash',
        apiKeyEnc: encryptProviderKey(AI_MASTER_KEY, 'key-b'),
        keyFingerprint: 'sha256:redacted',
        testedAt: null,
        testStatus: 'untested',
        active: false
      }]
    },
    extraEnv: {
      AI_CONFIG_MASTER_KEY: AI_MASTER_KEY,
      NODE_OPTIONS: `--import=${pathToFileURL(mockFile).href}`,
      DEV_PANEL_USER: username,
      DEV_PANEL_PASSWORD_HASH: hashDevPassword(password, DEV_SALT)
    }
  });
  const login = await post(url, '/api/dev/login', { username, password });
  const devCookie = cookieFrom(login, 'firstdev');

  const models = await fetch(`${url}/api/dev/ai/models?provider=gemini`, { headers: { Cookie: devCookie } });
  const body = await models.json();

  assert.equal(models.status, 422);
  assert.equal(body.error, 'The provider credential was rejected.');
  assert.doesNotMatch(JSON.stringify(body), /SENTINEL_UPSTREAM_DETAIL|key|secret|stack/i);
});
