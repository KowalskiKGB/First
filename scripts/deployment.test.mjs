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
  assert.match(compose, /hasaneyldrm\/exercises-dataset/i)
  assert.match(compose, /7455efae41b330c265e7cd4b78dfa848e7ce5ebd/)
  assert.match(compose, /73c038588404c71dd441535ce7a955d4d087575634d87712dbdbbe0f569ff000/)
  assert.match(compose, /first-media:/)
  assert.match(compose, /VITE_EXERCISE_MEDIA:\s*["']?1/)
  assert.match(compose, /media\/img\//)
  assert.match(compose, /media\/gif\//)
  assert.match(compose, /\/usr\/share\/nginx\/html\/media:ro/)
  assert.match(compose, /dockerfile:\s*Dockerfile/)
  assert.match(compose, /FIRST_BASIC_AUTH_USERS/)
  assert.match(compose, /FIRST_BOOTSTRAP_MIDDLEWARE/)
  assert.match(compose, /priority=1000/)

  const webDockerfile = read('Dockerfile')
  const apiDockerfile = read('api/Dockerfile')
  assert.match(webDockerfile, /RUN npm ci(?:\s|$)/)
  assert.doesNotMatch(webDockerfile, /npm ci[^\n]*\|\|/)
  assert.match(apiDockerfile, /npm ci --omit=dev/)
  assert.match(apiDockerfile, /su-exec node node server\.js/)

  const frontendPackage = JSON.parse(read('frontend/package.json'))
  assert.equal(frontendPackage.name, 'first-frontend')
  assert.match(frontendPackage.scripts['build:mobile'], /copy-exercise-media\.mjs/)
  assert.match(read('frontend/.env.mobile'), /VITE_EXERCISE_MEDIA=1/)
  const apiPackage = JSON.parse(read('api/package.json'))
  assert.equal(apiPackage.name, 'first-api')

  const api = read('api/server.js')
  assert.doesNotMatch(api, /GET \/api\/health[\s\S]*?users:\s*db\.users\.length/i)
  assert.match(api, /RP_ID and ORIGIN are required in production/)

  const capacitor = JSON.parse(read('frontend/capacitor.config.json'))
  assert.equal(capacitor.appName, 'First')
  assert.equal(capacitor.appId, 'com.kowalskikgb.first')

  const manifest = JSON.parse(read('frontend/public/manifest.json'))
  assert.equal(manifest.name, 'First')
  assert.equal(manifest.short_name, 'First')

  const html = read('frontend/index.html')
  assert.match(html, /<title>First<\/title>/)
  assert.doesNotMatch(html, /duarte-santos\.ch/i)

  const nginx = read('web/nginx.conf')
  assert.match(nginx, /real_ip_header X-Real-IP;/)
  assert.match(nginx, /zone=auth_limit:10m rate=60r\/m;/)

  const iosProject = read('frontend/ios/App/App.xcodeproj/project.pbxproj')
  const iosInfo = read('frontend/ios/App/App/Info.plist')
  assert.match(iosProject, /PRODUCT_BUNDLE_IDENTIFIER = com\.kowalskikgb\.first;/)
  assert.doesNotMatch(iosProject, /ch\.duartesantos\.opengym/i)
  assert.match(iosInfo, /<string>First<\/string>/)
  assert.doesNotMatch(iosInfo, /<string>openGym<\/string>/i)

  assert.doesNotMatch(read('frontend/src/sheets.jsx'), /opengym-plan-/i)
  assert.doesNotMatch(read('frontend/src/lib/mobile.js'), /opengym-state\.json/i)
  assert.doesNotMatch(read('frontend/src/components/ErrorBoundary.jsx'), /openGym render error/i)
})

test('docker compose accepts the documented production-safe environment', () => {
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', '.env.example', 'config'],
    { cwd: new URL('.', root), encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr || result.stdout)
})
