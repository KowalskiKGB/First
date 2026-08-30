# First account, DevPanel and AI routine differential review - 2026-08-30

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 1 |

**Overall Risk:** LOW
**Recommendation:** APPROVE after the production smoke check.

**Key Metrics:**
- Files analyzed: high-risk API/auth/provider/routine paths plus changed Home, Plan, AccountAccess, Settings and DevPanel.
- Security regressions detected: 0.
- Blocking product findings in reviewed web/API scope: 0.
- Residual operational note: the USB phone was not listed by ADB, so installation waits for reconnection; the APK itself was generated and verified.

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

### Resolved during review: concurrent AI routine generation

Identical in-flight requests are now coalesced by student, focus and context hash, later legitimate generations receive a fresh server ID, and the client ignores a repeated response ID. The routine sheet also exposes a live busy state and disables every creation choice while the request is running. This closes duplicate provider spend and duplicate React keys for the current single-instance deployment.

### LOW: Frontend whole-app coverage remains below 80% because of legacy untested surfaces

**Files:** Legacy frontend modules outside this focused change.  
**Evidence:** `npx vitest run --coverage` passed 515 tests but reported 62.96% lines / 57.49% statements for the whole frontend. Changed high-risk UI modules such as `DevPanel.jsx`, `Home.jsx`, `Plan.jsx`, `mobile.js` and `AiPlanExperience.jsx` are well covered, while large legacy views remain low.

**Impact:** This does not block the specific account/Dev/AI routine changes, but it prevents an honest "80% whole frontend" claim.

**Recommendation:** Treat 80% global frontend coverage as a separate hardening task. For this release, rely on focused unit tests, E2E and browser smoke evidence.

## Security Review

- No hardcoded commercial AI key or the temporary Gemini key prefix was found in the repository scan.
- Dev provider DTOs expose only configured state, selected model, fingerprint and status.
- Custom provider base URLs remain rejected.
- Gemini model listing uses `x-goog-api-key` header and filters for `generateContent` models.
- A replacement provider key is saved before model listing even when the slot already has a selected model.
- Provider authentication failures are mapped to a fixed safe message; raw Google responses and credential material remain hidden.
- `/api/ai/routine` is protected by the server's common trusted-origin guard because it is a non-GET route and is not in `TRUSTED_WRITE_EXEMPTIONS`.
- New AI routine generation has a six-per-hour authenticated student rate limit before body/provider work.
- Identical in-flight routine requests share one provider call and one usage record; the in-memory guard matches the documented single-instance architecture.
- Provider errors returned to the browser are sanitized.

## Verification Evidence

- `npm test` in `api`: 213 passed.
- `npm test` in `frontend`: 515 passed.
- `npm run test:e2e` in `frontend`: 24 passed.
- `npm run build` in `frontend`: passed, with existing large chunk warning.
- `npm audit --audit-level=moderate` in `api` and `frontend`: 0 vulnerabilities.
- `npm run test:coverage` in `api`: 213 passed; all files reached 85.31% lines and 81.96% branches.
- `npx vitest run --coverage` in `frontend`: 515 passed; global frontend remained at 62.96% lines because of inherited untested surfaces.
- Local Playwright smoke across mobile/tablet/desktop Home, mobile cadastro and desktop `/devadmin`: passed with no console errors and no horizontal overflow.
- `npm run build:mobile`: passed through Vite build, media copy and Capacitor sync.
- `gradlew clean assembleDebug --no-daemon --max-workers=1`: passed with 203 tasks.
- Debug APK: generated at `frontend/android/app/build/outputs/apk/debug/app-debug.apk` (146,699,479 bytes; SHA-256 `11E2886B442CDC93E18D6AD1C7B20D562B95ECDF98C48D031F79E52787BBDD8E`) and verified with APK Signature Scheme v1/v2.
- `adb devices -l`: no phone attached at the final local verification, so no installation claim is made.

## Production credential check

The isolated `/devadmin` login and encrypted Gemini slot were reached successfully in production. The temporary credential supplied for this release was stored through the protected API and tested against Google's official models endpoint, which returned HTTP 401. Gemini therefore remains inactive and no generation call is enabled until a valid replacement key passes model loading and the required structured-output test. No credential value was written to Git, printed or included in this report.

## Methodology

Strategy: focused high-risk differential review. Reviewed auth/session boundaries, secret handling, provider external calls, new public API mutation, profile state flow, Dev activation/deactivation behavior, changed mobile navigation, tests and deployment packaging.

Confidence: high for web/API security, behavior and Android packaging in the reviewed scope. Device-only interaction remains to be checked after the phone reconnects.
