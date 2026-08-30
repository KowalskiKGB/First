import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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

test('generator removes owned temporary files when the second private write fails', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-write-fault-'))
  const handoffDirectory = path.join(sandbox, 'handoff')
  mkdirSync(handoffDirectory)
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(handoffDirectory, 'coolify.json')
  const sentinel = path.join(sandbox, 'keep.txt')
  writeFileSync(sentinel, 'do-not-touch\n')
  let writes = 0
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
        if (writes === 2) throw new Error('injected private write failure')
        return writeFileSync(...args)
      },
    }), /injected private write failure/)

    assert.equal(existsSync(credentialsPath), false)
    assert.equal(existsSync(handoffPath), false)
    assert.deepEqual(readdirSync(sandbox).sort(), ['handoff', 'keep.txt'])
    assert.deepEqual(readdirSync(handoffDirectory), [])
    assert.equal(readFileSync(sentinel, 'utf8'), 'do-not-touch\n')
    assert.equal(leakedOutput, '')
  } finally {
    process.stdout.write = originalWrite
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('generator removes all owned artifacts when the second atomic rename fails', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'first-release-rename-fault-'))
  const handoffDirectory = path.join(sandbox, 'handoff')
  mkdirSync(handoffDirectory)
  const credentialsPath = path.join(sandbox, 'owner.md')
  const handoffPath = path.join(handoffDirectory, 'coolify.json')
  const sentinel = path.join(handoffDirectory, 'keep.txt')
  writeFileSync(sentinel, 'do-not-touch\n')
  let renames = 0
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
      renameSync: (...args) => {
        renames += 1
        if (renames === 2) throw new Error('injected atomic rename failure')
        return renameSync(...args)
      },
    }), /injected atomic rename failure/)

    assert.equal(existsSync(credentialsPath), false)
    assert.equal(existsSync(handoffPath), false)
    assert.deepEqual(readdirSync(sandbox).sort(), ['handoff'])
    assert.deepEqual(readdirSync(handoffDirectory), ['keep.txt'])
    assert.equal(readFileSync(sentinel, 'utf8'), 'do-not-touch\n')
    assert.equal(leakedOutput, '')
  } finally {
    process.stdout.write = originalWrite
    rmSync(sandbox, { recursive: true, force: true })
  }
})
