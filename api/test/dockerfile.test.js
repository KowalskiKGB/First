import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const dockerignore = fs.readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('production image includes every local module imported by the API', () => {
  const rootImports = [...server.matchAll(/from ['"]\.\/([^/'"]+\.js)['"]/g)].map(match => match[1]);
  assert.ok(rootImports.length > 0);
  for (const moduleName of rootImports) {
    assert.match(dockerfile, new RegExp(`\\bapi/${moduleName.replace('.', '\\.') }\\b`), `${moduleName} is missing from api/Dockerfile`);
  }
  assert.match(dockerfile, /COPY api\/domain \.\/domain/);
  assert.match(dockerfile, /COPY api\/lib \.\/lib/);
});

test('root Docker build context includes API sources while excluding API artifacts', () => {
  assert.doesNotMatch(dockerignore, /^api\s*$/m);
  assert.match(dockerignore, /^api\/node_modules\s*$/m);
  assert.match(dockerignore, /^api\/coverage\s*$/m);
});

test('Compose healthcheck uses readiness instead of liveness', () => {
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:3000\/api\/ready'\)/);
});
