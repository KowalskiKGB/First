# Contributing to First

Thanks for taking a look. First is an independent, AGPL-licensed version derived from
openGym. Keep changes small, dependency-light, and easy to self-host.

## Project layout

```text
frontend/  React + Vite app (including the optional Capacitor mobile shells).
api/       Node backend with WebAuthn and Web Push support.
Dockerfile builds the frontend and serves it through nginx.
web/       nginx configuration for the app and the /api proxy.
docs/      self-hosting and mobile build guides.
```

Exercise images and GIFs are not part of this repository or the default build. Do not add or
enable them without documenting a separate license from the relevant copyright holder. The
exercise metadata and instructional text derived from `hasaneyldrm/exercises-dataset` remain
under that project's MIT license; see [NOTICE.md](NOTICE.md).

## Running for development

For the complete local stack, copy the environment template, set `RP_ID=localhost` and
`ORIGIN=http://localhost:8080` in `.env`, then run:

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

The local override binds the app to `127.0.0.1:${WEB_PORT:-8080}`. For frontend hot reload and
tests:

```bash
cd frontend
npm install
npm run dev
npm test
```

## Guidelines

- Keep it dependency-light. The frontend uses React, React Router, Zustand, and Capacitor; the
  API uses `@simplewebauthn/server` and `web-push`.
- Match the existing style: small components, clear names, and comments only where the reason is
  not obvious. State belongs in the Zustand store; pure helpers belong in `frontend/src/lib`.
- Never commit runtime data, secrets, or unlicensed media.
- Test the flow you touched in a browser before opening a pull request.
- Training logic needs focused unit tests beside the helper it changes.

## Good first issues

The following are future work, not current features:

- Additional starter plans such as upper/lower, full-body, and 5x5.
- Percentage/training-max programming.
- Exercise notes and a plate calculator.
- Accessibility passes on workout and chart screens.

See [PLANEJAMENTO.md](PLANEJAMENTO.md) for the full roadmap.

## Where to ask what

Use [Issues](https://github.com/KowalskiKGB/First/issues) for questions, reproducible bugs, and
agreed work. Submit completed changes as pull requests.

When reporting a passkey problem, include `RP_ID` and `ORIGIN`, but never attach the contents of
the Docker data volume.

By contributing, you agree that your contribution is distributed under the project's
[GNU AGPL v3.0](LICENSE). Preserve the upstream attribution and third-party notices in
[NOTICE.md](NOTICE.md).
