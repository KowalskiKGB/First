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
if ! archive=$(realpath "$FIRST_RESTORE_ARCHIVE"); then
  echo "FIRST_RESTORE_ARCHIVE could not be resolved" >&2
  exit 64
fi
case "$archive" in
  "$repo_dir"|"$repo_dir"/*) echo "FIRST_RESTORE_ARCHIVE must be outside the repository" >&2; exit 64 ;;
esac
test -f "$archive"
private_dir=""
snapshot=""
snapshot_write_open=0
snapshot_read_open=0
snapshot_fd_path=""
manifest=""
entry_types=""

cleanup_release_files() {
  local cleanup_status=0
  local release_file
  if [ "$snapshot_read_open" -eq 1 ]; then
    exec 9<&- || cleanup_status=1
    snapshot_read_open=0
  fi
  if [ "$snapshot_write_open" -eq 1 ]; then
    exec 8>&- || cleanup_status=1
    snapshot_write_open=0
  fi
  for release_file in "$manifest" "$entry_types"; do
    [ -n "$release_file" ] || continue
    rm -f -- "$release_file" || cleanup_status=1
  done
  if [ -n "$private_dir" ]; then
    rmdir -- "$private_dir" || cleanup_status=1
  fi
  return "$cleanup_status"
}

cleanup_early_exit() {
  local status=$?
  trap - EXIT INT TERM
  cleanup_release_files || status=1
  exit "$status"
}
trap cleanup_early_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
if ! private_root=$(realpath "${TMPDIR:-/tmp}"); then
  echo "Private restore runtime could not be resolved" >&2
  exit 64
fi
case "$private_root" in
  "$repo_dir"|"$repo_dir"/*) echo "Private restore runtime must be outside the repository" >&2; exit 64 ;;
esac
test -d "$private_root"
private_dir=$(mktemp -d "$private_root/first-restore-private.XXXXXX")
chmod 700 -- "$private_dir"
snapshot="$private_dir/snapshot"
set -C
if ! { exec 8> "$snapshot"; }; then
  set +C
  echo "Private restore snapshot could not be created exclusively" >&2
  exit 69
fi
set +C
snapshot_write_open=1
chmod 600 -- "$snapshot"
if [ ! -e /dev/fd/8 ]; then
  echo "Restore requires stable /dev/fd descriptor access" >&2
  exit 69
fi
rm -f -- "$snapshot"
snapshot=""
cat -- "$archive" >&8
exec 9< /dev/fd/8 # read-only snapshot descriptor
snapshot_read_open=1
exec 8>&-
snapshot_write_open=0
snapshot_fd_path=/dev/fd/9
if [ ! -r "$snapshot_fd_path" ]; then
  echo "Restore requires stable /dev/fd descriptor access" >&2
  exit 69
fi
manifest="$private_dir/manifest"
entry_types="$private_dir/entry-types"
: > "$manifest"
: > "$entry_types"
chmod 600 -- "$manifest" "$entry_types"
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
    if curl --fail --silent --show-error --connect-timeout 5 --max-time 10 "$FIRST_HEALTH_URL" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

stop_api_writer() {
  local running_services
  docker compose stop api >/dev/null || return 1
  running_services=$(docker compose ps --status running --services) || return 1
  ! printf '%s\n' "$running_services" | grep -Fxq api
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
    if ! stop_api_writer; then
      status=1
      api_should_run=0
      echo "Automatic rollback was not attempted: writer stop could not be confirmed; live data remains untouched. Preserve /data/$recovery_name and perform manual recovery." >&2
    elif rollback_volume; then
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
  if ! cleanup_release_files; then status=1; fi
  exit "$status"
}
trap restart_or_rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Validate structure, entry types, and traversal before stopping the live writer.
if ! tar -tzf "$snapshot_fd_path" > "$manifest" || ! LC_ALL=C tar -tvzf "$snapshot_fd_path" > "$entry_types"; then
  echo "Archive listing could not be parsed safely" >&2
  exit 65
fi
test -s "$manifest"
test -s "$entry_types"
if ! awk '
  substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { unsafe = 1 }
  index($0, " -> ") { unsafe = 1 }
  END { exit (NR == 0 || unsafe) }
' "$entry_types"; then
  echo "Archive contains a link or unsupported archive entry type" >&2
  exit 65
fi
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
if ! stop_api_writer; then
  api_should_run=0
  echo "API writer stop could not be confirmed; restore aborted without data changes." >&2
  exit 70
fi

# Extract completely into staging while the current /data remains untouched.
docker compose run --rm --no-deps --entrypoint sh api -ceu '
  case "$1" in .first-restore-stage-*) ;; *) exit 64 ;; esac
  stage="/data/$1"
  test ! -e "$stage"
  mkdir -m 700 "$stage"
  tar -C "$stage" -xzf -
  invalid_entries=$(find "$stage" -mindepth 1 ! -type d ! -type f -exec printf x \;) || exit 65
  test -z "$invalid_entries"
  hardlinked_files=$(find "$stage" -type f -links +1 -exec printf x \;) || exit 65
  test -z "$hardlinked_files"
  test -f "$stage/db.json"
  test ! -L "$stage/db.json"
  test -f "$stage/secret"
  test ! -L "$stage/secret"
' -- "$stage_name" < "$snapshot_fd_path"

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
  test ! -L "$recovery/db.json"
  test -f "$recovery/secret"
  test ! -L "$recovery/secret"
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
  test ! -L /data/db.json
  test -f /data/secret
  test ! -L /data/secret
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

cleanup_release_files
trap - EXIT INT TERM
printf 'Restore healthy. Retain recovery until final smoke: /data/%s\n' "$recovery_name"
