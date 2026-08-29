# First media/PT-BR differential review - 2026-08-29

## Executive summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

Overall risk: Low.
Recommendation: Approve for the current personal/self-hosted deployment.

Scope reviewed: exercise media delivery, pt-BR catalogue/instructions, translated exercise display/search/import, Android media packaging, docs, and deployment template.

## What changed

Commit range reviewed: `a721d08..working-tree` plus the follow-up hardening commit.

Main production surfaces:

| Area | Files | Risk |
|---|---|---|
| Runtime media delivery | `docker-compose.yml`, `Dockerfile`, `web/nginx.conf` | Medium |
| Mobile media packaging | `frontend/.env.mobile`, `frontend/package.json`, `frontend/scripts/copy-exercise-media.mjs` | Medium |
| Build dependencies | `frontend/package.json`, `frontend/package-lock.json` | Medium |
| Catalogue/i18n/search | `frontend/src/lib/i18n.js`, `frontend/src/lib/exercises.js`, `frontend/src/lib/import-csv.js`, `frontend/src/exercise-names/`, `frontend/src/instr/pt.js` | Low |
| UI rendering | `frontend/src/components/Media.jsx`, `frontend/src/views/*`, `frontend/src/sheets.jsx`, `frontend/src/index.css` | Low |
| Tests/docs | `*.test.*`, `README.md`, `NOTICE.md`, `docs/*` | Low |

## Findings

No blocking findings.

Reviewed controls:

- Media is mounted into nginx as read-only: `docker-compose.yml:83`.
- The web image still does not bake media binaries into the image: `Dockerfile:24`.
- Production media download is pinned to upstream commit `7455efae41b330c265e7cd4b78dfa848e7ce5ebd`: `docker-compose.yml:13`.
- The media initializer verifies both counts and the sorted media path-list hash before reuse/install: `docker-compose.yml:14`, `docker-compose.yml:21`, `docker-compose.yml:35`.
- Mobile media copy refuses paths outside `frontend/dist` and child media directories: `frontend/scripts/copy-exercise-media.mjs:13`, `frontend/scripts/copy-exercise-media.mjs:21`.
- `@capacitor/assets` was removed because it was unused in the build/test scripts and pulled vulnerable dev tooling (`sharp`/`tar`); `npm audit --audit-level=high` is now clean.
- Public Git tracking excludes media binaries; `git ls-files media frontend/dist frontend/android/app/src/main/assets/public/media frontend/ios/App/App/public/media` returned no files.
- Media is served same-origin, so no CSP relaxation or third-party hotlinking was introduced.
- UI shows visible attribution for exercise visuals: `frontend/src/components/Media.jsx:29`.
- The animation frame is a real button with an accessible label, image dimensions, and reduced-motion users start from the still frame: `frontend/src/components/Media.jsx`.

## Residual risk

- The Compose initializer depends on GitHub availability when the `first-media` volume is empty or invalid. Existing valid volumes are reused.
- The repository intentionally does not grant a license for the exercise visual media. `README.md`, `NOTICE.md`, `docs/MOBILE.md`, and `docs/SELF_HOSTING.md` now state that operators remain responsible for rights before use or redistribution.
- The local debug APK includes the ignored media files for offline personal testing. Do not redistribute that APK unless the media rights are resolved.

## Test coverage

Covered by automated tests:

- Vitest coverage passed with 219 tests, 83.74% statements and 88.19% lines.
- Complete pt-BR name and instruction coverage for all 1,324 exercise IDs.
- Bilingual/accent-insensitive exercise search.
- PT-BR CSV import matching even when the UI language is English.
- Exact local private media parity with the exercise catalogue.
- Compose media/service/build configuration and Docker Compose config validity.

Manual/interactive checks:

- Android debug APK built, installed, launched, and inspected on `SM_S936B`.
- Android screenshot confirmed PT-BR UI and exercise media rendering.
- Local preview confirmed `media/img/...` and `media/gif/...` requests returning HTTP 200.
- Local preview confirmed `supino barra` resolves to `Supino reto com barra` with no console errors.
- `npm audit --audit-level=high` in `frontend/` and `npm audit --omit=dev --audit-level=high` in `api/` both passed after removing unused vulnerable dev tooling.

## Methodology

Strategy: Focused review. The high-risk surface was deployment/media acquisition, not auth or payments.

Checks applied:

- Differential inspection against `a721d08`.
- Insecure-defaults scan for hardcoded secrets, fail-open auth/config, and accidental public media tracking.
- Adversarial review of media path traversal, partial copy/deploy state, third-party download drift, and redistribution risk.
- Fresh build/test/coverage/mobile/browser verification before commit.

Confidence: High for the reviewed media/PT-BR scope. This report does not re-audit the whole authentication system; that was covered in the earlier First security review.
