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
import { MACAPA_GYM_REVIEW_SEED, MACAPA_GYM_SEED, MACAPA_GYM_SEED_VERSION } from '../data/macapa-gyms.js';
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
  assert.deepEqual(retained.map(item => item.id), ['active-new', 'removed']);
  assert.deepEqual(toggleGymFavorite([], {}), []);
  assert.deepEqual(upsertGymReview(retained, { ...review(), rating: 9 }).map(item => item.id), ['active-new', 'removed']);
});

test('gym social fix round caps review text and materializes nullable v4 gym defaults', () => {
  assert.equal(normalizeGymReview({ ...review(), comment: 'x'.repeat(601) }).comment.length, 600);

  const migrated = migrateCollaboration({ gymDirectory: [{
    id: 'legacy', name: 'Legacy', state: 'AP', city: 'Macapá', address: 'Rua Legado, 1',
    status: 'verified', openingHours: [], openingHoursNote: '', exerciseIds: [], createdAt: NOW, updatedAt: NOW
  }] });
  assert.deepEqual(migrated.gymDirectory[0], {
    id: 'legacy', name: 'Legacy', state: 'AP', city: 'Macapá', address: 'Rua Legado, 1',
    status: 'verified', visibility: 'public', latitude: null, longitude: null, source: null,
    coordinateVerification: null, coordinateApproximate: false, approvedAt: null,
    openingHours: [], openingHoursNote: '', exerciseIds: [], createdAt: NOW, updatedAt: NOW
  });
});

test('Macapá seed has verified metadata and applies once per version without reviving tombstones', () => {
  assert.equal(MACAPA_GYM_SEED.length, 11);
  const coordinateBounds = {
    'gym-macapa-smart-fit': [0.03, 0.032, -51.064, -51.062],
    'gym-macapa-maioral-tucuju': [0.073, 0.075, -51.057, -51.054],
    'gym-macapa-energy-zona-norte': [0.077, 0.079, -51.072, -51.069],
    'gym-macapa-energy-sport': [0.036, 0.038, -51.065, -51.062],
    'gym-macapa-box-cross': [0.031, 0.033, -51.075, -51.072],
    'gym-macapa-box-tucuju': [0.02, 0.022, -51.073, -51.07],
    'gym-macapa-t30-intensity': [0.03, 0.032, -51.063, -51.06],
    'gym-macapa-life-fit': [0.039, 0.042, -51.078, -51.075],
    'gym-macapa-best-gym': [0.048, 0.05, -51.12, -51.116],
    'gym-macapa-iron-men': [0.017, 0.02, -51.065, -51.062],
    'gym-macapa-shape-fitness': [0.059, 0.061, -51.055, -51.052]
  };
  for (const entry of MACAPA_GYM_SEED) {
    const [latMin, latMax, lonMin, lonMax] = coordinateBounds[entry.id];
    assert.equal(Number.isFinite(entry.latitude) && entry.latitude >= latMin && entry.latitude <= latMax, true, entry.id);
    assert.equal(Number.isFinite(entry.longitude) && entry.longitude >= lonMin && entry.longitude <= lonMax, true, entry.id);
    assert.match(entry.source.url, /^https:\/\/(?:www\.)?openstreetmap\.org\/(?:node|way)\/|^https:\/\/www\.econodata\.com\.br\/consulta-empresa\//, entry.id);
    assert.doesNotMatch(entry.source.url, /google\.com/i, entry.id);
    assert.ok(entry.source.label && entry.source.confidence && entry.source.verifiedAt, entry.id);
    assert.match(entry.coordinateVerification.provider, /^(?:OpenStreetMap|Google Maps center)/, entry.id);
    assert.match(entry.coordinateVerification.url, /^https:\/\/(?:www\.)?openstreetmap\.org\/(?:node|way)\/|^https:\/\/(?:www\.)?google\.com\/maps\/search\/\?/, entry.id);
    assert.ok(entry.coordinateVerification.verifiedAt, entry.id);
  }
  const bestGym = MACAPA_GYM_SEED.find(entry => entry.id === 'gym-macapa-best-gym');
  assert.equal(bestGym.coordinateApproximate, true);
  assert.equal(bestGym.latitude, 0.049152);
  assert.equal(bestGym.longitude, -51.11808);
  assert.equal(bestGym.source.url, 'https://www.econodata.com.br/consulta-empresa/51326678000108-academia-best-gym-ltda');
  assert.equal(bestGym.coordinateVerification.provider, 'Google Maps center');
  assert.match(bestGym.coordinateVerification.url, /^https:\/\/www\.google\.com\/maps\/search\/\?/, 'Best Gym map evidence');
  assert.match(bestGym.coordinateVerification.note, /Marabaixo III, Macapá/, 'Best Gym coordinate evidence note');

  const seeded = applyGymSeed({ gymDirectory: [], gymSeedTombstones: ['gym-macapa-smart-fit'] });
  assert.equal(seeded.gymSeedVersion, MACAPA_GYM_SEED_VERSION);
  assert.equal(seeded.gymDirectory.some(item => item.id === 'gym-macapa-smart-fit'), false);
  assert.equal(seeded.gymDirectory.length, 10);
  assert.deepEqual(applyGymSeed(seeded), seeded);

  const legacySeed = applyGymSeed({
    gymSeedVersion: 'macapa-2026-08-31',
    gymDirectory: [{
      ...MACAPA_GYM_SEED[0], latitude: 0, longitude: 0,
      source: { label: 'Google Maps', url: 'https://www.google.com/maps/search/?q=old', confidence: 'medium', verifiedAt: NOW }
    }]
  });
  assert.equal(legacySeed.gymDirectory[0].latitude, MACAPA_GYM_SEED[0].latitude);
  assert.equal(legacySeed.gymDirectory[0].source.url, MACAPA_GYM_SEED[0].source.url);

  const staleBest = applyGymSeed({
    gymSeedVersion: 'macapa-2026-09-01',
    gymDirectory: [{
      ...bestGym,
      latitude: null,
      longitude: null,
      source: { label: 'OpenStreetMap Nominatim', url: 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Best%20Gym', confidence: 'medium', verifiedAt: NOW },
      coordinateVerification: { provider: 'OpenStreetMap Nominatim', url: 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Best%20Gym', confidence: 'medium', verifiedAt: NOW }
    }]
  });
  assert.equal(staleBest.gymDirectory[0].latitude, 0.049152);
  assert.equal(staleBest.gymDirectory[0].longitude, -51.11808);
  assert.equal(staleBest.gymDirectory[0].source.url, bestGym.source.url);
  assert.equal(staleBest.gymDirectory[0].coordinateVerification.provider, 'Google Maps center');
});

test('Macapá social seed adds labeled demo reviews once and never revives a removed review', () => {
  assert.ok(MACAPA_GYM_REVIEW_SEED.length >= 6);
  assert.equal(MACAPA_GYM_REVIEW_SEED.every(item => item.demo === true && item.status === 'published'), true);
  assert.equal(MACAPA_GYM_REVIEW_SEED.every(item => item.userId.startsWith('demo-first-')), true);
  assert.equal(MACAPA_GYM_REVIEW_SEED.every(item => item.comment.startsWith('Demonstração —')), true);
  assert.equal(MACAPA_GYM_REVIEW_SEED.every(item => MACAPA_GYM_SEED.some(gym => gym.id === item.gymId)), true);

  const seeded = applyGymSeed({ gymDirectory: [], gymReviews: [] });
  assert.deepEqual(seeded.gymReviews, MACAPA_GYM_REVIEW_SEED);
  assert.deepEqual(applyGymSeed(seeded), seeded);

  const tombstonedGymId = MACAPA_GYM_REVIEW_SEED[0].gymId;
  const withoutTombstonedGym = applyGymSeed({ gymDirectory: [], gymReviews: [], gymSeedTombstones: [tombstonedGymId] });
  assert.equal(withoutTombstonedGym.gymReviews.some(item => item.gymId === tombstonedGymId), false);

  const removed = { ...seeded.gymReviews[0], status: 'removed', moderationReason: 'Removida pelo Dev' };
  const reseeded = applyGymSeed({
    ...seeded,
    gymSeedVersion: 'macapa-legacy',
    gymReviews: [removed, ...seeded.gymReviews.slice(1)]
  });
  assert.equal(reseeded.gymReviews.filter(item => item.id === removed.id).length, 1);
  assert.equal(reseeded.gymReviews.find(item => item.id === removed.id).status, 'removed');

  const migrated = migrateCollaboration({
    ...seeded,
    gymReviews: [
      removed,
      ...Array.from({ length: 5001 }, (_, index) => review({
        id: `removed-filler-${index}`,
        gymId: `gym-filler-${index}`,
        userId: `user-filler-${index}`,
        status: 'removed',
        updatedAt: new Date(Date.UTC(2027, 0, 2 + index)).toISOString()
      }))
    ]
  });
  assert.equal(migrated.gymReviews.some(item => item.id === removed.id), false);
  assert.deepEqual(migrated.gymReviewSeedTombstones, [removed.id]);
  const futureSeed = applyGymSeed({
    ...migrated,
    gymSeedVersion: 'macapa-future-seed',
    gymReviews: migrated.gymReviews.filter(item => item.id !== removed.id)
  });
  assert.equal(futureSeed.gymReviews.some(item => item.id === removed.id), false);
});

test('Macapá seed is applied by the production collaboration store exactly once', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'first-gym-social-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const first = createCollaborationStore(directory).read();
  const reopened = createCollaborationStore(directory).read();

  assert.equal(first.gymSeedVersion, MACAPA_GYM_SEED_VERSION);
  assert.equal(first.gymDirectory.length, MACAPA_GYM_SEED.length);
  assert.deepEqual(first.gymReviews, MACAPA_GYM_REVIEW_SEED);
  assert.deepEqual(reopened.gymDirectory, first.gymDirectory);
  assert.deepEqual(reopened.gymReviews, first.gymReviews);
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
  assert.deepEqual({ latitude: first.latitude, longitude: first.longitude }, { latitude: 0.035, longitude: -51.07 });
});

test('gym social projection excludes hidden and archived gyms, keeps closed gyms, and ranks favorites first', () => {
  const result = projectGymDirectory({
    gyms: [
      gym({ id: 'hidden', name: 'Hidden', visibility: 'hidden', latitude: 0.0301 }),
      gym({ id: 'archived', name: 'Archived', status: 'archived', latitude: 0.0302 }),
      gym({ id: 'closed', name: 'Closed', status: 'closed', latitude: 0.0303 }),
      gym({ id: 'near', name: 'Near', latitude: 0.0304 }),
      gym({ id: 'favorite-far', name: 'Favorite far', latitude: 0.08 })
    ],
    favorites: [{ gymId: 'favorite-far', userId: 'user-a', createdAt: NOW }],
    userId: 'user-a', latitude: 0.03, longitude: -51.07, now: NOW
  });

  assert.deepEqual(result.map(item => item.id), ['favorite-far', 'closed', 'near']);
  assert.equal(result.some(item => item.id === 'hidden' || item.id === 'archived'), false);
});

test('gym social projection chooses nearest tags by raw Haversine distance and rounds only DTO distance', () => {
  const result = projectGymDirectory({
    gyms: [
      gym({ id: 'a-farthest', latitude: 0, longitude: 0.00049 }),
      gym({ id: 'b-nearest', latitude: 0, longitude: 0.00046 }),
      gym({ id: 'c-second', latitude: 0, longitude: 0.00047 }),
      gym({ id: 'd-third', latitude: 0, longitude: 0.00048 })
    ],
    latitude: 0, longitude: 0, locality: { state: 'AP', city: 'Macapá' }, now: NOW
  });

  assert.deepEqual(result.filter(item => item.tags.includes('Perto de você')).map(item => item.id).sort(), ['b-nearest', 'c-second', 'd-third']);
  assert.deepEqual(result.map(item => item.distanceKm), [0.1, 0.1, 0.1, 0.1]);
});

test('gym social migration caps removed history without dropping active reviews', () => {
  const active = review({ id: 'active-first', gymId: 'gym-active', userId: 'active-user', updatedAt: '2026-01-01T00:00:00.000Z' });
  const removed = Array.from({ length: 5001 }, (_, index) => review({
    id: `removed-${String(index).padStart(4, '0')}`, gymId: `gym-removed-${index}`, userId: `user-removed-${index}`,
    status: 'removed', updatedAt: new Date(Date.UTC(2026, 0, 2 + index)).toISOString()
  }));
  const migrated = migrateCollaboration({ gymReviews: [active, ...removed] });

  assert.equal(migrated.gymReviews.length, 5000);
  assert.equal(migrated.gymReviews.some(item => item.id === 'active-first'), true);
  assert.equal(migrated.gymReviews.some(item => item.id === 'removed-0000'), false);
  assert.equal(migrated.gymReviews.some(item => item.id === 'removed-5000'), true);
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
