# Security policy

First is a self-hosted app: you run the server, you hold the data. This file says which
versions get fixes, how to report something privately, and — the part most people actually
need — what the app protects you from and what it doesn't.

## Supported versions

Until First publishes tagged releases, only the latest commit on `main` is supported. There is
no LTS or maintenance branch. First currently publishes source, not prebuilt container images.

Updating a self-hosted instance:

```bash
git pull
docker compose -f docker-compose.yml up -d --build
```

## Reporting a vulnerability

Use GitHub's private vulnerability reporting — repo **Security** tab → **Report a vulnerability**:

<https://github.com/KowalskiKGB/First/security/advisories/new>

> Private reporting has to be switched on in the repository settings for that link to work
> (Settings → Advanced Security → Private vulnerability reporting). If it 404s, open a normal
> issue saying only *"I need a private channel for a security report"* — no details, no repro —
> and it will be enabled.

Please don't put a working exploit in a public issue if it can be used against other people's
instances. Everything else (a crash you can only trigger on your own box, a scanner warning)
is fine as a normal issue.

Useful in a report: the commit, your `RP_ID`/`ORIGIN`, what sits in front of the app, steps to reproduce, and
what an attacker gets out of it.

There is no response-time SLA or bounty. If a report goes unfixed and you want to disclose it
publicly, coordinate that disclosure in the advisory thread first.

## In scope

- **`api/server.js`** — forging or replaying a session cookie, bypassing password or passkey
  verification, reading or writing another user's data through `/api/data`, reaching
  `/api/admin/*` without being an admin, bypassing the isolated Dev credential, or creating a
  profile without a valid code while `INVITE_ONLY=1`.
- **Frontend** — XSS in the React app, or anything that lets a page on another origin read or
  change a signed-in user's data.
- **Shipped deployment config** — `docker-compose.yml`, `docker-compose.local.yml`, the root
  `Dockerfile`, `api/Dockerfile`, and `web/nginx.conf`:
  a default that exposes something a self-hoster wouldn't expect to be exposed.

## Out of scope

- Anything that already assumes access to the host, to the `first-data` volume, or to the Docker socket. The
  operator is trusted by design — see the security model below.
- Admins reading their users' workout history. That is the documented purpose of the admin
  dashboard, not a leak.
- Generic volumetric denial of service. The shipped nginx config provides basic request limits;
  internet-facing operators still need upstream capacity controls. Genuine amplification (one
  small request causing unbounded work) *is* in scope.
- Instances served over plain `http://` on a LAN IP. Unsupported: passkeys don't work there and
  the session cookie isn't marked `Secure`.
- Scanner output with no working exploit, and `npm audit` findings in build-time
  devDependencies (Vite, Vitest, Capacitor CLI) that never reach a running instance.
- Rights to separately licensed exercise images or GIFs. The production Compose can fetch the
  pinned private media set into a Docker volume, but those binaries are not part of this source
  license and remain the operator's responsibility.

## Security model

Read this before hosting First for anyone other than yourself.

### Dev panel and AI providers

- **`/devadmin` is an isolated gate.** It is not linked from the app Settings and does not accept
  or require a student, Personal or app-admin session. The literal page requires only
  `DEV_PANEL_USER` plus a password verified against `DEV_PANEL_PASSWORD_HASH`. Its independent
  session is a signed `HttpOnly`, `SameSite=Strict` cookie, expires after four hours and has an
  explicit logout route. Login is limited to eight attempts per resolved client address in
  fifteen minutes, in addition to reverse-proxy limits.
- **Dev credentials are environment-only.** Production stores only `DEV_PANEL_USER` and a scrypt
  password hash in the form `scrypt:<base64url salt>:<base64url 32-byte hash>`.
  `DEV_PANEL_USER` must begin with `first_dev_`. Plaintext test credentials belong only in the ignored local
  `CREDENCIAIS_TESTE.md` file and must not contain Coolify, Cloudflare or commercial AI keys.
- **AI keys are encrypted at rest.** Provider keys are stored only after AES-256-GCM encryption
  with an independent `AI_CONFIG_MASTER_KEY` containing exactly 32 random bytes represented by
  64 hexadecimal characters. If that key is missing or malformed, the core app still starts, but
  provider save/test/model-list/activation fails closed and generation remains unavailable.
- **Gym equipment changes are moderated.** The public gym directory can be searched without a
  session, but new gym/equipment requests require a signed-in student, remain pending, and only a
  Dev session can approve or reject them. Approval stores catalogue exercise IDs from the canonical
  exercise database; free text from the requester is never treated as publishable equipment.
- **Dev user views are administrative projections.** `/devadmin` can list registered users, online
  status, last access and selected training/profile metadata for operations. Password hashes,
  provider keys, session cookies and full credential material are not returned to the browser.
- **Only one tested provider is active.** OpenAI, Gemini and Anthropic each have a fixed slot with
  selected model, fingerprint, test status and metrics. A provider can be activated only after a
  successful structured-output test for the saved model/key. Custom provider hosts are rejected;
  there is no automatic fallback or embedded commercial key.
- **Origin checks protect account, Dev, AI and collaboration mutations.** Browser writes on those
  surfaces must exactly match the configured `ORIGIN`, including Dev login. The Capacitor client
  may omit `Origin` only with the native marker expected by the API; the marker never overrides a
  conflicting header. Legacy core writes still rely on `SameSite=Lax`, as documented below, and
  there are no CSRF tokens.

### AI workout privacy and safety

- **The AI prompt is intentionally narrow.** Generation sends an anonymized training profile,
  current measurements, goal, availability, untrusted limitation text, a compact 28-day summary and
  a deterministic shortlist of allowed exercise IDs. It does not send name, phone, email,
  financial data, private Personal notes or raw workout history.
- **The server is the authority.** Exercise shortlist filtering runs before the provider call and
  semantic validation runs again after the response. Unknown IDs, duplicated IDs, unavailable
  equipment, invalid days, absolute loads, refusals and truncated responses are rejected before any
  plan is applied.
- **Minors require guardian confirmation.** Under 14 uses technique, supervision and conservative
  loading rules. Ages 14 to 17 require guardian confirmation and conservative rules. Acute risk or
  medical restriction blocks the call and preserves the existing plan.
- **Plans coexist.** Manual, Personal and AI schedules are separate. AI rollback restores a prior
  AI version without deleting manual routines or Personal programs.
- **Personal access is grant-bound.** An active link plus `trainingProfileWrite` is required to
  change a student's training profile or gym. Reading the AI plan separately requires
  `aiPlanRead`; admin status alone does not imply Personal access.
- **Jobs do not silently retry.** One active job is allowed per student, requests are idempotent,
  and an interrupted `running` job is marked failed after restart. Provider failure never triggers
  another provider or changes the current plan.

### Retention, logging and incidents

- **Retention is bounded.** The collaboration store keeps at most ten AI plan versions per student
  and two thousand AI usage records. Usage records keep provider/model/status/tokens/latency, not
  full prompts or full model responses. Public job stages are normalized to
  `organizing|generating|validating|applying` before projection.
- **Logs are metadata-only for AI.** Prompts, full responses, plaintext provider keys and decrypted
  key material are not logged. Upstream failures are normalized before they reach HTTP responses
  or server error logs.
- **Backups must cover the full volume.** Before any deploy that changes schema or provider
  configuration, snapshot the whole `first-data` volume. Restoring only `db.json` can desynchronize
  sessions, collaboration data, AI jobs and plan versions. Stop the API during tar backup/restore,
  serialize backup creation, keep the operator-owned backup directory `0700` and archives `0600`
  (or enforce equivalent Windows ACLs), require a regular `secret` plus a regular `db.json` or
  legacy `collaboration.json` store before publication, test restore separately and restore the
  full compatible volume for a data rollback.
- **Provider-key incident response:** remove or rotate the affected key at the provider, clear that
  slot in `/devadmin`, set a fresh key, run structured-output test again and reactivate only after the
  test succeeds. If `AI_CONFIG_MASTER_KEY` is suspected exposed, rotate it and re-enter every
  provider key because existing encrypted blobs cannot be trusted.
- **Dev-credential incident response:** replace both `DEV_PANEL_USER` (with a new random suffix)
  and `DEV_PANEL_PASSWORD_HASH`, redeploy and explicitly log out of `/devadmin`. No app account is
  involved. Rotating only the password hash does not invalidate an already-issued Dev cookie before
  its four-hour expiry; rotating the username as well invalidates that cookie because it is bound to
  the username.
- **No billing in this phase.** Usage counters and a feature gate exist, but checkout, quotas tied
  to payment and paid-plan enforcement do not. Do not market the current gate as a billing control.

### What it does

- **Student accounts support e-mail/password.** A password must contain at least six characters;
  the server stores a salted scrypt hash, never plaintext, and rate-limits registration and login.
  Authentication failures use a generic response so the login route does not disclose whether an
  address exists. There is no automated password-reset flow in this phase.
- **Legacy passkeys remain compatible.** WebAuthn registration remains available and existing
  passkey-only profiles can still sign in. Verification remains server-side through
  `@simplewebauthn/server` against `expectedOrigin: ORIGIN` and `expectedRPID: RP_ID`, and the
  authenticator signature counter is stored and updated after login.
- **Sessions are a signed cookie.** `gymsid` carries `<uid>:<expiry>:<version>` plus an
  HMAC-SHA256 tag over it, compared in constant time in `api/server.js`. The key is 32
  random bytes generated on first run and written to `/data/secret` with mode `0600`
  by `api/server.js`. The cookie is `HttpOnly` and `SameSite=Lax`, and gets `Secure` **only
  when `ORIGIN` starts with `https:`**.
- **Any signed-in student can end every app session they have.** `POST /api/logout/all` increments that account's
  session version, and every authenticated request checks the version in the cookie against the
  one on the user record, so every cookie ever
  issued for the account — on every device, including a copy someone walked off with — stops
  verifying at once. Password hashes and passkeys are untouched; signing back in works immediately.
- **Exercise media follows the app session.** Nginx uses an internal authorization subrequest and
  the API validates the signed `gymsid` cookie before serving `/media/`. Anonymous requests are
  denied, and media responses stay `private, no-store` so a shared proxy must not publish them.
- **Data is isolated per user by the session's uid.** `GET`/`PUT /api/data` only ever touch
  `state-<uid>.json` for the caller; no route lets a normal user name
  another user.
- **Disabling an account takes effect immediately.** Every authenticated request and every login
  is rejected for a disabled user.

### What it does not do

- **Nothing in `/data` is encrypted.** The `first-data` Docker volume holds `db.json` (users,
  e-mail addresses, password hashes, passkey public keys, push subscriptions, invite codes), one
  `state-<uid>.json` per user with their complete workout
  history and body-weight log, `secret`, and `vapid.json`. Anyone who can read that folder — you,
  whoever holds the backups, whoever gets into the host — can read every user's data, and with
  `secret` can mint a valid session cookie for any account. **If you host First for other
  people, they are trusting you exactly as much as they'd trust any server operator.**
- **Admins can read everything.** A user listed in `ADMIN_UIDS` (or flagged `admin: true` in
  `db.json`) gets every user's full history and body weight, can disable accounts, and can create
  or revoke invite codes. Off by default — a fresh instance has no admin.
- **Sessions can't be revoked one device at a time.** Revocation is per *account*, not per
  session: `POST /api/logout/all` kills all of them at once and there is no device list to pick
from. `POST /api/logout` on its own only clears the cookie in that one browser
  — a copy taken beforehand keeps working. The shipped Compose configuration
  sets sessions to **30 days**, configurable with `SESSION_DAYS`; each cookie carries the lifetime it
  was issued with, so changing the setting doesn't reach cookies that are already out. Deleting
  `/data/secret` from the Docker volume and restarting still works as the instance-wide reset, and disabling an account
  still locks out one user completely.
- **Legacy core CSRF protection is `SameSite=Lax`.** Dev, AI and Personal/collaboration mutations
  additionally check exact `Origin`, but older core routes such as `/api/data` have no CSRF token
  or explicit Origin check.
- **Passkey user verification is preferred, not required.** Both WebAuthn handshakes pass
  `requireUserVerification: false`, so a passkey
  released without a biometric or PIN is still accepted. In practice: unlocked device ≈ account
  access.
- **A passkey-only profile must add a password before losing its passkey.** There is no automated
  recovery or route to attach a second passkey. While signed in, its owner can add e-mail/password
  together through profile editing; without doing that first, losing the only passkey makes the
  profile unreachable without direct operator intervention in the `first-data` volume.
- **Disabling someone isn't a ban.** They can still register a fresh profile by e-mail or passkey
  unless `INVITE_ONLY=1` is set.
- **HTTPS is required and the Compose stack doesn't terminate TLS.** The API container speaks plain HTTP and
  nginx listens on `:80` (`web/nginx.conf`); TLS is your reverse proxy's job. Without it,
  browsers won't do passkeys at all (except on `http://localhost`) and the session cookie is sent
  in the clear.
- **Authentication has layered rate limiting.** The API limits e-mail/password authentication and
  the isolated Dev login; the shipped nginx config limits authentication endpoints separately from
  the rest of `/api`. Deployments exposed to the internet should also rate-limit at their TLS edge.
  `POST /api/register/options` reveals whether an invite code
  is valid. Current invite codes contain 64 bits of randomness; revoke and reissue older, shorter
  unused codes. The API also enforces a 5 MB request-body limit.
- **A few endpoints answer without a session:** `/api/health` returns only `{"ok":true}`,
  `/api/config` reports whether invite-only is on, `/api/push/public-key` returns the public VAPID
  key, the account/register/login handshakes and the isolated Dev session/login handshake.
- **Changing `RP_ID` invalidates every existing passkey.** They were bound to the old hostname
  and will fail verification against the new one. E-mail/password login is unaffected. Data in a
  passkey-only profile stays on disk but is unreachable until operator intervention; choose the
  hostname before anyone registers a passkey.
- **Guest mode never reaches the backend.** That data lives unencrypted in the browser's
  `localStorage` and is gone when the browser storage is cleared. AI generation is unavailable
  until the student signs in.
