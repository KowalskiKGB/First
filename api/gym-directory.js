import crypto from 'node:crypto';
import { AI_EXERCISES } from './ai.js';
import { RevisionConflictError } from './lib/json-store.js';

const REQUEST_KINDS = new Set(['gym', 'equipment', 'correction']);
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
    if (!/^[A-Z]{2}$/.test(state)) throw fail('invalid state');
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
  const ids = exerciseIds(value.exerciseIds || [], catalogue, kind === 'correction');
  const name = optionalText(value.name, 'name', 100);
  if (!name && !note && !ids.length) throw fail('empty request');
  return { ...(name ? { name } : {}), ...(note ? { note } : {}), exerciseIds: ids };
}

function publicGym(gym) {
  return {
    id: gym.id,
    name: gym.name,
    state: gym.state,
    city: gym.city,
    address: gym.address,
    status: gym.status,
    openingHours: structuredClone(gym.openingHours || []),
    openingHoursNote: clean(gym.openingHoursNote, 300),
    exerciseIds: [...(gym.exerciseIds || [])],
    createdAt: gym.createdAt,
    updatedAt: gym.updatedAt
  };
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
  getUsers = () => []
}) {
  const catalogue = new Set([...catalogIds].map(item => typeof item === 'string' ? item : item?.id).filter(Boolean));
  const nextId = typeof randomId === 'function' ? randomId : () => crypto.randomUUID();
  const requestAttempts = new Map();
  const withinRequestLimit = userId => {
    const currentTime = Date.parse(now()) || Date.now();
    const cutoff = currentTime - 60 * 60 * 1000;
    const recent = (requestAttempts.get(userId) || []).filter(timestamp => timestamp > cutoff);
    if (recent.length >= 20) return false;
    requestAttempts.set(userId, [...recent, currentTime]);
    if (requestAttempts.size > 2000) {
      for (const [id, attempts] of requestAttempts) {
        if (!attempts.some(timestamp => timestamp > cutoff)) requestAttempts.delete(id);
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
      const gyms = state.gymDirectory
        .filter(gym => (!uf || gym.state === uf) && (!city || fold(gym.city) === city))
        .filter(gym => !term || fold(`${gym.name} ${gym.address} ${gym.city} ${gym.state}`).includes(term))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
      json(res, 200, { rev: state.rev, gyms: gyms.slice(offset, offset + limit).map(publicGym), total: gyms.length, limit, offset });
    }),

    'GET /api/gym': (req, res) => guarded(res, () => {
      const id = clean(new URL(req.url, 'http://first.local').searchParams.get('id'), 100);
      const state = store.read();
      const gym = state.gymDirectory.find(item => item.id === id);
      if (!gym) throw fail('gym not found', 404);
      json(res, 200, { rev: state.rev, gym: publicGym(gym) });
    }),

    'POST /api/gym-requests': (req, res) => guarded(res, async () => {
      const user = readSession(req);
      if (!user?.id) return json(res, 401, { error: 'not signed in' });
      if (!requireTrustedWrite(req, res)) return;
      if (!withinRequestLimit(user.id)) return json(res, 429, { error: 'too many gym requests' });
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
      if (!requestId || !['approved', 'rejected'].includes(status)) throw fail('invalid review');
      const current = store.read();
      const expectedRev = Number.isInteger(body.rev) ? body.rev : current.rev;
      const reviewedAt = now();
      const updated = store.update(expectedRev, state => {
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
        const reviewed = { ...request, status, reviewedAt, reviewedBy: reviewer };
        return {
          ...state,
          gymDirectory,
          gymRequests: state.gymRequests.map(item => item.id === requestId ? reviewed : item)
        };
      });
      const request = updated.gymRequests.find(item => item.id === requestId);
      json(res, 200, { rev: updated.rev, request: requestForDev(request, updated, getUsers() || []) });
    })
  };
}
