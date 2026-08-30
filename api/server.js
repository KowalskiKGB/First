/* First API — passkey (WebAuthn) auth + per-user state storage.
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import { AI_EQUIPMENT } from './ai.js';
import { createAiJobRoutes, createAiJobService } from './ai-jobs.js';
import { bridgeAiUsageProperty } from './ai-usage.js';
import { createDevAuth, hashDevPassword, isTrustedMutation, verifyDevPassword } from './dev-auth.js';
import { reminderForState } from './lib/workout-schedule.js';
import {
  activateProvider,
  activeProvider,
  listProviderModels,
  providerSlotsDto,
  recordAiUsage,
  runStructuredOutput,
  summarizeAiUsage,
  testProvider,
  upsertProvider
} from './ai-providers.js';
import {
  buildAiGenerationStatus,
  createCollaborationStore,
  createPersonalRoutes,
  INITIAL_COLLABORATION,
  notifyAiPlanApplied
} from './personal.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'First';
if (process.env.NODE_ENV === 'production' && (!process.env.RP_ID || !process.env.ORIGIN)) {
  console.error('RP_ID and ORIGIN are required in production.');
  process.exit(1);
}
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const COMMON_BODY = 32 * 1024;
const MAX_STATE_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
const PRIMARY_DB_COLLECTIONS = ['users', 'creds', 'subs', 'invites', 'aiProviders', 'aiUsage'];
function normalizePrimaryDb(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('db.json must contain an object');
  const normalized = { ...value };
  for (const key of PRIMARY_DB_COLLECTIONS) {
    if (normalized[key] === undefined) normalized[key] = [];
    else if (!Array.isArray(normalized[key])) throw new TypeError(`db.json ${key} must be an array`);
  }
  return normalized;
}
function readPrimaryDb(file) {
  return normalizePrimaryDb(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function bootstrapPrimaryDb(file) {
  const initial = normalizePrimaryDb({});
  const temporary = `${file}.bootstrap-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(initial, null, 2));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try { fs.linkSync(temporary, file); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    return readPrimaryDb(file);
  } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(temporary); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
function loadPrimaryDbAtStartup(file) {
  try { return readPrimaryDb(file); }
  catch (error) {
    if (error?.code === 'ENOENT') return bootstrapPrimaryDb(file);
    throw error;
  }
}
let db = loadPrimaryDbAtStartup(dbFile);
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
function saveDb() {
  readPrimaryDb(dbFile);
  atomicWrite(dbFile, JSON.stringify(db, null, 2));
}
function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function parseStateFile(file) {
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.size > MAX_STATE_BODY) throw new TypeError('invalid state file');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state file must contain an object');
  return state;
}
function readState(uid) {
  try { return parseStateFile(stateFile(uid)); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
const collaborationStore = createCollaborationStore(DATA);
bridgeAiUsageProperty({ db, store: collaborationStore, saveDb });

function dataDirIsWritable() {
  const probe = path.join(DATA, `.ready-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  let descriptor;
  try {
    descriptor = fs.openSync(probe, 'wx', 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.unlinkSync(probe);
    return true;
  } catch {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(probe); } catch {}
    return false;
  }
}
function isReady() {
  try {
    normalizePrimaryDb(db);
    if (!fs.statSync(dbFile).isFile()) return false;
    const persisted = readPrimaryDb(dbFile);
    normalizePrimaryDb(persisted);
    const persistedSecret = fs.readFileSync(secretFile, 'utf8').trim();
    if (persistedSecret !== SECRET || Buffer.byteLength(SECRET) < 32) return false;
    const collaboration = collaborationStore.read();
    if (collaboration.schemaVersion !== INITIAL_COLLABORATION.schemaVersion ||
        !Number.isInteger(collaboration.rev) || collaboration.rev < 0) return false;
    for (const [key, initial] of Object.entries(INITIAL_COLLABORATION)) {
      if (Array.isArray(initial) && !Array.isArray(collaboration[key])) return false;
    }
    for (const entry of fs.readdirSync(DATA, { withFileTypes: true })) {
      if (!/^state-[a-zA-Z0-9_-]*\.json$/.test(entry.name)) continue;
      if (!entry.isFile()) return false;
      parseStateFile(path.join(DATA, entry.name));
    }
    return dataDirIsWritable();
  } catch { return false; }
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
const devLoginAttempts = new Map();
const studentLoginAttempts = new Map();
const studentRegistrationAttempts = new Map();
function withinLimit(store, key, limit, windowMs) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) { store.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (entry.count >= limit) return false;
  store.set(key, { ...entry, count: entry.count + 1 });
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const attempts of [devLoginAttempts, studentLoginAttempts, studentRegistrationAttempts]) {
    for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
  }
}, 60000).unref();
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    let S;
    try { S = readState(user.id); }
    catch (error) { console.error('state read failed', user.id, error.message); continue; }
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const reminder = reminderForState(S, now.date);
    if (!reminder) continue;
    console.log('reminder firing', user.id, reminder.optionCount);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, reminder);
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;
const devAuth = createDevAuth({ env: process.env, signingSecret: SECRET, origin: ORIGIN });
function requireDev(req, res) {
  const username = devAuth.readSession(req);
  if (!username) { json(res, 401, { error: 'dev panel locked' }); return null; }
  return username;
}

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function requireTrustedWrite(req, res) {
  if (isTrustedMutation(req, ORIGIN)) return true;
  json(res, 403, { error: 'invalid origin' });
  return false;
}
function requestError(message, status) {
  const error = new Error(message);
  error.expose = true;
  error.status = status;
  return error;
}
function readBody(req, max = COMMON_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; let settled = false; const chunks = [];
    req.on('data', d => {
      if (settled) return;
      size += d.length;
      if (size > max) { settled = true; reject(requestError('body too large', 413)); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      if (settled) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(requestError('bad json', 400)); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');
const STUDENT_REGISTER_FIELDS = new Set([
  'email', 'fullName', 'password', 'weightKg', 'heightCm', 'measurements', 'goal', 'inviteCode', 'code'
]);
const STUDENT_LOGIN_FIELDS = new Set(['email', 'password']);
const STUDENT_PROFILE_FIELDS = new Set([
  'email', 'fullName', 'weightKg', 'heightCm', 'measurements', 'goal', 'currentPassword', 'newPassword'
]);
const MEASUREMENT_LIMITS = Object.freeze({
  waistCm: [10, 300], chestCm: [10, 300], hipCm: [10, 300], neckCm: [10, 150],
  armCm: [10, 150], thighCm: [10, 200], calfCm: [10, 150], bodyFatPct: [1, 75]
});
const STUDENT_GOALS = new Set(['weight_loss', 'muscle_gain', 'both']);
const DUMMY_STUDENT_PASSWORD_HASH = hashDevPassword(crypto.randomBytes(24).toString('base64url'));

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function onlyFields(body, allowed) {
  if (!plainObject(body) || Object.keys(body).some(key => !allowed.has(key))) {
    throw requestError('unsupported fields', 400);
  }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw requestError('valid email required', 400);
  }
  return email;
}

function normalizeStudentName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw requestError('full name must contain 2 to 80 characters', 400);
  return name;
}

function normalizeStudentPassword(value, field = 'password') {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) {
    throw requestError(`${field} must contain 6 to 128 characters`, 400);
  }
  return value;
}

function boundedNumber(value, field, minimum, maximum) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw requestError(`${field} is invalid`, 400);
  }
  return Math.round(number * 10) / 10;
}

function normalizeMeasurements(value) {
  if (!plainObject(value)) throw requestError('measurements must be an object', 400);
  if (Object.keys(value).some(kind => !Object.hasOwn(MEASUREMENT_LIMITS, kind))) {
    throw requestError('unsupported measurement', 400);
  }
  return Object.fromEntries(Object.entries(value).map(([kind, amount]) => {
    const [minimum, maximum] = MEASUREMENT_LIMITS[kind];
    return [kind, boundedNumber(amount, kind, minimum, maximum)];
  }));
}

function profileFields(body) {
  const profile = {};
  if (Object.hasOwn(body, 'weightKg')) profile.weightKg = boundedNumber(body.weightKg, 'weightKg', 20, 350);
  if (Object.hasOwn(body, 'heightCm')) profile.heightCm = boundedNumber(body.heightCm, 'heightCm', 80, 250);
  if (Object.hasOwn(body, 'measurements')) profile.measurements = normalizeMeasurements(body.measurements);
  if (Object.hasOwn(body, 'goal')) {
    const goal = String(body.goal || '').trim();
    if (!STUDENT_GOALS.has(goal)) throw requestError('goal is invalid', 400);
    profile.goal = goal;
  }
  return profile;
}

function storedProfile(value) {
  if (!plainObject(value)) return {};
  const profile = {};
  if (Number.isFinite(value.weightKg)) profile.weightKg = value.weightKg;
  if (Number.isFinite(value.heightCm)) profile.heightCm = value.heightCm;
  if (plainObject(value.measurements)) profile.measurements = { ...value.measurements };
  if (STUDENT_GOALS.has(value.goal)) profile.goal = value.goal;
  return profile;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    ...(typeof user.email === 'string' && user.email ? { email: user.email } : {}),
    admin: isAdmin(user)
  };
}

function stateWithProfile(currentState, profile) {
  const current = plainObject(currentState) ? currentState : {};
  const aiProfile = plainObject(current.aiProfile) ? current.aiProfile : {};
  const measurements = plainObject(aiProfile.measurements) ? aiProfile.measurements : {};
  let bodyweight = Array.isArray(current.bodyweight) ? [...current.bodyweight] : [];
  if (Number.isFinite(profile.weightKg)) {
    const date = new Date().toISOString().slice(0, 10);
    const todayIndex = bodyweight.findIndex(entry => entry?.d === date);
    const entry = { d: date, w: profile.weightKg };
    bodyweight = todayIndex < 0
      ? [...bodyweight, entry]
      : bodyweight.map((existing, index) => index === todayIndex ? entry : existing);
  }
  return {
    ...current,
    ...(Number.isFinite(profile.weightKg) ? { bodyweight } : {}),
    aiProfile: {
      ...aiProfile,
      ...(Number.isFinite(profile.heightCm) ? { heightCm: profile.heightCm } : {}),
      ...(profile.goal ? { goal: profile.goal } : {}),
      ...(profile.measurements ? { measurements: { ...measurements, ...profile.measurements } } : {})
    },
    _ts: Date.now()
  };
}

function persistProfileState(userId, profile) {
  if (!Object.keys(profile).length) return;
  atomicWrite(stateFile(userId), JSON.stringify(stateWithProfile(readState(userId), profile)));
}

const AI_MASTER_KEY = String(process.env.AI_CONFIG_MASTER_KEY || '').trim();
const aiConfigurationEnabled = () => /^[0-9a-fA-F]{64}$/.test(AI_MASTER_KEY);

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true }),
  'GET /api/ready': async (req, res) => {
    const ready = isReady();
    json(res, ready ? 200 : 503, { ok: ready });
  },
  'GET /api/internal/media-auth': async (req, res) => {
    res.writeHead(readSession(req) ? 204 : 401, { 'Cache-Control': 'private, no-store' });
    res.end();
  },

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'POST /api/auth/register': async (req, res) => {
    const body = await readBody(req);
    onlyFields(body, STUDENT_REGISTER_FIELDS);
    const email = normalizeEmail(body.email);
    const name = normalizeStudentName(body.fullName);
    const password = normalizeStudentPassword(body.password);
    const registrationKey = req.socket.remoteAddress || 'unknown';
    if (!withinLimit(studentRegistrationAttempts, registrationKey, 5, 60 * 60000)) {
      return json(res, 429, { error: 'too many registration attempts' });
    }
    if (db.users.some(user => String(user.email || '').toLowerCase() === email)) {
      return json(res, 409, { error: 'email already registered' });
    }
    const inviteCode = String(body.inviteCode ?? body.code ?? '').trim().toUpperCase();
    const invite = INVITE_ONLY
      ? db.invites.find(item => item.code === inviteCode && !item.usedBy && !item.revoked)
      : null;
    if (INVITE_ONLY && !invite) return json(res, 403, { error: 'a valid invite code is required' });

    const profile = profileFields(body);
    const created = new Date().toISOString();
    const user = {
      id: crypto.randomBytes(12).toString('base64url'),
      name,
      email,
      passwordHash: hashDevPassword(password),
      created,
      ...(Object.keys(profile).length ? { profile } : {}),
      ...(invite ? { invitedBy: invite.code } : {})
    };
    persistProfileState(user.id, profile);
    db = {
      ...db,
      users: [...db.users, user],
      invites: invite
        ? db.invites.map(item => item.code === invite.code
          ? { ...item, usedBy: user.id, usedAt: created }
          : item)
        : db.invites
    };
    saveDb();
    json(res, 200, { user: publicUser(user), profile }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/auth/login': async (req, res) => {
    const body = await readBody(req);
    onlyFields(body, STUDENT_LOGIN_FIELDS);
    const email = normalizeEmail(body.email);
    const attemptKey = req.socket.remoteAddress || 'unknown';
    if (!withinLimit(studentLoginAttempts, attemptKey, 8, 15 * 60000)) {
      return json(res, 429, { error: 'too many login attempts' });
    }
    const user = db.users.find(item => String(item.email || '').toLowerCase() === email);
    const candidateHash = user?.passwordHash || DUMMY_STUDENT_PASSWORD_HASH;
    const password = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
    const authenticated = verifyDevPassword(password, candidateHash);
    if (!user || !authenticated) return json(res, 401, { error: 'invalid email or password' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    studentLoginAttempts.delete(attemptKey);
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: publicUser(user) });
  },

  'GET /api/profile': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: publicUser(user), profile: storedProfile(user.profile) });
  },

  'PUT /api/profile': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    onlyFields(body, STUDENT_PROFILE_FIELDS);
    const name = Object.hasOwn(body, 'fullName') ? normalizeStudentName(body.fullName) : user.name;
    const email = Object.hasOwn(body, 'email') ? normalizeEmail(body.email) : user.email;
    const changesEmail = email !== user.email;
    const changesPassword = Object.hasOwn(body, 'newPassword');
    if (email && db.users.some(item => item.id !== user.id && String(item.email || '').toLowerCase() === email)) {
      return json(res, 409, { error: 'email already registered' });
    }
    if ((changesEmail || changesPassword) && user.passwordHash) {
      const currentPassword = typeof body.currentPassword === 'string' && body.currentPassword.length <= 128
        ? body.currentPassword
        : '';
      if (!verifyDevPassword(currentPassword, user.passwordHash)) {
        return json(res, 401, { error: 'current password is incorrect' });
      }
    }
    if (changesEmail && !user.passwordHash && !changesPassword) {
      return json(res, 400, { error: 'set a password when adding an email' });
    }
    const passwordHash = changesPassword
      ? hashDevPassword(normalizeStudentPassword(body.newPassword, 'newPassword'))
      : user.passwordHash;
    const profile = { ...storedProfile(user.profile), ...profileFields(body) };
    const nextUser = {
      ...user,
      name,
      ...(email ? { email } : {}),
      ...(passwordHash ? { passwordHash } : {}),
      ...(Object.keys(profile).length ? { profile } : {})
    };
    persistProfileState(user.id, profile);
    db = { ...db, users: db.users.map(item => item.id === user.id ? nextUser : item) };
    saveDb();
    json(res, 200, { user: publicUser(nextUser), profile });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { state: readState(user.id) });
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req, MAX_STATE_BODY);
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) return json(res, 400, { error: 'state required' });
    readState(user.id);
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  /* ---------- AI workout generation + dev panel ---------- */
  'GET /api/ai/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const provider = activeProvider(db.aiProviders);
    json(res, 200, {
      ...buildAiGenerationStatus({
        collaboration: collaborationStore.read(),
        studentId: user.id,
        provider,
        configured: aiConfigurationEnabled()
      }),
      equipment: AI_EQUIPMENT,
    });
  },

  'GET /api/dev/session': async (req, res) => {
    const username = devAuth.readSession(req);
    json(res, 200, { unlocked: !!username, ...(username ? { username } : {}) });
  },

  'POST /api/dev/login': async (req, res) => {
    if (!requireTrustedWrite(req, res)) return;
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const attemptKey = req.socket.remoteAddress || 'unknown';
    if (!withinLimit(devLoginAttempts, attemptKey, 8, 15 * 60000)) return json(res, 429, { error: 'too many dev login attempts' });
    if (!devAuth.credential) return json(res, 503, { error: 'dev credentials not configured' });
    if (!devAuth.authenticate(username, password)) {
      return json(res, 401, { error: 'invalid dev credentials' });
    }
    json(res, 200, { ok: true }, { 'Set-Cookie': devAuth.sessionCookie(username) });
  },

  'POST /api/dev/logout': async (req, res) => {
    if (!requireTrustedWrite(req, res)) return;
    json(res, 200, { ok: true }, { 'Set-Cookie': devAuth.clearCookie });
  },

  'GET /api/dev/ai/providers': async (req, res) => {
    if (!requireDev(req, res)) return;
    json(res, 200, { providers: providerSlotsDto(db.aiProviders, db.aiUsage) });
  },

  'PUT /api/dev/ai/provider': async (req, res) => {
    if (!requireDev(req, res)) return;
    if (!requireTrustedWrite(req, res)) return;
    if (!aiConfigurationEnabled()) return json(res, 503, { error: 'AI configuration disabled' });
    const body = await readBody(req);
    try {
      const updated = upsertProvider(db.aiProviders, body, AI_MASTER_KEY);
      db.aiProviders = updated.records;
      saveDb();
      json(res, 200, { provider: updated.provider });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  },

  'POST /api/dev/ai/provider/test': async (req, res) => {
    if (!requireDev(req, res)) return;
    if (!requireTrustedWrite(req, res)) return;
    if (!aiConfigurationEnabled()) return json(res, 503, { error: 'AI configuration disabled' });
    const body = await readBody(req);
    const startedAt = Date.now();
    try {
      const tested = await testProvider(db.aiProviders, body.provider, { masterKey: AI_MASTER_KEY });
      db.aiProviders = tested.records;
      const testedSlot = db.aiProviders.find(provider => provider.provider === body.provider);
      const testUsage = tested.usage || {
        provider: testedSlot?.provider || String(body.provider || ''),
        model: testedSlot?.selectedModel || '', inputTokens: 0, outputTokens: 0, totalTokens: 0
      };
      db.aiUsage = recordAiUsage(db.aiUsage, testUsage, {
        status: tested.error ? 'failed' : 'success', latencyMs: Date.now() - startedAt, timestamp: new Date().toISOString()
      });
      saveDb();
      json(res, tested.error ? 422 : 200, { provider: tested.provider, error: tested.error });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  },

  'PUT /api/dev/ai/active': async (req, res) => {
    if (!requireDev(req, res)) return;
    if (!requireTrustedWrite(req, res)) return;
    if (!aiConfigurationEnabled()) return json(res, 503, { error: 'AI configuration disabled' });
    const body = await readBody(req);
    try {
      const activated = activateProvider(db.aiProviders, body.provider);
      db.aiProviders = activated.records;
      saveDb();
      json(res, 200, { provider: activated.provider });
    } catch (error) {
      json(res, 409, { error: error.message });
    }
  },

  'GET /api/dev/ai/usage': async (req, res) => {
    if (!requireDev(req, res)) return;
    const window = new URL(req.url, 'http://x').searchParams.get('window') || '7d';
    try { json(res, 200, { usage: summarizeAiUsage(db.aiUsage, window) }); }
    catch (error) { json(res, 400, { error: error.message }); }
  },

  'GET /api/dev/ai/models': async (req, res) => {
    if (!requireDev(req, res)) return;
    if (!aiConfigurationEnabled()) return json(res, 503, { error: 'AI configuration disabled' });
    const providerName = new URL(req.url, 'http://x').searchParams.get('provider');
    const provider = db.aiProviders.find(item => item.provider === providerName);
    if (!provider) return json(res, 404, { error: 'provider not configured' });
    json(res, 200, { models: await listProviderModels(provider, { masterKey: AI_MASTER_KEY }) });
  },

  'DELETE /api/dev/ai/provider': async (req, res) => {
    if (!requireDev(req, res)) return;
    if (!requireTrustedWrite(req, res)) return;
    const body = await readBody(req);
    db.aiProviders = db.aiProviders.filter(item => item.provider !== body.provider);
    saveDb();
    json(res, 200, { ok: true });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'First', body: 'Notificação de teste ✅ — é assim que os alertas aparecem.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  }
};

const aiJobs = createAiJobService({
  store: collaborationStore,
  readState,
  getActiveProvider: () => aiConfigurationEnabled() ? activeProvider(db.aiProviders) : null,
  runStructured: (provider, input) => runStructuredOutput(provider, { ...input, masterKey: AI_MASTER_KEY }),
  appendUsage: (usage, details) => {
    db.aiUsage = recordAiUsage(db.aiUsage, usage, details);
  },
  notifyApplied: (collaboration, { studentId, planId, now }) => notifyAiPlanApplied({
    collaboration,
    studentId,
    planId,
    now,
    randomId: () => crypto.randomBytes(16).toString('base64url')
  })
});
aiJobs.recoverInterrupted();
aiJobs.drain().catch(() => console.error('AI job queue startup failed'));

Object.assign(routes, createPersonalRoutes({
  dataDir: DATA,
  origin: ORIGIN,
  readSession,
  readBody,
  json,
  readState,
  sendPush,
  store: collaborationStore
}), createAiJobRoutes({
  service: aiJobs,
  readSession,
  readBody,
  json,
  requireTrustedWrite
}));

const TRUSTED_WRITE_EXEMPTIONS = new Set([
  'POST /api/register/options',
  'POST /api/register/verify',
  'POST /api/login/options',
  'POST /api/login/verify'
]);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  if (!['GET', 'HEAD'].includes(req.method) && !TRUSTED_WRITE_EXEMPTIONS.has(key) && !requireTrustedWrite(req, res)) return;
  try { await handler(req, res); }
  catch (e) {
    const status = e.expose && Number.isInteger(e.status) ? e.status : 500;
    if (status >= 500) console.error(key, e);
    if (!res.headersSent) json(res, status, { error: e.expose ? e.message : 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
