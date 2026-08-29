# Self-hosting First

First runs as two containers:

- `web`: nginx serving the built React app and proxying `/api`.
- `api`: Node server for passkeys, sessions, per-user state, admin tools, and push.

The source of this independent version is <https://github.com/KowalskiKGB/First>. The standard
deployment builds both images from the checkout; no prebuilt container image is required.

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
```

## First Owner Account

The first deployment uses:

```bash
INVITE_ONLY=0
ADMIN_UIDS=
```

After creating your first profile, read its `id` from the persisted `db.json`, set it in
`ADMIN_UIDS`, and switch:

```bash
INVITE_ONLY=1
```

Existing accounts continue working after invite-only mode is enabled.

## Exercise Media

Exercise metadata and instructional text derived from `hasaneyldrm/exercises-dataset` remain
under its MIT license. Images and GIFs require a separate license from their copyright holder.
They are not included, downloaded, served, or enabled by First's default build. See
[NOTICE.md](../NOTICE.md).

## License

First remains under the GNU AGPL v3.0 and preserves the original openGym attribution. Operators
of a modified network version must offer its users the corresponding source as required by AGPL
section 13.
