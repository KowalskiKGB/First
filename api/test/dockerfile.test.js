import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('production image includes every local module imported by the API', () => {
  assert.match(dockerfile, /COPY [^\n]*\bpersonal\.js\b[^\n]* \.\//);
  assert.match(dockerfile, /\bai-providers\.js\b/);
  assert.match(dockerfile, /\bai-jobs\.js\b/);
  assert.match(dockerfile, /\bai-usage\.js\b/);
  assert.match(dockerfile, /\bdev-auth\.js\b/);
  assert.match(dockerfile, /COPY api\/domain \.\/domain/);
  assert.match(dockerfile, /COPY api\/lib \.\/lib/);
});
