# First Personal Production Audit - 2026-08-29

Production audit: 86/100, strong for private/self-hosted launch, with two caveats: single API replica because storage is JSON, and legacy frontend coverage below the project target.

## Blockers

None found for the private deployment scope.

## High-Value Fixes

- Move collaboration storage from JSON to SQLite/Postgres before running multiple API replicas or opening this beyond a private instance.
- Add code splitting for large locale/catalogue chunks after the current functional release.
- Raise legacy frontend coverage over time; the new Personal surface is covered, but older screens keep global coverage low.
- Add the production signing-certificate fingerprint to Digital Asset Links before publishing a
  signed APK/AAB; the approved debug APK uses the debug certificate.

## Evidence Checked

- `docker-compose.yml`: one API service, persistent `/data`, healthcheck, required `RP_ID`, `ORIGIN` and media Basic Auth.
- `api/Dockerfile`: production image copies `server.js`, `personal.js`, `domain/` and `lib/`.
- `api/server.js`: production requires explicit `RP_ID`/`ORIGIN`, signed HttpOnly SameSite cookies, exact WebAuthn origin checks.
- `api/personal.js`: authenticated routes, exact browser Origin/native-client checks, revision conflicts, grants, per-trainer scoping and fail-safe Web Push dispatch.
- `frontend/src/store/useCollaboration.js`: account-bound collaboration cache and fail-closed handling.
- `frontend/src/lib/personal-forms.js` / `frontend/src/store/useStore.js`: published programs become executable weekly routines while manual routines, active workout and history are preserved.
- `frontend/src/views/personal/PersonalGuard.jsx`: blocks Personal views after role loss or permission revocation.
- `frontend/e2e/personal-workspace.spec.js`: critical Personal workflow in mobile/tablet/desktop.
- Android manifest/activity and `/.well-known/assetlinks.json`: WebAuthn for Apps, verified domain association and `android:allowBackup="false"`.
- `docker-compose.yml`: 2,648 private media files remain behind Basic Auth; whole-host bootstrap is empty for native API access and Digital Asset Links is public.

## Verification Commands

- `npm test` in `api`: 66 passed.
- `npm run test:coverage` in `api`: 99.77% lines, 82.96% branches, 91.93% functions.
- `npm test` in `frontend`: 341 passed.
- `npm run test:e2e` in `frontend`: 3 passed.
- `npm run build` in `frontend`: success with expected large catalogue chunk warning.
- Docker Compose `api`/`web` build and local API/web smoke: approved.
- `npm run build:mobile` and Android `assembleDebug`: approved with 2,648 offline media files.
- `npm audit --omit=dev` in `api`: 0 vulnerabilities.
- `npm audit --omit=dev` in `frontend`: 0 vulnerabilities.
- `git diff --check`: clean.

## Evidence Missing

- Live production smoke after Coolify deploy.
- Physical Android install and passkey login after the phone is connected again; the APK build itself is approved.
- Long-running concurrency test under simultaneous trainer writes.

## Next Action

Push `main`, trigger Coolify deploy, validate `/api/health`, app shell and media route on `https://first.rocketxsistemas.com.br`.
