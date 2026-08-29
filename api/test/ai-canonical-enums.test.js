import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_JOB_STATUSES, AI_PLAN_SOURCES, AI_PLAN_STATUSES, migrateCollaboration } from '../domain/schema.js';

const NOW = '2026-08-29T12:00:00.000Z';

test('AIPlan and AIJob migrations close legacy source/status values into canonical enums without dropping records', () => {
  assert.deepEqual([...AI_PLAN_SOURCES], ['ai', 'personal']);
  assert.deepEqual([...AI_PLAN_STATUSES], ['applied', 'superseded']);
  assert.deepEqual([...AI_JOB_STATUSES], ['queued', 'running', 'applied', 'failed']);
  const migrated = migrateCollaboration({
    aiPlans: [{
      id: 'legacy', studentId: 'student-a', version: 1, provider: 'openai', model: 'test', contextHash: 'hash',
      justification: 'safe', routines: [], schedule: [], source: 'generated', status: 'completed', createdAt: NOW, updatedAt: NOW
    }],
    aiJobs: [{
      id: 'job', idempotencyKey: 'key', studentId: 'student-a', status: 'completed', stage: 'done',
      publicError: null, contextHash: 'hash', planVersion: 1, createdAt: NOW, updatedAt: NOW
    }]
  });
  assert.equal(migrated.aiPlans.length, 1);
  assert.equal(migrated.aiPlans[0].source, 'ai');
  assert.equal(migrated.aiPlans[0].status, 'applied');
  assert.equal(migrated.aiJobs[0].status, 'applied');
});
