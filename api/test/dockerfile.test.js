import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('production image includes every local module imported by the API', () => {
  assert.match(dockerfile, /COPY [^\n]*\bpersonal\.js\b[^\n]* \.\//);
  assert.match(dockerfile, /COPY domain \.\/domain/);
  assert.match(dockerfile, /COPY lib \.\/lib/);
});
