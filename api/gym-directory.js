import crypto from 'node:crypto';
import { AI_EXERCISES } from './ai.js';
import { isBrazilStateCode } from './brazil-locations.js';
import { projectGymDirectory, toggleGymFavorite, upsertGymReview } from './gym-social.js';
import { RevisionConflictError } from './lib/json-store.js';

const REQUEST_KINDS = new Set(['gym', 'equipment', 'correction', 'closure']);
const REVIEW_STATUS = Object.freeze({ approve: 'approved', reject: 'rejected' });
const BODY_LIMIT = 32 * 1024;

const fail = (message, status = 400) => Object.assign(new Error(message), { expose: true, status });
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fold = value => clean(value, 240).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');

function requiredText(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`invalid ${name}`);
  return value.trim();
}

function optionalText(value, name, max) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw fail(`invalid ${name}`);
  return value.trim();
}

function exerciseIds(value, catalogue, allowEmpty = false) {
  if (!Array.isArray(value) || value.length > 200) throw fail('invalid exercises');
  const ids = [...new Set(value.map(id => requiredText(id, 'exercise', 100)))];
  if ((!allowEmpty && !ids.length) || ids.some(id => !catalogue.has(id))) throw fail('invalid exercises');
  return ids;
}

function openingHours(value) {
  if (!Array.isArray(value) || value.length > 7) throw fail('invalid opening hours');
  return value.map(entry => {
    if (!entry || !Number.isInteger(entry.day) || entry.day < 0 || entry.day > 6 || typeof entry.closed !== 'boolean') {
      throw fail('invalid opening hours');
    }
    const open = clean(entry.open, 5);
    const close = clean(entry.close, 5);
    const validTime = time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    if (!entry.closed && (!validTime(open) || !validTime(close))) throw fail('invalid opening hours');
    return { day: entry.day, open, close, closed: entry.closed };
  });
}

function requestPayload(kind, value, catalogue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('invalid request');
  const note = optionalText(value.note, 'note', 500);
  if (kind === 'gym') {
    const state = requiredText(value.state, 'state', 2).toUpperCase();
    if (!isBrazilStateCode(state)) throw fail('invalid state');
    return {
      name: requiredText(value.name, 'gym name', 120),
      state,
      city: requiredText(value.city, 'city', 100),
      address: requiredText(value.address, 'address', 240),
      openingHours: openingHours(value.openingHours || []),
      openingHoursNote: optionalText(value.openingHoursNote, 'opening hours', 300),
      exerciseIds: exerciseIds(value.exerciseIds || [], catalogue, true),
      ...(note ? { note } : {})
    };
  }
  if (kind === 'closure') {
    const note = requiredText(value.note, 'note', 500);
    return { note };
  }
  if (kind === 'correction') {
    const payload = {};
    const fields = [
      ['name', 120], ['networkName', 120], ['city', 100], ['address', 240], ['neighborhood', 120],
      ['postalCode', 20], ['openingHoursNote', 300]
    ];
    for (const [field, max] of fields) {
      const text = optionalText(value[field], field, max);
      if (text) payload[field] = text;
    }
    if (value.state != null && value.state !== '') {
      const state = requiredText(value.state, 'state', 2).toUpperCase();
      if (!isBrazilStateCode(state)) throw fail('invalid state');
      payload.state = state;
    }
    if (value.openingHours != null) payload.openingHours = openingHours(value.openingHours);
    if (value.exerciseIds != null) payload.exerciseIds = exerciseIds(value.exerciseIds, catalogue, true);
    const note = optionalText(value.note, 'note', 500);
    if (note) payload.note = note;
    if (!Object.keys(payload).length) throw fail('empty request');
    return payload;
  }
  const ids = exerciseIds(value.exerciseIds || [], catalogue, false);
  const name = optionalText(value.name, 'name', 100);
  if (!name && !note && !ids.length) throw fail('empty request');
  return { ...(name ? { name } : {}), ...(note ? { note } : {}), exerciseIds: ids };
}

function isSuspiciousReview(comment) {
  return /(?:https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\+?\d[\s().-]?){8,}\d\b)/iu.test(comment);
}

function reviewPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('invalid review');
  const rating = Number(value.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail('invalid rating');
  const comment = optionalText(value.comment, 'comment', 600);
  return { rating, comment };
}

function publicReview(review, users) {
  const author = users.find(user => user.id === review.userId);
  const parts = clean(author?.name, 160).split(/\s+/).filter(Boolean);
  const displayName = parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : parts[0] || 'Aluno';
  return {
    id: review.id, gymId: review.gymId, rating: review.rating, comment: review.comment,
    ...(review.demo ? { demo: true } : {}), displayName, createdAt: review.createdAt, updatedAt: review.updatedAt
  };
}

function ownReview(review) {
  return {
    id: review.id, gymId: review.gymId, rating: review.rating, comment: review.comment,
    status: review.status, ...(review.demo ? { demo: true } : {}), createdAt: review.createdAt, updatedAt: review.updatedAt
  };
}

function queryCoordinate(value, min, max) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function publicGyms(state, userId, query, now) {
  const rawLatitude = queryCoordinate(query.get('latitude'), -90, 90);
  const rawLongitude = queryCoordinate(query.get('longitude'), -180, 180);
  const [latitude, longitude] = rawLatitude === null || rawLongitude === null ? [null, null] : [rawLatitude, rawLongitude];
  const locality = { state: query.get('uf') || query.get('state') || '', city: query.get('city') || '' };
  return projectGymDirectory({
    gyms: state.gymDirectory, reviews: state.gymReviews, favorites: state.gymFavorites, userId,
    latitude, longitude, locality, now
  });
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: clean(user.name, 160), email: clean(user.email, 254) };
}

function requestForDev(request, collaboration, users) {
  const submitter = users.find(user => user.id === request.submittedByUserId);
  const gym = collaboration.gymDirectory.find(item => item.id === request.gymId);
  return {
    ...structuredClone(request),
    ...(submitter ? { submittedBy: publicUser(submitter) } : {}),
    ...(gym ? { gym: { id: gym.id, name: gym.name } } : {})
  };
}

function approvedGym(payload, id, timestamp, catalogue) {
  return {
    id,
    name: payload.name,
    state: payload.state,
    city: payload.city,
    address: payload.address,
    status: 'unverified',
    openingHours: structuredClone(payload.openingHours || []),
    openingHoursNote: payload.openingHoursNote || '',
    exerciseIds: (payload.exerciseIds || []).filter(exerciseId => catalogue.has(exerciseId)),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createGymDirectoryRoutes({
  store,
  readSession,
  readBody,
  json,
  requireTrustedWrite,
  requireDev,
  now = () => new Date().toISOString(),
  randomId,
  catalogIds = AI_EXERCISES.map(exercise => exercise.id),
  getUsers = () => [],
  getRequestAddress = () => ''
}) {
  const catalogue = new Set([...catalogIds].map(item => typeof item === 'string' ? item : item?.id).filter(Boolean));
  const nextId = typeof randomId === 'function' ? randomId : () => crypto.randomUUID();
  const attempts = new Map();
  const withinLimit = (scope, userId, req, res, limit, error) => {
    const currentTime = Date.parse(now()) || Date.now();
    const cutoff = currentTime - 60 * 60 * 1000;
    const address = clean(getRequestAddress(req), 100);
    const keys = [`${scope}:user:${userId}`, ...(address ? [`${scope}:address:${address}`] : [])];
    const recent = keys.map(key => (attempts.get(key) || []).filter(timestamp => timestamp > cutoff));
    if (recent.some(entries => entries.length >= limit)) {
      json(res, 429, { error });
      return false;
    }
    keys.forEach((key, index) => attempts.set(key, [...recent[index], currentTime]));
    if (attempts.size > 2000) {
      for (const [id, entries] of attempts) {
        if (!entries.some(timestamp => timestamp > cutoff)) attempts.delete(id);
      }
    }
    return true;
  };
  const guarded = async (res, action) => {
    try { return await action(); }
    catch (error) {
      if (error instanceof RevisionConflictError) return json(res, 409, { error: 'stale revision', rev: store.read().rev });
      return json(res, error?.expose && Number.isInteger(error.status) ? error.status : 500, {
        error: error?.expose ? error.message : 'server error'
      });
    }
  };

  return {
    'GET /api/gyms': (req, res) => guarded(res, () => {
      const query = new URL(req.url, 'http://first.local').searchParams;
      const state = store.read();
      const uf = clean(query.get('uf') || query.get('state'), 2).toUpperCase();
      const city = fold(query.get('city'));
      const term = fold(query.get('q'));
      const limit = Math.max(1, Math.min(100, Number.parseInt(query.get('limit') || '50', 10) || 50));
      const offset = Math.max(0, Number.parseInt(query.get('offset') || '0', 10) || 0);
      const user = readSession(req);
      const gyms = publicGyms(state, user?.id, query, now())
        .filter(gym => (!uf || gym.state === uf) && (!city || fold(gym.city) === city))
        .filter(gym => !term || fold(`${gym.name} ${gym.address} ${gym.city} ${gym.state}`).includes(term))
      json(res, 200, { rev: state.rev, gyms: gyms.slice(offset, offset + limit), total: gyms.length, limit, offset });
    }),

    'GET /api/gym': (req, res) => guarded(res, () => {
      const id = clean(new URL(req.url, 'http://first.local').searchParams.get('id'), 100);
      const state = store.read();
      const user = readSession(req);
      const gym = publicGyms(state, user?.id, new URL(req.url, 'http://first.local').searchParams, now()).find(item => item.id === id);
      if (!gym) throw fail('gym not found', 404);
      const users = getUsers() || [];
      const reviews = state.gymReviews.filter(review => review.gymId === id && review.status === 'published')
        .map(review => publicReview(review, users));
      const favoriteCount = state.gymFavorites.filter(favorite => favorite.gymId === id).length;
      json(res, 200, { rev: state.rev, gym: { ...gym, favoriteCount }, reviews });
    }),

    'POST /api/gym-requests': (req, res) => guarded(res, async () => {
      const user = readSession(req);
      if (!user?.id) return json(res, 401, { error: 'not signed in' });
      if (!requireTrustedWrite(req, res)) return;
      if (!withinLimit('gym-request', user.id, req, res, 20, 'too many gym requests')) return;
      const body = await readBody(req, BODY_LIMIT);
      if (!Number.isInteger(body.rev)) throw fail('rev required');
      if (!REQUEST_KINDS.has(body.kind)) throw fail('invalid request kind');
      const current = store.read();
      const gymId = clean(body.gymId, 100);
      if (body.kind !== 'gym' && !current.gymDirectory.some(gym => gym.id === gymId)) throw fail('gym not found', 404);
      const request = {
        id: `gym-request-${nextId()}`,
        kind: body.kind,
        status: 'pending',
        ...(body.kind !== 'gym' ? { gymId } : {}),
        submittedByUserId: user.id,
        payload: requestPayload(body.kind, body.payload, catalogue),
        createdAt: now()
      };
      const updated = store.update(body.rev, state => ({ ...state, gymRequests: [...state.gymRequests, request] }));
      json(res, 200, { rev: updated.rev, request: structuredClone(request) });
    }),

    'PUT /api/gym/favorite': (req, res) => guarded(res, async () => {
      const user = readSession(req);
      if (!user?.id) return json(res, 401, { error: 'not signed in' });
      if (!requireTrustedWrite(req, res)) return;
      if (!withinLimit('gym-favorite', user.id, req, res, 60, 'too many gym favorites')) return;
      const body = await readBody(req, BODY_LIMIT);
      if (!Number.isInteger(body.rev)) throw fail('rev required');
      const gymId = clean(body.gymId, 100);
      const current = store.read();
      if (!current.gymDirectory.some(gym => gym.id === gymId && gym.status !== 'archived' && gym.visibility !== 'hidden')) throw fail('gym not found', 404);
      const updated = store.update(body.rev, state => ({ ...state, gymFavorites: toggleGymFavorite(state.gymFavorites, { gymId, userId: user.id, now: now() }) }));
      const favorite = updated.gymFavorites.some(item => item.gymId === gymId && item.userId === user.id);
      json(res, 200, { rev: updated.rev, gymId, favorite });
    }),

    'PUT /api/gym/review': (req, res) => guarded(res, async () => {
      const user = readSession(req);
      if (!user?.id) return json(res, 401, { error: 'not signed in' });
      if (!requireTrustedWrite(req, res)) return;
      if (!withinLimit('gym-review', user.id, req, res, 30, 'too many gym reviews')) return;
      const body = await readBody(req, BODY_LIMIT);
      if (!Number.isInteger(body.rev)) throw fail('rev required');
      const gymId = clean(body.gymId, 100);
      const payload = reviewPayload(body);
      const current = store.read();
      if (!current.gymDirectory.some(gym => gym.id === gymId && gym.status !== 'archived' && gym.visibility !== 'hidden')) throw fail('gym not found', 404);
      const timestamp = now();
      const existing = current.gymReviews.find(review => review.gymId === gymId && review.userId === user.id && review.status !== 'removed');
      const review = {
        id: existing?.id || `gym-review-${nextId()}`, gymId, userId: user.id, ...payload,
        status: isSuspiciousReview(payload.comment) ? 'pending' : 'published', demo: false,
        createdAt: existing?.createdAt || timestamp, updatedAt: timestamp
      };
      const updated = store.update(body.rev, state => ({ ...state, gymReviews: upsertGymReview(state.gymReviews, review) }));
      const stored = updated.gymReviews.find(item => item.id === review.id) || updated.gymReviews.find(item => item.gymId === gymId && item.userId === user.id && item.status !== 'removed');
      json(res, 200, { rev: updated.rev, review: ownReview(stored) });
    }),

    'GET /api/dev/gym-requests': (req, res) => guarded(res, () => {
      if (!requireDev(req, res)) return;
      const state = store.read();
      const users = getUsers() || [];
      json(res, 200, {
        rev: state.rev,
        requests: state.gymRequests.map(request => requestForDev(request, state, users))
      });
    }),

    'POST /api/dev/gym-requests/review': (req, res) => guarded(res, async () => {
      const reviewer = requireDev(req, res);
      if (!reviewer) return;
      if (!requireTrustedWrite(req, res)) return;
      const body = await readBody(req, BODY_LIMIT);
      const requestId = clean(body.requestId || body.id, 100);
      const status = body.status || REVIEW_STATUS[body.decision];
      const reviewReason = optionalText(body.reason, 'reason', 300);
      if (!Number.isInteger(body.rev)) throw fail('rev required');
      if (!requestId || !['approved', 'rejected'].includes(status)) throw fail('invalid review');
      const reviewedAt = now();
      const updated = store.update(body.rev, state => {
        const request = state.gymRequests.find(item => item.id === requestId);
        if (!request) throw fail('request not found', 404);
        if (request.status !== 'pending') throw fail('request already reviewed', 409);
        let gymDirectory = state.gymDirectory;
        if (status === 'approved' && request.kind === 'gym') {
          gymDirectory = [...gymDirectory, approvedGym(request.payload, `gym-${nextId()}`, reviewedAt, catalogue)];
        }
        if (status === 'approved' && request.kind === 'equipment') {
          if (!gymDirectory.some(gym => gym.id === request.gymId)) throw fail('gym not found', 404);
          const allowedIds = request.payload.exerciseIds.filter(id => catalogue.has(id));
          gymDirectory = gymDirectory.map(gym => gym.id === request.gymId ? {
            ...gym,
            exerciseIds: [...new Set([...gym.exerciseIds, ...allowedIds])],
            updatedAt: reviewedAt
          } : gym);
        }
        if (status === 'approved' && request.kind === 'correction') {
          const { note: _note, ...correction } = request.payload;
          gymDirectory = gymDirectory.map(gym => gym.id === request.gymId ? {
            ...gym, ...structuredClone(correction), updatedAt: reviewedAt
          } : gym);
        }
        const reviewed = { ...request, status, reviewedAt, reviewedBy: reviewer, ...(reviewReason ? { reviewReason } : {}) };
        return {
          ...state,
          gymDirectory,
          gymRequests: state.gymRequests.map(item => item.id === requestId ? reviewed : item)
        };
      });
      const request = updated.gymRequests.find(item => item.id === requestId);
      json(res, 200, { rev: updated.rev, request: requestForDev(request, updated, getUsers() || []) });
    }),

    'GET /api/dev/gyms': (req, res) => guarded(res, () => {
      if (!requireDev(req, res)) return;
      const state = store.read();
      json(res, 200, { rev: state.rev, gyms: state.gymDirectory.map(gym => structuredClone(gym)) });
    }),

    'PUT /api/dev/gym': (req, res) => guarded(res, async () => {
      const reviewer = requireDev(req, res);
      if (!reviewer) return;
      if (!requireTrustedWrite(req, res)) return;
      const body = await readBody(req, BODY_LIMIT);
      const id = clean(body.id || body.gymId, 100);
      const action = clean(body.action, 20);
      const reason = optionalText(body.reason, 'reason', 300);
      if (!Number.isInteger(body.rev)) throw fail('rev required');
      if (!id || !['archive', 'restore'].includes(action)) throw fail('invalid gym action');
      const updatedAt = now();
      const updated = store.update(body.rev, state => {
        const previous = state.gymDirectory.find(gym => gym.id === id);
        if (!previous) throw fail('gym not found', 404);
        const gym = action === 'archive'
          ? { ...previous, status: 'archived', visibility: 'hidden', archivedStatus: previous.status === 'archived' ? previous.archivedStatus || 'unverified' : previous.status, updatedAt, moderatedAt: updatedAt, moderatedBy: reviewer, moderationReason: reason }
          : (() => {
              const { archivedStatus: _archivedStatus, ...restored } = previous;
              return { ...restored, status: previous.archivedStatus || 'unverified', visibility: 'public', updatedAt, moderatedAt: updatedAt, moderatedBy: reviewer, moderationReason: reason };
            })();
        return { ...state, gymDirectory: state.gymDirectory.map(item => item.id === id ? gym : item) };
      });
      const gym = updated.gymDirectory.find(item => item.id === id);
      json(res, 200, { rev: updated.rev, gym: structuredClone(gym) });
    }),

    'GET /api/dev/gym-reviews': (req, res) => guarded(res, () => {
      if (!requireDev(req, res)) return;
      const state = store.read();
      const users = getUsers() || [];
      const reviews = state.gymReviews.map(review => {
        const user = users.find(item => item.id === review.userId);
        return { ...structuredClone(review), ...(user ? { submittedBy: publicUser(user) } : {}) };
      });
      json(res, 200, { rev: state.rev, reviews });
    }),

    'PUT /api/dev/gym-review': (req, res) => guarded(res, async () => {
      const reviewer = requireDev(req, res);
      if (!reviewer) return;
      if (!requireTrustedWrite(req, res)) return;
      const body = await readBody(req, BODY_LIMIT);
      const id = clean(body.id || body.reviewId, 100);
      const status = clean(body.status, 20);
      const reason = optionalText(body.reason, 'reason', 300);
      if (!Number.isInteger(body.rev)) throw fail('rev required');
      if (!id || !['published', 'removed'].includes(status)) throw fail('invalid review moderation');
      const moderatedAt = now();
      const updated = store.update(body.rev, state => {
        if (!state.gymReviews.some(review => review.id === id)) throw fail('review not found', 404);
        return {
          ...state,
          gymReviews: state.gymReviews.map(review => review.id === id ? {
            ...review, status, updatedAt: moderatedAt, moderatedAt, moderatedBy: reviewer, ...(reason ? { moderationReason: reason } : {})
          } : review)
        };
      });
      const review = updated.gymReviews.find(item => item.id === id);
      json(res, 200, { rev: updated.rev, review: ownReview(review) });
    })
  };
}
