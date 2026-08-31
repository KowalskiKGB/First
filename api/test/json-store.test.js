import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createJsonStore, RevisionConflictError } from '../lib/json-store.js';
import { INITIAL_COLLABORATION, migrateCollaboration } from '../domain/schema.js';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'first-json-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    file: path.join(directory, 'collaboration.json'),
    initial: INITIAL_COLLABORATION,
    migrate: migrateCollaboration
  };
}

test('creates the collaboration document from its initial schema', (t) => {
  const options = fixture(t);
  const store = createJsonStore(options);

  assert.equal(existsSync(options.file), true);
  assert.deepEqual(store.read(), {
    schemaVersion: 4,
    rev: 0,
    profiles: [],
    connections: [],
    clients: [],
    notifications: [],
    audit: [],
    programs: [],
    measurements: [],
    availability: [],
    appointments: [],
    receivables: [],
    trainingProfiles: [],
    gymProfiles: [],
    gymDirectory: [],
    gymRequests: [],
    gymReviews: [],
    gymFavorites: [],
    gymSeedTombstones: [],
    gymSeedVersion: null,
    aiPlans: [],
    aiJobs: [],
    aiUsage: []
  });
});

test('migrates incomplete collaboration data idempotently', (t) => {
  const options = fixture(t);
  writeFileSync(options.file, JSON.stringify({ rev: 4, profiles: [{ userId: 'u1' }] }));

  const migrated = migrateCollaboration(JSON.parse(JSON.stringify(createJsonStore(options).read())));

  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.rev, 4);
  assert.deepEqual(migrated.profiles, [{ userId: 'u1' }]);
  assert.deepEqual(migrated.receivables, []);
  assert.deepEqual(migrateCollaboration(migrated), migrated);
});

test('returns defensive copies of collaboration data', (t) => {
  const store = createJsonStore(fixture(t));
  const firstRead = store.read();
  firstRead.profiles.push({ userId: 'u1', roles: ['student'] });

  assert.deepEqual(store.read().profiles, []);
});

test('rejects stale collaboration writes', (t) => {
  const store = createJsonStore(fixture(t));
  store.update(0, (state) => ({ ...state, profiles: [{ userId: 'u1', roles: ['student'] }] }));

  assert.throws(() => store.update(0, (state) => state), RevisionConflictError);
  assert.equal(store.read().rev, 1);
});
