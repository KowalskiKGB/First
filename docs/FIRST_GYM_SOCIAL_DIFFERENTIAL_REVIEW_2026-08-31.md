# First gym social differential review — 2026-08-31

Base: `40cc71d`
Head: `50b3fd0`

## Verdict

No Critical or Important findings remain for the gym social network, Dev moderation, reverse
geocoding, seeded Macapá gyms/reviews, mobile permissions or Docker packaging changes.

## Reviewed risk areas

- Auth and authorization: public reads remain open; favorite/review/contribution writes require an
  app session and trusted Origin/native marker; Dev moderation remains isolated behind Dev auth.
- Secrets and provider keys: no pasted Gemini key or commercial AI key was found in tracked files;
  provider keys remain header-only and encrypted by existing AI config paths.
- Location privacy: user coordinates are requested only by explicit action, rounded before reverse
  geocoding, kept in React memory for ranking and not stored in collaboration JSON or AI context.
- External calls: reverse geocoder uses HTTPS, host allowlist, cache/coalescing and serialized
  upstream calls with fixed public errors.
- Seed integrity: seeded gyms are versioned with source evidence; demo reviews are visibly labeled,
  excluded from aggregates/ranking/tags and protected by tombstones after Dev removal.
- Deployment: API Docker image now copies `api/gym-social.js` and `api/data`; deployment tests cover
  the local runtime import graph.

## Verification evidence

- `npm test` in `api`: 271/271 passing.
- `npm run test:coverage` in `api`: 271/271 passing, 84.01% line coverage, 81.02% branch coverage, 81.19% function coverage.
- `npm test` in `frontend`: 583/583 passing.
- `npx vitest run --coverage` in `frontend`: 583/583 passing; global legacy coverage remains 64.45%
  line coverage, with new/changed gym modules covered by focused unit/E2E tests.
- `npm run test:e2e -- e2e/gym-directory.spec.js e2e/dev-ai.spec.js` in `frontend`: 13/13 passing.
- `npm run test:e2e -- e2e/gym-directory.spec.js` after the final CSS cleanup: 3/3 passing.
- `npm run build`: web build passing.
- `npm run build:mobile`: mobile build/sync passing, copied 1,324 images and 1,324 GIFs.
- `gradlew assembleDebug`: debug APK build passing after setting local Android SDK env vars.
- `adb install -r`: installed successfully on device `RQGL209YMME`; the app process started and stayed alive.
- `npm audit --audit-level=high` in `api` and `frontend`: 0 vulnerabilities.
- `node --test scripts/deployment.test.mjs`: 5/5 passing.
- Local Docker smoke for the API image: `/api/ready` returned `{"ok":true}` and
  `/api/gyms?uf=AP&city=Macapá` returned 11 gyms.
- Playwright screenshots inspected for Home, Academias and `/devadmin`; no overflow or unusable
  mobile controls observed. The final physical screenshot landed on the Android lockscreen, so it
  was not used as UI evidence.

## Residual risks

- Frontend global coverage is below 80% because legacy screens are included in the global V8
  denominator. This delivery is covered by targeted unit tests and E2E flows, but the repo still
  needs a separate legacy coverage project if global 80% becomes a hard CI gate.
- Vite reports existing large chunks around 1.5 MB after minification. It does not block this
  release, but route-level code splitting is the next performance cleanup.
