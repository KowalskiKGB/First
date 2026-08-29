import { expect, test } from '@playwright/test'

test('AI plan saves the completed canonical profile before creating a job', async ({ page }, testInfo) => {
  const calls = []
  const consoleErrors = []
  let contextReads = 0
  const state = {
    lang: 'pt', theme: 'dark', accent: 'lime', unit: 'kg',
    bodyweight: [{ d: '2026-08-29', w: 70 }],
    week: { 1: 'manual' }, routines: [{ id: 'manual', name: 'Manual', ex: [] }], workouts: [],
    aiProfile: {
      heightCm: 170, goal: 'Força', experience: 'intermediario', sessionsPerWeek: 3,
      minutesPerSession: 45, availableDays: [1, 3, 5], equipment: ['dumbbell'],
      gymName: '', ageBand: null, consent: false, guardianConsent: false,
      targetAreas: [], favoriteExerciseIds: [], blockedExerciseIds: [], limitations: '', preferences: ''
    }
  }
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', error => consoleErrors.push(error.message))
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (['/api/ai/profile', '/api/ai/gym', '/api/ai/measurements', '/api/ai/jobs', '/api/ai/job'].includes(path)) {
      calls.push({ path, body: request.postDataJSON?.() })
    }
  })
  await page.route('**/api/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (path === '/api/me') return json(route, { user: { id: 'student-a', name: 'Aluno' } })
    if (path === '/api/data' && method === 'GET') return json(route, { state })
    if (path === '/api/data' && method === 'PUT') return json(route, { ok: true })
    if (path === '/api/collaboration') return json(route, {
      rev: 3, profile: { userId: 'student-a', roles: ['student'] }, connections: [], notifications: [], programs: []
    })
    if (path === '/api/ai/status') return json(route, {
      configured: true, eligible: contextReads > 1, missing: contextReads > 1 ? [] : ['profile'], blockers: [],
      provider: { provider: 'openai', selectedModel: 'mock-model' }
    })
    if (path === '/api/ai/context') {
      contextReads += 1
      if (contextReads === 1) return json(route, { rev: 3, completeness: { eligible: false, missing: ['profile'], blockers: [] } })
      if (contextReads === 2) return json(route, { rev: 6, completeness: { eligible: true, missing: [], blockers: [] }, plan: null })
      return json(route, {
        rev: 7, completeness: { eligible: true, missing: [], blockers: [] },
        plan: { id: 'plan-1', version: 1, justification: 'Seguro', appliedAt: '2026-08-29T17:00:00.000Z', routines: [], schedule: [] }
      })
    }
    if (path === '/api/ai/profile') return json(route, { rev: 4 })
    if (path === '/api/ai/gym') return json(route, { rev: 5 })
    if (path === '/api/ai/measurements') return json(route, { rev: 6 })
    if (path === '/api/ai/jobs') return json(route, { job: { id: 'job-1', status: 'queued' } })
    if (path === '/api/ai/job') return json(route, { job: { id: 'job-1', status: 'applied', planVersion: 1 } })
    return json(route, { error: `unmocked ${method} ${path}` }, 501)
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/plan')
  await expect(page.getByRole('heading', { name: 'Treino da semana com IA' })).toBeVisible()
  await expect(page.getByText('IA ativa')).toHaveText('IA ativa')

  await page.locator('[name="ai-gym-name"]').fill('Academia Centro')
  await page.getByRole('button', { name: '18 ou mais' }).click()
  await page.getByRole('button', { name: 'Autorizo', exact: true }).click()
  const generate = page.getByRole('button', { name: 'Elaborar meu treino com IA' })
  await expect(generate).toBeEnabled()
  await generate.click()

  await expect(page.getByText('Treino da semana gerado e aplicado.')).toBeVisible()
  expect(calls.map(call => call.path)).toEqual([
    '/api/ai/profile', '/api/ai/gym', '/api/ai/measurements', '/api/ai/jobs', '/api/ai/job'
  ])
  expect(calls[0].body.rev).toBe(3)
  expect(calls[1].body.rev).toBe(4)
  expect(calls[2].body.rev).toBe(5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('ai-plan-mobile.png'), fullPage: true })
})
