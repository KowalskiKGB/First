import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_COLLABORATION, migrateCollaboration } from '../domain/schema.js';

const NOW = '2026-08-30T12:00:00.000Z';
const gym = (overrides = {}) => ({
  id: 'gym-fortaleza-centro',
  name: 'Academia Centro',
  state: 'CE',
  city: 'Fortaleza',
  address: 'Rua ABC, 10 - Centro',
  status: 'unverified',
  openingHours: [{ day: 1, open: '06:00', close: '22:00', closed: false }],
  openingHoursNote: '',
  exerciseIds: ['0001'],
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides
});

const pendingRequest = (overrides = {}) => ({
  id: 'request-equipment',
  kind: 'equipment',
  status: 'pending',
  gymId: 'gym-fortaleza-centro',
  submittedByUserId: 'student-a',
  payload: { name: 'Hack squat', exerciseIds: ['0003'] },
  createdAt: NOW,
  ...overrides
});

function source(overrides = {}) {
  return {
    ...structuredClone(INITIAL_COLLABORATION),
    schemaVersion: 2,
    gymDirectory: [gym()],
    gymRequests: [],
    ...overrides
  };
}

function memoryStore(initial) {
  let value = migrateCollaboration(initial);
  return {
    read: () => structuredClone(value),
    update(expectedRev, reducer) {
      assert.equal(expectedRev, value.rev, 'stale collaboration revision');
      value = { ...migrateCollaboration(reducer(structuredClone(value))), rev: value.rev + 1 };
      return structuredClone(value);
    }
  };
}

async function fixture(initial) {
  const { createGymDirectoryRoutes } = await import('../gym-directory.js');
  const store = memoryStore(initial);
  let id = 0;
  const json = (res, status, body) => Object.assign(res, { status, body });
  const routes = createGymDirectoryRoutes({
    store,
    readSession: req => req.user || null,
    readBody: async req => req.body || {},
    json,
    requireTrustedWrite: (req, res) => req.trusted !== false || !json(res, 403, { error: 'invalid origin' }),
    requireDev: (req, res) => req.devUsername || !json(res, 401, { error: 'dev panel locked' }),
    now: () => NOW,
    randomId: () => `generated-${++id}`
  });
  return { routes, store };
}

async function invoke(routes, key, request = {}) {
  assert.equal(typeof routes[key], 'function', `missing route ${key}`);
  const req = {
    headers: {},
    url: key.slice(key.indexOf(' ') + 1),
    trusted: true,
    ...request
  };
  const res = {};
  await routes[key](req, res);
  return res;
}

test('collaboration migration adds the moderated gym collections without losing legacy data', () => {
  const legacy = source({
    rev: 7,
    legacyFlag: { keep: true },
    profiles: [{ userId: 'legacy-user', custom: 'keep' }],
    gymDirectory: [gym({ createdBy: 'must-not-be-public' })],
    gymRequests: [pendingRequest()]
  });

  const migrated = migrateCollaboration(legacy);

  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.rev, 7);
  assert.deepEqual(migrated.legacyFlag, { keep: true });
  assert.deepEqual(migrated.profiles, legacy.profiles);
  assert.deepEqual(migrated.gymDirectory, [gym({
    visibility: 'public', latitude: null, longitude: null, source: null,
    coordinateVerification: null, coordinateApproximate: false, approvedAt: null
  })]);
  assert.deepEqual(migrated.gymRequests, [pendingRequest()]);
  assert.deepEqual(migrateCollaboration(migrated), migrated);

  const empty = migrateCollaboration({ schemaVersion: 2, rev: 0, profiles: [{ userId: 'student-a' }] });
  assert.deepEqual(empty.gymDirectory, []);
  assert.deepEqual(empty.gymRequests, []);
  assert.deepEqual(empty.profiles, [{ userId: 'student-a' }]);
});

test('public directory needs no session and filters by UF, city and free-text query', async () => {
  const second = gym({
    id: 'gym-fortaleza-aldeota', name: 'Movimento Aldeota', address: 'Avenida Santos Dumont, 2000',
    status: 'verified', exerciseIds: ['0001', '0003'], createdBy: 'student-secret'
  });
  const third = gym({ id: 'gym-sp', name: 'Academia Centro Paulista', state: 'SP', city: 'São Paulo' });
  const f = await fixture(source({ gymDirectory: [gym(), second, third], gymRequests: [pendingRequest()] }));

  const list = await invoke(f.routes, 'GET /api/gyms', {
    url: '/api/gyms?uf=ce&city=fortaleza&q=aldeota'
  });

  assert.equal(list.status, 200);
  assert.deepEqual(list.body.gyms.map(item => item.id), ['gym-fortaleza-aldeota']);
  assert.equal(JSON.stringify(list.body).includes('student-secret'), false);
  assert.equal(JSON.stringify(list.body).includes('student-a'), false);

  const accentInsensitive = await invoke(f.routes, 'GET /api/gyms', {
    url: '/api/gyms?uf=sp&city=sao%20paulo&q=paulista'
  });
  assert.deepEqual(accentInsensitive.body.gyms.map(item => item.id), ['gym-sp']);

  const detail = await invoke(f.routes, 'GET /api/gym', { url: '/api/gym?id=gym-fortaleza-aldeota' });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.gym.exerciseIds, ['0001', '0003']);
  assert.deepEqual(detail.body.gym.openingHours, second.openingHours);
  assert.equal(detail.body.gym.openingHoursNote, '');
  assert.equal('createdBy' in detail.body.gym, false);
});

test('only an authenticated student can queue an equipment suggestion and it does not publish directly', async () => {
  const f = await fixture(source());
  const body = {
    rev: 0,
    kind: 'equipment',
    gymId: 'gym-fortaleza-centro',
    payload: { name: 'Hack squat', exerciseIds: ['0003', '0001', '0003'] }
  };

  const anonymous = await invoke(f.routes, 'POST /api/gym-requests', { body });
  assert.equal(anonymous.status, 401);

  const untrusted = await invoke(f.routes, 'POST /api/gym-requests', {
    user: { id: 'student-a' }, trusted: false, body
  });
  assert.equal(untrusted.status, 403);

  const inventedExercise = await invoke(f.routes, 'POST /api/gym-requests', {
    user: { id: 'student-a' },
    body: { ...body, payload: { name: 'Aparelho inventado', exerciseIds: ['not-in-catalogue'] } }
  });
  assert.equal(inventedExercise.status, 400);
  assert.deepEqual(f.store.read().gymRequests, []);

  const created = await invoke(f.routes, 'POST /api/gym-requests', {
    user: { id: 'student-a' }, body
  });

  assert.equal(created.status, 200);
  assert.equal(created.body.request.status, 'pending');
  assert.equal(created.body.request.submittedByUserId, 'student-a');
  assert.deepEqual(created.body.request.payload.exerciseIds, ['0003', '0001']);
  assert.deepEqual(f.store.read().gymDirectory[0].exerciseIds, ['0001']);

  body.payload.exerciseIds.push('0002');
  assert.deepEqual(f.store.read().gymRequests[0].payload.exerciseIds, ['0003', '0001']);
});

test('gym registration accepts only a real Brazilian UF', async () => {
  const f = await fixture(source());
  const response = await invoke(f.routes, 'POST /api/gym-requests', {
    user: { id: 'student-a' },
    body: {
      rev: 0,
      kind: 'gym',
      payload: {
        name: 'Academia Inventada',
        state: 'ZZ',
        city: 'Cidade inexistente',
        address: 'Rua sem cadastro, 1',
        openingHours: [],
        exerciseIds: []
      }
    }
  });

  assert.deepEqual({ status: response.status, body: response.body }, {
    status: 400,
    body: { error: 'invalid state' }
  });
  assert.deepEqual(f.store.read().gymRequests, []);
});

test('equipment suggestions are rate-limited per authenticated account', async () => {
  const f = await fixture(source());
  for (let index = 0; index < 20; index += 1) {
    const created = await invoke(f.routes, 'POST /api/gym-requests', {
      user: { id: 'student-a' },
      body: {
        rev: index,
        kind: 'equipment',
        gymId: 'gym-fortaleza-centro',
        payload: { name: `Sugestão ${index}`, exerciseIds: ['0003'] }
      }
    });
    assert.equal(created.status, 200);
  }

  const limited = await invoke(f.routes, 'POST /api/gym-requests', {
    user: { id: 'student-a' },
    body: {
      rev: 20,
      kind: 'equipment',
      gymId: 'gym-fortaleza-centro',
      payload: { name: 'Sugestão excedente', exerciseIds: ['0003'] }
    }
  });

  assert.deepEqual({ status: limited.status, body: limited.body }, {
    status: 429,
    body: { error: 'too many gym requests' }
  });
  assert.equal(f.store.read().gymRequests.length, 20);
});

test('Dev lists private requests, approves their exercise snapshot and can reject without publishing', async () => {
  const equipment = pendingRequest({ payload: { name: 'Hack squat', exerciseIds: ['0003', '0001'] } });
  const newGym = pendingRequest({
    id: 'request-gym', kind: 'gym', gymId: undefined,
    payload: {
      name: 'Academia Nova', state: 'CE', city: 'Fortaleza', address: 'Rua Nova, 20',
      openingHours: [], exerciseIds: ['0002']
    }
  });
  const f = await fixture(source({ gymRequests: [equipment, newGym] }));

  const locked = await invoke(f.routes, 'GET /api/dev/gym-requests');
  assert.equal(locked.status, 401);

  const queue = await invoke(f.routes, 'GET /api/dev/gym-requests', { devUsername: 'first_dev_test' });
  assert.equal(queue.status, 200);
  assert.deepEqual(queue.body.requests.map(item => item.id), ['request-equipment', 'request-gym']);
  assert.equal(queue.body.requests[0].submittedByUserId, 'student-a');

  const approved = await invoke(f.routes, 'POST /api/dev/gym-requests/review', {
    devUsername: 'first_dev_test',
    body: { rev: 0, requestId: 'request-equipment', status: 'approved' }
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.request.status, 'approved');
  assert.equal(approved.body.request.reviewedBy, 'first_dev_test');
  assert.deepEqual(f.store.read().gymDirectory[0].exerciseIds, ['0001', '0003']);

  const rejected = await invoke(f.routes, 'POST /api/dev/gym-requests/review', {
    devUsername: 'first_dev_test',
    body: { rev: 1, requestId: 'request-gym', status: 'rejected' }
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.request.status, 'rejected');
  assert.equal(f.store.read().gymDirectory.some(item => item.name === 'Academia Nova'), false);
});

test('Dev-approved gym suggestions preserve catalogue exercises and textual opening hours', async () => {
  const f = await fixture(source());
  const created = await invoke(f.routes, 'POST /api/gym-requests', {
    user: { id: 'student-a' },
    body: {
      rev: 0,
      kind: 'gym',
      payload: {
        name: 'Academia Nova',
        state: 'CE',
        city: 'Fortaleza',
        address: 'Rua Nova, 20',
        openingHours: [],
        openingHoursNote: 'Segunda a sexta, 6:00 às 22:00',
        exerciseIds: ['0002', '0003']
      }
    }
  });
  assert.equal(created.status, 200);

  const approved = await invoke(f.routes, 'POST /api/dev/gym-requests/review', {
    devUsername: 'first_dev_test',
    body: { rev: 1, requestId: created.body.request.id, status: 'approved' }
  });

  assert.equal(approved.status, 200);
  const published = f.store.read().gymDirectory.find(item => item.name === 'Academia Nova');
  assert.equal(published.openingHoursNote, 'Segunda a sexta, 6:00 às 22:00');
  assert.deepEqual(published.exerciseIds, ['0002', '0003']);
});

test('public directory enriches gyms without exposing reviewer identity and a signed-in student can toggle a private favorite', async () => {
  const review = {
    id: 'review-published', gymId: 'gym-fortaleza-centro', userId: 'student-b', rating: 4,
    comment: 'Boa academia', status: 'published', demo: false, createdAt: NOW, updatedAt: NOW
  };
  const f = await fixture(source({ gymReviews: [review], gymFavorites: [] }));

  const publicList = await invoke(f.routes, 'GET /api/gyms');
  assert.equal(publicList.status, 200);
  assert.equal(publicList.body.gyms[0].averageRating, 4);
  assert.equal(publicList.body.gyms[0].reviewCount, 1);
  assert.equal(JSON.stringify(publicList.body).includes('student-b'), false);

  const favorite = await invoke(f.routes, 'PUT /api/gym/favorite', {
    user: { id: 'student-a' }, body: { rev: 0, gymId: 'gym-fortaleza-centro' }
  });
  assert.deepEqual({ status: favorite.status, favorite: favorite.body.favorite }, { status: 200, favorite: true });
  assert.deepEqual(f.store.read().gymFavorites.map(item => item.userId), ['student-a']);

  const removed = await invoke(f.routes, 'PUT /api/gym/favorite', {
    user: { id: 'student-a' }, body: { rev: 1, gymId: 'gym-fortaleza-centro' }
  });
  assert.deepEqual({ status: removed.status, favorite: removed.body.favorite }, { status: 200, favorite: false });
  assert.deepEqual(f.store.read().gymFavorites, []);
});

test('a student owns one review, suspicious content is pending and review edits are rate-limited', async () => {
  const f = await fixture(source());
  const suspicious = await invoke(f.routes, 'PUT /api/gym/review', {
    user: { id: 'student-a' }, body: { rev: 0, gymId: 'gym-fortaleza-centro', rating: 5, comment: 'Ligue 99999-9999' }
  });
  assert.equal(suspicious.status, 200);
  assert.equal(suspicious.body.review.status, 'pending');
  assert.equal('userId' in suspicious.body.review, false);

  const edited = await invoke(f.routes, 'PUT /api/gym/review', {
    user: { id: 'student-a' }, body: { rev: 1, gymId: 'gym-fortaleza-centro', rating: 3, comment: 'Atualizada' }
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.review.status, 'published');
  assert.equal(f.store.read().gymReviews.filter(item => item.userId === 'student-a' && item.status !== 'removed').length, 1);

  for (let index = 0; index < 30; index += 1) {
    const response = await invoke(f.routes, 'PUT /api/gym/review', {
      user: { id: 'student-b' }, body: { rev: index + 2, gymId: 'gym-fortaleza-centro', rating: 4, comment: `Comentário ${index}` }
    });
    assert.equal(response.status, 200);
  }
  const limited = await invoke(f.routes, 'PUT /api/gym/review', {
    user: { id: 'student-b' }, body: { rev: 32, gymId: 'gym-fortaleza-centro', rating: 4, comment: 'Excedente' }
  });
  assert.deepEqual({ status: limited.status, body: limited.body }, { status: 429, body: { error: 'too many gym reviews' } });
});

test('Dev applies structured corrections, archives and restores gyms, and moderates reviews', async () => {
  const request = pendingRequest({
    id: 'request-correction', kind: 'correction',
    payload: { address: 'Rua Corrigida, 20', city: 'Fortaleza', exerciseIds: ['0002'] }
  });
  const review = {
    id: 'review-pending', gymId: 'gym-fortaleza-centro', userId: 'student-a', rating: 4,
    comment: 'Aguardando análise', status: 'pending', demo: false, createdAt: NOW, updatedAt: NOW
  };
  const f = await fixture(source({ gymRequests: [request], gymReviews: [review] }));

  const correction = await invoke(f.routes, 'POST /api/dev/gym-requests/review', {
    devUsername: 'first_dev_test', body: { rev: 0, requestId: request.id, status: 'approved' }
  });
  assert.equal(correction.status, 200);
  assert.equal(f.store.read().gymDirectory[0].address, 'Rua Corrigida, 20');
  assert.deepEqual(f.store.read().gymDirectory[0].exerciseIds, ['0002']);

  const archived = await invoke(f.routes, 'PUT /api/dev/gym', {
    devUsername: 'first_dev_test', body: { rev: 1, id: 'gym-fortaleza-centro', action: 'archive', reason: 'Duplicada' }
  });
  assert.equal(archived.status, 200);
  assert.equal(f.store.read().gymDirectory[0].status, 'archived');
  assert.equal((await invoke(f.routes, 'GET /api/gyms')).body.gyms.length, 0);
  const restored = await invoke(f.routes, 'PUT /api/dev/gym', {
    devUsername: 'first_dev_test', body: { rev: 2, id: 'gym-fortaleza-centro', action: 'restore', reason: 'Confirmada' }
  });
  assert.equal(restored.status, 200);
  assert.equal(f.store.read().gymDirectory[0].status, 'unverified');

  const published = await invoke(f.routes, 'PUT /api/dev/gym-review', {
    devUsername: 'first_dev_test', body: { rev: 3, id: review.id, status: 'published', reason: 'Sem dados pessoais' }
  });
  assert.equal(published.status, 200);
  const removed = await invoke(f.routes, 'PUT /api/dev/gym-review', {
    devUsername: 'first_dev_test', body: { rev: 4, id: review.id, status: 'removed', reason: 'Solicitado' }
  });
  assert.equal(removed.status, 200);
  const restoredReview = await invoke(f.routes, 'PUT /api/dev/gym-review', {
    devUsername: 'first_dev_test', body: { rev: 5, id: review.id, status: 'published', reason: 'Restaurado' }
  });
  assert.equal(restoredReview.status, 200);
  const reviews = await invoke(f.routes, 'GET /api/dev/gym-reviews', { devUsername: 'first_dev_test' });
  assert.equal(reviews.body.reviews[0].status, 'published');
});

test('closure requests require Dev review and approval never closes the gym automatically', async () => {
  const f = await fixture(source());
  const created = await invoke(f.routes, 'POST /api/gym-requests', {
    user: { id: 'student-a' },
    body: { rev: 0, kind: 'closure', gymId: 'gym-fortaleza-centro', payload: { note: 'Fechada há semanas.' } }
  });
  assert.equal(created.status, 200);
  const approved = await invoke(f.routes, 'POST /api/dev/gym-requests/review', {
    devUsername: 'first_dev_test', body: { rev: 1, requestId: created.body.request.id, status: 'approved' }
  });
  assert.equal(approved.status, 200);
  assert.equal(f.store.read().gymDirectory[0].status, 'unverified');
});
