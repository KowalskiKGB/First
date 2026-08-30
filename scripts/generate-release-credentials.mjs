#!/usr/bin/env node
import crypto from 'node:crypto'
import {
  chmodSync,
  existsSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashDevPassword } from '../api/dev-auth.js'

const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)))

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

function canonicalTarget(value, label) {
  if (!path.isAbsolute(value)) fail('credentials and handoff require explicit absolute output paths')
  const parent = realpathSync(path.dirname(value))
  const target = path.join(parent, path.basename(value))
  if (existsSync(target)) fail(`${label} output already exists; rotate it explicitly before generating another`)
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

function privateWrite(target, contents) {
  writeFileSync(target, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try { chmodSync(target, 0o600) } catch {
    // Windows does not expose POSIX mode bits; exclusive creation still applies.
  }
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

export function generateReleaseCredentials(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  const credentialsPath = canonicalTarget(options['credentials-out'], 'credentials')
  const handoffPath = canonicalTarget(options['handoff-out'], 'handoff')
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
  let credentialsWritten = false
  let handoffWritten = false
  try {
    privateWrite(credentialsPath, credentialDocument({ url, username, password, generatedAt }))
    credentialsWritten = true
    privateWrite(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`)
    handoffWritten = true
  } catch (error) {
    if (credentialsWritten) unlinkSync(credentialsPath)
    if (handoffWritten) unlinkSync(handoffPath)
    throw error
  }

  process.stdout.write(`Credenciais gravadas: ${credentialsPath}\n`)
  process.stdout.write(`Handoff efêmero gravado: ${handoffPath}\n`)
  return { credentialsPath, handoffPath }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { generateReleaseCredentials() }
  catch (error) {
    process.stderr.write(`Release credential generation failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
