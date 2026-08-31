import { expect, test } from '@playwright/test'

import { EXDB } from '../src/lib/exercises-data.js'

const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }
const GYM_EXERCISE_IDS = ['0043', '0085']
const REQUEST_EXERCISE_ID = '0007'

const gyms = [
  {
    id: 'gym-fortaleza',
    name: 'Academia X',
    state: 'CE',
    city: 'Fortaleza',
    address: 'Rua ABC, 123',
    status: 'verified',
    openingHoursNote: 'Segunda a sexta, 6:00 às 22:00',
    openingHours: [
      { day: 1, open: '06:00', close: '22:00', closed: false },
      { day: 0, closed: true },
    ],
    exerciseIds: GYM_EXERCISE_IDS,
  },
  {
    id: 'gym-caucaia',
    name: 'Academia Litoral',
    state: 'CE',
    city: 'Caucaia',
    address: 'Avenida Central, 40',
    status: 'unverified',
    openingHours: [],
    exerciseIds: ['0739'],
  },
  {
    id: 'gym-campinas',
    name: 'Academia Campinas',
    state: 'SP',
    city: 'Campinas',
    address: 'Rua das Flores, 90',
    status: 'partner',
    openingHours: [],
    exerciseIds: ['0009'],
  },
]

const municipalities = {
  CE: [{ id: 2303709, name: 'Caucaia' }, { id: 2304400, name: 'Fortaleza' }],
  SP: [{ id: 3509502, name: 'Campinas' }, { id: 3550308, name: 'São Paulo' }],
}

const emptyState = {
  lang: 'pt',
  theme: 'dark',
  accent: 'lime',
  unit: 'kg',
  bodyweight: [],
  workouts: [],
  routines: [],
  week: {},
  dayPlan: {},
  sourceSchedules: { ai: [], personal: [] },
}

function gymFixtures({ authenticated = false, failedUf = '', municipalityDelay = 0 } = {}) {
  const user = authenticated
    ? { id: 'student-gym-e2e', name: 'Aluno Academia', email: 'aluno.academia@example.com', admin: false }
    : null
  const writes = []
  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

  return {
    writes,
    async handle(route) {
      const request = route.request()
      const url = new URL(request.url())
      const { pathname } = url
      const method = request.method()
      const body = method === 'GET' ? null : request.postDataJSON()
      if (method !== 'GET') writes.push({ method, pathname, body })

      if (pathname === '/api/me') return json(route, { user })
      if (pathname === '/api/data' && method === 'GET') return json(route, { state: emptyState })
      if (pathname === '/api/data' && method === 'PUT') return json(route, { ok: true })
      if (pathname === '/api/collaboration') return json(route, { rev: 1, profile: null, connections: [], notifications: [], programs: [] })
      if (pathname === '/api/gyms') return json(route, { rev: 7, gyms })
      if (pathname === '/api/locations/municipalities') {
        const uf = url.searchParams.get('uf')
        if (municipalityDelay) await new Promise(resolve => setTimeout(resolve, municipalityDelay))
        if (uf === failedUf) return json(route, { error: 'Não foi possível carregar os municípios. Digite o município manualmente.' }, 502)
        return json(route, { uf, municipalities: municipalities[uf] || [] })
      }
      if (pathname === '/api/gym-requests' && method === 'POST') return json(route, {
        rev: 8,
        request: { id: 'gym-request-e2e', status: 'pending', ...body },
      })
      return json(route, { error: `unmocked ${method} ${pathname}` }, 501)
    },
  }
}

function watchBrowser(page) {
  const errors = { console: [], page: [] }
  page.on('console', message => {
    if (message.type() === 'error') errors.console.push(message.text())
  })
  page.on('pageerror', error => errors.page.push(error.message))
  return errors
}

test('guest filters locality and search, then opens a gym with its exact exercise catalog on mobile', async ({ page }, testInfo) => {
  const fixtures = gymFixtures({ municipalityDelay: 150 })
  const errors = watchBrowser(page)
  await page.setViewportSize(MOBILE)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/academias')
  await expect(page.getByRole('heading', { name: 'Encontre sua academia' })).toBeVisible()

  const state = page.locator('[name="gym-state"]')
  const city = page.locator('[name="gym-city"]')
  const search = page.locator('[name="gym-search"]')
  await expect(state.locator('option')).toHaveCount(28)
  await expect(state).toHaveValue('')
  await expect(city).toBeDisabled()
  await expect(search).toBeDisabled()
  await expect(page.locator('.gym-result')).toHaveCount(0)
  await expect(page.locator('.gym-empty')).toContainText(/UF.*município|state.*municipality/i)

  await state.selectOption('SP')
  await expect(city).toBeDisabled()
  await expect(city.locator('option').first()).toContainText(/Carregando|Loading/i)
  await expect(city).toBeEnabled()
  await city.selectOption('Campinas')
  await expect(page.locator('.gym-result', { hasText: 'Academia Campinas' })).toBeVisible()
  await expect(page.locator('.gym-result', { hasText: 'Academia X' })).toHaveCount(0)

  await state.selectOption('CE')
  await expect(city).toBeEnabled()
  await city.selectOption('Caucaia')
  await expect(page.locator('.gym-result', { hasText: 'Academia Litoral' })).toBeVisible()
  await city.selectOption('Fortaleza')
  await page.locator('[name="gym-search"]').fill('Rua ABC')
  await expect(page.locator('.gym-result', { hasText: 'Academia X' })).toBeVisible()
  await expect(page.locator('.gym-result')).toHaveCount(1)

  await page.locator('.gym-result', { hasText: 'Academia X' }).click()
  const detail = page.locator('.gym-detail')
  await expect(detail.getByRole('heading', { name: 'Academia X' })).toBeVisible()
  await expect(detail).toContainText('Rua ABC, 123')
  await expect(detail).toContainText('06:00')
  await expect(detail).toContainText('22:00')

  const catalog = detail.locator('.gym-inventory .exercise-catalog-picker')
  const exactIds = await catalog.locator('.item').evaluateAll(items => items.map(item => item.dataset.exerciseId).sort())
  expect(exactIds).toEqual([...GYM_EXERCISE_IDS].sort())
  expect(GYM_EXERCISE_IDS.every(id => EXDB.some(exercise => exercise.id === id))).toBe(true)
  await expect(catalog.locator('.thumb')).toHaveCount(GYM_EXERCISE_IDS.length)
  await expect(catalog.locator('.chips').first()).toBeVisible()
  await catalog.locator('[name="gym-exercise-search"]').fill('Agachamento')
  await expect(catalog.locator(`[data-exercise-id="${GYM_EXERCISE_IDS[0]}"]`)).toBeVisible()
  await expect(catalog.locator('.item')).toHaveCount(1)

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('gym-directory-guest-mobile.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})

test('municipality failure falls back to manual entry without showing a premature empty result', async ({ page }) => {
  const fixtures = gymFixtures({ failedUf: 'RR' })
  const errors = watchBrowser(page)
  await page.setViewportSize(MOBILE)
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/academias')
  await page.locator('[name="gym-state"]').selectOption('RR')
  const city = page.locator('input[name="gym-city"]')
  await expect(city).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Digite o município manualmente')
  await expect(page.locator('.gym-results')).not.toContainText(/nenhuma academia|no gyms/i)

  await city.fill('Boa Vista')
  await expect(page.locator('[name="gym-search"]')).toBeEnabled()
  await expect(page.locator('.gym-empty')).toContainText(/nenhuma academia|no gyms/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  expect(errors.console.every(message => /Failed to load resource.*502/.test(message))).toBe(true)
  expect(errors.page).toEqual([])
})

test('signed-in student selects a gym and requests equipment by a real catalog ID on desktop', async ({ page }, testInfo) => {
  const fixtures = gymFixtures({ authenticated: true })
  const errors = watchBrowser(page)
  await page.setViewportSize(DESKTOP)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/academias')
  await page.locator('[name="gym-state"]').selectOption('CE')
  await expect(page.locator('[name="gym-city"]')).toBeEnabled()
  await page.locator('[name="gym-city"]').selectOption('Fortaleza')

  await page.locator('.gym-new-request-action').click()
  const gymRequest = page.locator('.gym-new-request')
  await expect(gymRequest.locator('[name="gym-request-state"]')).toHaveValue('CE')
  await expect(gymRequest.locator('[name="gym-request-city"]')).toHaveValue('Fortaleza')
  await gymRequest.getByRole('button', { name: 'Cancelar' }).click()

  await page.locator('.gym-result', { hasText: 'Academia X' }).click()
  const detail = page.locator('.gym-detail')
  await detail.getByRole('button', { name: 'Selecionar esta academia' }).click()

  const selectedGym = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_state_v1')).selectedGym)
  expect(selectedGym).toMatchObject({
    id: 'gym-fortaleza',
    directoryGymId: 'gym-fortaleza',
    name: 'Academia X',
    city: 'Fortaleza',
    state: 'CE',
    exerciseIds: GYM_EXERCISE_IDS,
  })

  await detail.getByRole('button', { name: 'Não encontrou seu aparelho? Clique aqui para cadastrar' }).click()
  const requestForm = detail.locator('.gym-equipment-request')
  await expect(requestForm.getByRole('heading', { name: 'Solicitar aparelho' })).toBeVisible()
  await requestForm.locator('[name="gym-request-name"]').fill('Puxador lateral articulado')

  const catalog = requestForm.locator('.exercise-catalog-picker')
  await catalog.locator('[name="gym-request-exercise-search"]').fill('Puxada lateral alternada')
  const exercise = catalog.locator(`[data-exercise-id="${REQUEST_EXERCISE_ID}"]`)
  await expect(exercise).toBeVisible()
  expect(EXDB.some(item => item.id === REQUEST_EXERCISE_ID)).toBe(true)
  await exercise.click()
  await expect(exercise).toHaveAttribute('aria-pressed', 'true')
  await requestForm.locator('[name="gym-request-note"]').fill('Aparelho disponível na sala principal.')
  await requestForm.getByRole('button', { name: 'Enviar para análise' }).click()

  await expect(page.locator('.gym-directory-message')).toContainText('Solicitação enviada para análise')
  const requestWrite = fixtures.writes.find(write => write.pathname === '/api/gym-requests')
  expect(requestWrite).toEqual({
    method: 'POST',
    pathname: '/api/gym-requests',
    body: {
      rev: 7,
      kind: 'equipment',
      gymId: 'gym-fortaleza',
      payload: {
        name: 'Puxador lateral articulado',
        note: 'Aparelho disponível na sala principal.',
        exerciseIds: [REQUEST_EXERCISE_ID],
      },
    },
  })

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('gym-directory-request-desktop.png'), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})
