import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

const initialState = () => ({
  lang: 'pt', theme: 'dark', accent: 'lime', unit: 'kg', body: 'male',
  bodyweight: [], week: { 1: 'manual' }, routines: [{ id: 'manual', name: 'Meu treino', emoji: 'dumbbell', ex: [] }],
  workouts: [], sourceSchedules: {}, aiPlanHistory: [{ planId: 'plan-0', version: 0, label: 'Plano anterior' }],
})

const profile = () => ({
  ageBand: 'adult', heightCm: 170, goal: 'Força', experience: 'intermediario',
  availableDays: [1, 3, 5], minutesPerSession: 45, focusAreas: ['back'],
  favoriteExerciseIds: [], avoidedExerciseIds: [], limitations: '', acuteRisk: false,
  medicalRestriction: false, consent: false, guardianConsent: null,
})

const gym = () => ({ name: 'Academia Centro', genericEquipment: ['dumbbell'], specificMachines: [] })

const generatedPlan = (id = 'plan-1', version = 1) => ({
  id, version, studentId: 'student-a', source: 'ai', provider: 'openai', model: 'gpt-5-mini', contextHash: `ctx-${version}`,
  justification: version === 1 ? 'Prioriza força com o equipamento disponível.' : 'Versão anterior segura.',
  appliedAt: '2026-08-29T17:00:00.000Z',
  routines: [{
    id: `routine-${version}`, name: `Força IA ${version}`, emoji: 'sparkles',
    exercises: [{ id: `output-${version}`, exerciseId: '0001', mode: 'reps', sets: 3, repMin: 8, repMax: 10, restSeconds: 90, note: 'Técnica controlada', progression: 'double' }],
  }],
  schedule: [{ day: 1, routineId: `routine-${version}` }],
})

function aiFixtures({ plan = null, job = null } = {}) {
  let rev = 3
  let currentProfile = profile()
  let currentGym = gym()
  let measurements = { weight: { value: 70, unit: 'kg', observedAt: '2026-08-29' } }
  let currentPlan = plan
  let currentJob = job
  let planHistory = [generatedPlan('plan-0', 0)]
  if (currentPlan) planHistory = [currentPlan, ...planHistory.filter(item => item.id !== currentPlan.id)]
  let dataState = initialState()
  if (currentPlan) dataState.aiLastGeneration = { planId: currentPlan.id, version: currentPlan.version, summary: currentPlan.justification, generatedAt: currentPlan.appliedAt }
  const calls = []
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const context = () => ({
    rev, profile: currentProfile, gym: currentGym, measurements, plan: currentPlan, job: currentJob,
    planHistory,
    completeness: { eligible: true, missing: [], blockers: [] },
  })

  return {
    calls,
    async handle(route) {
      const request = route.request()
      const { pathname } = new URL(request.url())
      const method = request.method()
      const body = method === 'GET' ? null : request.postDataJSON()
      if (method !== 'GET') calls.push({ pathname, body, headers: request.headers() })

      if (pathname === '/api/me') return json(route, { user: { id: 'student-a', name: 'Aluno' } })
      if (pathname === '/api/data' && method === 'GET') {
        return json(route, { state: dataState })
      }
      if (pathname === '/api/data' && method === 'PUT') {
        dataState = structuredClone(body.state)
        return json(route, { ok: true })
      }
      if (pathname === '/api/collaboration') return json(route, { rev, profile: { userId: 'student-a', roles: ['student'] }, connections: [], notifications: [], programs: [] })
      if (pathname === '/api/ai/status') return json(route, { configured: true, eligible: true, missing: [], blockers: [], provider: { provider: 'openai', selectedModel: 'gpt-5-mini' } })
      if (pathname === '/api/ai/context') return json(route, context())
      if (pathname === '/api/ai/profile' && method === 'PUT') {
        rev += 1
        const { rev: _observedRev, ...saved } = body
        currentProfile = saved
        return json(route, { rev })
      }
      if (pathname === '/api/ai/gym' && method === 'PUT') {
        rev += 1
        const { rev: _observedRev, ...saved } = body
        currentGym = saved
        return json(route, { rev })
      }
      if (pathname === '/api/ai/measurements' && method === 'POST') {
        rev += 1
        const { rev: _observedRev, kind, ...saved } = body
        measurements = { ...measurements, [kind]: saved }
        return json(route, { rev })
      }
      if (pathname === '/api/ai/jobs' && method === 'POST') {
        currentJob = { id: 'job-1', status: 'queued', stage: 'organizing' }
        return json(route, { job: currentJob })
      }
      if (pathname === '/api/ai/job') {
        currentPlan = generatedPlan()
        planHistory = [currentPlan, ...planHistory.filter(item => item.id !== currentPlan.id)]
        currentJob = { id: 'job-1', status: 'applied', planVersion: 1, contextHash: 'ctx-1' }
        return json(route, { job: currentJob })
      }
      if (pathname === '/api/ai/plan/rollback' && method === 'POST') {
        currentPlan = planHistory.find(item => item.id === body.planId) || currentPlan
        currentJob = null
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

for (const viewport of VIEWPORTS) test(`wizard persists canonical context, applies, copies and rolls back on ${viewport.name}`, async ({ page }, testInfo) => {
  const fixtures = aiFixtures()
  const errors = watchBrowser(page)
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/plan')
  await expect(page.getByRole('heading', { name: 'Treino semanal com IA' })).toBeVisible()
  await page.getByRole('button', { name: 'Configurar meu treino com IA' }).click()
  await expect(page.getByRole('heading', { name: 'Dados e medidas' })).toBeFocused()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Objetivo e disponibilidade' })).toBeFocused()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Academia e preferências' })).toBeFocused()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Revisão e consentimento' })).toBeFocused()
  await page.getByText('Autorizo o uso destes dados nesta geração.').click()
  await page.getByRole('button', { name: 'Gerar e aplicar' }).click()

  await expect(page.getByText('Treino semanal gerado e aplicado.')).toBeVisible()
  await expect(page.getByText('OpenAI · gpt-5-mini')).toBeVisible()
  await page.getByRole('button', { name: 'Copiar e personalizar' }).click()
  await expect(page.locator('#toast')).toContainText('1 rotinas copiadas para Meu treino.')
  await page.getByRole('button', { name: 'Desfazer geração' }).click()
  await expect(page.getByText('Versão 0')).toBeVisible()

  const canonicalWrites = fixtures.calls.filter(call => ['/api/ai/profile', '/api/ai/gym', '/api/ai/measurements'].includes(call.pathname))
  expect(canonicalWrites.map(call => [call.pathname, call.body.rev])).toEqual([
    ['/api/ai/profile', 3], ['/api/ai/gym', 4], ['/api/ai/measurements', 5],
  ])
  const jobWrite = fixtures.calls.find(call => call.pathname === '/api/ai/jobs')
  expect(jobWrite.headers['idempotency-key']).toBeTruthy()
  expect(fixtures.calls.find(call => call.pathname === '/api/ai/plan/rollback').body).toEqual({ planId: 'plan-0' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath(`ai-plan-${viewport.name}.png`), fullPage: true, animations: 'disabled', caret: 'hide' })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})

test('an active job resumes after remount without creating a second job', async ({ page }, testInfo) => {
  const fixtures = aiFixtures({ job: { id: 'job-1', status: 'running', stage: 'generating' } })
  const errors = watchBrowser(page)
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/plan')
  await expect(page.getByText('Gerando treino')).toBeVisible()
  await expect(page.getByText('Versão 1')).toBeVisible()
  expect(fixtures.calls.filter(call => call.pathname === '/api/ai/jobs')).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('ai-plan-tablet-resumed.png'), fullPage: true })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})

test('a job applied while closed is reconciled into local schedules exactly once', async ({ page }, testInfo) => {
  const fixtures = aiFixtures({
    plan: generatedPlan(),
    job: { id: 'job-closed', status: 'applied', planVersion: 1, contextHash: 'ctx-1' },
  })
  const errors = watchBrowser(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/plan')
  await expect(page.getByText('Força IA 1', { exact: true })).toBeVisible()
  await expect.poll(() => fixtures.calls.filter(call => call.pathname === '/api/data').length).toBe(1)
  const persisted = fixtures.calls.find(call => call.pathname === '/api/data').body.state
  expect(persisted.week).toEqual({ 1: 'manual' })
  expect(persisted.routines.map(routine => routine.id)).toEqual(['manual', 'routine-1'])
  expect(persisted.sourceSchedules.ai[0]).toMatchObject({ planId: 'plan-1', version: 1, week: { 1: 'routine-1' } })
  expect(fixtures.calls.filter(call => call.pathname === '/api/ai/jobs')).toHaveLength(0)

  await page.reload()
  await expect(page.getByText('Força IA 1', { exact: true })).toBeVisible()
  await page.waitForTimeout(250)
  expect(fixtures.calls.filter(call => call.pathname === '/api/data')).toHaveLength(1)
  expect(fixtures.calls.filter(call => call.pathname === '/api/ai/jobs')).toHaveLength(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('ai-plan-mobile-closed-reconcile.png'), fullPage: true })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})

test('stale context is discoverable from Home and never generates automatically', async ({ page }, testInfo) => {
  const fixtures = aiFixtures({ plan: generatedPlan() })
  const errors = watchBrowser(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('first_ai_context_student-a', 'ctx-stale'))
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/plan')
  await expect(page.getByText('Seu treino pode ser atualizado')).toBeVisible()
  await page.waitForTimeout(900)
  expect(fixtures.calls.filter(call => call.pathname === '/api/ai/jobs')).toHaveLength(0)
  await page.goto('/#/home')
  await expect(page.getByRole('heading', { name: 'Treino semanal com IA' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Montar treino com IA' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('ai-home-desktop.png'), fullPage: true })
  expect(errors.console).toEqual([])
  expect(errors.page).toEqual([])
})
