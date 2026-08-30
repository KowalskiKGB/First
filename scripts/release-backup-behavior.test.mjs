import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const backupScript = path.join(root, 'scripts', 'backup-first-data.sh')
const bash = process.env.FIRST_TEST_BASH
  || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash')
const stamp = '20260830T120000Z'

function shellPath(value) {
  const resolved = path.resolve(value)
  if (process.platform !== 'win32') return resolved
  return resolved.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll('\\', '/')
}

function writeExecutable(target, contents) {
  writeFileSync(target, contents.replace(/^\n/, ''), 'utf8')
  chmodSync(target, 0o755)
}

function bashResult(script, ...values) {
  return spawnSync(bash, ['-c', script, 'backup-test', ...values.map(shellPath)], { encoding: 'utf8' })
}

function modeOf(target) {
  const result = bashResult('stat -c %a "$1"', target)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function eventsFrom(target) {
  return readFileSync(target, 'utf8').trim().split(/\r?\n/).filter(Boolean)
}

function createHarness(t, { apiRunning = true, data = 'valid' } = {}) {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-backup-behavior-'))
  t.after(() => rmSync(sandbox, { recursive: true, force: true }))
  const repo = path.join(sandbox, 'repo')
  const backupDir = path.join(sandbox, 'backups')
  const dataDir = path.join(sandbox, 'data')
  const fakeBin = path.join(sandbox, 'bin')
  const barrier = path.join(sandbox, 'barrier')
  const events = path.join(sandbox, 'events.log')
  const apiState = path.join(sandbox, 'api-state')
  const publishMarker = path.join(sandbox, 'publish-replaced')
  const runner = path.join(sandbox, 'run-backup.sh')
  const finalPath = path.join(backupDir, `first-data-${stamp}.tgz`)
  const unrelated = path.join(backupDir, '.first-backup-private-unowned')

  mkdirSync(repo)
  mkdirSync(backupDir)
  mkdirSync(fakeBin)
  mkdirSync(barrier)
  mkdirSync(unrelated)
  writeFileSync(path.join(unrelated, 'keep'), 'external\n')
  writeFileSync(events, '')
  writeFileSync(apiState, apiRunning ? 'running\n' : 'stopped\n')
  if (data !== 'absent') {
    mkdirSync(dataDir)
    if (data === 'valid') {
      writeFileSync(path.join(dataDir, 'db.json'), '{}\n')
      writeFileSync(path.join(dataDir, 'secret'), 'fixture-only\n')
    }
  }
  const chmodResult = bashResult('chmod 755 "$1"', backupDir)
  assert.equal(chmodResult.status, 0, chmodResult.stderr)

  writeExecutable(runner, String.raw`
#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
export FIRST_FAKE_REAL_PATH=$PATH
export PATH="$FIRST_FAKE_BIN:$PATH"
cd "$FIRST_FAKE_REPO"
exec "$FIRST_BACKUP_SCRIPT"
`)

  writeExecutable(path.join(fakeBin, 'date'), String.raw`
#!/usr/bin/env bash
printf '%s\n' "$FIRST_FAKE_STAMP"
`)

  writeExecutable(path.join(fakeBin, 'tar'), String.raw`
#!/usr/bin/env bash
set -u
PATH="$FIRST_FAKE_REAL_PATH" tar "$@"
status=$?
if [ "$status" -eq 0 ] && [ -n "${'$'}{FIRST_FAKE_PUBLISH_TARGET:-}" ] \
  && [ ! -e "$FIRST_FAKE_PUBLISH_MARKER" ]; then
  (set -C; printf '%s\n' 'external replacement' > "$FIRST_FAKE_PUBLISH_TARGET") || exit 95
  : > "$FIRST_FAKE_PUBLISH_MARKER"
  printf '%s\n' publish-replaced >> "$FIRST_FAKE_EVENTS"
fi
exit "$status"
`)

  writeExecutable(path.join(fakeBin, 'docker'), String.raw`
#!/usr/bin/env bash
set -u
instance=${'$'}{FIRST_FAKE_INSTANCE:-single}
[ "${'$'}{1:-}" = compose ] || exit 90
shift
command=${'$'}{1:-}
shift || true
printf '%s:%s\n' "$instance" "$command" >> "$FIRST_FAKE_EVENTS"
case "$command" in
  ps)
    was_running=0
    if grep -Fxq running "$FIRST_FAKE_API_STATE"; then was_running=1; fi
    if [ "${'$'}{FIRST_FAKE_PS_BARRIER:-0}" = 1 ]; then
      : > "$FIRST_FAKE_BARRIER/$instance"
      attempts=0
      while { [ ! -e "$FIRST_FAKE_BARRIER/one" ] || [ ! -e "$FIRST_FAKE_BARRIER/two" ]; } \
        && [ "$attempts" -lt 100 ]; do
        attempts=$((attempts + 1))
        sleep 0.01
      done
    fi
    if [ "$was_running" -eq 1 ]; then printf '%s\n' api; fi
    ;;
  stop)
    printf '%s\n' stopped > "$FIRST_FAKE_API_STATE"
    ;;
  start)
    printf '%s\n' running > "$FIRST_FAKE_API_STATE"
    ;;
  run)
    if [ ! -d "$FIRST_FAKE_DATA" ]; then exit 44; fi
    PATH="$FIRST_FAKE_REAL_PATH" tar -C "$FIRST_FAKE_DATA" -czf - .
    ;;
  *) exit 91 ;;
esac
`)

  const environment = (instance = 'single', extra = {}) => ({
    ...process.env,
    FIRST_BACKUP_DIR: shellPath(backupDir),
    FIRST_BACKUP_SCRIPT: shellPath(backupScript),
    FIRST_FAKE_API_STATE: shellPath(apiState),
    FIRST_FAKE_BARRIER: shellPath(barrier),
    FIRST_FAKE_BIN: shellPath(fakeBin),
    FIRST_FAKE_DATA: shellPath(dataDir),
    FIRST_FAKE_EVENTS: shellPath(events),
    FIRST_FAKE_INSTANCE: instance,
    FIRST_FAKE_PUBLISH_MARKER: shellPath(publishMarker),
    FIRST_FAKE_REPO: shellPath(repo),
    FIRST_FAKE_STAMP: stamp,
    ...extra,
  })

  function run(extra = {}) {
    return spawnSync(bash, [shellPath(runner)], {
      encoding: 'utf8',
      env: environment('single', extra),
    })
  }

  function runAsync(instance, extra = {}) {
    const child = spawn(bash, [shellPath(runner)], { env: environment(instance, extra) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    return new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', status => resolve({ status, stderr, stdout }))
    })
  }

  return { apiState, backupDir, events, finalPath, run, runAsync, unrelated }
}

function assertPrivateResult(harness, expectedFiles) {
  assert.equal(modeOf(harness.backupDir), '700')
  assert.deepEqual(readdirSync(harness.backupDir).sort(), [...expectedFiles, path.basename(harness.unrelated)].sort())
  assert.equal(readFileSync(path.join(harness.unrelated, 'keep'), 'utf8'), 'external\n')
}

test('backup publishes a 0600 archive from a 0700 directory and restarts a running API', t => {
  const harness = createHarness(t)
  const result = harness.run()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(modeOf(harness.finalPath), '600')
  assertPrivateResult(harness, [path.basename(harness.finalPath)])
  const listing = bashResult('tar -tzf "$1"', harness.finalPath)
  assert.equal(listing.status, 0, listing.stderr)
  assert.match(listing.stdout, /(^|\n)\.\/db\.json(\r?\n|$)/)
  assert.match(listing.stdout, /(^|\n)\.\/secret(\r?\n|$)/)
  assert.deepEqual(eventsFrom(harness.events), ['single:ps', 'single:stop', 'single:run', 'single:start'])
  assert.equal(readFileSync(harness.apiState, 'utf8'), 'running\n')
})

test('backup leaves an originally stopped API stopped', t => {
  const harness = createHarness(t, { apiRunning: false })
  const result = harness.run()

  assert.equal(result.status, 0, result.stderr)
  assertPrivateResult(harness, [path.basename(harness.finalPath)])
  assert.deepEqual(eventsFrom(harness.events), ['single:ps', 'single:stop', 'single:run'])
  assert.equal(readFileSync(harness.apiState, 'utf8'), 'stopped\n')
})

test('backup rejects an empty data volume and restores a running API', t => {
  const harness = createHarness(t, { data: 'empty' })
  const result = harness.run()

  assert.notEqual(result.status, 0, result.stdout)
  assert.equal(existsSync(harness.finalPath), false)
  assertPrivateResult(harness, [])
  assert.ok(eventsFrom(harness.events).includes('single:start'))
  assert.equal(readFileSync(harness.apiState, 'utf8'), 'running\n')
})

test('backup rejects an absent data volume and removes only its private state', t => {
  const harness = createHarness(t, { data: 'absent' })
  const result = harness.run()

  assert.notEqual(result.status, 0, result.stdout)
  assert.equal(existsSync(harness.finalPath), false)
  assertPrivateResult(harness, [])
  assert.ok(eventsFrom(harness.events).includes('single:start'))
  assert.equal(readFileSync(harness.apiState, 'utf8'), 'running\n')
})

test('backup lock admits only one concurrent invocation', { timeout: 15_000 }, async t => {
  const harness = createHarness(t)
  const extra = { FIRST_FAKE_PS_BARRIER: '1' }
  const results = await Promise.all([
    harness.runAsync('one', extra),
    harness.runAsync('two', extra),
  ])

  assert.equal(results.filter(result => result.status === 0).length, 1, JSON.stringify(results))
  assert.equal(eventsFrom(harness.events).filter(event => event.endsWith(':ps')).length, 1)
  assert.equal(existsSync(harness.finalPath), true)
  assertPrivateResult(harness, [path.basename(harness.finalPath)])
  assert.equal(readFileSync(harness.apiState, 'utf8'), 'running\n')
})

test('backup publication never overwrites a target created after validation', t => {
  const harness = createHarness(t)
  const result = harness.run({ FIRST_FAKE_PUBLISH_TARGET: shellPath(harness.finalPath) })

  assert.notEqual(result.status, 0, result.stdout)
  assert.equal(readFileSync(harness.finalPath, 'utf8'), 'external replacement\n')
  assert.ok(eventsFrom(harness.events).includes('publish-replaced'))
  assertPrivateResult(harness, [path.basename(harness.finalPath)])
  assert.ok(eventsFrom(harness.events).includes('single:start'))
  assert.equal(readFileSync(harness.apiState, 'utf8'), 'running\n')
})
