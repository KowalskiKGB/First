import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { INITIAL_COLLABORATION } from '../domain/schema.js';
import { createPersonalRoutes } from '../personal.js';

async function startServer(t) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-personal-http-'));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: available } = probe.address();
      probe.close(error => error ? reject(error) : resolve(available));
    });
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: 'test' },
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
      if (response.ok) return url;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`server did not start: ${stderr}`);
}

test('HTTP body reader returns 400 for malformed JSON', async t => {
  const url = await startServer(t);

  const malformed = await fetch(`${url}/api/register/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{'
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'bad json' });
});

test('HTTP body reader returns 413 above 32 KiB', async t => {
  const url = await startServer(t);
  const oversized = await fetch(`${url}/api/register/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Aluno', padding: 'x'.repeat(33 * 1024) })
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'body too large' });
});

test('personal routes request 32 KiB for common bodies and 256 KiB for programs', async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'first-personal-limits-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const limits = [];
  const routes = createPersonalRoutes({
    dataDir,
    origin: 'https://first.example',
    readSession: () => ({ id: 'trainer-a' }),
    readBody: async (_req, max) => {
      limits.push(max);
      return { rev: 0, roles: ['student', 'trainer'], clientId: 'missing', routines: [] };
    },
    json: (res, status, body) => Object.assign(res, { status, body }),
    readState: () => null,
    sendPush: async () => {}
  });

  const roleRes = {};
  await routes['PUT /api/profile/roles']({ headers: {}, url: '/api/profile/roles' }, roleRes);
  assert.equal(roleRes.status, 200);
  assert.equal(limits[0], 32 * 1024);

  const programRes = {};
  await routes['PUT /api/personal/program']({ headers: {}, url: '/api/personal/program' }, programRes);
  assert.equal(limits[1], 256 * 1024);
});
