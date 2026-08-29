# Multi-stage: build the React app, then serve it with nginx.
# Self-hosters never need Node locally — `docker compose up` builds everything.
#
# --platform=$BUILDPLATFORM pins the build stage to the host's native arch even when
# cross-building for other targets (e.g. amd64 host building an arm64 image). The build
# output (static JS/CSS/HTML) is arch-independent, so there's no reason to run it under
# QEMU — and QEMU-emulated npm installs are known to corrupt esbuild/rollup's platform-
# specific native binaries, which is what breaks `vite build` with unrelated-looking
# module-resolution errors.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_EXERCISE_MEDIA=0
ARG VITE_IMG_BASE=img/
ARG VITE_GIF_BASE=gif/
ENV VITE_EXERCISE_MEDIA=$VITE_EXERCISE_MEDIA \
    VITE_IMG_BASE=$VITE_IMG_BASE \
    VITE_GIF_BASE=$VITE_GIF_BASE
RUN npm run build

FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Exercise media is intentionally absent unless a licensed deployment enables it.
