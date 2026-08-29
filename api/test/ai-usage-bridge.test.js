import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bridgeAiUsageProperty } from '../ai-usage.js';
import { INITIAL_COLLABORATION, migrateCollaboration } from '../domain/schema.js';
import { createJsonStore } from '../lib/json-store.js';

const NOW = '2026-08-29T12:00:00.000Z';
const usage = (status = 'success') => ({
  provider: 'openai', model: 'gpt-test', inputTokens: 10, outputTokens: 4,
  totalTokens: 14, latencyMs: 120, status, timestamp: NOW
});

test('db.aiUsage operational reads/writes canonical collaboration.aiUsage and migrates legacy metrics once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-ai-usage-'));
  const file = path.join(dir, 'collaboration.json');
  const store = createJsonStore({ file, initial: { ...structuredClone(INITIAL_COLLABORATION), aiUsage: [usage('failed')] }, migrate: migrateCollaboration });
  const db = { users: [], aiProviders: [{ provider: 'openai' }], aiUsage: [usage('success')] };
  let saves = 0;

  bridgeAiUsageProperty({ db, store, saveDb: () => { saves += 1; } });

  assert.equal(db.aiUsage.length, 2);
  assert.equal(store.read().aiUsage.length, 2);
  db.aiUsage = [...db.aiUsage, { ...usage(), model: 'gpt-next' }];
  assert.equal(store.read().aiUsage.length, 3);
  assert.equal(JSON.stringify(db).includes('aiUsage'), false);
  assert.equal(db.aiProviders.length, 1);
  assert.equal(saves, 1);

  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.aiUsage.length, 3);
  assert.equal(JSON.stringify(persisted).includes('prompt'), false);
  assert.equal(JSON.stringify(persisted).includes('response'), false);
});

test('usage bridge supports an empty legacy db without duplicating canonical rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-ai-usage-empty-'));
  const store = createJsonStore({
    file: path.join(dir, 'collaboration.json'),
    initial: { ...structuredClone(INITIAL_COLLABORATION), aiUsage: [usage()] },
    migrate: migrateCollaboration
  });
  const db = { aiProviders: [], aiUsage: [] };
  bridgeAiUsageProperty({ db, store });
  assert.deepEqual(db.aiUsage, [usage()]);
  db.aiUsage = null;
  assert.deepEqual(db.aiUsage, []);
});
