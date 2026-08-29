# Task 2 Report — Collaborative AI Context

## Outcome

Task 2 implements the revisioned, student-authorized source of truth for AI training context in the existing collaboration JSON document.

Delivered:

- Schema v2 with normalized `trainingProfiles`, `gymProfiles`, `aiPlans`, `aiJobs` and `aiUsage`.
- Idempotent defensive migration that preserves legacy top-level fields/collections, retains 10 AI plan versions per student and 2,000 usage rows, and strips prompt/response data from canonical AI records.
- Grants `trainingProfileWrite` and `aiPlanRead` in backend defaults/normalization/projections and the frontend connection mirror.
- Student endpoints: `GET /api/ai/context`, `PUT /api/ai/profile`, `PUT /api/ai/gym`, `POST /api/ai/measurements`.
- Personal endpoints: `PUT /api/personal/training-profile`, `PUT /api/personal/gym`.
- Student-only grant mutation endpoint: `PUT /api/connections/grants`.
- Personal workspace/detail projections with separate profile/gym and AI-plan authorization.
- Safe context completeness, minor guardian-consent eligibility, under-14 conservative marker, current measurements, applied plan and current job.
- Notifications to the student after Personal profile/gym changes and `notifyAiPlanApplied` for Task 3.

## Decisions

- Reused `createJsonStore` and its optimistic `rev`; no database, ORM or second collaboration store was added.
- Kept global provider-slot configuration in `db.json` and left Task 1 provider adapters untouched.
- Used strict replace-style PUT validation for profile/gym data: bounded strings/arrays, enumerated age/experience, catalog IDs as bounded strings, numeric ranges and booleans.
- Personal mutation derives the student from the owned client and requires role, ownership, an active link and `trainingProfileWrite`.
- Student context derives `studentId` exclusively from the authenticated session.
- Plan projection is independent behind `aiPlanRead`; provider secrets, prompts, provider responses, finance and private Personal notes are not projected.
- Push is dispatched only after the revisioned write succeeds; rejection cannot roll back persisted state.

## TDD Evidence

### RED 1 — `2e6d85e`

Commands:

- `npm test -- --test-name-pattern="collaboration migration|only the student|trainer profile|trainer workspace projects|student AI context|AI plan notifications|student persists|trainer mutations|student grant mutation|student AI writes"`
- `npm test -- src/lib/connections.test.js`

Evidence:

- API: 5 failures from missing exports/routes (`buildAiContext`, profile/gym/grant routes).
- Frontend: 5 focused failures because only five grants existed.

### GREEN 1 — `b7237b6`

The same focused commands passed:

- API: 21/21 selected file/contract results, including all 10 new Task 2 guarantees.
- Frontend: 20/20.

### RED 2 — `1df556b`

Command:

- `npm test -- --test-name-pattern="trainer profile and gym|student AI context|connection projections"`

Evidence:

- 2 failures: manual client accepted a null student profile; legacy relationship projection omitted explicit new-grant denials.

### GREEN 2 — `275ee54`

The focused authorization/projection target passed 14/14 selected results, including the two reproducers.

### Coverage hardening — `4b2e256`

Added malformed canonical migration cases and updated the test harness startup polling to remain condition-based under full-suite concurrency.

## Final Verification

| Command | Result |
|---|---|
| `npm test` (API) | 114/114 passed |
| `npm run test:coverage` (API) | 114/114 passed; all covered files 99.76% lines / 81.27% branches / 93.03% functions |
| Focused `schema.js` coverage | 100.00% lines / 90.00% branches / 100.00% functions |
| Focused `personal.js` coverage | 99.30% lines / 80.37% branches / 91.49% functions |
| `npm test -- src/lib/connections.test.js` | 20/20 passed |
| `npm audit --omit=dev` (API) | 0 vulnerabilities |
| `graphify update .` | 1,289 nodes / 3,512 edges; graph updated |

The full frontend suite passed 347/349. Its two failures are confined to the explicitly preserved WIP in `frontend/src/lib/ai-plan.js` (`aiMissingFields` expectation and accented equipment label), not to Task 2's grant mirror. No WIP file was staged or modified by Task 2.

## Commits

- `2e6d85e` — `test: add collaborative AI context contracts` (RED)
- `b7237b6` — `feat: persist collaborative AI training context` (GREEN)
- `1df556b` — `test: cover collaborative grant projection boundaries` (RED)
- `275ee54` — `fix: fail closed on collaborative profile access` (GREEN)
- `4b2e256` — `test: harden collaborative schema coverage`

## Risks and Follow-ups

- Task 3 must adapt the Task 1 operational `db.aiUsage` writer to append compatible canonical collaboration `aiUsage` rows and must persist generated plans/jobs in the new collections. Existing metrics were not removed or rewritten in Task 2.
- `notifyAiPlanApplied` is intentionally a pure contract; Task 3 must call it only after applying a persisted plan version and then dispatch the resulting notification after commit.
- The preserved future-task WIP currently prevents a completely green frontend suite; focused Task 2 frontend coverage is green.
- No deploy, push or external provider call was performed.
