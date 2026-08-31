import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { migrateCollaboration } from '../domain/schema.js';
import {
  applyGymSeed,
  haversineKm,
  normalizeGymFavorite,
  normalizeGymRecord,
  normalizeGymReview,
  projectGymDirectory,
  retainOneActiveGymReview,
  toggleGymFavorite,
  upsertGymReview
} from '../gym-social.js';
import { MACAPA_GYM_SEED, MACAPA_GYM_SEED_VERSION } from '../data/macapa-gyms.js';
import { createCollaborationStore } from '../personal.js';

const NOW = '2026-08-31T12:00:00.000Z';
const gym = (overrides = {}) => ({
  id: 'gym-a', name: 'Academia A', state: 'AP', city: 'Macapá', address: 'Rua A, 1',
  latitude: 0.035, longitude: -51.07, status: 'verified', visibility: 'public',
  openingHours: [], openingHoursNote: '', exerciseIds: [],
  source: { label: 'Fonte', url: 'https://example.test/a', confidence: 'high', verifiedAt: NOW },
  approvedAt: '2026-08-15T12:00:00.000Z', createdAt: NOW, updatedAt: NOW,
  ...overrides
});
const review = (overrides = {}) => ({
  id: 'review-a', gymId: 'gym-a', userId: 'user-a', rating: 5, comment: 'Ótima',
  status: 'published', demo: false, createdAt: NOW, updatedAt: NOW,
  ...overrides
});

test('gym social migration strictly normalizes expanded records, keeps old data and is idempotent', () => {
  const migrated = migrateCollaboration({
    schemaVersion: 4, rev: 4, legacyFlag: { retain: true }, gymDirectory: [
      gym({ latitude: '0.035', longitude: Number.NaN, visibility: 'not-public', source: { url: 'http://invalid' } }),
      gym({ id: '', name: 'discarded' })
    ],
    gymRequests: [{ id: 'closure', kind: 'closure', status: 'pending', gymId: 'gym-a', submittedByUserId: 'user-a', payload: { note: 'Closed' }, createdAt: NOW }],
    gymReviews: [review(), review({ id: 'review-b', rating: 4, updatedAt: '2026-08-31T13:00:00.000Z' })],
    gymFavorites: [{ gymId: 'gym-a', userId: 'user-a', createdAt: NOW }, { gymId: 'gym-a', userId: 'user-a', createdAt: NOW }],
    gymSeedTombstones: ['gym-macapa-smart-fit', '', 3]
  });

  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.rev, 4);
  assert.deepEqual(migrated.legacyFlag, { retain: true });
  assert.equal(migrated.gymDirectory.find(item => item.id === 'gym-a').latitude, 0.035);
  assert.equal(migrated.gymDirectory.find(item => item.id === 'gym-a').longitude, null);
  assert.equal(migrated.gymDirectory.find(item => item.id === 'gym-a').visibility, 'public');
  assert.equal(migrated.gymDirectory.find(item => item.id === 'gym-a').source, null);
  assert.deepEqual(migrated.gymRequests.map(item => item.kind), ['closure']);
  assert.deepEqual(migrated.gymReviews.filter(item => item.gymId === 'gym-a').map(item => item.id), ['review-b']);
  assert.deepEqual(migrated.gymFavorites, [{ gymId: 'gym-a', userId: 'user-a', createdAt: NOW }]);
  assert.deepEqual(migrated.gymSeedTombstones, ['gym-macapa-smart-fit']);
  assert.deepEqual(migrateCollaboration(migrated), migrated);
});

test('gym social normalizers close malformed data while retaining valid optional fields', () => {
  const normalized = normalizeGymRecord(gym({
    networkName: ' Rede ', neighborhood: ' Centro ', postalCode: '68900-000', visibility: 'hidden',
    openingHours: [
      { day: 1, open: '06:00', close: '22:00', closed: false },
      { day: 2, open: '', close: '', closed: true },
      { day: 9, open: '06:00', close: '22:00', closed: false },
      { day: 3, open: 'invalid', close: '22:00', closed: false }
    ]
  }));
  assert.deepEqual(normalized.openingHours, [
    { day: 1, open: '06:00', close: '22:00', closed: false },
    { day: 2, open: '', close: '', closed: true }
  ]);
  assert.equal(normalized.networkName, 'Rede');
  assert.equal(normalized.visibility, 'hidden');
  assert.equal(normalizeGymRecord({}), null);
  assert.equal(normalizeGymReview({ ...review(), rating: 6 }), null);
  assert.equal(normalizeGymFavorite({ gymId: 'gym-a' }), null);
  assert.deepEqual(normalizeGymReview({ ...review(), moderatedAt: NOW, moderatedBy: 'dev', moderationReason: 'ok' }), {
    ...review(), moderatedAt: NOW, moderatedBy: 'dev', moderationReason: 'ok'
  });

  const retained = retainOneActiveGymReview([
    review({ id: 'removed', status: 'removed' }),
    review({ id: 'active-old', updatedAt: '2026-08-30T00:00:00.000Z' }),
    review({ id: 'active-new', updatedAt: '2026-08-31T00:00:00.000Z' })
  ]);
  assert.deepEqual(retained.map(item => item.id), ['removed', 'active-new']);
  assert.deepEqual(toggleGymFavorite([], {}), []);
  assert.deepEqual(upsertGymReview(retained, { ...review(), rating: 9 }).map(item => item.id), ['removed', 'active-new']);
});

test('Macapá seed has verified metadata and applies once per version without reviving tombstones', () => {
  assert.equal(MACAPA_GYM_SEED.length, 11);
  for (const entry of MACAPA_GYM_SEED) {
    assert.equal(Number.isFinite(entry.latitude), true, entry.id);
    assert.equal(Number.isFinite(entry.longitude), true, entry.id);
    assert.match(entry.source.url, /^https:\/\//, entry.id);
    assert.ok(entry.source.label && entry.source.confidence && entry.source.verifiedAt, entry.id);
  }

  const seeded = applyGymSeed({ gymDirectory: [], gymSeedTombstones: ['gym-macapa-smart-fit'] });
  assert.equal(seeded.gymSeedVersion, MACAPA_GYM_SEED_VERSION);
  assert.equal(seeded.gymDirectory.some(item => item.id === 'gym-macapa-smart-fit'), false);
  assert.equal(seeded.gymDirectory.length, 10);
  assert.deepEqual(applyGymSeed(seeded), seeded);
});

test('Macapá seed is applied by the production collaboration store exactly once', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'first-gym-social-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const first = createCollaborationStore(directory).read();
  const reopened = createCollaborationStore(directory).read();

  assert.equal(first.gymSeedVersion, MACAPA_GYM_SEED_VERSION);
  assert.equal(first.gymDirectory.length, MACAPA_GYM_SEED.length);
  assert.deepEqual(reopened.gymDirectory, first.gymDirectory);
});

test('gym social calculates Haversine distance and immutable favorite/review changes', () => {
  assert.ok(Math.abs(haversineKm(0, 0, 0, 1) - 111.195) < 0.01);
  assert.equal(haversineKm(null, 0, 0, 1), null);

  const favorites = [{ gymId: 'gym-a', userId: 'user-a', createdAt: NOW }];
  const removed = toggleGymFavorite(favorites, { gymId: 'gym-a', userId: 'user-a', now: 'later' });
  assert.deepEqual(removed, []);
  assert.deepEqual(favorites, [{ gymId: 'gym-a', userId: 'user-a', createdAt: NOW }]);
  const added = toggleGymFavorite(removed, { gymId: 'gym-a', userId: 'user-a', now: NOW });
  assert.deepEqual(added, favorites);

  const reviews = [review({ id: 'old', rating: 2 })];
  const changed = upsertGymReview(reviews, review({ id: 'new', rating: 5 }));
  assert.deepEqual(changed.map(item => item.id), ['new']);
  assert.deepEqual(reviews.map(item => item.id), ['old']);
});

test('gym social projection excludes demos and PII and derives stable tags', () => {
  const result = projectGymDirectory({
    gyms: [
      gym({ id: 'gym-a', networkName: 'Rede A' }),
      gym({ id: 'gym-b', name: 'Academia B', latitude: 0.04, longitude: -51.07, approvedAt: '2026-01-01T00:00:00.000Z' }),
      gym({ id: 'gym-c', name: 'Academia C', latitude: 0.05, longitude: -51.07 })
    ],
    reviews: [
      review(), review({ id: 'demo', rating: 1, demo: true, userId: 'private-demo' }),
      review({ id: 'pending', rating: 1, status: 'pending', userId: 'private-pending' })
    ],
    favorites: [{ gymId: 'gym-a', userId: 'user-a', createdAt: NOW }],
    userId: 'user-a', latitude: 0.03, longitude: -51.07,
    locality: { state: 'AP', city: 'Macapá' }, now: NOW
  });

  const first = result.find(item => item.id === 'gym-a');
  assert.equal(first.averageRating, 5);
  assert.equal(first.reviewCount, 1);
  assert.deepEqual(first.tags, ['Preferida', 'Perto de você', 'Nova', 'Rede Rede A']);
  assert.equal(first.distanceKm > 0, true);
  assert.equal(JSON.stringify(result).includes('user-a'), false);
  assert.equal(JSON.stringify(result).includes('private-demo'), false);
  assert.equal(JSON.stringify(result).includes('latitude'), false);
  assert.equal(JSON.stringify(result).includes('longitude'), false);
});

test('gym social projection derives hot and declining tags only from real published windows', () => {
  const dated = (id, gymId, rating, date) => review({ id, gymId, rating, createdAt: date, updatedAt: date });
  const old = '2026-07-01T00:00:00.000Z';
  const recent = '2026-08-20T00:00:00.000Z';
  const reviews = [
    ...Array.from({ length: 5 }, (_, index) => dated(`hot-old-${index}`, 'hot', 4, old)),
    ...Array.from({ length: 5 }, (_, index) => dated(`hot-new-${index}`, 'hot', 5, recent)),
    ...Array.from({ length: 5 }, (_, index) => dated(`low-old-${index}`, 'low', 5, old)),
    ...Array.from({ length: 5 }, (_, index) => dated(`low-new-${index}`, 'low', 4, recent))
  ];
  const result = projectGymDirectory({
    gyms: [gym({ id: 'hot', name: 'Hot' }), gym({ id: 'low', name: 'Low', source: undefined })],
    reviews,
    now: NOW
  });

  assert.equal(result.find(item => item.id === 'hot').tags.includes('Em alta'), true);
  assert.equal(result.find(item => item.id === 'low').tags.includes('Em baixa'), true);
  assert.equal(result.every(item => item.distanceKm === undefined), true);
});
