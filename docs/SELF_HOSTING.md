# Self-hosting First

First runs as three Compose services:

- `web`: nginx serving the built React app and proxying `/api`.
- `api`: Node server for passkeys, sessions, per-user state, admin tools, and push.
- `media`: one-shot initializer that verifies or populates the persistent exercise-media volume.

The source of this independent version is <https://github.com/KowalskiKGB/First>. The standard
deployment builds the `web` and `api` images from the checkout and pulls the small initializer
image; no prebuilt First container image is required.

## Production Deployment

```bash
git clone https://github.com/KowalskiKGB/First
cd First
cp .env.example .env
docker compose -f docker-compose.yml up -d --build
```

The base `docker-compose.yml` exposes `web:80` only to Docker networks. Attach the HTTPS reverse
proxy for `first.rocketxsistemas.com.br` to that network and route it to the `web` service.

## Local Smoke Test

```bash
cp .env.example .env
```

For a passkey-capable local preview, set these values in `.env`:

```dotenv
RP_ID=localhost
ORIGIN=http://localhost:8080
VAPID_SUBJECT=mailto:admin@localhost
WEB_PORT=8080
```

Then start the base file with the local override:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml up -d --build
curl http://localhost:8080/api/health
```

A healthy response contains `"ok": true` and the current user count.

Stop the local stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

## Public HTTPS

Passkeys are bound to a hostname. For the production domain, keep these values aligned:

```bash
RP_ID=first.rocketxsistemas.com.br
ORIGIN=https://first.rocketxsistemas.com.br
RP_NAME=First
```

Do not create passkeys on a temporary hostname if you plan to use another domain later.
Changing `RP_ID` invalidates existing passkeys for the old hostname.

## Reverse Proxy

Use the Docker Compose build from this GitHub repository. Point the public domain to the
`web` service on internal port `80`; do not publish host ports from the compose file.

Persist data with the named Docker volume:

```yaml
volumes:
  first-data:
  first-media:
```

`first-data` contains application state. `first-media` contains exercise visuals and is mounted
read-only by the `web` container.

## First Owner Account

The first deployment uses:

```bash
INVITE_ONLY=0
ADMIN_UIDS=
FIRST_BASIC_AUTH_USERS=first-bootstrap:{SHA}<generated-hash>
FIRST_BOOTSTRAP_MIDDLEWARE=,first-bootstrap-auth
```

The two values activate the temporary high-priority whole-host Basic Auth router in Coolify.
`FIRST_BASIC_AUTH_USERS` is also permanently required for the separately licensed `/media/` paths.
After creating your first profile, read its `id`
from the persisted `db.json`, set it in `ADMIN_UIDS`, and switch:

```bash
INVITE_ONLY=1
FIRST_BASIC_AUTH_USERS=first-bootstrap:{SHA}<keep-the-existing-hash>
FIRST_BOOTSTRAP_MIDDLEWARE=
```

Existing accounts continue working after invite-only mode is enabled. Clearing only
`FIRST_BOOTSTRAP_MIDDLEWARE` removes the extra prompt from the application while keeping
`/media/` private; do not clear `FIRST_BASIC_AUTH_USERS` while server media is enabled.

## Exercise Media

Exercise metadata and instructional text derived from `hasaneyldrm/exercises-dataset` remain
under its MIT license. First has pt-BR names and instructions for all 1,324 exercises. The pt-BR
instruction set comes from the `tutods` contribution at commit
[`93475e2982117339d2cbf88eb900ad2ceb8d97d6`](https://github.com/tutods/exercises-dataset/commit/93475e2982117339d2cbf88eb900ad2ceb8d97d6).

The production Compose file enables visual demonstrations. Its one-shot `media` service downloads
exactly 1,324 JPG files and 1,324 GIF files from upstream commit
[`7455efae41b330c265e7cd4b78dfa848e7ce5ebd`](https://github.com/hasaneyldrm/exercises-dataset/commit/7455efae41b330c265e7cd4b78dfa848e7ce5ebd),
checks both counts, the exact sorted path list, and every file's content before writing them to the
private named volume `first-media`. Subsequent starts repeat those checks before reusing the volume.
The `web` service mounts the volume read-only and serves the files from the same origin.

The dedicated high-priority Traefik router keeps `/media/` behind Basic Auth even after the
whole-host bootstrap guard is removed. The static paths intentionally do not use the application's
passkey session, so keep `FIRST_BASIC_AUTH_USERS` configured while server media is enabled.

The media binaries are intentionally excluded from the public Git repository. Images and GIFs
require separate rights from their copyright holder, and the application shows the visible
attribution **© Gym visual**. Operating or redistributing the files is the deployer's
responsibility; neither the dataset's MIT license nor First's AGPL grants media rights. See
[NOTICE.md](../NOTICE.md).

## License

First remains under the GNU AGPL v3.0 and preserves the original openGym attribution. Operators
of a modified network version must offer its users the corresponding source as required by AGPL
section 13.
