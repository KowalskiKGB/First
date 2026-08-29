# Task 2 Differential Security Review

## Executive Summary

| Severity | Open | Resolved during review |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 2 |
| Low | 0 | 0 |

**Overall risk:** Medium because this task adds authenticated health-context mutation and cross-user projections.

**Recommendation:** Approve Task 2. The two authorization/projection defects found during review were reproduced in `1df556b` and fixed in `275ee54`.

**Key metrics:**

- Baseline: `4671d35`
- Reviewed range: `4671d35..4b2e256`
- Changed files reviewed: 9/9
- Production files reviewed: 3/3
- Dependency audit: 0 vulnerabilities
- Security regressions left open: 0

## What Changed

| File | Change | Risk | Blast radius |
|---|---|---|---|
| `api/domain/schema.js` | Schema v2, canonical collection migration and retention | High | Store-wide; migration runs on every collaboration load |
| `api/personal.js` | Grants, authorization, projections, profile/gym/context/measurement routes | High | `buildWorkspace` has 10 production call sites; new mutations have one HTTP entry each |
| `frontend/src/lib/connections.js` | Mirrors two fail-closed grants | Low | Connection request/response payload helpers |
| API/frontend tests | RED/GREEN, isolation, migration, validation and coverage | Low | Test-only |

The range adds 1,083 lines and removes 20 lines before these review artifacts. It introduces no dependency and does not modify provider adapters or global provider-slot persistence.

## Resolved Findings

### Medium: Manual clients could create a null collaborative student profile

**Location:** `api/personal.js:462`

**Attacker model:** Authenticated Personal using `PUT /api/personal/training-profile` with an owned manual client.

**Attack sequence:**

1. Personal selects a client whose `studentUserId` is `null`.
2. The original implementation passed ownership because manual clients are trainer-owned.
3. A `trainingProfiles` row with `studentId: null` could be persisted.

**Impact:** Corrupt canonical context and ambiguous future reads; no foreign student's data was exposed.

**Resolution:** `saveTrainingProfile` and `saveGymProfile` reject absent/invalid student IDs before authorization or persistence. The reproducer is in `api/test/ai-collaboration.test.js`.

### Medium: Legacy connections projected incomplete grants

**Location:** `api/personal.js:60`, `api/personal.js:997`

**Attacker model:** Authenticated relationship participant reading a pre-v2 connection.

**Attack sequence:**

1. A legacy connection contains only older grant keys.
2. Raw response projection omitted the two new keys.
3. Consumers could interpret absence inconsistently instead of an explicit denial.

**Impact:** Authorization remained fail-closed server-side, but the public contract was ambiguous.

**Resolution:** Every relationship response now passes through `projectConnection`, which normalizes all seven grants to strict booleans. The isolation/projection reproducer is in `api/test/ai-collaboration-http.test.js`.

## Authorization and Adversarial Analysis

| Entry point | Untrusted actor | Enforced boundary | Result |
|---|---|---|---|
| `PUT /api/ai/profile`, `PUT /api/ai/gym`, `POST /api/ai/measurements` | Authenticated user | `studentId` derives only from session; Origin and revision required | Pass |
| `PUT /api/personal/training-profile`, `PUT /api/personal/gym` | Malicious Personal | Trainer role, client ownership, linked student, active relationship and `trainingProfileWrite` | Pass |
| `PUT /api/connections/grants` | Personal or unrelated user | Connection must be active and actor must equal `connection.studentId` | Pass |
| Personal workspace/detail | Personal probing client IDs | Own active clients only; foreign IDs return 404; profile/gym and AI plan use separate grants | Pass |
| `GET /api/ai/context` | Authenticated user | Session-scoped profile, gym, measurements, plan and job projections | Pass |

Concrete attempts by a foreign Personal, a Personal without a grant, a Personal widening grants, and a second student's data appearing in context all have automated negative tests.

No provider secret, raw prompt, raw provider response, financial record or Personal private note is included by the new AI-context projectors. The migration also strips prompt/response-shaped top-level fields from canonical AI plans and usage rows.

## Test Coverage Analysis

`npm run test:coverage` passed 114/114 API tests.

| Module | Lines | Branches | Functions |
|---|---:|---:|---:|
| `api/domain/schema.js` | 100.00% | 90.00% | 100.00% |
| `api/personal.js` | 99.30% | 80.37% | 91.49% |
| All API-covered files | 99.76% | 81.27% | 93.03% |

The focused frontend grant suite passed 20/20. The full frontend run passed 347/349; its two failures are in pre-existing, explicitly preserved WIP in `frontend/src/lib/ai-plan.js`, outside Task 2.

## Historical Context

The baseline authorization flow (`activeConnection` -> `authorize` -> `requireTrainerAccess`) came from the Personal hardening commits and was retained. The diff removes no role, ownership, active-link, Origin or optimistic-revision check. The only security-relevant replacement changes raw grant copying/projection to explicit strict-boolean normalization.

## Recommendations and Known Integration Boundary

- Task 3 must write generated plan versions/jobs/usage into the canonical collaboration collections and call `notifyAiPlanApplied` after a version is applied.
- Global provider slot configuration remains in `db.json` as intended.
- The Task 1 usage writer still records its legacy operational metrics in `db.json`; Task 3 should adapt those rows into canonical collaborative `aiUsage` without deleting historical metrics.

## Methodology

**Strategy:** Focused review of all changed files, with deep analysis of `schema.js` and `personal.js`.

**Techniques:** Baseline/current diff, git history of authorization and grant helpers, call-site count, Graphify structural mapping, fail-open/default scan, attacker modeling, negative HTTP/pure tests, coverage review and dependency audit.

**Limitations:** No deployment, external provider call or browser E2E was run; Task 2 changes no UI surface beyond grant metadata. Confidence is high for the reviewed local scope.

## Fix Round 1 Differential Review

**Reviewed range:** `42e158d..bcaa842`

**Risk:** High (persisted authorization data and cross-user projections)

**Recommendation:** Approve; no open Critical, High, Medium or Low finding in this fix range.

### Security analysis

- `migrateCollaboration` is the store-wide migration boundary. It now converts every known grant to an exact boolean and discards unknown grant keys, so persisted strings, numbers, arrays and objects cannot become permissions.
- `authorize` has two production call sites and now requires `=== true`; `buildWorkspace` has eight production call sites beyond its definition and uses the same strict boundary for every affected projection.
- The concrete attacker case is an authenticated Personal linked through a malformed persisted active connection. Values such as `trainingProfileWrite: "yes"` and `aiPlanRead: "yes"` previously enabled a profile write or private plan projection; the focused negative test now proves the write is forbidden, no state read occurs, and all protected projections remain absent.
- AI-plan retention is store-wide but does not widen access. Normalized plans are ordered by numeric version, then canonical timestamp and ID, before the newest ten per student are retained. The unsorted/tied regression proves deterministic, idempotent selection.
- History review found that the permissive grant check originated in `11f05a8` and physical-order retention in `b7237b6`; neither was a reintroduction of a prior security removal. This range removes no role, ownership, active-link, Origin or revision check and adds no dependency or external call.

### Verification and limits

- Focused regressions: 5/5 passed.
- Full API coverage: 117/117 passed; 99.76% lines, 81.09% branches and 93.10% functions overall.
- Dependency audit: 0 vulnerabilities.
- Review covered all three changed code/test files plus the Task 2 report. No deployment, provider call or browser E2E was required for this backend-only correction. Confidence is high for the reviewed scope.
