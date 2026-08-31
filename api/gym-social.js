import { MACAPA_GYM_SEED, MACAPA_GYM_SEED_VERSION } from './data/macapa-gyms.js';

const GYM_STATUSES = new Set(['unverified', 'verified', 'partner', 'closed', 'archived']);
const VISIBILITIES = new Set(['public', 'hidden']);
const REVIEW_STATUSES = new Set(['pending', 'published', 'removed']);
const CONFIDENCE = new Set(['high', 'medium']);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const timestamp = value => text(value, 40) || null;
const list = (value, max, length = 100) => [...new Set((Array.isArray(value) ? value : [])
  .slice(0, max).map(item => text(item, length)).filter(Boolean))];
const coordinate = (value, min, max) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

function openingHours(value) {
  const validTime = item => /^([01]\d|2[0-3]):[0-5]\d$/.test(item);
  return (Array.isArray(value) ? value : []).slice(0, 7).flatMap(item => {
    if (!item || !Number.isInteger(item.day) || item.day < 0 || item.day > 6) return [];
    const closed = item.closed === true;
    const open = text(item.open, 5);
    const close = text(item.close, 5);
    return closed || (validTime(open) && validTime(close)) ? [{ day: item.day, open, close, closed }] : [];
  });
}

function source(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const label = text(value.label, 120);
  const url = text(value.url, 500);
  if (!label || !/^https:\/\//i.test(url) || !CONFIDENCE.has(value.confidence)) return null;
  return { label, url, confidence: value.confidence, verifiedAt: timestamp(value.verifiedAt) };
}

export function normalizeGymRecord(value) {
  const id = text(value?.id, 100);
  const name = text(value?.name, 120);
  const state = text(value?.state, 2).toUpperCase();
  const city = text(value?.city, 100);
  const address = text(value?.address, 240);
  if (!id || !name || !/^[A-Z]{2}$/.test(state) || !city || !address) return null;
  const normalized = {
    id, name, state, city, address,
    status: GYM_STATUSES.has(value.status) ? value.status : 'unverified',
    openingHours: openingHours(value.openingHours),
    openingHoursNote: text(value.openingHoursNote, 300),
    exerciseIds: list(value.exerciseIds, 200),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt)
  };
  const networkName = text(value.networkName, 120);
  const neighborhood = text(value.neighborhood, 120);
  const postalCode = text(value.postalCode, 20);
  if (networkName) normalized.networkName = networkName;
  if (neighborhood) normalized.neighborhood = neighborhood;
  if (postalCode) normalized.postalCode = postalCode;
  if (Object.hasOwn(value, 'latitude')) normalized.latitude = coordinate(value.latitude, -90, 90);
  if (Object.hasOwn(value, 'longitude')) normalized.longitude = coordinate(value.longitude, -180, 180);
  if (Object.hasOwn(value, 'visibility')) normalized.visibility = VISIBILITIES.has(value.visibility) ? value.visibility : 'public';
  if (Object.hasOwn(value, 'source')) normalized.source = source(value.source);
  if (Object.hasOwn(value, 'approvedAt')) normalized.approvedAt = timestamp(value.approvedAt);
  return normalized;
}

export function normalizeGymReview(value) {
  const id = text(value?.id, 100);
  const gymId = text(value?.gymId, 100);
  const userId = text(value?.userId, 100);
  const rating = Number(value?.rating);
  if (!id || !gymId || !userId || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const status = REVIEW_STATUSES.has(value.status) ? value.status : 'pending';
  const normalized = {
    id, gymId, userId, rating, comment: text(value.comment, 1200), status,
    demo: value.demo === true, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt)
  };
  const moderatedAt = timestamp(value.moderatedAt);
  const moderatedBy = text(value.moderatedBy, 100);
  const moderationReason = text(value.moderationReason, 300);
  if (moderatedAt) normalized.moderatedAt = moderatedAt;
  if (moderatedBy) normalized.moderatedBy = moderatedBy;
  if (moderationReason) normalized.moderationReason = moderationReason;
  return normalized;
}

export function normalizeGymFavorite(value) {
  const gymId = text(value?.gymId, 100);
  const userId = text(value?.userId, 100);
  if (!gymId || !userId) return null;
  return { gymId, userId, createdAt: timestamp(value.createdAt) };
}

export const normalizeGymSeedTombstones = value => list(value, 2000);

const stamp = value => Date.parse(value?.updatedAt || value?.createdAt || '') || 0;

export function retainOneActiveGymReview(values) {
  const normalized = (Array.isArray(values) ? values : []).map(normalizeGymReview).filter(Boolean);
  const latest = new Map();
  normalized.forEach((item, index) => {
    if (item.status !== 'removed') {
      const key = `${item.gymId}\u0000${item.userId}`;
      const current = latest.get(key);
      if (!current || stamp(item) > stamp(current.item) || (stamp(item) === stamp(current.item) && index > current.index)) latest.set(key, { item, index });
    }
  });
  return normalized.filter(item => item.status === 'removed' || latest.get(`${item.gymId}\u0000${item.userId}`)?.item === item);
}

export function applyGymSeed(value) {
  const collaboration = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const directory = Array.isArray(collaboration.gymDirectory) ? collaboration.gymDirectory.map(item => structuredClone(item)) : [];
  const tombstones = normalizeGymSeedTombstones(collaboration.gymSeedTombstones);
  if (collaboration.gymSeedVersion === MACAPA_GYM_SEED_VERSION) return structuredClone(collaboration);
  const known = new Set(directory.map(item => item.id));
  const blocked = new Set(tombstones);
  const additions = MACAPA_GYM_SEED.filter(item => !known.has(item.id) && !blocked.has(item.id)).map(item => structuredClone(item));
  return {
    ...structuredClone(collaboration),
    gymDirectory: [...directory, ...additions],
    gymSeedTombstones: tombstones,
    gymSeedVersion: MACAPA_GYM_SEED_VERSION
  };
}

export function haversineKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const latA = coordinate(latitudeA, -90, 90);
  const lonA = coordinate(longitudeA, -180, 180);
  const latB = coordinate(latitudeB, -90, 90);
  const lonB = coordinate(longitudeB, -180, 180);
  if ([latA, lonA, latB, lonB].some(value => value === null)) return null;
  const radians = Math.PI / 180;
  const a = Math.sin((latB - latA) * radians / 2) ** 2 + Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin((lonB - lonA) * radians / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function toggleGymFavorite(values, { gymId, userId, now } = {}) {
  const favorite = normalizeGymFavorite({ gymId, userId, createdAt: now });
  const current = (Array.isArray(values) ? values : []).map(normalizeGymFavorite).filter(Boolean);
  if (!favorite) return current;
  const exists = current.some(item => item.gymId === favorite.gymId && item.userId === favorite.userId);
  return exists ? current.filter(item => item.gymId !== favorite.gymId || item.userId !== favorite.userId) : [...current, favorite];
}

export function upsertGymReview(values, value) {
  const review = normalizeGymReview(value);
  const current = retainOneActiveGymReview(values);
  if (!review) return current;
  return [...current.filter(item => item.status === 'removed' || item.gymId !== review.gymId || item.userId !== review.userId), review];
}

function realPublishedReviews(reviews, gymId) {
  return (Array.isArray(reviews) ? reviews : []).map(normalizeGymReview).filter(item => item && item.gymId === gymId && item.status === 'published' && !item.demo);
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function rankingTags(gym, reviews, now) {
  const date = Date.parse(now) || Date.now();
  const recentCutoff = date - 30 * 86400000;
  const recent = reviews.filter(item => stamp(item) >= recentCutoff);
  const historic = reviews.filter(item => stamp(item) < recentCutoff);
  const tags = [];
  const approvedAt = Date.parse(gym.approvedAt || '');
  if (Number.isFinite(approvedAt) && approvedAt >= date - 60 * 86400000 && approvedAt <= date) tags.push('Nova');
  if (recent.length >= 5 && mean(recent.map(item => item.rating)) > mean(reviews.map(item => item.rating))) tags.push('Em alta');
  if (recent.length >= 5 && historic.length >= 5 && mean(recent.map(item => item.rating)) <= mean(historic.map(item => item.rating)) - 0.6) tags.push('Em baixa');
  if (gym.networkName) tags.push(`Rede ${gym.networkName}`);
  return tags;
}

function sameLocality(gym, locality) {
  if (!locality || typeof locality !== 'object') return true;
  const state = text(locality.state, 2).toUpperCase();
  const city = text(locality.city, 100).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const gymCity = gym.city.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return (!state || gym.state === state) && (!city || gymCity === city);
}

export function projectGymDirectory({ gyms, reviews, favorites, userId, latitude, longitude, locality, now = new Date().toISOString() } = {}) {
  const currentUser = text(userId, 100);
  const normalizedGyms = (Array.isArray(gyms) ? gyms : []).map(normalizeGymRecord).filter(Boolean);
  const favoriteKeys = new Set((Array.isArray(favorites) ? favorites : []).map(normalizeGymFavorite).filter(Boolean)
    .filter(item => item.userId === currentUser).map(item => item.gymId));
  const projected = normalizedGyms.map(gym => {
    const distance = haversineKm(latitude, longitude, gym.latitude, gym.longitude);
    const published = realPublishedReviews(reviews, gym.id);
    const average = mean(published.map(item => item.rating));
    const tags = [
      ...(favoriteKeys.has(gym.id) ? ['Preferida'] : []),
      ...rankingTags(gym, published, now)
    ];
    return {
      id: gym.id, name: gym.name, ...(gym.networkName ? { networkName: gym.networkName } : {}),
      state: gym.state, city: gym.city, address: gym.address,
      ...(gym.neighborhood ? { neighborhood: gym.neighborhood } : {}),
      ...(gym.postalCode ? { postalCode: gym.postalCode } : {}),
      status: gym.status, visibility: gym.visibility || 'public',
      openingHours: structuredClone(gym.openingHours), openingHoursNote: gym.openingHoursNote,
      exerciseIds: [...gym.exerciseIds], ...(gym.source ? { source: structuredClone(gym.source) } : {}),
      ...(gym.approvedAt ? { approvedAt: gym.approvedAt } : {}), createdAt: gym.createdAt, updatedAt: gym.updatedAt,
      averageRating: average === null ? null : Math.round(average * 10) / 10,
      reviewCount: published.length,
      ...(distance === null ? {} : { distanceKm: Math.round(distance * 10) / 10 }),
      tags
    };
  });
  const nearest = projected.filter(item => item.distanceKm != null && sameLocality(item, locality))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id)).slice(0, 3).map(item => item.id);
  const nearIds = new Set(nearest);
  return projected.map(item => ({ ...item, tags: [
    ...(item.tags.includes('Preferida') ? ['Preferida'] : []),
    ...(nearIds.has(item.id) ? ['Perto de você'] : []),
    ...item.tags.filter(tag => tag !== 'Preferida')
  ] })).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}
