import crypto from 'node:crypto';

const DEV_SESSION_SECONDS = 4 * 60 * 60;
const SCRYPT_PATTERN = /^scrypt:([A-Za-z0-9_-]{8,}):([A-Za-z0-9_-]{20,})$/;

function scryptParts(encoded) {
  const match = SCRYPT_PATTERN.exec(String(encoded || ''));
  if (!match) return null;
  return {
    salt: match[1],
    saltBytes: Buffer.from(match[1], 'base64url'),
    hash: Buffer.from(match[2], 'base64url')
  };
}

export function hashDevPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

export function verifyDevPassword(password, encoded) {
  const parts = scryptParts(encoded);
  if (!parts || parts.saltBytes.length < 16 || parts.hash.length !== 32) return false;
  const actual = crypto.scryptSync(String(password), parts.salt, 32);
  const expected = parts.hash;
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

export function resolveDevCredential(env = process.env) {
  const username = String(env.DEV_PANEL_USER || '').trim();
  const passwordHash = String(env.DEV_PANEL_PASSWORD_HASH || '').trim();
  const production = env.NODE_ENV === 'production';
  if (!username && !passwordHash && !production) return null;
  if (!username || !passwordHash) throw new Error('DEV_PANEL_USER and DEV_PANEL_PASSWORD_HASH are required together');
  if (production && !username.startsWith('first_dev_')) throw new Error('DEV_PANEL_USER must start with first_dev_ in production');
  const parts = scryptParts(passwordHash);
  if (!parts) throw new Error('DEV_PANEL_PASSWORD_HASH must be a scrypt hash');
  if (parts.saltBytes.length < 16) throw new Error('DEV_PANEL_PASSWORD_HASH salt must contain at least 16 bytes');
  if (parts.hash.length !== 32) throw new Error('DEV_PANEL_PASSWORD_HASH hash must contain exactly 32 bytes');
  return Object.freeze({ username, passwordHash });
}

function cookies(req) {
  return Object.fromEntries(String(req.headers?.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
}

export function createDevAuth({ env = process.env, signingSecret, origin, now = Date.now }) {
  const credential = resolveDevCredential(env);
  const secure = /^https:/i.test(origin) ? ' Secure;' : '';
  const sign = payload => {
    const mac = crypto.createHmac('sha256', signingSecret).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  };
  const verify = token => {
    const index = String(token || '').lastIndexOf('.');
    if (index < 0) return null;
    const payload = token.slice(0, index);
    const supplied = Buffer.from(token.slice(index + 1));
    const expected = Buffer.from(crypto.createHmac('sha256', signingSecret).update(payload).digest('base64url'));
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected) ? payload : null;
  };
  return Object.freeze({
    credential,
    authenticate: (username, password) => !!credential && username === credential.username && verifyDevPassword(password, credential.passwordHash),
    sessionCookie: username => `firstdev=${sign(`dev:${username}:${now() + DEV_SESSION_SECONDS * 1000}`)}; Path=/api/dev; Max-Age=${DEV_SESSION_SECONDS}; HttpOnly;${secure} SameSite=Strict`,
    clearCookie: `firstdev=; Path=/api/dev; Max-Age=0; HttpOnly;${secure} SameSite=Strict`,
    readSession(req) {
      if (!credential) return null;
      const payload = verify(cookies(req).firstdev);
      if (!payload) return null;
      const [kind, username, expiry] = payload.split(':');
      return kind === 'dev' && username === credential.username && Number(expiry) > now() ? username : null;
    }
  });
}

export function isTrustedMutation(req, origin) {
  const suppliedOrigin = req.headers?.origin;
  if (suppliedOrigin) return suppliedOrigin === origin;
  return req.headers?.['x-first-client'] === 'capacitor';
}
