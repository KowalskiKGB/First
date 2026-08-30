#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${FIRST_BACKUP_DIR:?FIRST_BACKUP_DIR must be an absolute directory outside the repository}"
case "$FIRST_BACKUP_DIR" in
  /*) ;;
  *) echo "FIRST_BACKUP_DIR must be absolute" >&2; exit 64 ;;
esac

repo_dir=$(pwd -P)
mkdir -p -- "$FIRST_BACKUP_DIR"
backup_dir=$(cd -- "$FIRST_BACKUP_DIR" && pwd -P)
case "$backup_dir/" in
  "$repo_dir/"*) echo "FIRST_BACKUP_DIR must be outside the repository" >&2; exit 64 ;;
esac
if [ ! -O "$backup_dir" ]; then
  echo "FIRST_BACKUP_DIR must be owned by the current user" >&2
  exit 77
fi
chmod 700 -- "$backup_dir"

lock_dir="$backup_dir/.first-backup.lock"
lock_owned=0
private_dir=""
partial=""
manifest=""
entry_types=""
archive_fd_open=0
api_was_running=0

finish_backup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$archive_fd_open" -eq 1 ]; then exec 8>&- || status=1; fi
  if [ -n "$partial" ] && ! rm -f -- "$partial"; then status=1; fi
  if [ -n "$manifest" ] && ! rm -f -- "$manifest"; then status=1; fi
  if [ -n "$entry_types" ] && ! rm -f -- "$entry_types"; then status=1; fi
  if [ -n "$private_dir" ] && ! rmdir -- "$private_dir"; then status=1; fi
  if [ "$api_was_running" -eq 1 ] && ! docker compose start api >/dev/null; then status=1; fi
  if [ "$lock_owned" -eq 1 ] && ! rmdir -- "$lock_dir"; then status=1; fi
  exit "$status"
}

stop_api_writer() {
  local running_services
  docker compose stop api >/dev/null || return 1
  running_services=$(docker compose ps --status running --services) || return 1
  ! printf '%s\n' "$running_services" | grep -Fxq api
}

if ! mkdir -m 700 -- "$lock_dir"; then
  echo "Another backup is already in progress; remove $lock_dir only after confirming no backup is running." >&2
  exit 75
fi
lock_owned=1
trap finish_backup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$backup_dir/first-data-$stamp.tgz"
if [ -e "$backup" ] || [ -L "$backup" ]; then
  echo "Backup destination already exists: $backup" >&2
  exit 73
fi

private_dir=$(mktemp -d "$backup_dir/.first-backup-private.XXXXXX")
chmod 700 -- "$private_dir"
partial="$private_dir/archive.tgz"
manifest="$private_dir/manifest"
entry_types="$private_dir/entry-types"
set -C
if ! { exec 8> "$partial"; }; then
  set +C
  echo "Private backup archive could not be created exclusively" >&2
  exit 73
fi
set +C
archive_fd_open=1
chmod 600 -- "$partial"

running_services=$(docker compose ps --status running --services)
if printf '%s\n' "$running_services" | grep -Fxq api; then
  api_was_running=1
fi

# Quiesce the only JSON writer before reading any file from first-data.
if ! stop_api_writer; then
  echo "API writer stop could not be confirmed; backup aborted without reading data." >&2
  exit 70
fi
docker compose run --rm --no-deps --entrypoint tar api -C /data \
  --exclude='./.first-restore-stage-*' \
  --exclude='./.first-recovery-*' \
  --exclude='./.first-retired-*' \
  --exclude='./.first-failed-*' \
  -czf - . >&8
exec 8>&-
archive_fd_open=0
test -s "$partial"
if ! tar -tzf "$partial" > "$manifest" || ! LC_ALL=C tar -tvzf "$partial" > "$entry_types"; then
  echo "Backup archive could not be listed" >&2
  exit 65
fi
chmod 600 -- "$manifest" "$entry_types"
if ! awk '
  function application_path(value) {
    sub(/^\.\//, "", value)
    sub(/\/$/, "", value)
    return value
  }
  {
    type = substr($0, 1, 1)
    name = application_path($NF)
    if (type != "-" && type != "d") unsafe = 1
    if (index($0, " -> ") || index($0, " link to ")) unsafe = 1
    if (name == "db.json" || name == "collaboration.json" || name == "secret") {
      if (type != "-") required_wrong_type = 1
      else if (name == "db.json") db += 1
      else if (name == "collaboration.json") collaboration += 1
      else secret += 1
    }
  }
  END {
    valid_store = (db == 1 || collaboration == 1) && db <= 1 && collaboration <= 1
    exit !(NR > 0 && !unsafe && !required_wrong_type && secret == 1 && valid_store)
  }
' "$entry_types"; then
  echo "Backup archive must contain one regular secret and a regular db.json or collaboration.json, without links or special entries" >&2
  exit 65
fi

# Same-filesystem hardlink publication fails instead of overwriting a racing destination.
if ! ln -T -- "$partial" "$backup"; then
  echo "Backup destination appeared before publication: $backup" >&2
  exit 73
fi
rm -f -- "$partial"
partial=
rm -f -- "$manifest"
manifest=
rm -f -- "$entry_types"
entry_types=
rmdir -- "$private_dir"
private_dir=
printf 'Validated backup created: %s\n' "$backup"
