import { expect, test } from '@playwright/test'

function accountFixtures({ omitRegisteredUser = false, rejectRegistrationSession = false } = {}) {
  let user = null
  let sessionReady = false
  let profile = { weightKg: 82.4, targetWeightKg: 75, heightCm: 177, measurements: { waistCm: 91, armCm: 34 }, goal: 'both' }
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

      if (pathname === '/api/me') return user && (!rejectRegistrationSession || sessionReady) ? json(route, { user }) : json(route, { error: 'not signed in' }, 401)
      if (pathname === '/api/config') return json(route, { invite_only: false })
      if (pathname === '/api/data' && method === 'GET') return json(route, { state: {
        lang: 'pt', theme: 'dark', accent: 'lime', unit: 'kg', bodyweight: [], workouts: [], routines: [], week: {}, sourceSchedules: {},
      } })
      if (pathname === '/api/data' && method === 'PUT') return json(route, { ok: true })
      if (pathname === '/api/collaboration') return json(route, { rev: 1, profile: null, connections: [], notifications: [], programs: [] })
      if (pathname === '/api/auth/register' && method === 'POST') {
        user = { id: 'student-home', name: body.fullName, email: body.email.toLowerCase(), admin: false }
        profile = { weightKg: body.weightKg, targetWeightKg: body.targetWeightKg, heightCm: body.heightCm, measurements: body.measurements, goal: body.goal }
        return json(route, omitRegisteredUser ? { ok: true } : { user, profile })
      }
      if (pathname === '/api/auth/login' && method === 'POST') {
        sessionReady = true
        return json(route, { user })
      }
      if (pathname === '/api/profile' && method === 'GET') return json(route, { user, profile })
      if (pathname === '/api/profile' && method === 'PUT') {
        user = { ...user, name: body.fullName, email: body.email }
        profile = { ...profile, ...body }
        return json(route, { user, profile })
      }
      if (pathname === '/api/ai/context') return user ? json(route, {
        rev: 1,
        profile: null,
        gym: null,
        measurements: {},
        completeness: { eligible: false, missing: ['profile', 'gym', 'weight'], blockers: [] },
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
  await page.addInitScript(() => localStorage.setItem('gym_state_v1', JSON.stringify({
    unit: 'kg', bodyweight: [{ d: '2026-08-30', w: 82.4 }], targetW: 75,
    aiProfile: { heightCm: 177, goal: 'both', measurements: {} },
    workouts: [], routines: [], week: {}, dayPlan: {}, sourceSchedules: { ai: [], personal: [] },
  })))

  await page.goto('/#/home')
  await expect(page.getByRole('heading', { name: 'Fazer login' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fazer login' })).toBeVisible()
  await expect(page.getByText(/PPL|Push\s*\/\s*Pull\s*\/\s*Legs/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Montar treino com IA' }).first().click()
  await expect(page.locator('.account-access').getByRole('heading', { name: 'Fazer login' })).toBeVisible()
  await page.getByRole('button', { name: 'Cadastre-se' }).click()
  await page.locator('[name="fullName"]').fill('Beatriz Lima')
  await page.locator('[name="email"]').fill('beatriz@example.com')
  await page.locator('[name="password"]').fill('abc123')
  await page.locator('[name="confirmPassword"]').fill('abc123')
  await expect(page.locator('[name="weightKg"]')).toHaveValue('82.4')
  await expect(page.locator('[name="targetWeightKg"]')).toHaveValue('75')
  await expect(page.locator('[name="heightM"]')).toHaveValue('1,77')
  await page.locator('[name="heightM"]').fill('177')
  await expect(page.locator('[name="heightM"]')).toHaveValue('1,77')
  await page.locator('[name="heightM"]').fill('177,5')
  await expect(page.locator('[name="heightM"]')).toHaveValue('1,77')
  await expect(page.getByRole('radio', { name: 'Ambos' })).toBeChecked()
  await page.locator('[name="waistCm"]').fill('91')
  await page.locator('[name="armCm"]').fill('34')
  await page.getByRole('button', { name: 'Criar minha conta' }).click()

  await expect(page.getByRole('heading', { name: 'Olá, Beatriz Lima' })).toBeVisible()
  const registrationRequest = fixtures.calls.find(call => call.pathname === '/api/auth/register').body
  expect(registrationRequest).toMatchObject({
    email: 'beatriz@example.com',
    fullName: 'Beatriz Lima',
    password: 'abc123',
    weightKg: 82.4,
    targetWeightKg: 75,
    heightCm: 177,
    measurements: { waistCm: 91, armCm: 34 },
    goal: 'both',
  })
  expect(registrationRequest).not.toHaveProperty('confirmPassword')

  await page.getByRole('button', { name: 'Montar treino com IA' }).first().click()
  await expect(page).toHaveURL(/#\/plan/)
  await expect(page.getByRole('heading', { name: 'Dados e medidas' })).toBeVisible()
  await expect(page.locator('#tabbar')).toBeHidden()
  await expect(page.locator('[name="ai-weight"]')).toHaveValue('82.4')
  await expect(page.locator('[name="ai-height"]')).toHaveValue('177')
  await page.getByRole('button', { name: '18 anos ou mais' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.locator('[name="ai-goal"]')).toHaveValue('both')

  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Perfil' })).toBeVisible()
  await page.getByRole('button', { name: /Beatriz Lima/ }).click()
  await expect(page.getByRole('heading', { name: 'Editar perfil' })).toBeVisible()
  await expect(page.locator('[name="profile-target-weight"]')).toHaveValue('75')
  await page.locator('[name="profile-target-weight"]').fill('74.5')
  await page.locator('[name="profile-height"]').fill('178')
  await expect(page.locator('[name="profile-height"]')).toHaveValue('1,78')
  await page.locator('[name="profile-full-name"]').fill(' ')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.locator('[name="profile-full-name"]')).toBeFocused()
  await expect(page.locator('[name="profile-full-name"]')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('[name="profile-full-name"]')).toHaveAttribute('aria-describedby', 'profile-form-error')
  await expect(page.locator('#profile-form-error')).toContainText('Informe seu nome completo')
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
    targetWeightKg: 74.5,
    heightCm: 178,
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('student-account-home-mobile.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})

test('a successful registration recovers its session without asking the student to confirm an account', async ({ page }) => {
  const fixtures = accountFixtures({ omitRegisteredUser: true, rejectRegistrationSession: true })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Fazer login' }).click()
  await page.getByRole('button', { name: 'Cadastre-se' }).click()
  await page.locator('[name="fullName"]').fill('Ana Teste')
  await page.locator('[name="email"]').fill('ana@example.com')
  await page.locator('[name="password"]').fill('abc123')
  await page.locator('[name="confirmPassword"]').fill('abc123')
  await page.getByRole('button', { name: 'Criar minha conta' }).click()

  await expect(page.getByRole('heading', { name: /Ana Teste$/ })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/confirmar a conta|Cannot read properties|undefined.*name/i)
  expect(fixtures.calls.filter(call => call.pathname === '/api/auth/login')).toHaveLength(1)
})

test('registration blocks mismatched passwords before sending account data', async ({ page }) => {
  const fixtures = accountFixtures()
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Fazer login' }).click()
  await page.getByRole('button', { name: 'Cadastre-se' }).click()
  await page.locator('[name="fullName"]').fill('Senha Diferente')
  await page.locator('[name="email"]').fill('senhas@example.com')
  await page.locator('[name="password"]').fill('abc123')
  await page.locator('[name="confirmPassword"]').fill('abc124')
  await page.getByRole('button', { name: 'Criar minha conta' }).click()

  await expect(page.getByRole('alert')).toContainText(/senhas n.o coincidem/i)
  expect(fixtures.calls.filter(call => call.pathname === '/api/auth/register')).toHaveLength(0)
})

test('AI routine choice stays visible and blocks another choice while generation is running', async ({ page }) => {
  const fixtures = accountFixtures()
  let routineCalls = 0
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Fazer login' }).click()
  await page.getByRole('button', { name: 'Cadastre-se' }).click()
  await page.locator('[name="fullName"]').fill('Aluno Rotina')
  await page.locator('[name="email"]').fill('rotina@example.com')
  await page.locator('[name="password"]').fill('abc123')
  await page.locator('[name="confirmPassword"]').fill('abc123')
  await page.getByRole('button', { name: 'Criar minha conta' }).click()

  await page.route('**/api/ai/routine', async route => {
    routineCalls += 1
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ routine: { id: 'ai-legs-once', name: 'Pernas sob medida', emoji: 'legs', ex: [] } }),
    })
  })

  await page.goto('/#/plan')
  await page.locator('.plan-routine-heading').getByRole('button', { name: 'Nova' }).click()
  const dialog = page.getByRole('dialog')
  const legs = dialog.getByRole('button', { name: /IA.*Pernas/ })
  await legs.click()

  await expect(dialog).toBeVisible()
  await expect(legs).toBeDisabled()
  await expect(dialog.getByRole('status')).toContainText('Criando sua rotina')
  await expect(page).toHaveURL(/#\/plan\/r\/ai-legs-once/)
  expect(routineCalls).toBe(1)
})
