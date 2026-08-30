import { expect, test } from '@playwright/test'

function accountFixtures() {
  let user = null
  let profile = { weightKg: 82.4, heightCm: 178, measurements: { waistCm: 91, armCm: 34 }, goal: 'both' }
  const calls = []
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  return {
    calls,
    async handle(route) {
      const request = route.request()
      const { pathname } = new URL(request.url())
      const method = request.method()
      const body = method === 'GET' ? null : request.postDataJSON()
      if (method !== 'GET') calls.push({ pathname, body })

      if (pathname === '/api/me') return user ? json(route, { user }) : json(route, { error: 'not signed in' }, 401)
      if (pathname === '/api/config') return json(route, { invite_only: false })
      if (pathname === '/api/data' && method === 'GET') return json(route, { state: {
        lang: 'pt', theme: 'dark', accent: 'lime', unit: 'kg', bodyweight: [], workouts: [], routines: [], week: {}, sourceSchedules: {},
      } })
      if (pathname === '/api/data' && method === 'PUT') return json(route, { ok: true })
      if (pathname === '/api/collaboration') return json(route, { rev: 1, profile: null, connections: [], notifications: [], programs: [] })
      if (pathname === '/api/auth/register' && method === 'POST') {
        user = { id: 'student-home', name: body.fullName, email: body.email.toLowerCase(), admin: false }
        profile = { weightKg: body.weightKg, heightCm: body.heightCm, measurements: body.measurements, goal: body.goal }
        return json(route, { user, profile })
      }
      if (pathname === '/api/profile' && method === 'GET') return json(route, { user, profile })
      if (pathname === '/api/profile' && method === 'PUT') {
        user = { ...user, name: body.fullName, email: body.email }
        profile = { ...profile, ...body }
        return json(route, { user, profile })
      }
      if (pathname === '/api/ai/context') return user ? json(route, {
        rev: 1,
        profile: { ageBand: 'adult', heightCm: profile.heightCm, goal: profile.goal, availableDays: [1, 3, 5], minutesPerSession: 45, experience: 'intermediario', consent: false },
        gym: { name: '', genericEquipment: [], specificMachines: [] },
        measurements: { weight: { value: profile.weightKg, unit: 'kg', observedAt: '2026-08-30' } },
        completeness: { eligible: false, missing: ['equipment'], blockers: [] },
        plan: null,
        job: null,
        planHistory: [],
      }) : json(route, { error: 'not signed in' }, 401)
      if (pathname === '/api/ai/status') return user ? json(route, { configured: false, eligible: false, missing: ['equipment'], blockers: [] }) : json(route, { error: 'not signed in' }, 401)
      return json(route, { error: `unmocked ${method} ${pathname}` }, 501)
    },
  }
}

test('student Home invites login, registers profile data, gates AI and exposes profile editing', async ({ page }, testInfo) => {
  const fixtures = accountFixtures()
  const errors = { console: [], page: [] }
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('401 (Unauthorized)')) errors.console.push(message.text()) })
  page.on('pageerror', error => errors.page.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/home')
  await expect(page.getByRole('heading', { name: 'Olá!' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fazer login' })).toBeVisible()
  await expect(page.getByText(/PPL|Push\s*\/\s*Pull\s*\/\s*Legs/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Montar treino com IA' }).first().click()
  await expect(page.getByRole('heading', { name: 'Fazer login' })).toBeVisible()
  await page.getByRole('button', { name: 'Cadastre-se' }).click()
  await page.locator('[name="fullName"]').fill('Beatriz Lima')
  await page.locator('[name="email"]').fill('beatriz@example.com')
  await page.locator('[name="password"]').fill('abc123')
  await page.locator('[name="weightKg"]').fill('82.4')
  await page.locator('[name="heightCm"]').fill('178')
  await page.locator('[name="waistCm"]').fill('91')
  await page.locator('[name="armCm"]').fill('34')
  await page.locator('[name="goal"]').selectOption('both')
  await page.getByRole('button', { name: 'Criar minha conta' }).click()

  await expect(page.getByRole('heading', { name: 'Olá, Beatriz Lima' })).toBeVisible()
  expect(fixtures.calls.find(call => call.pathname === '/api/auth/register').body).toMatchObject({
    email: 'beatriz@example.com',
    fullName: 'Beatriz Lima',
    password: 'abc123',
    weightKg: 82.4,
    heightCm: 178,
    measurements: { waistCm: 91, armCm: 34 },
    goal: 'both',
  })

  await page.getByRole('button', { name: 'Montar treino com IA' }).first().click()
  await expect(page).toHaveURL(/#\/plan/)
  await expect(page.getByRole('heading', { name: 'Dados e medidas' })).toBeVisible()
  await expect(page.locator('#tabbar')).toBeHidden()

  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Perfil' })).toBeVisible()
  await page.getByRole('button', { name: /Beatriz Lima/ }).click()
  await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible()
  await page.locator('[name="profile-full-name"]').fill('Beatriz Lima Personal')
  await page.locator('[name="profile-current-password"]').fill('abc123')
  await page.locator('[name="profile-new-password"]').fill('nova123')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.locator('#toast')).toContainText('Perfil atualizado')

  expect(fixtures.calls.find(call => call.pathname === '/api/profile').body).toMatchObject({
    fullName: 'Beatriz Lima Personal',
    email: 'beatriz@example.com',
    currentPassword: 'abc123',
    newPassword: 'nova123',
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('student-account-home-mobile.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})
