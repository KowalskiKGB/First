#!/usr/bin/env bash
set -Eeuo pipefail

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

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$backup_dir/first-data-$stamp.tgz"
partial="$backup_dir/.first-data-$stamp.tgz.partial"
test ! -e "$backup"
test ! -e "$partial"

api_was_running=0
running_services=$(docker compose ps --status running --services)
if printf '%s\n' "$running_services" | grep -Fxq api; then
  api_was_running=1
fi

restart_api() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "${partial:-}" ]; then rm -f -- "$partial"; fi
  if [ "$api_was_running" -eq 1 ] && ! docker compose start api >/dev/null; then status=1; fi
  exit "$status"
}
trap restart_api EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Quiesce the only JSON writer before reading any file from first-data.
docker compose stop api
docker compose run --rm --no-deps --entrypoint tar api -C /data \
  --exclude='./.first-restore-stage-*' \
  --exclude='./.first-recovery-*' \
  --exclude='./.first-retired-*' \
  --exclude='./.first-failed-*' \
  -czf - . > "$partial"
test -s "$partial"
tar -tzf "$partial" >/dev/null

# Same-directory rename publishes only a complete, validated archive.
mv -- "$partial" "$backup"
partial=
printf 'Validated backup created: %s\n' "$backup"
