<div align="center">

<h1>First</h1>

**A self-hosted workout and body-weight tracker whose data stays on infrastructure you control.**

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-a3e635?style=flat-square)](LICENSE)
![React](https://img.shields.io/badge/React-19-38bdf8?style=flat-square&logo=react&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
[![GitHub issues](https://img.shields.io/github/issues/KowalskiKGB/First?style=flat-square)](https://github.com/KowalskiKGB/First/issues)

### [first.rocketxsistemas.com.br](https://first.rocketxsistemas.com.br) · [Source](https://github.com/KowalskiKGB/First)

</div>

## About First

First is an independent modified version derived from openGym. It keeps the existing workout,
passkey, PWA, and local/mobile foundations while establishing its own repository and deployment.
The original openGym work is Copyright (C) 2026 Duarte Santos; attribution, third-party notices,
and the independent-copy history are preserved in [NOTICE.md](NOTICE.md).

The current application includes:

- Weekly routines, guided workouts, rest and work timers, supersets, cardio, and custom exercises.
- Body-weight history, workout statistics, activity heatmaps, muscle maps, and estimated 1RM.
- Existing linear, Greyskull, double, timed, and body-weight progression rules.
- Optional RIR/RPE logging, plan sharing, JSON backups, and imports from common tracker exports.
- Guest mode or passkey profiles synchronized through the self-hosted API.
- Optional administration, invite-only registration, and Web Push reminders.
- An installable PWA plus source for local Capacitor Android/iOS builds.

The student/trainer portal, body measurements, new starter plans, exercise notes, plate calculator,
and percentage/training-max programming described in [PLANEJAMENTO.md](PLANEJAMENTO.md) are future
work, not current features.

## Production deployment

You need [Docker](https://docs.docker.com/get-docker/) with the Compose plugin and an HTTPS reverse
proxy for the public hostname.

```bash
git clone https://github.com/KowalskiKGB/First
cd First
cp .env.example .env
docker compose -f docker-compose.yml up -d --build
```

The supplied `.env.example` targets `https://first.rocketxsistemas.com.br`. Review it before
starting the stack. The production Compose file builds from this checkout, keeps API data in the
named `first-data` volume, and exposes `web:80` only to Docker networks. Attach the TLS reverse
proxy to that network and route the public domain to the `web` service.

First does not publish or require prebuilt container images. See
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for proxy, passkey, backup, and update details.

## Local preview

Copy `.env.example` to `.env`, then change the local passkey origin:

```dotenv
RP_ID=localhost
ORIGIN=http://localhost:8080
VAPID_SUBJECT=mailto:admin@localhost
WEB_PORT=8080
```

Start the base stack with the loopback-only override:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Open <http://localhost:8080>. The local override binds only to `127.0.0.1`; use the HTTPS domain
for another device because passkeys do not work on a plain LAN-IP origin.

## Architecture

```text
browser / PWA
      │ HTTPS
      ▼
external TLS proxy
      │ HTTP on the Docker network
      ▼
web (nginx: static React app + /api proxy)
      │
      ▼
api (Node + WebAuthn) ── first-data volume (/data)
```

- `frontend/` — React 19, Vite, React Router, and Zustand.
- `api/` — Node HTTP API, passkeys, per-user JSON state, and Web Push.
- `Dockerfile` — multi-stage frontend build and nginx runtime image.
- `web/nginx.conf` — static app, same-origin API proxy, headers, and basic request limits.
- `docker-compose.yml` — production services and persistent volume.
- `docker-compose.local.yml` — loopback port binding used only for local preview.

## Configuration

All deployment settings come from `.env`; start with [.env.example](.env.example).

| Variable | Purpose | Template value |
|---|---|---|
| `RP_ID` | Exact hostname bound to passkeys | `first.rocketxsistemas.com.br` |
| `ORIGIN` | Exact public origin used by WebAuthn and cookies | `https://first.rocketxsistemas.com.br` |
| `RP_NAME` | Name shown in the passkey prompt | `First` |
| `ADMIN_UIDS` | Comma-separated administrator user ids | empty |
| `INVITE_ONLY` | Require an invite for new profiles (`1` enables it) | `0` |
| `SESSION_DAYS` | Lifetime of newly issued sessions | `30` |
| `VAPID_SUBJECT` | Contact URI for Web Push | public First URL |
| `WEB_PORT` | Loopback port in `docker-compose.local.yml` only | `8080` |

Changing `RP_ID` invalidates passkeys already registered for the old hostname. Choose the public
domain before creating production profiles.

## Exercise data and media

Exercise metadata and instructional text derived from
[`hasaneyldrm/exercises-dataset`](https://github.com/hasaneyldrm/exercises-dataset) are distributed
under that project's MIT license.

Exercise images and GIFs require a separate license from their copyright holder. They are not
included, downloaded, served, or enabled by First's default build or Compose deployment. A party
that enables or redistributes media must obtain the necessary rights independently. See
[NOTICE.md](NOTICE.md).

## Mobile builds

The repository retains Capacitor projects for local Android and iOS builds, but First does not
publish a signed APK or an iOS package. Build and signing instructions are in
[docs/MOBILE.md](docs/MOBILE.md). The standard mobile build also leaves exercise images and GIFs
disabled and absent.

## Contributing and security

- Development guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Bugs and agreed work: [GitHub Issues](https://github.com/KowalskiKGB/First/issues)
- Security reports: [SECURITY.md](SECURITY.md)
- Current roadmap: [PLANEJAMENTO.md](PLANEJAMENTO.md)

## License and source obligations

First's program code remains under the [GNU Affero General Public License v3.0](LICENSE). You may
run, inspect, modify, and redistribute it under that license. If you operate a modified version
for users over a network, AGPL section 13 requires offering those users the corresponding source
of the version they are using. The corresponding source for this independent version is
<https://github.com/KowalskiKGB/First>.

The AGPL does not license separately copyrighted exercise images or GIFs. Exercise metadata and
instructional text carry their upstream MIT terms, and all attribution and additional notices
remain in [NOTICE.md](NOTICE.md).
