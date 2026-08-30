#!/usr/bin/env node
import crypto from 'node:crypto'
import {
  closeSync,
  existsSync,
  fchmodSync,
  linkSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashDevPassword } from '../api/dev-auth.js'

const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const defaultRuntime = {
  closeSync,
  existsSync,
  fchmodSync,
  linkSync,
  openSync,
  realpathSync,
  stdout: process.stdout,
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

function privateSibling(target, phase, runtime) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(16).toString('hex')
    const candidate = path.join(path.dirname(target), `.${path.basename(target)}.${phase}-${process.pid}-${suffix}`)
    if (!runtime.existsSync(candidate)) return candidate
  }
  fail('could not reserve a private temporary output name')
}

function privateWrite(target, contents, runtime, owned) {
  const descriptor = runtime.openSync(target, 'wx', 0o600)
  owned.add(target)
  try {
    runtime.writeFileSync(descriptor, contents, { encoding: 'utf8' })
    try { runtime.fchmodSync(descriptor, 0o600) } catch {
      // Windows does not expose POSIX mode bits; exclusive creation still applies.
    }
  } finally {
    runtime.closeSync(descriptor)
  }
}

function publishPrivateOutput(target, contents, runtime, owned) {
  const partial = privateSibling(target, 'partial', runtime)
  privateWrite(partial, contents, runtime, owned)
  runtime.linkSync(partial, target)
  owned.add(target)
  runtime.unlinkSync(partial)
  owned.delete(partial)
}

function cleanupOwned(runtime, owned) {
  let failed = false
  for (const target of owned) {
    try {
      if (runtime.existsSync(target)) runtime.unlinkSync(target)
    } catch {
      failed = true
    }
  }
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
  const runtime = { ...defaultRuntime, ...overrides }
  const options = parseArguments(argv)
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
