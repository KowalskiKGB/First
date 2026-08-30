import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
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

function writeArchive(target, extraEntries = []) {
  const entries = [
    { name: 'db.json', body: '{}\n' },
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
  const fakeBin = path.join(sandbox, 'bin')
  const runner = path.join(sandbox, 'run-restore.sh')
  mkdirSync(fakeBin)
  writeArchive(archive, extraEntries)
  writeFileSync(events, '')
  writeFileSync(stopCount, '0\n')
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
    printf '%s\n' api
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
    ;;
  start)
    printf '%s\n' start >> "$events"
    ;;
  run)
    all="$*"
    if [[ "$all" == *'failed="/data/$2"'* ]]; then
      printf '%s\n' rollback-mutate-attempt >> "$events"
      if [ "${'$'}{FIRST_FAKE_ROLLBACK_FAIL:-0}" = 1 ]; then exit 43; fi
      printf '%s\n' rollback-mutate >> "$events"
    elif [[ "$all" == *'tar -C "$stage" -xzf -'* ]]; then
      printf '%s\n' extract >> "$events"
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
        FIRST_FAKE_BIN: shellPath(fakeBin),
        FIRST_FAKE_EVENTS: shellPath(events),
        FIRST_FAKE_STOP_COUNT: shellPath(stopCount),
        FIRST_HEALTH_URL: 'https://first.example.test/api/health',
        FIRST_RESTORE_ARCHIVE: shellPath(archive),
        FIRST_RESTORE_SCRIPT: shellPath(restoreScript),
        ...extraEnv,
      },
    })
  }

  return { events, run, sandbox }
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
]) {
  test(`archive ${fixture.label} is rejected before API stop`, t => {
    const harness = createHarness(t, [fixture.entry])
    const result = harness.run()

    assert.notEqual(result.status, 0)
    const events = readEvents(harness.events)
    assert.equal(events.includes('stop:1'), false)
    assert.equal(events.some(event => dataMutationEvents.has(event)), false)
    assert.match(result.stderr, /link|unsupported archive entry type/i)
  })
}

test('an external symlink resolving into the repository is rejected canonically', t => {
  const harness = createHarness(t)
  const externalLink = path.join(harness.sandbox, 'external-link.tgz')
  symlinkSync(path.join(root, 'README.md'), externalLink, 'file')

  const result = harness.run({ FIRST_RESTORE_ARCHIVE: shellPath(externalLink) })

  assert.notEqual(result.status, 0)
  assert.equal(readEvents(harness.events).includes('stop:1'), false)
  assert.match(result.stderr, /outside the repository/i)
})
