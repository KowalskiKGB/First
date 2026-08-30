# First Student Account Differential Review - 2026-08-30

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 2 fixed |
| Low | 0 |

**Overall risk:** Medium before the compatibility/proxy fixes, Low after verification.
**Recommendation:** Approve; the fresh verification suite is green.

## What Changed

Range reviewed: `5dada46..HEAD` plus the uncommitted follow-up changes on `feat/student-home-auth`.

- Added e-mail/password student registration and login beside the existing passkey-compatible backend.
- Moved account entry to Home and kept Settings for logged-in profile editing only.
- Isolated the Dev AI panel at `/devadmin`, outside the student router and app session.
- Kept AI workout generation gated behind an authenticated student.
- Updated Home, Plan CTAs, pt-BR copy, and Playwright coverage for account, AI, Personal and Dev flows.

## Findings

### Medium - fixed: passkey-only profiles could not edit body data

**File:** `frontend/src/views/Settings.jsx:412`
**Risk:** Behavioral regression for existing users created before e-mail/password accounts.

The first profile editor version made `profile-email` required and validated it on every save. Existing passkey-only users with no e-mail would be unable to update weight, measures, goal or other profile data without adding e-mail/password immediately.

**Fix applied:** e-mail remains required for e-mail accounts, but is optional for legacy passkey-only profiles. The payload omits `email` when a legacy profile leaves it blank, and the backend rejects direct attempts to add a password without also adding an e-mail.

**Coverage:** `frontend/src/views/Settings.account.test.jsx` covers the passkey-only UI case, and `api/test/student-auth-http.test.js` covers direct API mutation.

### Medium - fixed: API auth rate limit could become global behind nginx

**File:** `api/server.js:556`, `api/server.js:598`, `api/server.js:817`, `web/nginx.conf:24`
**Risk:** Availability regression for production behind the bundled nginx proxy.

The first e-mail/password and Dev login limiters keyed attempts by `req.socket.remoteAddress`. In the deployed topology, the API sees the nginx container as the socket peer, so repeated failures from one public client could throttle other clients until the window expired.

**Fix applied:** the API now uses `X-Real-IP` only when the socket peer is loopback or a private proxy address, falling back to the peer address otherwise. The nginx auth-rate-limit location also covers `/api/auth/register` and `/api/auth/login`, not only legacy WebAuthn handshakes.

**Coverage:** `api/test/student-auth-http.test.js` verifies two distinct `X-Real-IP` clients do not share the same throttle bucket; `scripts/deployment.test.mjs` verifies the nginx auth location includes the e-mail/password endpoints.

## Security Review

- Dev APIs require the independent `firstdev` cookie; app `gymsid` sessions do not unlock provider configuration.
- Dev and student credential mutations still pass the exact-origin guard.
- Provider keys remain encrypted server-side and are not returned to the browser.
- Student password hashes are stored as scrypt hashes; responses expose only `publicUser`.
- E-mail/password changes require the current password when a password hash exists.
- E-mail or password changes bump the session version and return a fresh cookie, invalidating stale sessions.
- Anonymous users can view the app shell but cannot call AI status/context/generation successfully.

## Test Coverage

- API: student registration/login/profile security, Dev isolation, AI auth gate.
- Unit frontend: `/devadmin` entry, Home CTA behavior, AccountAccess form contract, Settings profile boundary.
- E2E: Dev provider configuration on mobile/tablet/desktop, AI wizard/apply/rollback, Personal workspace, schedule coexistence, and the new student Home account flow.

## Residual Risk

- There is still no automated password reset in this phase. Users who rely only on e-mail/password need manual operator recovery if they lose credentials.
- Other locale packs retain old starter-plan translation strings, but current visible pt-BR Home/Plan/Settings CTAs no longer use the PPL action.
- The frontend bundle still carries pre-existing large chunks; this release did not introduce code-splitting.

## Methodology

Strategy: focused high-risk review. I reviewed auth/session changes, Dev trust boundaries, changed UI entry points, tests, grep scans for old routes/PPL strings, and Playwright browser evidence. Historical context included `git blame` and `git log -S` for credential/session changes.
