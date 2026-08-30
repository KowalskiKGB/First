import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bridgeAiUsageProperty } from '../ai-usage.js';
import { INITIAL_COLLABORATION, migrateCollaboration } from '../domain/schema.js';
import { createJsonStore, RevisionConflictError } from '../lib/json-store.js';

const NOW = '2026-08-29T12:00:00.000Z';
const usage = (status = 'success') => ({
  provider: 'openai', model: 'gpt-test', inputTokens: 10, outputTokens: 4,
  totalTokens: 14, latencyMs: 120, status, timestamp: NOW
});

function createMemoryStore(initial) {
  let state = structuredClone(initial);
  return {
    read: () => structuredClone(state),
    update(expectedRev, reducer) {
      if (expectedRev !== state.rev) throw new RevisionConflictError();
      state = { ...reducer(structuredClone(state)), rev: state.rev + 1 };
      return structuredClone(state);
    }
  };
}

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

test('legacy migration retries a revision conflict against the newest canonical usage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-ai-usage-retry-'));
  const baseStore = createJsonStore({
    file: path.join(dir, 'collaboration.json'),
    initial: { ...structuredClone(INITIAL_COLLABORATION), aiUsage: [{ ...usage(), model: 'current' }] },
    migrate: migrateCollaboration
  });
  const concurrent = { ...usage(), model: 'concurrent' };
  let attempts = 0;
  let injected = false;
  const store = {
    read: () => baseStore.read(),
    update(expectedRev, reducer) {
      attempts += 1;
      if (!injected) {
        injected = true;
        const current = baseStore.read();
        baseStore.update(current.rev, state => ({ ...state, aiUsage: [...state.aiUsage, concurrent] }));
      }
      return baseStore.update(expectedRev, reducer);
    }
  };
  const db = { aiUsage: [{ ...usage(), model: 'legacy' }] };

  bridgeAiUsageProperty({ db, store });

  assert.equal(attempts, 2);
  assert.deepEqual(db.aiUsage.map(row => row.model), ['current', 'concurrent', 'legacy']);
  assert.equal(baseStore.read().rev, 2);
});

test('legacy migration stops after three revision conflicts and leaves the legacy db intact', () => {
  const conflict = new RevisionConflictError();
  const legacy = [{ ...usage(), model: 'legacy' }];
  const db = { aiUsage: legacy };
  let attempts = 0;
  let saves = 0;
  const store = {
    read: () => ({ rev: 0, aiUsage: [] }),
    update() {
      attempts += 1;
      throw conflict;
    }
  };

  assert.throws(
    () => bridgeAiUsageProperty({ db, store, saveDb: () => { saves += 1; } }),
    error => error === conflict
  );
  assert.equal(attempts, 3);
  assert.strictEqual(db.aiUsage, legacy);
  assert.equal(saves, 0);
});

test('legacy migration propagates non-conflict failures without retrying', () => {
  const failure = new Error('storage unavailable');
  const db = { aiUsage: [usage()] };
  let attempts = 0;
  const store = {
    read: () => ({ rev: 0, aiUsage: [] }),
    update() {
      attempts += 1;
      throw failure;
    }
  };

  assert.throws(() => bridgeAiUsageProperty({ db, store }), error => error === failure);
  assert.equal(attempts, 1);
  assert.deepEqual(db.aiUsage, [usage()]);
});

test('absent legacy usage stays canonical while replacement is immutable and capped', () => {
  const canonical = { ...usage(), model: 'canonical' };
  const store = createMemoryStore({ rev: 7, aiUsage: [canonical] });
  const bridge = bridgeAiUsageProperty({ db: {}, store });
  assert.deepEqual(bridge.read(), [canonical]);

  const entries = Array.from({ length: 2001 }, (_, index) => ({
    ...usage(),
    model: `model-${index}`,
    ...(index === 2000 ? { studentId: 'student-a', privatePayload: 'discard-me' } : {})
  }));
  const originalEntries = structuredClone(entries);

  const replaced = bridge.replace(entries);

  assert.equal(replaced.length, 2000);
  assert.equal(replaced[0].model, 'model-1');
  assert.deepEqual(replaced.at(-1), {
    provider: 'openai',
    model: 'model-2000',
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    latencyMs: 120,
    status: 'success',
    studentId: 'student-a',
    timestamp: NOW
  });
  assert.deepEqual(entries, originalEntries);
  replaced[0].model = 'mutated-read';
  assert.equal(bridge.read()[0].model, 'model-1');
});
