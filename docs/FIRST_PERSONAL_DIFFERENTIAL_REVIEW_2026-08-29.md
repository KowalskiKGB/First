# First Personal Differential Review - 2026-08-29

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

**Overall Risk:** Medium, because the release adds authenticated collaboration, health data, scheduling and receivables.
**Recommendation:** APPROVE for the private/self-hosted deployment.

**Key Metrics:**
- Commit range: `origin/main..5da1fa3` at final local review
- Files changed: 64
- Shortstat: 8,194 insertions, 273 deletions
- Security regressions detected: 0
- Blocking test gaps in the reviewed high-risk surface: 0

## What Changed

The release adds the Personal/instructor workspace to the isolated First repo:

- revisioned `collaboration.json` storage;
- student/trainer roles, explicit connection consent, grants, inbox and audit;
- Personal dashboard, student list, student detail, agenda and finance views;
- controlled forms for clients, programs, measurements, appointments and receivables;
- Playwright E2E coverage for the professional workspace across mobile, tablet and desktop.
- final release fixes for private media cache documentation and Node 22 Docker lockfile metadata.

## High-Risk Files Reviewed

| File | Risk | Result |
|------|------|--------|
| `api/personal.js` | High | Approved |
| `api/lib/json-store.js` | High | Approved |
| `api/domain/schema.js` | Medium | Approved |
| `api/server.js` | High | Approved |
| `frontend/src/store/useCollaboration.js` | High | Approved |
| `frontend/src/views/personal/PersonalGuard.jsx` | High | Approved |
| `frontend/src/lib/connections.js` | High | Approved |
| `frontend/src/views/student/Connections.jsx` | Medium | Approved |
| `frontend/e2e/personal-workspace.spec.js` | Medium | Approved |
| `web/nginx.conf` / `nginx.conf` | Medium | Approved |
| `frontend/package-lock.json` | Low | Approved |

## Findings

No blocking findings found in the reviewed differential.

Final addendum: commit `5da1fa3` changes only `frontend/package-lock.json` optional/peer metadata
so `npm ci` succeeds inside `node:22-alpine`. It adds no application code and was validated by
frontend tests, frontend build and Docker Compose build.

## Security Notes

- Server-side authorization is enforced before trainer-owned writes through `requireTrainerAccess` in `api/personal.js:125`.
- Cross-user connection actions validate actor role, participants and `requestedBy` in `api/personal.js:132` and `api/personal.js:164`.
- Appointment and receivable writes validate ownership, ID matching, conflicts, dates and money boundaries in `api/personal.js:440` and `api/personal.js:479`.
- Production personal writes require exact same-origin requests in `api/personal.js:673`.
- Client-side loss of `401/403` access clears Personal state in `frontend/src/store/useCollaboration.js:24` and routes away from the Personal area in `frontend/src/views/personal/PersonalGuard.jsx:32`.
- The frontend helper rejects invalid connection actor roles before sending requests in `frontend/src/lib/connections.js:25`.

## Test Coverage Evidence

- `npm test` in `api`: 61 passed.
- `npm run test:coverage` in `api`: all files 99.77% lines, 82.35% branches, 90.87% functions.
- `npm test` in `frontend`: 332 passed.
- `npm run test:e2e` in `frontend`: 3 passed for 360x800, 768x1024 and 1440x900.
- `npm run build` in `frontend`: success; expected catalogue chunk warning only.
- `docker compose -f docker-compose.yml build api web`: success after lockfile synchronization.
- local Compose smoke: `/api/health` 200, app shell 200 with CSP, real `/media/img/...jpg` 200 with `Cache-Control: private, no-store`.
- `npm audit --omit=dev` in `api` and `frontend`: 0 vulnerabilities.
- `git diff --check`: clean.

## Residual Risk

- The app still uses a single JSON document and must run as one API replica.
- Finance is manual accounts receivable; no payment processor or webhook exists.
- The Personal program is published and visible, but automatic ingestion into the student's local workout engine is still roadmap work.
- Full frontend global coverage is below 80% because of legacy untested screens, although the new Personal code and critical API paths have focused tests and E2E.

## Methodology

Strategy: focused review. The high-risk surface is auth/authorization, personal health data, scheduling, receivables and deployment defaults.

Techniques used:

- diff triage against `origin/main`;
- line-level review of backend access checks and frontend fail-closed state;
- adversarial checks for IDOR, stale revision, invalid actor roles, malformed requester state and cross-trainer finance/schedule access;
- verification of red/green regression tests and E2E evidence.

Confidence: high for the reviewed high-risk release surface, medium for legacy UI outside the Personal workspace.
