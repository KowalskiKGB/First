import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))
const restoreScript = path.join(root, 'scripts', 'restore-first-data.sh')
const bash = process.env.FIRST_TEST_BASH
  || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash')

function shellPath(value) {
  const resolved = path.resolve(value)
  if (process.platform !== 'win32') return resolved
  return resolved.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll('\\', '/')
}

function putString(buffer, value, offset, length) {
  buffer.write(value, offset, Math.min(Buffer.byteLength(value), length), 'utf8')
}

function putOctal(buffer, value, offset, length) {
  putString(buffer, `${value.toString(8).padStart(length - 1, '0')}\0`, offset, length)
}

function tarEntry({ name, type = '0', link = '', body = '' }) {
  const content = Buffer.from(body)
  const header = Buffer.alloc(512)
  putString(header, name, 0, 100)
  putOctal(header, type === '2' ? 0o777 : 0o600, 100, 8)
  putOctal(header, 0, 108, 8)
  putOctal(header, 0, 116, 8)
  putOctal(header, type === '0' ? content.length : 0, 124, 12)
  putOctal(header, 0, 136, 12)
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  putString(header, link, 157, 100)
  putString(header, 'ustar\0', 257, 6)
  putString(header, '00', 263, 2)
  let checksum = 0
  for (const byte of header) checksum += byte
  putString(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  return Buffer.concat([header, content, padding])
}

function writeArchive(target, extraEntries = [], dbBody = '{}\n') {
  const entries = [
    { name: 'db.json', body: dbBody },
    { name: 'secret', body: 'fixture-only\n' },
    ...extraEntries,
  ]
  const tar = Buffer.concat([...entries.map(tarEntry), Buffer.alloc(1024)])
  writeFileSync(target, gzipSync(tar))
}

function writeExecutable(target, contents) {
  writeFileSync(target, contents.replace(/^\n/, ''), 'utf8')
  chmodSync(target, 0o755)
}

function createHarness(t, extraEntries = []) {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-restore-behavior-'))
  t.after(() => rmSync(sandbox, { recursive: true, force: true }))
  const archive = path.join(sandbox, 'first-data-fixture.tgz')
  const events = path.join(sandbox, 'events.log')
  const stopCount = path.join(sandbox, 'stop-count')
  const apiState = path.join(sandbox, 'api-state')
  const replaceMarker = path.join(sandbox, 'archive-replaced')
  const snapshotPathRecord = path.join(sandbox, 'snapshot-path')
  const fakeBin = path.join(sandbox, 'bin')
  const runtimeRoot = path.join(sandbox, 'runtime')
  const stageBin = path.join(sandbox, 'stage-bin')
  const stageData = path.join(sandbox, 'stage-data')
  const runner = path.join(sandbox, 'run-restore.sh')
  mkdirSync(fakeBin)
  mkdirSync(runtimeRoot, { mode: 0o700 })
  mkdirSync(stageBin)
  mkdirSync(stageData)
  writeArchive(archive, extraEntries)
  writeFileSync(events, '')
  writeFileSync(stopCount, '0\n')
  writeFileSync(apiState, 'running\n')
  writeExecutable(runner, '#!/usr/bin/env bash\nset -Eeuo pipefail\nexport PATH="$FIRST_FAKE_BIN:$PATH"\nexec "$FIRST_RESTORE_SCRIPT"\n')

  writeExecutable(path.join(fakeBin, 'docker'), String.raw`
#!/usr/bin/env bash
set -u
events=$FIRST_FAKE_EVENTS
if [ "${'$'}{1:-}" != compose ]; then exit 90; fi
shift
command=${'$'}{1:-}
shift || true
case "$command" in
  ps)
    printf '%s\n' ps >> "$events"
    if [ -n "${'$'}{FIRST_FAKE_REPLACEMENT_ARCHIVE:-}" ] && [ ! -e "$FIRST_FAKE_REPLACE_MARKER" ]; then
      /usr/bin/cp -- "$FIRST_FAKE_REPLACEMENT_ARCHIVE" "$FIRST_FAKE_REPLACE_SOURCE"
      : > "$FIRST_FAKE_REPLACE_MARKER"
      printf '%s\n' archive-replaced >> "$events"
    fi
    if grep -Fxq running "$FIRST_FAKE_API_STATE"; then printf '%s\n' api; fi
    ;;
  stop)
    count=$(cat "$FIRST_FAKE_STOP_COUNT")
    count=$((count + 1))
    printf '%s\n' "$count" > "$FIRST_FAKE_STOP_COUNT"
    printf 'stop:%s\n' "$count" >> "$events"
    if { [ "${'$'}{FIRST_FAKE_STOP_MODE:-}" = initial ] && [ "$count" -eq 1 ]; } \
      || { [ "${'$'}{FIRST_FAKE_STOP_MODE:-}" = rollback ] && [ "$count" -ge 2 ]; }; then
      printf 'stop-failed:%s\n' "$count" >> "$events"
      exit 42
    fi
    if [ "${'$'}{FIRST_FAKE_STOP_MODE:-}" = unconfirmed ] && [ "$count" -eq 1 ]; then
      printf '%s\n' stop-unconfirmed >> "$events"
      exit 0
    fi
    printf '%s\n' stopped > "$FIRST_FAKE_API_STATE"
    ;;
  start)
    printf '%s\n' start >> "$events"
    printf '%s\n' running > "$FIRST_FAKE_API_STATE"
    ;;
  run)
    all="$*"
    if [[ "$all" == *'failed="/data/$2"'* ]]; then
      printf '%s\n' rollback-mutate-attempt >> "$events"
      if [ "${'$'}{FIRST_FAKE_ROLLBACK_FAIL:-0}" = 1 ]; then exit 43; fi
      printf '%s\n' rollback-mutate >> "$events"
    elif [[ "$all" == *'tar -C "$stage" -xzf -'* ]]; then
      printf '%s\n' extract >> "$events"
      if [ "${'$'}{FIRST_FAKE_EXECUTE_STAGE_VALIDATION:-0}" = 1 ]; then
        stage_script=
        previous=
        for argument in "$@"; do
          if [ "$previous" = -ceu ]; then stage_script=$argument; previous=; continue; fi
          if [ "$argument" = -ceu ]; then previous=-ceu; fi
        done
        stage_name=${'$'}{@: -1}
        translated=${'$'}{stage_script//\/data/$FIRST_FAKE_STAGE_DATA}
        PATH="$FIRST_FAKE_STAGE_BIN:$PATH" /bin/sh -ceu "$translated" -- "$stage_name"
        exit $?
      fi
      if [ -n "${'$'}{FIRST_FAKE_EXTRACTED_ARCHIVE:-}" ]; then
        cat > "$FIRST_FAKE_EXTRACTED_ARCHIVE"
      fi
      if [ -s "$FIRST_FAKE_SNAPSHOT_PATH_RECORD" ]; then
        snapshot_path=$(cat "$FIRST_FAKE_SNAPSHOT_PATH_RECORD")
        case "$snapshot_path" in
          "$FIRST_FAKE_RUNTIME_ROOT"/first-restore-private.*/snapshot) ;;
          *) exit 94 ;;
        esac
        [ -f "$snapshot_path" ] || exit 94
        /bin/rm -f -- "$snapshot_path" || exit $?
        printf '%s\n' snapshot-race-cleaned >> "$events"
      fi
    elif [[ "$all" == *'cp -a -- "$entry" "$recovery/"'* ]]; then
      printf '%s\n' recovery >> "$events"
    elif [[ "$all" == *'mv -- "$entry" /data/'* ]]; then
      printf '%s\n' swap >> "$events"
    elif [[ "$all" == *'rm -rf -- "/data/$1"'* ]]; then
      printf '%s\n' cleanup >> "$events"
    else
      printf '%s\n' unknown-run >> "$events"
      exit 91
    fi
    ;;
  *) exit 92 ;;
esac
`)

  writeExecutable(path.join(fakeBin, 'rm'), String.raw`
#!/usr/bin/env bash
set -u
snapshot=
for candidate in "$@"; do
  case "$candidate" in
    "$FIRST_FAKE_RUNTIME_ROOT"/first-restore-private.*/snapshot) snapshot=$candidate ;;
  esac
done
if [ -n "$snapshot" ]; then
  private_dir=${'$'}{snapshot%/snapshot}
  printf 'private-mode:%s\n' "$(stat -c %a "$private_dir")" >> "$FIRST_FAKE_EVENTS"
  printf 'snapshot-mode:%s\n' "$(stat -c %a "$snapshot")" >> "$FIRST_FAKE_EVENTS"
  if [ "${'$'}{FIRST_FAKE_CHECK_UNPRIVILEGED:-0}" = 1 ]; then
    if su nobody -s /bin/sh -c "test ! -r '$snapshot' && test ! -x '$private_dir'"; then
      printf '%s\n' private-access-denied >> "$FIRST_FAKE_EVENTS"
    else
      printf '%s\n' private-accessible >> "$FIRST_FAKE_EVENTS"
    fi
  fi
  /bin/rm "$@" || exit $?
  if [ ! -e "$snapshot" ]; then printf '%s\n' snapshot-path-absent >> "$FIRST_FAKE_EVENTS"; fi
  if [ -n "${'$'}{FIRST_FAKE_SNAPSHOT_REPLACEMENT:-}" ]; then
    /bin/cp -- "$FIRST_FAKE_SNAPSHOT_REPLACEMENT" "$snapshot" || exit $?
    [ -f "$snapshot" ] || exit 94
    printf '%s\n' "$snapshot" > "$FIRST_FAKE_SNAPSHOT_PATH_RECORD" || exit $?
    printf '%s\n' snapshot-replaced >> "$FIRST_FAKE_EVENTS"
  fi
  exit 0
fi
exec /bin/rm "$@"
`)

  writeExecutable(path.join(stageBin, 'tar'), String.raw`
#!/usr/bin/env bash
set -u
if [ "${'$'}{1:-}" = -C ]; then
  stage=$2
  cat >/dev/null
  printf '%s\n' '{}' > "$stage/db.json"
  printf '%s\n' fixture-only > "$stage/secret"
  exit 0
fi
exec /usr/bin/tar "$@"
`)

  writeExecutable(path.join(stageBin, 'find'), String.raw`
#!/usr/bin/env bash
set -u
if [ "${'$'}{FIRST_FAKE_STAGE_FIND_FAIL:-0}" = 1 ]; then
  printf '%s\n' find-failed-empty >> "$FIRST_FAKE_EVENTS"
  exit 47
fi
exec /usr/bin/find "$@"
`)

  writeExecutable(path.join(stageBin, 'mkdir'), String.raw`
#!/usr/bin/env bash
set -u
if [ "${'$'}{1:-}" = -m ]; then shift 2; fi
exec /bin/mkdir "$@"
`)

  writeExecutable(path.join(fakeBin, 'curl'), String.raw`
#!/usr/bin/env bash
printf 'curl:%s\n' "$*" >> "$FIRST_FAKE_EVENTS"
case "${'$'}{FIRST_FAKE_HEALTH_MODE:-success}" in
  success) exit 0 ;;
  fail) exit 22 ;;
  stall-until-rollback)
    /usr/bin/sleep 0.02
    if grep -Fxq rollback-mutate "$FIRST_FAKE_EVENTS"; then exit 0; fi
    exit 28
    ;;
  *) exit 93 ;;
esac
`)

  writeExecutable(path.join(fakeBin, 'sleep'), String.raw`
#!/usr/bin/env bash
printf 'sleep:%s\n' "$*" >> "$FIRST_FAKE_EVENTS"
exit 0
`)

  function run(extraEnv = {}) {
    return spawnSync(bash, [shellPath(runner)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        FIRST_FAKE_API_STATE: shellPath(apiState),
        FIRST_FAKE_BIN: shellPath(fakeBin),
        FIRST_FAKE_EVENTS: shellPath(events),
        FIRST_FAKE_REPLACE_MARKER: shellPath(replaceMarker),
        FIRST_FAKE_RUNTIME_ROOT: shellPath(runtimeRoot),
        FIRST_FAKE_SNAPSHOT_PATH_RECORD: shellPath(snapshotPathRecord),
        FIRST_FAKE_STAGE_BIN: shellPath(stageBin),
        FIRST_FAKE_STAGE_DATA: shellPath(stageData),
        FIRST_FAKE_STOP_COUNT: shellPath(stopCount),
        FIRST_HEALTH_URL: 'https://first.example.test/api/health',
        FIRST_RESTORE_ARCHIVE: shellPath(archive),
        FIRST_RESTORE_SCRIPT: shellPath(restoreScript),
        TMPDIR: shellPath(runtimeRoot),
        ...extraEnv,
      },
    })
  }

  return { archive, events, run, runtimeRoot, sandbox }
}

function readEvents(target) {
  return readFileSync(target, 'utf8').trim().split(/\r?\n/).filter(Boolean)
}

const dataMutationEvents = new Set(['extract', 'recovery', 'swap', 'rollback-mutate-attempt', 'rollback-mutate'])

test('safe restore orders stop, staging, recovery, swap, start, and bounded health', t => {
  const harness = createHarness(t)
  const result = harness.run()

  assert.equal(result.status, 0, result.stderr)
  const events = readEvents(harness.events)
  const order = name => events.findIndex(event => event === name || event.startsWith(`${name}:`))
  assert.ok(order('stop') < order('extract'))
  assert.ok(order('extract') < order('recovery'))
  assert.ok(order('recovery') < order('swap'))
  assert.ok(order('swap') < order('start'))
  assert.ok(order('start') < order('curl'))
  const curl = events.find(event => event.startsWith('curl:'))
  assert.match(curl, /--connect-timeout\s+[1-9][0-9]*/)
  assert.match(curl, /--max-time\s+[1-9][0-9]*/)
  assert.equal(events.includes('rollback-mutate-attempt'), false)
})

test('initial API stop failure never reaches any data mutation', t => {
  const harness = createHarness(t)
  const result = harness.run({ FIRST_FAKE_STOP_MODE: 'initial' })

  assert.notEqual(result.status, 0)
  const events = readEvents(harness.events)
  assert.ok(events.includes('stop-failed:1'))
  assert.equal(events.some(event => dataMutationEvents.has(event)), false)
})

test('a successful stop that leaves the API active never reaches data mutation', t => {
  const harness = createHarness(t)
  const result = harness.run({ FIRST_FAKE_STOP_MODE: 'unconfirmed' })

  assert.notEqual(result.status, 0)
  const events = readEvents(harness.events)
  assert.ok(events.includes('stop-unconfirmed'))
  assert.equal(events.some(event => dataMutationEvents.has(event)), false)
  assert.match(result.stderr, /writer stop could not be confirmed/i)
})

test('rollback stop failure preserves live data and requires manual recovery', t => {
  const harness = createHarness(t)
  const result = harness.run({
    FIRST_FAKE_HEALTH_MODE: 'fail',
    FIRST_FAKE_STOP_MODE: 'rollback',
  })

  assert.notEqual(result.status, 0)
  const events = readEvents(harness.events)
  assert.ok(events.includes('stop-failed:2'))
  assert.equal(events.includes('rollback-mutate-attempt'), false)
  assert.match(result.stderr, /writer stop could not be confirmed[^\n]+manual recovery/i)
  assert.doesNotMatch(result.stderr, /recovery copy was restored/i)
})

test('stalled health uses bounded curl and triggers verified rollback', t => {
  const harness = createHarness(t)
  const result = harness.run({ FIRST_FAKE_HEALTH_MODE: 'stall-until-rollback' })

  assert.notEqual(result.status, 0)
  const events = readEvents(harness.events)
  const curlCalls = events.filter(event => event.startsWith('curl:'))
  assert.ok(curlCalls.length >= 2)
  for (const call of curlCalls) {
    assert.match(call, /--connect-timeout\s+[1-9][0-9]*/)
    assert.match(call, /--max-time\s+[1-9][0-9]*/)
  }
  assert.ok(events.includes('rollback-mutate'))
  assert.match(result.stderr, /retained recovery copy was restored/i)
})

test('rollback mutation failure leaves the API stopped for manual recovery', t => {
  const harness = createHarness(t)
  const result = harness.run({
    FIRST_FAKE_HEALTH_MODE: 'fail',
    FIRST_FAKE_ROLLBACK_FAIL: '1',
  })

  assert.notEqual(result.status, 0)
  const events = readEvents(harness.events)
  assert.ok(events.includes('rollback-mutate-attempt'))
  assert.equal(events.includes('rollback-mutate'), false)
  assert.equal(events.filter(event => event === 'start').length, 1, 'failed rollback must not restart the API')
  assert.match(result.stderr, /automatic rollback failed[^\n]+keep the API stopped/i)
})

for (const fixture of [
  { label: 'symbolic link', entry: { name: 'unsafe-link', type: '2', link: 'db.json' } },
  { label: 'hard link', entry: { name: 'unsafe-hardlink', type: '1', link: 'db.json' } },
  { label: 'FIFO', entry: { name: 'unsafe-fifo', type: '6' } },
  { label: 'character device', entry: { name: 'unsafe-device', type: '3' } },
]) {
  test(`archive ${fixture.label} is rejected before API stop`, t => {
    const harness = createHarness(t, [fixture.entry])
    const result = harness.run()

    assert.notEqual(result.status, 0)
    const events = readEvents(harness.events)
    assert.equal(events.includes('stop:1'), false)
    assert.equal(events.some(event => dataMutationEvents.has(event)), false)
    assert.match(result.stderr, /link|unsupported archive entry type/i)
    assert.deepEqual(readdirSync(harness.sandbox).filter(name => name.startsWith('.first-restore-snapshot.')), [])
  })
}

test('source replacement after validation cannot change the private snapshot extracted', t => {
  const harness = createHarness(t)
  const replacement = path.join(harness.sandbox, 'replacement.tgz')
  const extracted = path.join(harness.sandbox, 'extracted.tgz')
  const original = readFileSync(harness.archive)
  writeArchive(replacement, [], '{"replacement":true}\n')

  const result = harness.run({
    FIRST_FAKE_EXTRACTED_ARCHIVE: shellPath(extracted),
    FIRST_FAKE_REPLACEMENT_ARCHIVE: shellPath(replacement),
    FIRST_FAKE_REPLACE_SOURCE: shellPath(harness.archive),
    FIRST_FAKE_CHECK_UNPRIVILEGED: process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/etc/alpine-release') ? '1' : '0',
  })

  assert.equal(result.status, 0, result.stderr)
  const events = readEvents(harness.events)
  assert.ok(events.includes('archive-replaced'), events.join(','))
  assert.ok(events.includes('snapshot-path-absent'), events.join(','))
  if (process.platform !== 'win32') {
    assert.ok(events.includes('private-mode:700'), events.join(','))
    assert.ok(events.includes('snapshot-mode:600'), events.join(','))
  }
  if (process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/etc/alpine-release')) {
    assert.ok(events.includes('private-access-denied'), events.join(','))
    assert.equal(events.includes('private-accessible'), false, events.join(','))
  }
  assert.deepEqual(readFileSync(extracted), original)
  assert.deepEqual(readdirSync(harness.runtimeRoot), [])
})

test('replacement at the current private snapshot pathname cannot change the inode extracted', t => {
  const harness = createHarness(t)
  const replacement = path.join(harness.sandbox, 'snapshot-replacement.tgz')
  const extracted = path.join(harness.sandbox, 'snapshot-extracted.tgz')
  const original = readFileSync(harness.archive)
  writeArchive(replacement, [], '{"snapshotReplacement":true}\n')
  assert.notDeepEqual(readFileSync(replacement), original, 'the racing archive must differ from the owned inode')

  const result = harness.run({
    FIRST_FAKE_EXTRACTED_ARCHIVE: shellPath(extracted),
    FIRST_FAKE_SNAPSHOT_REPLACEMENT: shellPath(replacement),
  })

  assert.equal(result.status, 0, result.stderr)
  const events = readEvents(harness.events)
  assert.ok(events.includes('snapshot-mode:600'), events.join(','))
  assert.ok(events.includes('snapshot-path-absent'), events.join(','))
  assert.ok(events.includes('snapshot-replaced'), events.join(','))
  assert.ok(events.includes('snapshot-race-cleaned'), events.join(','))
  assert.deepEqual(readFileSync(extracted), original)
  assert.deepEqual(readdirSync(harness.runtimeRoot), [])
})

test('canonical TMPDIR resolving inside the repository is rejected before API stop', t => {
  const harness = createHarness(t)
  const unsafeRuntime = path.join(harness.sandbox, 'runtime-inside-repository')
  symlinkSync(root, unsafeRuntime, 'dir')

  const result = harness.run({
    TMPDIR: shellPath(unsafeRuntime),
  })

  assert.notEqual(result.status, 0)
  const events = readEvents(harness.events)
  assert.equal(events.includes('stop:1'), false, events.join(','))
  assert.match(result.stderr, /private restore runtime[^\n]+outside the repository/i)
})

test('empty-output find failure during staging aborts before live data mutation', t => {
  const harness = createHarness(t)
  const result = harness.run({
    FIRST_FAKE_EXECUTE_STAGE_VALIDATION: '1',
    FIRST_FAKE_STAGE_FIND_FAIL: '1',
  })

  assert.notEqual(result.status, 0)
  const events = readEvents(harness.events)
  assert.ok(events.includes('find-failed-empty'), `${events.join(',')}\n${result.stderr}`)
  assert.equal(events.includes('recovery'), false, events.join(','))
  assert.equal(events.includes('swap'), false, events.join(','))
  assert.equal(events.includes('rollback-mutate-attempt'), false, events.join(','))
})

test('an external symlink resolving into the repository is rejected canonically', t => {
  const harness = createHarness(t)
  const externalLink = path.join(harness.sandbox, 'external-link.tgz')
  symlinkSync(path.join(root, 'README.md'), externalLink, 'file')

  const result = harness.run({ FIRST_RESTORE_ARCHIVE: shellPath(externalLink) })

  assert.notEqual(result.status, 0)
  assert.equal(readEvents(harness.events).includes('stop:1'), false)
  assert.match(result.stderr, /outside the repository/i)
})
