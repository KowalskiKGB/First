#!/usr/bin/env bash
set -Eeuo pipefail

: "${FIRST_RESTORE_ARCHIVE:?FIRST_RESTORE_ARCHIVE must be an absolute validated first-data archive}"
: "${FIRST_HEALTH_URL:?FIRST_HEALTH_URL must be the public HTTPS /api/health URL}"
case "$FIRST_RESTORE_ARCHIVE" in
  /*) ;;
  *) echo "FIRST_RESTORE_ARCHIVE must be absolute" >&2; exit 64 ;;
esac
case "$FIRST_HEALTH_URL" in
  https://*/api/health) ;;
  *) echo "FIRST_HEALTH_URL must be an HTTPS /api/health URL" >&2; exit 64 ;;
esac

repo_dir=$(pwd -P)
archive_dir=$(cd -- "$(dirname -- "$FIRST_RESTORE_ARCHIVE")" && pwd -P)
archive="$archive_dir/$(basename -- "$FIRST_RESTORE_ARCHIVE")"
case "$archive_dir/" in
  "$repo_dir/"*) echo "FIRST_RESTORE_ARCHIVE must be outside the repository" >&2; exit 64 ;;
esac
test -f "$archive"

manifest=$(mktemp "${TMPDIR:-/tmp}/first-restore-manifest.XXXXXX")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stage_name=".first-restore-stage-$stamp-$$"
recovery_name=".first-recovery-$stamp-$$"
retired_name=".first-retired-$stamp-$$"
failed_name=".first-failed-$stamp-$$"
api_should_run=0
recovery_ready=0
swap_started=0

wait_for_health() {
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    if curl --fail --silent --show-error "$FIRST_HEALTH_URL" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

rollback_volume() {
  docker compose run --rm --no-deps --entrypoint sh api -ceu '
    recovery="/data/$1"
    failed="/data/$2"
    stage="/data/$3"
    retired="/data/$4"
    test -d "$recovery"
    test ! -e "$failed"
    mkdir -m 700 "$failed"
    for entry in /data/* /data/.[!.]* /data/..?*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      base=${entry##*/}
      case "$base" in .first-restore-stage-*|.first-recovery-*|.first-retired-*|.first-failed-*) continue ;; esac
      mv -- "$entry" "$failed/"
    done
    for entry in "$recovery"/* "$recovery"/.[!.]* "$recovery"/..?*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      cp -a -- "$entry" /data/
    done
    test -f /data/db.json
    test -f /data/secret
  ' -- "$recovery_name" "$failed_name" "$stage_name" "$retired_name"
}

restart_or_rollback() {
  status=$?
  trap - EXIT INT TERM
  rolled_back=0
  if [ "$status" -ne 0 ] && [ "$recovery_ready" -eq 1 ] && [ "$swap_started" -eq 1 ]; then
    docker compose stop api >/dev/null || true
    if rollback_volume; then
      rolled_back=1
      echo "Restore failed; the retained recovery copy was restored." >&2
    else
      status=1
      echo "Automatic rollback failed; keep the API stopped and inspect /data/$recovery_name." >&2
      api_should_run=0
    fi
  fi
  if [ "$api_should_run" -eq 1 ]; then
    if ! docker compose start api >/dev/null; then
      status=1
    elif [ "$rolled_back" -eq 1 ] && ! wait_for_health; then
      status=1
      echo "Rollback completed but the restored service did not become healthy." >&2
    fi
  fi
  rm -f -- "$manifest"
  exit "$status"
}
trap restart_or_rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Validate structure and traversal before stopping the live writer.
tar -tzf "$archive" > "$manifest"
test -s "$manifest"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$manifest"; then
  echo "Archive contains an unsafe path" >&2
  exit 65
fi
if grep -Eq '^(\./)?\.first-(restore-stage|recovery|retired|failed)-' "$manifest"; then
  echo "Archive contains release working data instead of only application data" >&2
  exit 65
fi
grep -Eq '^(\./)?db\.json/?$' "$manifest"
grep -Eq '^(\./)?secret/?$' "$manifest"

if ! docker compose ps --status running --services | grep -Fxq api; then
  echo "API must be running before restore so health and rollback can be verified" >&2
  exit 69
fi
api_should_run=1
docker compose stop api

# Extract completely into staging while the current /data remains untouched.
docker compose run --rm --no-deps --entrypoint sh api -ceu '
  case "$1" in .first-restore-stage-*) ;; *) exit 64 ;; esac
  stage="/data/$1"
  test ! -e "$stage"
  mkdir -m 700 "$stage"
  tar -C "$stage" -xzf -
  test -f "$stage/db.json"
  test -f "$stage/secret"
' -- "$stage_name" < "$archive"

# Retain a complete recovery copy before the first live path is moved.
docker compose run --rm --no-deps --entrypoint sh api -ceu '
  stage="/data/$1"
  recovery="/data/$2"
  test -d "$stage"
  test ! -e "$recovery"
  mkdir -m 700 "$recovery"
  for entry in /data/* /data/.[!.]* /data/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    base=${entry##*/}
    case "$base" in .first-restore-stage-*|.first-recovery-*|.first-retired-*|.first-failed-*) continue ;; esac
    cp -a -- "$entry" "$recovery/"
  done
  test -f "$recovery/db.json"
  test -f "$recovery/secret"
' -- "$stage_name" "$recovery_name" "$retired_name" "$failed_name"
recovery_ready=1

# Only now swap the validated staging data into /data. Any later error triggers rollback.
swap_started=1
docker compose run --rm --no-deps --entrypoint sh api -ceu '
  stage="/data/$1"
  recovery="/data/$2"
  retired="/data/$3"
  test -d "$stage"
  test -d "$recovery"
  test ! -e "$retired"
  mkdir -m 700 "$retired"
  for entry in /data/* /data/.[!.]* /data/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    base=${entry##*/}
    case "$base" in .first-restore-stage-*|.first-recovery-*|.first-retired-*|.first-failed-*) continue ;; esac
    mv -- "$entry" "$retired/"
  done
  for entry in "$stage"/* "$stage"/.[!.]* "$stage"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    mv -- "$entry" /data/
  done
  rmdir "$stage"
  test -f /data/db.json
  test -f /data/secret
' -- "$stage_name" "$recovery_name" "$retired_name" "$failed_name"

docker compose start api >/dev/null
if ! wait_for_health; then
  echo "Restored API did not become healthy; rolling back automatically." >&2
  exit 1
fi

# Health passed. Keep recovery until the application smoke passes; retired is now redundant.
swap_started=0
if ! docker compose run --rm --no-deps --entrypoint sh api -ceu '
  case "$1" in .first-retired-*) rm -rf -- "/data/$1" ;; *) exit 64 ;; esac
' -- "$retired_name"; then
  echo "Healthy restore completed; redundant retired data could not be removed." >&2
fi

trap - EXIT INT TERM
rm -f -- "$manifest"
printf 'Restore healthy. Retain recovery until final smoke: /data/%s\n' "$recovery_name"
