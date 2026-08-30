import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

function devFixtures() {
  let unlocked = false
  let providers = ['openai', 'gemini', 'anthropic'].map(provider => ({
    provider, selectedModel: '', configured: false, keyFingerprint: null,
    testedAt: null, testStatus: 'untested', active: false,
  }))
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
      if (pathname === '/api/dev/ai/models') {
        if (searchParams.get('provider') === 'gemini') return json(route, { error: 'upstream credential material' }, 500)
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
  await expect(page.locator('.dev-provider-card')).toHaveCount(3)
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
  const gemini = page.locator('form[aria-labelledby="provider-gemini"]')
  await gemini.getByRole('button', { name: 'Carregar modelos' }).click()

  await expect(gemini.getByText('Não foi possível carregar os modelos. Tente novamente.').first()).toBeVisible()
  expect(await page.content()).not.toContain('upstream credential material')
  await page.screenshot({ path: testInfo.outputPath('dev-ai-gemini-error-desktop.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([expect.stringContaining('500 (Internal Server Error)')])
  expect(errors.page).toEqual([])
})
