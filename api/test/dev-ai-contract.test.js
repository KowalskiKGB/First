import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const jobsSource = fs.readFileSync(new URL('../ai-jobs.js', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

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
  for (const route of ['POST /api/ai/jobs', 'GET /api/ai/job', 'POST /api/ai/plan/rollback']) {
    assert.notEqual(jobsSource.indexOf(`'${route}'`), -1, route);
  }
  assert.notEqual(source.indexOf('createAiRoutineRoutes'), -1);
  assert.notEqual(fs.readFileSync(new URL('../ai-routines.js', import.meta.url), 'utf8').indexOf("'POST /api/ai/routine'"), -1);
});

test('every Dev or AI mutation wired in server requires the trusted-origin guard', () => {
  for (const route of [
    'POST /api/dev/login',
    'POST /api/dev/logout',
    'PUT /api/dev/ai/provider',
    'POST /api/dev/ai/provider/test',
    'PUT /api/dev/ai/active',
    'DELETE /api/dev/ai/provider'
  ]) assert.match(routeBody(route), /requireTrustedWrite\(req, res\)/, route);
  for (const route of ['POST /api/ai/jobs', 'POST /api/ai/plan/rollback']) {
    const start = jobsSource.indexOf(`'${route}'`);
    const end = jobsSource.indexOf("\n    '", start + route.length + 2);
    assert.match(jobsSource.slice(start, end < 0 ? jobsSource.length : end), /requireTrustedWrite\(req, res\)/, route);
  }
});

test('server source contains neither persisted initial passwords nor provider keys in URLs', () => {
  assert.doesNotMatch(source, /initialPassword|dev-panel\.json/);
  assert.doesNotMatch(source, /[?&]key=/);
});

test('activation fails closed when the AI master key is unavailable', () => {
  assert.match(routeBody('PUT /api/dev/ai/active'), /aiConfigurationEnabled\(\)/);
});

test('production API image includes the AI routine endpoint module', () => {
  assert.match(dockerfile, /ai-routines\.js/);
});

test('generation never forwards raw provider error messages to DTOs or 5xx logs', () => {
  assert.doesNotMatch(jobsSource, /publicError:\s*error\.message/);
  assert.match(jobsSource, /PUBLIC_GENERATION_ERROR/);
  assert.ok(jobsSource.indexOf('validateAiWorkoutPlan(generated.value') > jobsSource.indexOf('try {'));
});

test('generation failure wiring retains provider usage captured before normalization fails', () => {
  assert.match(jobsSource, /failedGenerationUsage\(generated, provider\)/);
  assert.match(jobsSource, /appendUsage\(failedGenerationUsage/);
});

test('startup fails interrupted running jobs and resumes only work that remained queued', () => {
  assert.match(source, /aiJobs\.recoverInterrupted\(\);\s*aiJobs\.drain\(\)/);
});

test('AI status uses the same canonical collaboration context as generation', () => {
  const body = routeBody('GET /api/ai/status');
  assert.match(body, /buildAiGenerationStatus/);
  assert.match(body, /collaborationStore\.read\(\)/);
  assert.doesNotMatch(body, /readState|missingAiFields/);
});
