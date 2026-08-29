import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDevAuth,
  hashDevPassword,
  isTrustedMutation,
  resolveDevCredential
} from '../dev-auth.js';

test('production Dev auth requires first_dev_ username and an explicit scrypt hash', () => {
  assert.throws(() => resolveDevCredential({ NODE_ENV: 'production' }), /DEV_PANEL/);
  assert.throws(() => resolveDevCredential({
    NODE_ENV: 'production', DEV_PANEL_USER: 'dev_admin', DEV_PANEL_PASSWORD_HASH: hashDevPassword('long-test-password')
  }), /first_dev_/);
  assert.throws(() => resolveDevCredential({
    NODE_ENV: 'production', DEV_PANEL_USER: 'first_dev_admin', DEV_PANEL_PASSWORD_HASH: 'plaintext'
  }), /scrypt/);
  assert.throws(() => resolveDevCredential({ NODE_ENV: 'test', DEV_PANEL_USER: 'fixture-only' }), /required together/);
});

test('development does not generate or persist an initial password when credentials are absent', () => {
  assert.equal(resolveDevCredential({ NODE_ENV: 'test' }), null);
  assert.equal(JSON.stringify(resolveDevCredential({ NODE_ENV: 'test' })), 'null');
});

test('Dev session is four hours, HttpOnly, Strict, and Secure on HTTPS', () => {
  const env = {
    NODE_ENV: 'test',
    DEV_PANEL_USER: 'first_dev_fixture',
    DEV_PANEL_PASSWORD_HASH: hashDevPassword('fixture-password', 'fixed-test-salt')
  };
  const auth = createDevAuth({ env, signingSecret: 'test-signing-secret', origin: 'https://first.example', now: () => 1_000 });
  assert.equal(auth.authenticate('first_dev_fixture', 'fixture-password'), true);
  assert.equal(auth.authenticate('first_dev_fixture', 'wrong'), false);
  const cookie = auth.sessionCookie('first_dev_fixture');
  assert.match(cookie, /Max-Age=14400/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(auth.readSession({ headers: { cookie } }), 'first_dev_fixture');
});

test('trusted mutation requires exact Origin or originless Capacitor marker', () => {
  const origin = 'https://first.example';
  assert.equal(isTrustedMutation({ headers: { origin } }, origin), true);
  assert.equal(isTrustedMutation({ headers: { 'x-first-client': 'capacitor' } }, origin), true);
  assert.equal(isTrustedMutation({ headers: { origin: 'https://evil.example', 'x-first-client': 'capacitor' } }, origin), false);
  assert.equal(isTrustedMutation({ headers: {} }, origin), false);
});

test('HTTP Dev cookies omit Secure and reject expired or tampered sessions', () => {
  let time = 1_000;
  const env = {
    NODE_ENV: 'test', DEV_PANEL_USER: 'fixture',
    DEV_PANEL_PASSWORD_HASH: hashDevPassword('fixture-password', 'fixed-test-salt')
  };
  const auth = createDevAuth({ env, signingSecret: 'test-signing-secret', origin: 'http://localhost:8080', now: () => time });
  const cookie = auth.sessionCookie('fixture');
  assert.doesNotMatch(cookie, /Secure/);
  const token = /^firstdev=([^;]+)/.exec(cookie)[1];
  assert.equal(auth.readSession({ headers: { cookie: cookie.replace(token, `${token.slice(0, -1)}!`) } }), null);
  time += 4 * 60 * 60 * 1_000 + 1;
  assert.equal(auth.readSession({ headers: { cookie } }), null);
  assert.equal(auth.authenticate('other', 'fixture-password'), false);
});
