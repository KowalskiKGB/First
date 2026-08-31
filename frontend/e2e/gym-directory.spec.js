import { expect, test } from '@playwright/test'

const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }
const EXERCISE_IDS = ['0043', '0085']
const gyms = [
  {
    id: 'gym-smart', name: 'Smart Fit Macapá', networkName: 'Smart Fit', state: 'AP', city: 'Macapá',
    address: 'Rua Leopoldo Machado, 2334', neighborhood: 'Central', status: 'verified',
    latitude: 0.031, longitude: -51.067, averageRating: 4.8, reviewCount: 27,
    tags: ['Em alta', 'Rede Smart Fit'], openingHoursNote: 'Segunda a sexta, 6:00 às 22:00',
    openingHours: [{ day: 1, open: '06:00', close: '22:00', closed: false }], exerciseIds: EXERCISE_IDS,
  },
  {
    id: 'gym-box', name: 'Box Tucuju', state: 'AP', city: 'Macapá', address: 'Avenida Anhanguera, 1246A',
    neighborhood: 'Buritizal', status: 'unverified', latitude: 0.012, longitude: -51.059,
    averageRating: 4.5, reviewCount: 8, tags: ['Perto de você'], openingHours: [], exerciseIds: ['0007'],
  },
  {
    id: 'gym-ce', name: 'Academia Fortaleza', state: 'CE', city: 'Fortaleza', address: 'Rua Ceará, 10',
    neighborhood: 'Aldeota', status: 'partner', openingHours: [], exerciseIds: ['0009'], tags: [],
  },
]
const emptyState = { lang: 'pt', theme: 'dark', accent: 'lime', unit: 'kg', bodyweight: [], workouts: [], routines: [], week: {}, dayPlan: {}, sourceSchedules: { ai: [], personal: [] } }

function fixtures({ authenticated = false, conflictOnce = [] } = {}) {
  const user = authenticated ? { id: 'student-e2e', name: 'Aluno Academia', email: 'aluno@example.com', admin: false } : null
  const writes = []
  const reads = []
  const conflicted = new Set()
  let rev = 7
  let favorite = false
  let reviews = [{ id: 'review-demo', gymId: 'gym-smart', rating: 5, comment: 'Ambiente de demonstração.', displayName: 'Demonstração', demo: true }]
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  return {
    writes,
    reads,
    async handle(route) {
      const request = route.request()
      const url = new URL(request.url())
      const method = request.method()
      const body = method === 'GET' ? null : request.postDataJSON()
      if (method === 'GET') reads.push({ pathname: url.pathname, search: url.search })
      else writes.push({ method, pathname: url.pathname, body })
      if (url.pathname === '/api/me') return json(route, { user })
      if (url.pathname === '/api/config') return json(route, { invite_only: false })
      if (url.pathname === '/api/data' && method === 'GET') return json(route, { state: emptyState })
      if (url.pathname === '/api/data' && method === 'PUT') return json(route, { ok: true })
      if (url.pathname === '/api/collaboration') return json(route, { rev: 1, profile: null, connections: [], notifications: [], programs: [] })
      if (url.pathname === '/api/gyms') return json(route, { rev, gyms: gyms.map(gym => gym.id === 'gym-smart' && favorite ? { ...gym, tags: ['Preferida', ...gym.tags] } : gym) })
      if (url.pathname === '/api/gym') {
        const gym = gyms.find(item => item.id === url.searchParams.get('id'))
        return json(route, { rev, gym: gym.id === 'gym-smart' && favorite ? { ...gym, tags: ['Preferida', ...gym.tags], favoriteCount: 4 } : { ...gym, favoriteCount: 3 }, reviews })
      }
      if (url.pathname === '/api/locations/municipalities') {
        const uf = url.searchParams.get('uf')
        return json(route, { uf, municipalities: uf === 'AP' ? [{ id: 1600303, name: 'Macapá' }] : [{ id: 2304400, name: 'Fortaleza' }] })
      }
      if (url.pathname === '/api/location/reverse') return json(route, { state: 'AP', city: 'Macapá', attribution: '© OpenStreetMap contributors' })
      const conflictKey = url.pathname === '/api/gym/favorite' ? 'favorite'
        : url.pathname === '/api/gym/review' ? 'review'
          : url.pathname === '/api/gym-requests' ? body.kind : ''
      if (conflictOnce.includes(conflictKey) && !conflicted.has(conflictKey)) {
        conflicted.add(conflictKey); rev += 1
        return json(route, { error: 'stale revision', rev }, 409)
      }
      if (url.pathname === '/api/gym/favorite' && method === 'PUT') { favorite = !favorite; rev += 1; return json(route, { rev, gymId: body.gymId, favorite }) }
      if (url.pathname === '/api/gym/review' && method === 'PUT') {
        rev += 1
        reviews = [...reviews, { id: 'review-student', gymId: body.gymId, rating: body.rating, comment: body.comment, displayName: 'Aluno A.' }]
        return json(route, { rev, review: { id: 'review-student', gymId: body.gymId, rating: body.rating, comment: body.comment, status: 'published' } })
      }
      if (url.pathname === '/api/gym-requests' && method === 'POST') { rev += 1; return json(route, { rev, request: { id: `request-${rev}`, status: 'pending', kind: body.kind } }) }
      return json(route, { error: `unmocked ${method} ${url.pathname}` }, 501)
    },
  }
}

function watchBrowser(page) {
  const errors = { console: [], page: [] }
  page.on('console', message => { if (message.type() === 'error') errors.console.push(message.text()) })
  page.on('pageerror', error => errors.page.push(error.message))
  return errors
}

test('guest opts into location, searches social signals and returns with focus on mobile', async ({ page, context }, testInfo) => {
  const api = fixtures()
  const errors = watchBrowser(page)
  await page.setViewportSize(MOBILE)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:5173' })
  await context.setGeolocation({ latitude: 0.03545, longitude: -51.06656 })
  await page.route('**/api/**', route => api.handle(route))

  await page.goto('/#/academias')
  await page.getByRole('button', { name: /Usar minha localização/ }).click()
  await expect(page.locator('[name="gym-state"]')).toHaveValue('AP')
  await expect(page.locator('[name="gym-city"]')).toHaveValue('Macapá')
  await expect(page.getByText('© OpenStreetMap contributors')).toBeVisible()
  expect(api.reads.filter(read => read.pathname === '/api/gyms').every(read => !/[?&](latitude|longitude)=/.test(read.search))).toBe(true)
  expect(api.reads.some(read => read.pathname === '/api/location/reverse' && read.search === '?latitude=0.035&longitude=-51.067')).toBe(true)
  await expect(page.locator('.gym-result')).toHaveCount(2)
  await expect(page.locator('.gym-result').first()).toContainText('Smart Fit Macapá')

  await page.getByRole('button', { name: 'Em alta', exact: true }).click()
  await expect(page.locator('.gym-result')).toHaveCount(1)
  await page.getByRole('button', { name: 'Todas' }).click()
  await page.locator('[name="gym-search"]').fill('Smart Central')
  const smart = page.locator('.gym-result', { hasText: 'Smart Fit Macapá' })
  await expect(smart).toContainText('4,8')
  await expect(smart).toContainText('500 m')
  await smart.click()
  await expect(page.getByRole('heading', { name: 'Smart Fit Macapá' })).toBeVisible()
  await expect(page.getByText('Demonstração', { exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Favoritar' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  const firstBackPrevented = await page.evaluate(() => {
    const event = new Event('first:native-back', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(firstBackPrevented).toBe(true)
  await expect(smart).toBeFocused()
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.firstGymDetail))).toBe(false)
  const secondBackPrevented = await page.evaluate(() => {
    const event = new Event('first:native-back', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(secondBackPrevented).toBe(false)

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('gym-social-mobile-390x844.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})

test('denied location leaves the manual UF and municipality flow usable', async ({ page, context }) => {
  const api = fixtures()
  const errors = watchBrowser(page)
  await page.setViewportSize(MOBILE)
  await context.clearPermissions()
  await page.route('**/api/**', route => api.handle(route))
  await page.goto('/#/academias')

  await page.getByRole('button', { name: /Usar minha localização/ }).click()
  await expect(page.locator('.gym-directory-message')).toContainText(/não permitida|identificar sua localização/i)
  await page.locator('[name="gym-state"]').selectOption('CE')
  await expect(page.locator('[name="gym-city"]')).toBeEnabled()
  await page.locator('[name="gym-city"]').selectOption('Fortaleza')
  await expect(page.locator('.gym-result', { hasText: 'Academia Fortaleza' })).toBeVisible()
  expect(errors.page).toEqual([])
})

test('student recovers stale writes without losing drafts, then contributes and creates on desktop', async ({ page }, testInfo) => {
  const api = fixtures({ authenticated: true, conflictOnce: ['favorite', 'review', 'correction', 'equipment', 'closure', 'gym'] })
  const errors = watchBrowser(page)
  await page.setViewportSize(DESKTOP)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => api.handle(route))
  await page.goto('/#/academias')
  await page.locator('[name="gym-state"]').selectOption('AP')
  await expect(page.locator('[name="gym-city"]')).toBeEnabled()
  await page.locator('[name="gym-city"]').selectOption('Macapá')
  await page.locator('.gym-result', { hasText: 'Smart Fit Macapá' }).click()

  await page.getByRole('button', { name: 'Favoritar' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('continua aqui')
  await page.getByRole('button', { name: 'Favoritar' }).click()
  await expect(page.getByRole('button', { name: 'Favorita' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('5 estrelas').check()
  await page.locator('[name="gym-review-comment"]').fill('Equipe atenciosa e aparelhos bem cuidados.')
  await page.getByRole('button', { name: 'Publicar avaliação' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('continua aqui')
  await expect(page.locator('[name="gym-review-comment"]')).toHaveValue('Equipe atenciosa e aparelhos bem cuidados.')
  await page.getByRole('button', { name: 'Publicar avaliação' }).click()
  await expect(page.getByText('Aluno A.')).toBeVisible()

  await page.getByRole('button', { name: 'Sugerir correção' }).click()
  await page.locator('.gym-contribution textarea').fill('O acesso principal mudou de lado.')
  await page.locator('.gym-contribution').getByRole('button', { name: 'Enviar para análise' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('continua aqui')
  await expect(page.locator('.gym-contribution textarea')).toHaveValue('O acesso principal mudou de lado.')
  await page.locator('.gym-contribution').getByRole('button', { name: 'Enviar para análise' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('em verificação')

  await page.getByRole('button', { name: 'Adicionar aparelho' }).click()
  const equipment = page.locator('.gym-contribution')
  await equipment.locator('[name="gym-contribution-exercise-search"]').fill('Puxada lateral alternada')
  await equipment.locator('[data-exercise-id="0007"]').click()
  await equipment.getByRole('button', { name: 'Enviar para análise' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('continua aqui')
  await equipment.getByRole('button', { name: 'Enviar para análise' }).click()

  await page.getByRole('button', { name: 'Informar fechamento' }).click()
  await page.locator('.gym-contribution textarea').fill('Há uma placa de encerramento na porta.')
  await page.locator('.gym-contribution').getByRole('button', { name: 'Enviar para análise' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('continua aqui')
  await expect(page.locator('.gym-contribution textarea')).toHaveValue('Há uma placa de encerramento na porta.')
  await page.locator('.gym-contribution').getByRole('button', { name: 'Enviar para análise' }).click()
  await page.getByRole('button', { name: 'Selecionar esta academia' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')).selectedGym)).toMatchObject({ id: 'gym-smart', networkName: 'Smart Fit', exerciseIds: EXERCISE_IDS })

  await page.getByRole('button', { name: 'Voltar para academias' }).click()
  await page.getByRole('button', { name: 'Não encontrou a academia? Crie aqui' }).click()
  await page.locator('[name="name"]').fill('Academia Comunitária')
  await page.locator('[name="address"]').fill('Rua Nova, 20')
  await page.locator('.gym-new-request').getByRole('button', { name: 'Enviar para análise' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('continua aqui')
  await expect(page.locator('[name="name"]')).toHaveValue('Academia Comunitária')
  await page.locator('.gym-new-request').getByRole('button', { name: 'Enviar para análise' }).click()
  await expect(page.locator('.gym-directory-message')).toContainText('em verificação')

  const kinds = api.writes.filter(write => write.pathname === '/api/gym-requests').map(write => write.body.kind)
  expect(kinds).toEqual(['correction', 'correction', 'equipment', 'equipment', 'closure', 'closure', 'gym', 'gym'])
  expect(api.writes.filter(write => write.pathname === '/api/gym-requests' && write.body.kind === 'equipment').every(write => !('name' in write.body.payload))).toBe(true)
  expect(api.writes.some(write => write.pathname === '/api/gym/favorite')).toBe(true)
  expect(api.writes.some(write => write.pathname === '/api/gym/review' && write.body.rating === 5)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('gym-social-desktop-1440x900.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toHaveLength(6)
  expect(errors.console.every(message => message.includes('409 (Conflict)'))).toBe(true)
  expect(errors.page).toEqual([])
})
