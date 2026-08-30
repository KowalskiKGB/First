# First account, DevPanel and AI routine differential review - 2026-08-30

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 1 |
| LOW | 1 |

**Overall Risk:** MEDIUM  
**Recommendation:** CONDITIONAL for Android packaging, APPROVE for web/API deployment.

**Key Metrics:**
- Files analyzed: high-risk API/auth/provider/routine paths plus changed Home, Plan, AccountAccess, Settings and DevPanel.
- Security regressions detected: 0.
- Blocking product findings in reviewed web/API scope: 0.
- Residual operational blocker: local Android Gradle daemon is being stopped before APK generation.

## What Changed

The diff moves student login/cadastro to the Home entry point, isolates Dev credentials under `/devadmin`, lets Dev save a provider key before selecting a model, supports global deactivation, adds authenticated AI routine generation from the routine screen, and updates Capacitor with `@capacitor/app` for Android back-button handling.

High-risk files reviewed:

| File | Risk | Notes |
|------|------|-------|
| `api/dev-auth.js` | HIGH | Dev cookie path narrowed to `/api/dev`; session remains signed, HttpOnly, SameSite=Strict and Secure on HTTPS. |
| `api/ai-providers.js` | HIGH | Provider key handling still encrypts server-side and never returns the key; model listing keeps keys in headers. |
| `api/server.js` | HIGH | New profile fields, model-list sanitization, AI usage save, AI routine route wiring and rate limit. |
| `api/ai-routines.js` | HIGH | New provider-consuming endpoint; uses canonical context, shortlist, schema validation and sanitized public errors. |
| `frontend/src/views/DevPanel.jsx` | MEDIUM | Key-first model loading, deactivation, UI state. |
| `frontend/src/App.jsx`, `AccountAccess.jsx`, `Settings.jsx` | MEDIUM | Student auth/profile data flow. |
| `frontend/src/Home.jsx`, `Plan.jsx`, `sheets.jsx` | MEDIUM | User-facing AI CTA and routine-generation flow. |

## Findings

### MEDIUM: Android APK generation is blocked by local Gradle daemon termination

**Files:** Android packaging environment, not a source-code defect isolated to one file.  
**Evidence:** `npm run build:mobile` completed and `cap sync` found `@capacitor/app@7.1.2`, but `gradlew assembleDebug` and a reduced `--no-daemon --max-workers=1` run both failed with "Gradle build daemon has been stopped: stop command received" / daemon disappearance. `adb devices` listed no attached devices at verification time.

**Impact:** Web/API can be deployed, but APK install/update on the USB phone could not be completed in this local run.

**Recommendation:** Retry from a stable terminal/Android Studio process after reconnecting the device, or inspect local Gradle/JVM process management. No source rollback is recommended from this evidence.

### LOW: Frontend whole-app coverage remains below 80% because of legacy untested surfaces

**Files:** Legacy frontend modules outside this focused change.  
**Evidence:** `npx vitest run --coverage` passed 513 tests but reported 63.19% lines / 57.64% statements for the whole frontend. Changed high-risk UI modules such as `DevPanel.jsx`, `Home.jsx`, `Plan.jsx`, `mobile.js` and `AiPlanExperience.jsx` are well covered, while large legacy views remain low.

**Impact:** This does not block the specific account/Dev/AI routine changes, but it prevents an honest "80% whole frontend" claim.

**Recommendation:** Treat 80% global frontend coverage as a separate hardening task. For this release, rely on focused unit tests, E2E and browser smoke evidence.

## Security Review

- No hardcoded commercial AI key or the temporary Gemini key prefix was found in the repository scan.
- Dev provider DTOs expose only configured state, selected model, fingerprint and status.
- Custom provider base URLs remain rejected.
- Gemini model listing uses `x-goog-api-key` header and filters for `generateContent` models.
- `/api/ai/routine` is protected by the server's common trusted-origin guard because it is a non-GET route and is not in `TRUSTED_WRITE_EXEMPTIONS`.
- New AI routine generation has a six-per-hour authenticated student rate limit before body/provider work.
- Provider errors returned to the browser are sanitized.

## Verification Evidence

- `npm test` in `api`: 211 passed.
- `npm test` in `frontend`: 513 passed.
- `npm run test:e2e` in `frontend`: 23 passed.
- `npm run build` in `frontend`: passed, with existing large chunk warning.
- `npm audit --audit-level=moderate` in `api` and `frontend`: 0 vulnerabilities.
- `npm run test:coverage` in `api`: 211 passed, all files 85.25% line coverage.
- `npx vitest run --coverage` in `frontend`: 513 passed, global frontend coverage below 80%.
- Local Playwright smoke across mobile/tablet/desktop Home, mobile cadastro and desktop `/devadmin`: passed with no console errors and no horizontal overflow.
- `npm run build:mobile`: passed through Vite build, media copy and Capacitor sync.
- `gradlew assembleDebug`: blocked by local daemon stop before APK creation.

## Methodology

Strategy: focused high-risk differential review. Reviewed auth/session boundaries, secret handling, provider external calls, new public API mutation, profile state flow, Dev activation/deactivation behavior, changed mobile navigation, tests and deployment packaging.

Confidence: high for web/API security and behavior in the reviewed scope; medium for Android packaging because local Gradle process termination prevented APK verification.
