import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

const routeBody = route => {
  const start = source.indexOf(`'${route}'`);
  const end = source.indexOf("\n  '", start + route.length + 2);
  return source.slice(start, end < 0 ? source.length : end);
};

test('server exposes the authoritative Dev AI and usage contracts', () => {
  for (const route of [
    'GET /api/dev/ai/providers',
    'PUT /api/dev/ai/provider',
    'POST /api/dev/ai/provider/test',
    'GET /api/dev/ai/models',
    'PUT /api/dev/ai/active',
    'GET /api/dev/ai/usage'
  ]) assert.notEqual(source.indexOf(`'${route}'`), -1, route);
});

test('every Dev or AI mutation wired in server requires the trusted-origin guard', () => {
  for (const route of [
    'POST /api/ai/workout/generate',
    'POST /api/dev/login',
    'POST /api/dev/logout',
    'PUT /api/dev/ai/provider',
    'POST /api/dev/ai/provider/test',
    'PUT /api/dev/ai/active',
    'DELETE /api/dev/ai/provider'
  ]) assert.match(routeBody(route), /requireTrustedWrite\(req, res\)/, route);
});

test('server source contains neither persisted initial passwords nor provider keys in URLs', () => {
  assert.doesNotMatch(source, /initialPassword|dev-panel\.json/);
  assert.doesNotMatch(source, /[?&]key=/);
});
