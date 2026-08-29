import { expect, test } from '@playwright/test'

const trainer = { userId: 'trainer-1', name: 'Personal Teste', roles: ['student', 'trainer'], timezone: 'America/Fortaleza' }

function personalAiFixtures() {
  let rev = 7
  let conflictProfile = true
  let client = {
    id: 'client-1', trainerId: 'trainer-1', studentUserId: 'student-1', name: 'Ana Teste', goal: 'Força',
    targetSessionsPerWeek: 3, inactiveAfterDays: 7, priority: 'ok', reasons: [],
    progress: { adherence: 86, workouts28d: 10, volume28d: 18400, recentWorkouts: [] },
    finance: { expectedCents: 0, receivedCents: 0, openCents: 0, overdueCents: 0, months: [] },
    trainingProfile: {
      ageBand: 'adult', heightCm: 168, goal: 'Força', experience: 'intermediario', availableDays: [1, 3, 5],
      minutesPerSession: 50, focusAreas: ['back'], favoriteExerciseIds: [], avoidedExerciseIds: [], limitations: '',
      acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: null, updatedAt: '2026-08-27T12:00:00Z',
    },
    gymProfile: { name: 'Academia Centro', genericEquipment: ['dumbbell'], specificMachines: [], updatedAt: '2026-08-27T12:00:00Z' },
    aiPlan: { id: 'plan-3', version: 3, provider: 'openai', model: 'gpt-5-mini', contextHash: 'ctx-safe', justification: 'Prioriza a força com supervisão.', appliedAt: '2026-08-29T12:00:00Z' },
  }
  const writes = []
  const measurements = [{ id: 'm-1', kind: 'weight', value: 64, unit: 'kg', observedAt: '2026-08-29' }]
  const connection = { id: 'link-1', trainerId: 'trainer-1', studentId: 'student-1', status: 'active', grants: { trainingProfileWrite: true, aiPlanRead: true } }
  const workspace = () => ({
    rev, kpis: { activeClients: 1, appointmentsToday: 0, appointments7d: 0, freeHoursToday: 2, averageAdherence: 86, priorities: { urgent: 0, attention: 0, ok: 1 } },
    finance: { expectedCents: 0, receivedCents: 0, openCents: 0, overdueCents: 0, months: [] },
    availability: [], agenda: { today: [], openSlots: [] }, clients: [client],
  })
  const detail = () => ({ rev, client, measurements, appointments: [], receivables: [], program: null })
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  return {
    writes,
    async handle(route) {
      const request = route.request()
      const { pathname, searchParams } = new URL(request.url())
      const method = request.method()
      const body = method === 'GET' ? null : request.postDataJSON()

      if (pathname === '/api/me') return json(route, { user: { id: 'trainer-1', name: 'Personal Teste', admin: false } })
      if (pathname === '/api/data' && method === 'GET') return json(route, { state: { lang: 'pt', theme: 'dark', accent: 'lime', routines: [], workouts: [], bodyweight: [] } })
      if (pathname === '/api/data' && method === 'PUT') return json(route, { ok: true })
      if (pathname === '/api/collaboration') return json(route, { rev, profile: trainer, connections: [connection], notifications: [], programs: [] })
      if (pathname === '/api/personal/workspace') return json(route, workspace())
      if (pathname === '/api/personal/client' && searchParams.get('id') === 'client-1') return json(route, detail())
      if (pathname === '/api/personal/training-profile' && method === 'PUT') {
        if (conflictProfile) {
          conflictProfile = false
          rev += 1
          return json(route, { error: 'revision conflict with internal detail' }, 409)
        }
        writes.push({ pathname, body })
        rev += 1
        const { clientId: _clientId, rev: _observedRev, ...saved } = body
        client = { ...client, trainingProfile: { ...saved, updatedAt: '2026-08-29T18:00:00Z' } }
        return json(route, detail())
      }
      if (pathname === '/api/personal/gym' && method === 'PUT') {
        writes.push({ pathname, body })
        rev += 1
        const { clientId: _clientId, rev: _observedRev, ...saved } = body
        client = { ...client, gymProfile: { ...saved, updatedAt: '2026-08-29T18:05:00Z' } }
        return json(route, detail())
      }
      return json(route, { error: `unmocked ${method} ${pathname}` }, 501)
    },
  }
}

test('Personal edits the authorized AI profile and canonical gym machines with conflict recovery', async ({ page }, testInfo) => {
  const fixtures = personalAiFixtures()
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => fixtures.handle(route))

  await page.goto('/#/personal/alunos/client-1/ia')
  await expect(page.getByRole('heading', { name: 'Plano de IA aplicado' })).toBeVisible()
  await expect(page.getByText('OpenAI · gpt-5-mini')).toBeVisible()
  await expect(page.getByText('64 kg')).toBeVisible()

  const profileForm = page.getByRole('form', { name: 'Editar perfil de treino para IA' })
  await profileForm.locator('[name="personal-ai-goal"]').fill('Força e mobilidade')
  await profileForm.getByRole('button', { name: 'Salvar perfil de treino' }).click()
  await expect(page.getByText('Os dados foram atualizados; mantenha este formulário aberto e repita a ação.')).toBeVisible()
  await profileForm.getByRole('button', { name: 'Salvar perfil de treino' }).click()

  const gymForm = page.getByRole('form', { name: 'Editar academia do aluno' })
  await gymForm.getByRole('button', { name: 'Adicionar máquina' }).click()
  await gymForm.getByLabel('Nome da máquina').fill('Crossover duplo')
  await gymForm.getByLabel('Categoria').fill('Polia')
  await gymForm.getByPlaceholder('Buscar exercício…').fill('agachamento')
  await gymForm.locator('.exercise-preference-results button').first().click()
  await gymForm.getByRole('button', { name: 'Salvar academia' }).click()

  expect(fixtures.writes.find(write => write.pathname === '/api/personal/training-profile').body).toMatchObject({ clientId: 'client-1', rev: 8, goal: 'Força e mobilidade' })
  expect(fixtures.writes.find(write => write.pathname === '/api/personal/gym').body).toMatchObject({
    clientId: 'client-1', rev: 9,
    specificMachines: [{ name: 'Crossover duplo', category: 'Polia', exerciseIds: [expect.any(String)] }],
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('personal-ai-tablet.png'), fullPage: true })
  expect(errors.filter(message => !message.includes('409 (Conflict)'))).toEqual([])
})
