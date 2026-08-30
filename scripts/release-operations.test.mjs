import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('release backup and restore fail closed around the single JSON writer', () => {
  const runbook = read('docs/SELF_HOSTING.md')

  assert.match(runbook, /set -Eeuo pipefail/)
  assert.match(runbook, /FIRST_BACKUP_DIR:\?/)
  assert.match(runbook, /FIRST_BACKUP_DIR[^\n]+absolute/i)
  assert.match(runbook, /backup_dir[^\n]+pwd -P/)
  assert.match(runbook, /repo_dir[^\n]+pwd -P/)
  assert.match(runbook, /\.partial/)
  assert.match(runbook, /docker compose stop api/)
  assert.match(runbook, /trap [^\n]+restart/i)
  assert.match(runbook, /tar -tzf/)
  assert.match(runbook, /mv -- [^\n]+partial[^\n]+backup/)

  assert.match(runbook, /FIRST_RESTORE_ARCHIVE:\?/)
  assert.match(runbook, /restore-stage/)
  assert.match(runbook, /recovery/)
  assert.match(runbook, /validate_archive_before_stop=1/)
  assert.match(runbook, /swap_only_after_extract=1/)
  assert.match(runbook, /rollback_on_failed_health=1/)
  assert.match(runbook, /curl --fail --silent --show-error/)
  assert.doesNotMatch(runbook, /release_backup_dir=\.\/backups/)
  assert.doesNotMatch(runbook, /find \/data[^\n]+rm -rf/)
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
