# First 1.4 differential review - 2026-08-31

Base: `03c8c1289c5bfe632d44af6f45eddcdaf00b4830`
Head: release candidate based on `a4af554`

## Executive summary

| Severity | Count |
|---|---:|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |

Overall risk: LOW
Recommendation: APPROVE for production smoke, with the residual notes below tracked after deploy.

## What changed

- `/devadmin` remains isolated, with copyable local Dev credential handoff pointing to `/devadmin`, four-hour Dev session, exact Origin messaging, show/hide controls and separate panel-loading failures.
- Academias now attempts geolocation automatically on screen entry, keeps coordinates in memory only, fills UF/municipality from `/api/location/reverse`, preserves manual edits and removes the old location button.
- Student, Personal and Dev UI were restyled to the First 1.4 training-log identity: solid dark/light surfaces, local fonts, compact rails, 44px targets, no gradients and reduced-motion support.
- Student navigation is now Inicio, Plano, Iniciar/Retomar, Academias, Exercicios; Estatisticas remains route-accessible through profile/evolution links.
- Exercise, routine and modal click surfaces were tightened to native buttons where they trigger actions.

## Findings

### LOW: Frontend global coverage remains below the 80% policy target

File: frontend coverage output

The new and high-risk changed paths are covered by focused unit tests and Playwright flows, but the whole frontend V8 denominator still includes large legacy screens (`Workout.jsx`, `sheets.jsx`, `Settings.jsx`, `useUI.js`) that keep global frontend coverage at 64.94% lines. This is not a release blocker for this isolated 1.4 change because the critical user flows pass E2E across mobile/tablet/desktop, but a future CI gate at 80% frontend global would fail.

Recommendation: create a separate legacy-coverage project or add gradual coverage thresholds per changed file before enforcing 80% globally.

### LOW: Production bundle still has large chunks

File: frontend build output

Vite still reports chunks above 1.5 MB after minification, mostly from the existing exercise catalogue and locale payloads. This does not break correctness or security, but affects first-load performance on weak mobile connections.

Recommendation: split catalogue/locale data by route or lazy-load large language/exercise payloads after the first screen.

## Security review

No HIGH or CRITICAL issues were found in the reviewed diff.

- Dev auth: environment-only Dev credential, scrypt hash validation, `first_dev_` production prefix, signed HttpOnly Strict cookie and four-hour expiry remain enforced.
- Origin: Dev login and provider mutations keep exact Origin validation; UI now distinguishes invalid credential, invalid Origin, lockout and server-not-configured states.
- Secrets: no AI key, Coolify token, Cloudflare token, plaintext Dev password hash, generated handoff JSON or user-provided Gemini key appears in the tracked diff.
- Location: coordinates are used only in React state and rounded reverse-geocode requests; no profile, AI context, collaboration JSON or analytics persistence was added.
- AI providers: custom base URLs remain rejected; frontend receives fingerprints/status only.

## Verification evidence

- `npm test` in `api`: 271/271 passing.
- `npm run test:coverage` in `api`: 271/271 passing, 84.01% line coverage, 81.02% branch coverage, 81.19% function coverage.
- `npm test` in `frontend`: 597/597 passing.
- `npm test -- --coverage` in `frontend`: 597/597 passing, 64.94% global line coverage; changed critical views/libs covered by focused tests and E2E.
- `npm run build` in `frontend`: passing; large chunk warning remains.
- `npm run test:e2e` in `frontend`: 36/36 passing.
- `node --test scripts/deployment.test.mjs scripts/release-credentials.test.mjs scripts/release-operations.test.mjs`: 19/19 passing.
- `npm audit --audit-level=moderate` in `api` and `frontend`: 0 vulnerabilities.
- Static UI/security grep: no `div/span onClick`, no gradients, no `transition: all`, no paste-blocking handler, no mobile zoom disable.
- Playwright screenshots inspected for Home, Academias, Personal and `/devadmin`.

## Methodology and limitations

Strategy: focused differential review. High-risk areas (`/devadmin`, credential generation, Origin/cookies, provider-key UI, location privacy and mobile navigation) were reviewed directly against code, tests and screenshots. Low-risk UI styling was reviewed through automated contract tests, greps, build output and screenshot inspection.

Limitations: production smoke, Coolify credential rotation and physical Android reinstall are operational steps performed after this report and should be recorded in the final handoff.
