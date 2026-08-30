#!/usr/bin/env node
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashDevPassword } from '../api/dev-auth.js'

const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const defaultRuntime = {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmdirSync,
  spawnSync,
  stdout: process.stdout,
  platform: process.platform,
  unlinkSync,
  writeFileSync,
}

function fail(message) {
  throw new Error(message)
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value == null || value.startsWith('--')) fail('usage: --url URL --credentials-out PATH --handoff-out PATH')
    if (values.has(name)) fail(`duplicate option: ${name}`)
    values.set(name, value)
  }
  const allowed = new Set(['--url', '--credentials-out', '--handoff-out'])
  if ([...values.keys()].some(name => !allowed.has(name))) fail('unknown option')
  for (const required of allowed) if (!values.get(required)) fail(`missing required option: ${required}`)
  return Object.fromEntries([...values].map(([name, value]) => [name.slice(2), value]))
}

function canonicalTarget(value, label, runtime) {
  if (!path.isAbsolute(value)) fail('credentials and handoff require explicit absolute output paths')
  const parent = runtime.realpathSync(path.dirname(value))
  const target = path.join(parent, path.basename(value))
  if (runtime.existsSync(target)) fail(`${label} output already exists; rotate it explicitly before generating another`)
  return target
}

function insideRepository(target) {
  const relative = path.relative(repository, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function validateUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('url must be a valid HTTPS origin') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('url must be a valid HTTPS origin')
  return url.origin
}

function currentWindowsSid(runtime) {
  const result = runtime.spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  ], { encoding: 'utf8', windowsHide: true })
  const sid = result.stdout?.trim()
  if (result.status !== 0 || !/^S-\d(?:-\d+)+$/.test(sid)) fail('could not resolve the Windows owner SID for private credential output')
  return sid
}

function protectWindowsPath(target, directory, runtime) {
  if (runtime.platform !== 'win32') return
  const inheritance = directory ? '(OI)(CI)' : ''
  const result = runtime.spawnSync('icacls.exe', [
    target,
    '/inheritance:r',
    '/grant:r',
    `*${runtime.windowsSid}:${inheritance}F`,
    `*S-1-5-18:${inheritance}F`,
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) fail('could not restrict the Windows ACL for private credential output')
}

function privateWorkspace(target, runtime) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(16).toString('hex')
    const candidate = path.join(path.dirname(target), `.first-release-private-${process.pid}-${suffix}`)
    let created = false
    try {
      runtime.mkdirSync(candidate, { mode: 0o700 })
      created = true
      if (runtime.platform === 'win32') protectWindowsPath(candidate, true, runtime)
      else runtime.chmodSync(candidate, 0o700)
      return candidate
    } catch (error) {
      if (created) try { runtime.rmdirSync(candidate) } catch {
        // Preserve the ACL error; cleanup is best-effort before any secret is written.
      }
      if (error?.code !== 'EEXIST') throw error
    }
  }
  fail('could not reserve a private output directory')
}

function identityOf(stat) {
  return { device: stat.dev, inode: stat.ino }
}

function sameIdentity(left, right) {
  return left.device === right.device && left.inode === right.inode
}

function currentIdentity(target, runtime) {
  try {
    return identityOf(runtime.lstatSync(target, { bigint: true }))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function privateWrite(target, contents, runtime, owned) {
  const privateDirectory = privateWorkspace(target, runtime)
  const privatePath = path.join(privateDirectory, 'output')
  let descriptor
  try {
    descriptor = runtime.openSync(privatePath, 'wx', 0o600)
    const record = { descriptor, privateDirectory, privatePath, publishedPath: null }
    owned.add(record)
    if (runtime.platform === 'win32') protectWindowsPath(privatePath, false, runtime)
    runtime.writeFileSync(descriptor, contents, { encoding: 'utf8' })
    if (runtime.platform !== 'win32') runtime.fchmodSync(descriptor, 0o600)
    return record
  } catch (error) {
    if (descriptor != null && ![...owned].some(record => record.descriptor === descriptor)) runtime.closeSync(descriptor)
    try { runtime.rmdirSync(privateDirectory) } catch {
      // A tracked descriptor is cleaned by cleanupOwned; otherwise the original error is retained.
    }
    throw error
  }
}

function publishPrivateOutput(target, contents, runtime, owned) {
  const record = privateWrite(target, contents, runtime, owned)
  runtime.linkSync(record.privatePath, target)
  const partialIdentity = identityOf(runtime.fstatSync(record.descriptor, { bigint: true }))
  const publishedIdentity = currentIdentity(target, runtime)
  if (!publishedIdentity || !sameIdentity(publishedIdentity, partialIdentity)) fail('published output identity changed unexpectedly')
  record.publishedPath = target
  runtime.unlinkSync(record.privatePath)
  record.privatePath = null
  runtime.rmdirSync(record.privateDirectory)
  record.privateDirectory = null
  const finalIdentity = currentIdentity(target, runtime)
  const ownedIdentity = identityOf(runtime.fstatSync(record.descriptor, { bigint: true }))
  if (!finalIdentity || !sameIdentity(finalIdentity, ownedIdentity)) fail('published output identity changed unexpectedly')
}

function closeOwnedDescriptors(runtime, records) {
  let failed = false
  for (const record of records) {
    try { runtime.closeSync(record.descriptor) }
    catch { failed = true }
  }
  return !failed
}

function releaseOwned(runtime, owned) {
  for (const record of owned) {
    if (!record.publishedPath) return false
    const current = currentIdentity(record.publishedPath, runtime)
    const expected = identityOf(runtime.fstatSync(record.descriptor, { bigint: true }))
    if (!current || !sameIdentity(current, expected)) return false
  }
  const records = [...owned]
  if (!closeOwnedDescriptors(runtime, records)) return false
  owned.clear()
  return true
}

function cleanupOwned(runtime, owned) {
  let failed = false
  const records = [...owned]
  for (const record of records) {
    try {
      runtime.ftruncateSync(record.descriptor, 0)
      runtime.fsyncSync(record.descriptor)
    } catch {
      failed = true
    }
  }
  if (!closeOwnedDescriptors(runtime, records)) failed = true
  for (const record of records) {
    if (record.privatePath) {
      try { runtime.unlinkSync(record.privatePath) } catch { failed = true }
    }
    if (record.privateDirectory) {
      try { runtime.rmdirSync(record.privateDirectory) } catch { failed = true }
    }
  }
  owned.clear()
  return !failed
}

function credentialDocument({ url, username, password, generatedAt }) {
  return [
    '# Credenciais de teste — First',
    '',
    `- URL: ${url}`,
    `- Usuário: \`${username}\``,
    `- Senha: \`${password}\``,
    `- Gerado em: \`${generatedAt}\``,
    '',
    'Troque a credencial após o primeiro acesso e guarde a substituta em um gerenciador de senhas.',
    'Este arquivo é local, ignorado pelo Git e não deve ser enviado ao servidor.',
  ].join('\n') + '\n'
}

export function generateReleaseCredentials(argv = process.argv.slice(2), overrides = {}) {
  const configuredRuntime = { ...defaultRuntime, ...overrides }
  const options = parseArguments(argv)
  const runtime = configuredRuntime.platform === 'win32'
    ? { ...configuredRuntime, windowsSid: configuredRuntime.windowsSid || currentWindowsSid(configuredRuntime) }
    : configuredRuntime
  const credentialsPath = canonicalTarget(options['credentials-out'], 'credentials', runtime)
  const handoffPath = canonicalTarget(options['handoff-out'], 'handoff', runtime)
  if (credentialsPath === handoffPath) fail('credentials and handoff outputs must be different files')
  const allowedLocalCredentials = path.join(repository, 'CREDENCIAIS_TESTE.md')
  if (insideRepository(credentialsPath) && credentialsPath !== allowedLocalCredentials) {
    fail('credentials output inside the repository must be the ignored CREDENCIAIS_TESTE.md')
  }
  if (insideRepository(handoffPath)) fail('handoff output must be outside the repository')

  const url = validateUrl(options.url)
  const username = `first_dev_${crypto.randomBytes(12).toString('hex')}`
  const password = crypto.randomBytes(32).toString('base64url')
  const handoff = {
    DEV_PANEL_USER: username,
    DEV_PANEL_PASSWORD_HASH: hashDevPassword(password),
    AI_CONFIG_MASTER_KEY: crypto.randomBytes(32).toString('hex'),
  }
  const generatedAt = new Date().toISOString()
  const owned = new Set()
  try {
    publishPrivateOutput(
      credentialsPath,
      credentialDocument({ url, username, password, generatedAt }),
      runtime,
      owned,
    )
    publishPrivateOutput(
      handoffPath,
      `${JSON.stringify(handoff, null, 2)}\n`,
      runtime,
      owned,
    )
    if (!releaseOwned(runtime, owned)) fail('published output identity changed before completion')
  } catch (error) {
    if (!cleanupOwned(runtime, owned)) throw new Error('release credential generation failed and private artifact cleanup was incomplete')
    throw error
  }

  runtime.stdout.write('Release credentials generated successfully.\n')
  return { credentialsPath, handoffPath }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { generateReleaseCredentials() }
  catch (error) {
    process.stderr.write(`Release credential generation failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
