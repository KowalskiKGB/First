import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

function devFixtures(seed = {}) {
  let unlocked = false
  let providers = ['openai', 'gemini', 'anthropic'].map(provider => ({
    provider, selectedModel: '', configured: false, keyFingerprint: null,
    testedAt: null, testStatus: 'untested', active: false,
  }))
  let gymRequests = [...(seed.requests || [])]
  const users = [...(seed.users || [])]
  const userDetails = seed.userDetails || {}
  const writes = []
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const patchProvider = (provider, patch) => { providers = providers.map(slot => slot.provider === provider ? { ...slot, ...patch } : slot) }

  return {
    writes,
    async handle(route) {
      const request = route.request()
      const { pathname, searchParams } = new URL(request.url())
      const method = request.method()
      const body = method === 'GET' ? null : request.postDataJSON()
      if (method !== 'GET') writes.push({ method, pathname, body })

      if (pathname === '/api/me') return json(route, { user: { id: 'admin-1', name: 'Administrador', admin: true } })
      if (pathname === '/api/data' && method === 'GET') return json(route, { state: { lang: 'pt', theme: 'dark', accent: 'lime', routines: [], workouts: [], bodyweight: [] } })
      if (pathname === '/api/data' && method === 'PUT') return json(route, { ok: true })
      if (pathname === '/api/collaboration') return json(route, { rev: 1, profile: { userId: 'admin-1', roles: ['student'] }, connections: [], notifications: [], programs: [] })
      if (pathname === '/api/dev/session') return json(route, { unlocked, ...(unlocked ? { username: 'first_dev_demo' } : {}) })
      if (pathname === '/api/dev/login' && method === 'POST') {
        unlocked = true
        return json(route, { ok: true })
      }
      if (pathname === '/api/dev/logout' && method === 'POST') {
        unlocked = false
        return json(route, { ok: true })
      }
      if (pathname === '/api/dev/ai/providers') return json(route, { providers })
      if (pathname === '/api/dev/ai/usage') {
        const longWindow = searchParams.get('window') === '30d'
        return json(route, { usage: { requests: longWindow ? 30 : 7, failures: longWindow ? 3 : 1, totalTokens: longWindow ? 5400 : 1200, latencyMs: longWindow ? 9000 : 2100 } })
      }
      if (pathname === '/api/dev/gym-requests/review' && method === 'POST') {
        gymRequests = gymRequests.map(item => item.id === body.id
          ? { ...item, status: body.decision === 'approve' ? 'approved' : 'rejected' }
          : item)
        return json(route, { request: gymRequests.find(item => item.id === body.id) })
      }
      if (pathname === '/api/dev/gym-requests') return json(route, { requests: gymRequests })
      if (pathname === '/api/dev/users') return seed.failUsers
        ? json(route, { error: 'temporary user index failure' }, 503)
        : json(route, { users })
      if (pathname === '/api/dev/user') return json(route, userDetails[searchParams.get('id')] || { error: 'not found' }, userDetails[searchParams.get('id')] ? 200 : 404)
      if (pathname === '/api/dev/ai/models') {
        if (searchParams.get('provider') === 'gemini') return json(route, { error: 'The provider credential was rejected.' }, 422)
        return json(route, { models: ['gpt-5', 'gpt-5-mini', 'o3'] })
      }
      if (pathname === '/api/dev/ai/provider' && method === 'PUT') {
        patchProvider(body.provider, {
          selectedModel: body.selectedModel ?? '', configured: true, keyFingerprint: '…A1B2',
          testStatus: 'untested', testedAt: null,
        })
        return json(route, { ok: true })
      }
      if (pathname === '/api/dev/ai/provider/test' && method === 'POST') {
        patchProvider(body.provider, { testStatus: 'success', testedAt: '2026-08-29T18:00:00.000Z' })
        return json(route, { ok: true })
      }
      if (pathname === '/api/dev/ai/active' && method === 'PUT') {
        providers = providers.map(slot => ({ ...slot, active: slot.provider === body.provider }))
        return json(route, { ok: true })
      }
      return json(route, { error: `unmocked ${method} ${pathname}` }, 501)
    },
  }
}

const watchBrowser = page => {
  const errors = { console: [], page: [] }
  page.on('console', message => { if (message.type() === 'error') errors.console.push(message.text()) })
  page.on('pageerror', error => errors.page.push(error.message))
  return errors
}

for (const viewport of VIEWPORTS) test(`Dev configures, tests and activates one provider on ${viewport.name}`, async ({ page }, testInfo) => {
  const fixtures = devFixtures()
  const errors = watchBrowser(page)
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/devadmin')
  await expect(page.getByRole('heading', { name: 'Credencial Dev' })).toBeVisible()
  await expect(page.locator('[name="dev-username"]')).toHaveValue('')
  await page.locator('[name="dev-username"]').fill('first_dev_demo')
  await page.locator('[name="dev-password"]').fill('temporary-demo-password')
  await page.getByRole('button', { name: 'Abrir Painel Dev' }).click()

  await expect(page.getByRole('heading', { name: 'Provedores de IA' })).toBeVisible()
  await expect(page.locator('.dev-provider-list button')).toHaveCount(3)
  await expect(page.locator('.dev-provider-card')).toHaveCount(1)
  await page.locator('.dev-provider-list button', { hasText: 'OpenAI' }).click()
  const openai = page.locator('form[aria-labelledby="provider-openai"]')
  await openai.locator('[name="openai-api-key"]').fill('test-provider-key-never-render-again')
  await openai.getByRole('button', { name: 'Carregar modelos' }).click()
  await expect(openai.locator('[name="openai-model"]')).toHaveValue('')
  await openai.locator('[name="openai-model-search"]').fill('mini')
  await openai.getByRole('button', { name: 'gpt-5-mini' }).click()
  await openai.getByRole('button', { name: 'Limpar busca' }).click()
  expect(fixtures.writes.filter(write => write.pathname === '/api/dev/ai/provider')).toHaveLength(1)
  await openai.getByRole('button', { name: 'Salvar configuração' }).click()

  await expect(openai.locator('[name="openai-api-key"]')).toHaveValue('')
  await expect(openai.getByText('…A1B2')).toBeVisible()
  expect(await page.content()).not.toContain('test-provider-key-never-render-again')
  await openai.getByRole('button', { name: 'Testar saída estruturada' }).click()
  await expect(openai.getByText('Testado')).toBeVisible()
  await openai.getByRole('button', { name: 'Ativar globalmente' }).click()
  await expect(openai.getByText('Ativo', { exact: true })).toBeVisible()
  await openai.getByRole('button', { name: /Desativar globalmente|Deactivate globally/ }).click()
  await expect(openai.getByText('Ativo', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '30 dias' }).click()
  await expect(page.getByText('30').first()).toBeVisible()
  await expect(page.locator('#tabbar')).toHaveCount(0)

  expect(fixtures.writes.filter(write => write.pathname === '/api/dev/ai/provider').map(write => write.body)).toEqual([
    { provider: 'openai', apiKey: 'test-provider-key-never-render-again' },
    { provider: 'openai', selectedModel: 'gpt-5-mini' },
  ])
  expect(fixtures.writes.find(write => write.pathname === '/api/dev/ai/provider/test').body).toEqual({ provider: 'openai' })
  expect(fixtures.writes.find(write => write.pathname === '/api/dev/ai/active').body).toEqual({ provider: 'openai' })
  expect(fixtures.writes.filter(write => write.pathname === '/api/dev/ai/active').map(write => write.body)).toEqual([
    { provider: 'openai' },
    { provider: null },
  ])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath(`dev-ai-${viewport.name}.png`), fullPage: true, animations: 'disabled', caret: 'hide' })

  await page.getByRole('button', { name: 'Sair do Painel Dev' }).click()
  await expect(page.getByRole('heading', { name: 'Credencial Dev' })).toBeVisible()
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})

test('Dev shows a sanitized Gemini model error without leaking upstream material', async ({ page }, testInfo) => {
  const fixtures = devFixtures()
  const errors = watchBrowser(page)
  await page.setViewportSize(VIEWPORTS[2])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/devadmin')
  await page.locator('[name="dev-username"]').fill('first_dev_demo')
  await page.locator('[name="dev-password"]').fill('temporary-demo-password')
  await page.getByRole('button', { name: 'Abrir Painel Dev' }).click()
  await page.locator('.dev-provider-list button', { hasText: 'Gemini' }).click()
  const gemini = page.locator('form[aria-labelledby="provider-gemini"]')
  await gemini.getByRole('button', { name: 'Carregar modelos' }).click()

  await expect(gemini.getByText('A credencial foi recusada pelo provedor. Cole uma nova chave e tente novamente.').first()).toBeVisible()
  expect(await page.content()).not.toContain('upstream credential material')
  await page.screenshot({ path: testInfo.outputPath('dev-ai-gemini-error-desktop.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([expect.stringContaining('422 (Unprocessable Entity)')])
  expect(errors.page).toEqual([])
})

test('Dev reviews equipment requests and inspects registered users', async ({ page }) => {
  const user = {
    id: 'student-1', name: 'Beatriz Lima', email: 'beatriz@example.com', role: 'student',
    online: false, lastAccessAt: '2026-08-30T12:00:00.000Z', lastLoginAt: '2026-08-30T11:58:00.000Z',
  }
  const fixtures = devFixtures({
    requests: [{
      id: 'request-1', kind: 'equipment', status: 'pending', equipmentName: 'Hack squat articulado',
      gym: { id: 'gym-1', name: 'Academia Centro', city: 'Fortaleza', state: 'CE' },
      requestedBy: { id: user.id, name: user.name, email: user.email },
      exerciseIds: ['0001'], payload: { note: 'Equipamento disponível na unidade.' }, createdAt: '2026-08-30T12:30:00.000Z',
    }],
    users: [user],
    userDetails: {
      [user.id]: {
        user,
        trainingProfile: { heightCm: 177, goal: 'muscle_gain', weightKg: 82 },
        gymProfile: { name: 'Academia Centro' },
        measurements: [{ id: 'measurement-1', kind: 'waist', value: 88, unit: 'cm', observedAt: '2026-08-30' }],
        bodyweight: [], workouts: [], routines: [],
      },
    },
  })
  await page.setViewportSize(VIEWPORTS[2])
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/devadmin')
  await page.locator('[name="dev-username"]').fill('first_dev_demo')
  await page.locator('[name="dev-password"]').fill('temporary-demo-password')
  await page.getByRole('button', { name: 'Abrir Painel Dev' }).click()

  await page.getByRole('tab', { name: 'Solicitações' }).click()
  await expect(page.getByRole('heading', { name: 'Solicitações de aparelhos' })).toBeVisible()
  await expect(page.getByText('Hack squat articulado').first()).toBeVisible()
  await page.getByRole('button', { name: 'Aprovar' }).click()
  await expect(page.getByText('Aprovada', { exact: true }).last()).toBeVisible()

  await page.getByRole('tab', { name: 'Usuários' }).click()
  await page.getByRole('button', { name: /Beatriz Lima/ }).click()
  await expect(page.getByRole('heading', { name: 'Beatriz Lima' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Medidas corporais' })).toBeVisible()
  await expect(page.getByText('Academia Centro')).toBeVisible()
  expect(fixtures.writes).toContainEqual(expect.objectContaining({
    pathname: '/api/dev/gym-requests/review',
    body: { id: 'request-1', decision: 'approve' },
  }))
})

test('an unavailable user index does not block AI provider configuration', async ({ page }) => {
  const fixtures = devFixtures({ failUsers: true })
  await page.route('**/api/**', route => fixtures.handle(route))
  await page.goto('/devadmin')
  await page.locator('[name="dev-username"]').fill('first_dev_demo')
  await page.locator('[name="dev-password"]').fill('temporary-demo-password')
  await page.getByRole('button', { name: 'Abrir Painel Dev' }).click()

  await expect(page.locator('form[aria-labelledby="provider-openai"]')).toBeVisible()
  await expect(page.getByText('Alguns dados do painel não puderam ser carregados.')).toBeVisible()
  await expect(page.getByText('Credencial Dev inválida.')).toHaveCount(0)
})
