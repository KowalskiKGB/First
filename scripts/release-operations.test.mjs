import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('release backup and restore fail closed around the single JSON writer', () => {
  const runbook = read('docs/SELF_HOSTING.md')
  const backup = read('scripts/backup-first-data.sh')
  const restore = read('scripts/restore-first-data.sh')

  assert.match(runbook, /FIRST_BACKUP_DIR/)
  assert.match(runbook, /scripts\/backup-first-data\.sh/)
  assert.match(runbook, /FIRST_RESTORE_ARCHIVE/)
  assert.match(runbook, /scripts\/restore-first-data\.sh/)
  assert.match(backup, /set -Eeuo pipefail/)
  assert.match(backup, /FIRST_BACKUP_DIR:\?/)
  assert.match(backup, /FIRST_BACKUP_DIR[^\n]+absolute/i)
  assert.match(backup, /backup_dir[^\n]+pwd -P/)
  assert.match(backup, /repo_dir[^\n]+pwd -P/)
  assert.match(backup, /\.partial/)
  assert.match(backup, /docker compose stop api/)
  assert.match(backup, /running_services=\$\(docker compose ps --status running --services\)/)
  assert.match(backup, /trap restart_api EXIT/)
  assert.match(backup, /tar -tzf/)
  assert.match(backup, /mv -- [^\n]+partial[^\n]+backup/)
  assert.match(backup, /--exclude='\.\/\.first-recovery-\*'/)

  assert.match(restore, /set -Eeuo pipefail/)
  assert.match(restore, /FIRST_RESTORE_ARCHIVE:\?/)
  assert.match(restore, /restore-stage/)
  assert.match(restore, /recovery/)
  assert.match(restore, /rollback_volume/)
  assert.match(restore, /\.first-\(restore-stage\|recovery\|retired\|failed\)-/)
  assert.match(restore, /curl --fail --silent --show-error --connect-timeout [1-9][0-9]* --max-time [1-9][0-9]*/)
  assert.match(restore, /realpath -- "\$FIRST_RESTORE_ARCHIVE"/)
  assert.match(restore, /snapshot=.*mktemp[^\n]+\.first-restore-snapshot/)
  assert.match(restore, /chmod 600[^\n]+snapshot/)
  assert.match(restore, /tar -tvzf/)
  assert.match(restore, /tar -tzf "\$snapshot"/)
  assert.match(restore, /< "\$snapshot"/)
  assert.match(restore, /stat -c %h/)
  assert.match(restore, /! -type d ! -type f/)
  assert.match(restore, /writer stop could not be confirmed/i)
  const validate = restore.indexOf('tar -tzf "$archive"')
  const stop = restore.indexOf('if ! stop_api_writer', validate)
  const extract = restore.indexOf('# Extract completely')
  const retainRecovery = restore.indexOf('# Retain a complete recovery copy')
  const swap = restore.indexOf('# Only now swap')
  assert.ok(validate >= 0 && validate < stop, 'restore archive must be validated before API stop')
  assert.ok(extract >= 0 && extract < retainRecovery && retainRecovery < swap, 'extract and recovery must finish before swap')
  assert.doesNotMatch(runbook, /release_backup_dir=\.\/backups/)
  assert.doesNotMatch(runbook, /find \/data[^\n]+rm -rf/)
  assert.match(runbook, /symbolic links and hard links|symlinks e hardlinks/i)
  assert.match(runbook, /connect-timeout|bounded health/i)
  assert.match(runbook, /parada do writer[^\n]+confirmada|writer stop cannot be confirmed/i)
})

test('release-only local artifacts have narrow defensive ignore rules', () => {
  const ignore = read('.gitignore')

  assert.match(ignore, /^backups\/$/m)
  assert.match(ignore, /^first-data-\*\.tgz(?:\.partial)?$/m)
  assert.match(ignore, /^tmp-first-release-secrets\.json$/m)
})

test('security documentation describes the minimal public health response', () => {
  const security = read('SECURITY.md')

  assert.match(security, /`\/api\/health`[^\n]+`\{"ok":true\}`/)
  assert.doesNotMatch(security, /`\/api\/health`[^\n]+total user count/i)
})
