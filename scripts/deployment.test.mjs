import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('the deployment template is complete and builds only this repository', () => {
  assert.equal(existsSync(new URL('.env.example', root)), true, '.env.example must exist')

  const compose = read('docker-compose.yml')
  assert.doesNotMatch(compose, /ghcr\.io\/duartesantos8/i)
  assert.doesNotMatch(compose, /hasaneyldrm\/exercises-dataset/i)
  assert.match(compose, /dockerfile:\s*Dockerfile/)
})

test('docker compose accepts the documented production-safe environment', () => {
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', '.env.example', 'config'],
    { cwd: new URL('.', root), encoding: 'utf8', shell: process.platform === 'win32' },
  )

  assert.equal(result.status, 0, result.stderr || result.stdout)
})

