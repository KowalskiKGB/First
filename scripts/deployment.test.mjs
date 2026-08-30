import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('the deployment template is complete and builds only this repository', () => {
  assert.equal(existsSync(new URL('.env.example', root)), true, '.env.example must exist')

  const compose = read('docker-compose.yml')
  const envExample = read('.env.example')
  assert.doesNotMatch(compose, /ghcr\.io\/duartesantos8/i)
  assert.match(compose, /hasaneyldrm\/exercises-dataset/i)
  assert.match(compose, /7455efae41b330c265e7cd4b78dfa848e7ce5ebd/)
  assert.match(compose, /73c038588404c71dd441535ce7a955d4d087575634d87712dbdbbe0f569ff000/)
  assert.match(compose, /84a9a354242923378e9e7dfca3026277a01a1a9fb8de57f7d2a5021d55fc215b/)
  assert.match(compose, /first-media:/)
  assert.match(compose, /VITE_EXERCISE_MEDIA:\s*["']?1/)
  assert.match(compose, /media\/img\//)
  assert.match(compose, /media\/gif\//)
  assert.match(compose, /\/usr\/share\/nginx\/html\/media:ro/)
  assert.match(compose, /dockerfile:\s*Dockerfile/)
  assert.match(compose, /FIRST_BASIC_AUTH_USERS/)
  assert.match(compose, /FIRST_BOOTSTRAP_MIDDLEWARE/)
  assert.match(compose, /INVITE_ONLY:\s*\$\{INVITE_ONLY:\?/)
  assert.match(compose, /DEV_PANEL_USER:\s*\$\{DEV_PANEL_USER:\?/)
  assert.match(compose, /DEV_PANEL_PASSWORD_HASH:\s*\$\{DEV_PANEL_PASSWORD_HASH:\?/)
  assert.match(compose, /AI_CONFIG_MASTER_KEY:\s*\$\{AI_CONFIG_MASTER_KEY:-\}/)
  assert.match(envExample, /^INVITE_ONLY=1$/m)
  assert.match(envExample, /^DEV_PANEL_USER=\s*$/m)
  assert.match(envExample, /^DEV_PANEL_PASSWORD_HASH=\s*$/m)
  assert.match(envExample, /^AI_CONFIG_MASTER_KEY=\s*$/m)
  assert.match(compose, /PathPrefix\(`\/media\/`\)/)
  assert.match(compose, /first-media-\$\{COOLIFY_RESOURCE_UUID/)
  assert.match(compose, /first-assetlinks-\$\{COOLIFY_RESOURCE_UUID/)
  assert.match(compose, /Path\(`\/\.well-known\/assetlinks\.json`\)/)
  assert.match(compose, /priority=1000/)
  assert.match(compose, /priority=1100/)
  assert.match(compose, /priority=1200/)
  assert.doesNotMatch(
    compose,
    /routers\.first-media-\$\{COOLIFY_RESOURCE_UUID[^\n]+\.middlewares=[^\n]*first-bootstrap-auth/,
  )
  assert.doesNotMatch(compose, /first-media-[^\n]+\.tls\.certresolver/)
  assert.doesNotMatch(compose, /first-secure-[^\n]+\.tls\.certresolver/)

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
  assert.equal(capacitor.server.hostname, 'first.rocketxsistemas.com.br')
  assert.equal(capacitor.server.androidScheme, 'https')

  const androidActivity = read('frontend/android/app/src/main/java/com/kowalskikgb/first/MainActivity.java')
  const androidGradle = read('frontend/android/app/build.gradle')
  const androidManifest = read('frontend/android/app/src/main/AndroidManifest.xml')
  const androidStrings = read('frontend/android/app/src/main/res/values/strings.xml')
  assert.match(androidActivity, /WebSettingsCompat\.setWebAuthenticationSupport/)
  assert.match(androidActivity, /WEB_AUTHENTICATION_SUPPORT_FOR_APP/)
  assert.match(androidGradle, /androidx\.credentials:credentials:/)
  assert.match(androidGradle, /androidx\.credentials:credentials-play-services-auth:/)
  assert.match(androidGradle, /androidx\.webkit:webkit:/)
  assert.match(androidManifest, /android:allowBackup="false"/)
  assert.match(androidManifest, /android:name="asset_statements"/)
  assert.match(androidManifest, /android:autoVerify="true"/)
  assert.match(androidManifest, /SCHEDULE_EXACT_ALARM[\s\S]*tools:ignore="ProtectedPermissions"/)
  assert.match(androidStrings, /https:\/\/first\.rocketxsistemas\.com\.br\/\.well-known\/assetlinks\.json/)

  const assetLinks = JSON.parse(read('frontend/public/.well-known/assetlinks.json'))
  assert.equal(assetLinks[0].target.package_name, 'com.kowalskikgb.first')
  assert.deepEqual(assetLinks[0].relation, [
    'delegate_permission/common.handle_all_urls',
    'delegate_permission/common.get_login_creds',
  ])
  assert.ok(assetLinks[0].target.sha256_cert_fingerprints.includes('68:53:78:BE:95:E1:77:88:94:92:2A:A3:9E:39:81:5B:F4:93:A4:1B:40:09:1B:C7:D9:CF:F9:85:E2:E6:93:21'))

  const manifest = JSON.parse(read('frontend/public/manifest.json'))
  assert.equal(manifest.name, 'First')
  assert.equal(manifest.short_name, 'First')

  const html = read('frontend/index.html')
  assert.match(html, /<title>First<\/title>/)
  assert.doesNotMatch(html, /duarte-santos\.ch/i)

  const nginx = read('web/nginx.conf')
  assert.equal(
    read('nginx.conf').replaceAll('\r\n', '\n'),
    nginx.replaceAll('\r\n', '\n'),
    'the compatibility nginx config must mirror the deployed config',
  )
  assert.match(nginx, /real_ip_header X-Real-IP;/)
  assert.match(nginx, /zone=auth_limit:10m rate=60r\/m;/)
  assert.match(nginx, /auth\/\(register\|login\)/, 'email/password auth endpoints must use the nginx auth rate limit')
  assert.match(
    nginx,
    /location = \/_internal\/media-auth \{[\s\S]*internal;[\s\S]*proxy_pass http:\/\/api:3000\/api\/internal\/media-auth;[\s\S]*proxy_set_header Cookie \$http_cookie;/,
  )
  assert.match(
    nginx,
    /location \^~ \/media\/ \{[\s\S]*auth_request \/_internal\/media-auth;[\s\S]*Cache-Control "private, no-store"/,
  )
  assert.match(
    nginx,
    /location = \/sw\.js \{[\s\S]*Cache-Control "no-store, no-cache, must-revalidate, max-age=0"/,
  )

  const serviceWorker = read('frontend/public/sw.js')
  assert.match(serviceWorker, /const CACHE = 'first-rt-v2'/)
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/media\/'\)/)

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
    {
      cwd: new URL('.', root),
      encoding: 'utf8',
      env: {
        ...process.env,
        INVITE_ONLY: '1',
        DEV_PANEL_USER: 'first_dev_test_only',
        DEV_PANEL_PASSWORD_HASH: 'scrypt:test-only-salt:test-only-hash-material',
        FIRST_BASIC_AUTH_USERS: 'first-test:{SHA}not-a-production-credential',
      },
    },
  )

  assert.equal(result.status, 0, result.stderr || result.stdout)
})
