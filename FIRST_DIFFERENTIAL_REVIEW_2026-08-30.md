# First differential security review — 2026-08-30

## Executive summary

| Severity | Count |
|---|---:|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 1 |

Overall risk: MEDIUM. Recommendation: approve after accepting the documented Dev-only operational exposure.

Scope reviewed: current working-tree diff over commit `2cf941b`, focusing on Dev auth, AI provider configuration, gym directory/moderation, user projections, collaboration schema migration, and AI generation/provider contracts.

## What changed

- Added moderated gym directory and student gym/equipment requests.
- Added `/devadmin` support for compact AI provider configuration, request review and registered-user projections.
- Extended collaboration schema for gym directory/request state.
- Adjusted AI provider contracts for Gemini/OpenAI GPT-5 truncation handling.
- Reworked Home, AI wizard, Dev panel, Personal AI tab and E2E contracts.

## Findings

### MEDIUM: Dev user detail returns full bodyweight/workout arrays without pagination

File: `api/server.js:482-500`

`GET /api/dev/user` is Dev-only, but `accountDetail()` returns complete `bodyweight` and reversed complete `workouts`. That matches the requested Dev visibility, but it increases blast radius if the Dev credential is compromised and can also create large responses for heavy users.

Minimal correction if this becomes multi-user production: add query windows/limits, default to recent summaries, and expose full history only behind an explicit export action.

Current mitigating evidence:

- Dev session is isolated: `api/server.js:538-543`.
- Route requires Dev cookie: `api/server.js:1072-1073`.
- Password hashes/provider keys are not projected by `projectAccount()`.

### MEDIUM: `/api/dev/users` scans every user state file synchronously

File: `api/server.js:406-417`, `api/server.js:1065-1070`

The Dev users list maps every account through `accountSummary()`, which reads each `state-<uid>.json`. This is behind Dev auth, so not public DoS, but with many registered users it can block the single Node process and make the Dev page slow or unavailable.

Minimal correction if user count grows: store last workout/count/last sync as account metadata during normal writes, or paginate `/api/dev/users`.

### LOW: Dev AI provider delete route exists outside the public contract

File: `api/server.js:1189-1195`

`DELETE /api/dev/ai/provider` remains available even though the intended contract uses save/test/activate/deactivate. It is protected by Dev auth and exact Origin, so this is not an access bypass. It is extra surface that can remove provider configuration accidentally.

Minimal correction: remove the route or hide it behind an explicit reset action with confirmation.

## Security checks with no blocking findings

- Gym/equipment requests require a signed-in student and exact trusted write before mutation: `api/gym-directory.js:177-198`, global guard at `api/server.js:1416`.
- Requests stay pending and only Dev approval changes the directory: `api/gym-directory.js:211-247`.
- Approved equipment is constrained to catalogue exercise IDs: `api/gym-directory.js:24-29`, `api/gym-directory.js:232-235`.
- Dev provider keys are encrypted and DTOs expose only fingerprint/config state: `api/ai-providers.js:35-76`.
- Custom provider base URLs are rejected: `api/ai-providers.js:78-81`.
- Gemini key is sent in header, not URL: `api/ai-providers.js:167-176`.
- OpenAI requests set `store:false` and GPT-5 output budget was raised to reduce truncation: `api/ai-providers.js:150-164`.
- Dev login and provider mutations require exact Origin through the global write guard and route guards: `api/server.js:1089-1165`, `api/server.js:1416`.
- Secret scan of non-test diff found no pasted AI key, plaintext Dev password, provider secret, scrypt hash, or `initialPassword`.

## Verification evidence

- API tests: `231 passed`.
- Frontend unit tests: `551 passed`.
- E2E Playwright: `25 passed`.
- API coverage: 82.42% lines, 80.58% branches.
- Frontend global coverage is lower because of legacy modules, but the new/altered core modules are above 80% lines (`AiPlanExperience`, `ExerciseCatalogPicker`, `ai-plan`, `ai-product`, `Home`, `DevPanel`, `GymDirectory`, `PersonalAiTab`).
- `npm audit --omit=dev`: 0 vulnerabilities in API and frontend.
- `git diff --check`: no whitespace errors; only CRLF normalization warnings.

## Methodology and limitations

Strategy: focused differential review. High-risk areas were read directly with line-number evidence and checked against tests. This review did not perform manual penetration testing against production, and did not inspect third-party provider SDK internals because the app uses direct HTTP requests.
