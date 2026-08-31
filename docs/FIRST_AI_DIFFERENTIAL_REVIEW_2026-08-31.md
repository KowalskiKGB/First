# First AI/Dev Differential Review - 2026-08-31

## Scope

- `api/ai-providers.js`
- `api/test/ai-providers.test.js`
- `frontend/src/index.css`
- `frontend/e2e/dev-ai.spec.js`
- `frontend/src/locales/pt.js`

## Findings

No Critical or High findings.

## Security Notes

- Provider test failures expose only fixed diagnostics: credential rejected, provider/model HTTP status, or timeout.
- Upstream response bodies, transport exception text, prompts, full model responses, and complete API keys remain out of public DTOs and test assertions cover those sentinel cases.
- The diagnostic marker is a private module `Symbol`; browser input cannot mark an arbitrary upstream or transport error as safe.
- Gemini/OpenAI/Anthropic keys remain sent only in headers or request bodies already covered by provider adapter tests; model-list URLs do not contain keys.

## Behavioral Notes

- Mobile Dev provider selectors were reduced from stacked large cards to three compact selectors without horizontal overflow.
- The Dev request title now covers both gym and equipment moderation, so the E2E assertion was updated to the Portuguese copy currently rendered.

## Verification

- `npm test` in `api`: 235 passed.
- `npm test` in `frontend`: 551 passed.
- `npm run build` in `frontend`: passed, with the existing large chunk warning.
- `npm run test:e2e` in `frontend`: 29 passed.
- `npm audit --audit-level=moderate` in `api`: 0 vulnerabilities.
- `npm audit --audit-level=moderate` in `frontend`: 0 vulnerabilities.
- `git diff --check`: passed.
