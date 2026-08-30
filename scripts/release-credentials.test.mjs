import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  ftruncateSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { verifyDevPassword } from '../api/dev-auth.js'
import { generateReleaseCredentials } from './generate-release-credentials.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = path.join(root, 'scripts', 'generate-release-credentials.mjs')

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env },
  })
}

test('generator separates owner credentials from the ephemeral Coolify handoff', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-credentials-'))
  try {
    const credentialsPath = path.join(sandbox, 'CREDENCIAIS_TESTE.md')
    const handoffDirectory = path.join(sandbox, 'handoff')
    const handoffPath = path.join(handoffDirectory, 'coolify.json')
    mkdirSync(handoffDirectory)

    const result = run([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ])
    assert.equal(result.status, 0, 'credential generator should succeed')

    const credentials = readFileSync(credentialsPath, 'utf8')
    const handoff = JSON.parse(readFileSync(handoffPath, 'utf8'))
    const username = /- Usuário: `([^`]+)`/.exec(credentials)?.[1]
    const password = /- Senha: `([^`]+)`/.exec(credentials)?.[1]

    assert.ok(/^first_dev_[a-f0-9]{24}$/.test(username), 'username format must be production-safe')
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(password), 'password must encode 32 random bytes')
    assert.deepEqual(Object.keys(handoff).sort(), [
      'AI_CONFIG_MASTER_KEY',
      'DEV_PANEL_PASSWORD_HASH',
      'DEV_PANEL_USER',
    ])
    assert.equal(handoff.DEV_PANEL_USER, username)
    assert.ok(/^scrypt:[A-Za-z0-9_-]{8,}:[A-Za-z0-9_-]{20,}$/.test(handoff.DEV_PANEL_PASSWORD_HASH), 'hash format must match runtime')
    assert.equal(verifyDevPassword(password, handoff.DEV_PANEL_PASSWORD_HASH), true, 'generated hash must verify with runtime code')
    assert.ok(/^[a-f0-9]{64}$/.test(handoff.AI_CONFIG_MASTER_KEY), 'master key must encode 32 random bytes')

    assert.equal(credentials.includes('DEV_PANEL_PASSWORD_HASH'), false)
    assert.equal(credentials.includes('AI_CONFIG_MASTER_KEY'), false)
    assert.equal(credentials.includes('OpenAI'), false)
    assert.equal(credentials.includes('Gemini'), false)
    assert.equal(credentials.includes('Anthropic'), false)
    assert.equal('password' in handoff, false)
    for (const secret of [username, password, handoff.DEV_PANEL_PASSWORD_HASH, handoff.AI_CONFIG_MASTER_KEY]) {
      assert.equal(result.stdout.includes(secret), false, 'stdout must not contain generated values')
      assert.equal(result.stderr.includes(secret), false, 'stderr must not contain generated values')
    }
    assert.match(credentials, /Troque a credencial após o primeiro acesso/)
    assert.match(credentials, /Gerado em: `\d{4}-\d{2}-\d{2}T/)
    assert.equal(result.stdout.trim(), 'Release credentials generated successfully.')
    assert.equal(result.stdout.includes(credentialsPath), false)
    assert.equal(result.stdout.includes(handoffPath), false)

    if (process.platform !== 'win32') {
      assert.equal(statSync(credentialsPath).mode & 0o777, 0o600)
      assert.equal(statSync(handoffPath).mode & 0o777, 0o600)
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator refuses a handoff path inside the repository before writing anything', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-unsafe-'))
  const credentialsPath = path.join(sandbox, 'CREDENCIAIS_TESTE.md')
  const unsafeHandoff = path.join(root, `tmp-unsafe-handoff-${process.pid}.json`)
  try {
    assert.equal(existsSync(unsafeHandoff), false, 'unsafe fixture path must start absent')
    const result = run([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', unsafeHandoff,
    ])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /handoff[^\n]+outside the repository/i)
    assert.equal(existsSync(credentialsPath), false)
    assert.equal(existsSync(unsafeHandoff), false)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator requires explicit absolute output paths', () => {
  const result = run([
    '--url', 'https://first.example.test',
    '--credentials-out', 'CREDENCIAIS_TESTE.md',
    '--handoff-out', 'coolify.json',
  ])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /absolute output paths/i)
})

test('generator never replaces a preexisting output', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-existing-'))
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(sandbox, 'coolify.json')
  writeFileSync(credentialsPath, 'operator-owned\n')
  try {
    const result = run([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ])

    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(credentialsPath, 'utf8'), 'operator-owned\n')
    assert.equal(existsSync(handoffPath), false)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator keeps unpublished secret files inside private 0700 directories', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-private-workspace-'))
  const handoffDirectory = path.join(sandbox, 'handoff')
  mkdirSync(handoffDirectory)
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(handoffDirectory, 'coolify.json')
  const privateWrites = []
  try {
    generateReleaseCredentials([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ], {
      openSync: (target, flags, mode) => {
        const descriptor = openSync(target, flags, mode)
        const privateDirectory = path.dirname(target)
        privateWrites.push({
          privateDirectory,
          mode: statSync(privateDirectory).mode & 0o777,
        })
        return descriptor
      },
      stdout: { write: () => true },
    })

    assert.equal(privateWrites.length, 2)
    assert.notEqual(privateWrites[0].privateDirectory, path.dirname(credentialsPath))
    assert.notEqual(privateWrites[1].privateDirectory, path.dirname(handoffPath))
    if (process.platform !== 'win32') {
      assert.deepEqual(privateWrites.map(write => write.mode), [0o700, 0o700])
    }
    assert.deepEqual(readdirSync(sandbox).sort(), ['handoff', 'owner.md'])
    assert.deepEqual(readdirSync(handoffDirectory), ['coolify.json'])
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator wipes a published output through its descriptor when the second private write fails', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-write-fault-'))
  const handoffDirectory = path.join(sandbox, 'handoff')
  mkdirSync(handoffDirectory)
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(handoffDirectory, 'coolify.json')
  const sentinel = path.join(sandbox, 'keep.txt')
  writeFileSync(sentinel, 'do-not-touch\n')
  let writes = 0
  const generatedContents = []
  let leakedOutput = ''
  const originalWrite = process.stdout.write
  process.stdout.write = chunk => {
    leakedOutput += String(chunk)
    return true
  }
  try {
    assert.throws(() => generateReleaseCredentials([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ], {
      writeFileSync: (...args) => {
        writes += 1
        generatedContents.push(String(args[1]))
        const result = writeFileSync(...args)
        if (writes === 2) throw new Error('injected private write failure')
        return result
      },
    }), /injected private write failure/)

    assert.equal(readFileSync(credentialsPath, 'utf8'), '', 'the owned published inode must retain no plaintext')
    assert.equal(existsSync(handoffPath), false)
    assert.deepEqual(readdirSync(sandbox).sort(), ['handoff', 'keep.txt', 'owner.md'])
    assert.deepEqual(readdirSync(handoffDirectory), [])
    assert.equal(readFileSync(sentinel, 'utf8'), 'do-not-touch\n')
    assert.ok(generatedContents.every(contents => contents.length > 0), 'the injected failure must occur after secret material was written')
    assert.equal(leakedOutput, '')

    const retry = run([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ])
    assert.notEqual(retry.status, 0)
    assert.match(retry.stderr, /output already exists; rotate it explicitly/i)
    assert.equal(readFileSync(credentialsPath, 'utf8'), '')
  } finally {
    process.stdout.write = originalWrite
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator leaves a racing external publication file untouched', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-publish-race-'))
  const handoffDirectory = path.join(sandbox, 'handoff')
  mkdirSync(handoffDirectory)
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(handoffDirectory, 'coolify.json')
  let racedPath = ''
  let leakedOutput = ''
  const originalWrite = process.stdout.write
  process.stdout.write = chunk => {
    leakedOutput += String(chunk)
    return true
  }
  try {
    const race = (target, publish) => {
      if (!racedPath) {
        writeFileSync(target, 'external-race\n', { flag: 'wx' })
        racedPath = target
      }
      return publish()
    }
    assert.throws(() => generateReleaseCredentials([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ], {
      linkSync: (source, target) => race(target, () => linkSync(source, target)),
      renameSync: (source, target) => race(target, () => renameSync(source, target)),
    }), /EEXIST|file already exists/i)

    assert.equal(racedPath, credentialsPath)
    assert.equal(readFileSync(credentialsPath, 'utf8'), 'external-race\n')
    assert.equal(existsSync(handoffPath), false)
    assert.deepEqual(readdirSync(sandbox).sort(), ['handoff', 'owner.md'])
    assert.deepEqual(readdirSync(handoffDirectory), [])
    assert.equal(leakedOutput, '')
  } finally {
    process.stdout.write = originalWrite
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator cleanup preserves a published file replaced before the second publication fails', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-cleanup-race-'))
  const handoffDirectory = path.join(sandbox, 'handoff')
  mkdirSync(handoffDirectory)
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(handoffDirectory, 'coolify.json')
  let links = 0
  let leakedOutput = ''
  const originalWrite = process.stdout.write
  process.stdout.write = chunk => {
    leakedOutput += String(chunk)
    return true
  }
  try {
    assert.throws(() => generateReleaseCredentials([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ], {
      linkSync: (source, target) => {
        links += 1
        if (links === 1) return linkSync(source, target)
        unlinkSync(credentialsPath)
        writeFileSync(credentialsPath, 'external-after-publication\n', { flag: 'wx' })
        throw new Error('injected second publication failure')
      },
    }), /injected second publication failure/)

    assert.equal(links, 2)
    assert.equal(readFileSync(credentialsPath, 'utf8'), 'external-after-publication\n')
    assert.equal(existsSync(handoffPath), false)
    assert.deepEqual(readdirSync(sandbox).sort(), ['handoff', 'owner.md'])
    assert.deepEqual(readdirSync(handoffDirectory), [])
    assert.equal(leakedOutput, '')
  } finally {
    process.stdout.write = originalWrite
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator never unlinks an external replacement racing after the owned-inode check', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-post-check-race-'))
  const handoffDirectory = path.join(sandbox, 'handoff')
  mkdirSync(handoffDirectory)
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(handoffDirectory, 'coolify.json')
  let failureTriggered = false
  let raceInjected = false
  let links = 0
  try {
    const replacePublishedPath = () => {
      unlinkSync(credentialsPath)
      writeFileSync(credentialsPath, 'external-after-identity-check\n', { flag: 'wx' })
      raceInjected = true
    }

    assert.throws(() => generateReleaseCredentials([
      '--url', 'https://first.example.test',
      '--credentials-out', credentialsPath,
      '--handoff-out', handoffPath,
    ], {
      linkSync: (source, target) => {
        links += 1
        if (links === 1) return linkSync(source, target)
        failureTriggered = true
        throw new Error('injected second publication failure after first output')
      },
      lstatSync: (target, options) => {
        const identity = lstatSync(target, options)
        if (failureTriggered && target === credentialsPath && !raceInjected) replacePublishedPath()
        return identity
      },
      ftruncateSync: (descriptor, length) => {
        if (failureTriggered && !raceInjected) replacePublishedPath()
        return ftruncateSync(descriptor, length)
      },
      fsyncSync,
    }), /injected second publication failure/)

    assert.equal(raceInjected, true, 'the race must execute during failure cleanup')
    assert.equal(readFileSync(credentialsPath, 'utf8'), 'external-after-identity-check\n')
    assert.equal(existsSync(handoffPath), false)
    assert.deepEqual(readdirSync(handoffDirectory), [])
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
