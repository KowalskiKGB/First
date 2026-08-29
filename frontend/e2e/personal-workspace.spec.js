import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'celular', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

const profile = {
  userId: 'trainer-1',
  name: 'Personal Teste',
  roles: ['student', 'trainer'],
  timezone: 'America/Fortaleza',
  shareCode: 'ABCDEF1234567890ABCDEF1234567890',
  shareCodeExpiresAt: '2026-08-30T00:00:00.000Z',
}

function initialClient() {
  return {
    id: 'client-1',
    trainerId: 'trainer-1',
    studentUserId: null,
    name: 'Ana Teste',
    goal: 'Hipertrofia',
    phone: '85999990000',
    notes: 'Priorizar joelho',
    targetSessionsPerWeek: 3,
    inactiveAfterDays: 7,
    priority: 'urgent',
    reasons: ['Medidas ainda não registradas'],
    progress: {
      adherence: 75,
      workouts28d: 9,
      volume28d: 18400,
      lastActivity: '2026-08-25',
      recentWorkouts: [{ id: 'w1', d: '2026-08-25', vol: 4200 }],
    },
    latestMeasurement: null,
    program: null,
    nextAppointment: null,
    finance: {
      expectedCents: 0,
      receivedCents: 0,
      openCents: 0,
      overdueCents: 0,
      months: [],
    },
  }
}

function apiFixtures() {
  let rev = 1
  let client = initialClient()
  let measurements = []
  let appointments = []
  let receivables = []
  let program = null
  let revokeNextMeasurement = false
  const writes = []

  const workspace = () => ({
    rev,
    kpis: {
      activeClients: 1,
      appointmentsToday: appointments.length,
      appointments7d: appointments.length,
      freeHoursToday: Math.max(0, 3 - appointments.length),
      averageAdherence: 75,
      priorities: { urgent: client.priority === 'urgent' ? 1 : 0, attention: client.priority === 'attention' ? 1 : 0, ok: client.priority === 'ok' ? 1 : 0 },
    },
    finance: {
      expectedCents: receivables.reduce((sum, item) => sum + item.amountCents, 0),
      receivedCents: 0,
      openCents: receivables.reduce((sum, item) => sum + item.amountCents, 0),
      overdueCents: 0,
      months: receivables.map(item => ({ period: item.period, expectedCents: item.amountCents, receivedCents: 0 })),
    },
    availability: [{ trainerId: 'trainer-1', weekday: 6, start: '08:00', end: '12:00', slotMinutes: 60 }],
    agenda: {
      today: appointments.map(item => ({ ...item, clientName: client.name })),
      openSlots: appointments.length ? [] : [{ startsAt: '2026-08-29T11:00:00.000Z', endsAt: '2026-08-29T12:00:00.000Z' }],
    },
    clients: [client],
  })

  const detail = () => ({ rev, client, measurements, appointments, receivables, program })
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  return {
    writes,
    revokeMeasurement() { revokeNextMeasurement = true },
    async handle(route) {
      const request = route.request()
      const { pathname, searchParams } = new URL(request.url())
      const method = request.method()
      const body = method === 'GET' ? null : request.postDataJSON()

      if (pathname === '/api/me') return json(route, { user: { id: 'trainer-1', name: 'Personal Teste', admin: false } })
      if (pathname === '/api/data' && method === 'GET') return json(route, { state: { lang: 'pt', theme: 'dark', accent: 'lime', bodyweight: [], routines: [], workouts: [] } })
      if (pathname === '/api/data' && method === 'PUT') return json(route, { ok: true })
      if (pathname === '/api/collaboration') return json(route, { rev, profile, connections: [], notifications: [], programs: [] })
      if (pathname === '/api/personal/workspace') return json(route, workspace())
      if (pathname === '/api/personal/client' && searchParams.get('id') === client.id) return json(route, detail())

      if (pathname === '/api/personal/measurements' && method === 'POST') {
        writes.push({ pathname, body })
        if (revokeNextMeasurement) return json(route, { error: 'forbidden' }, 403)
        rev += 1
        const measurement = { id: `measurement-${rev}`, ...body, recordedBy: 'trainer-1', createdAt: '2026-08-29T15:00:00.000Z' }
        measurements = [...measurements, measurement]
        client = { ...client, latestMeasurement: measurement, priority: 'ok', reasons: [] }
        return json(route, detail())
      }

      if (pathname === '/api/personal/program' && method === 'PUT') {
        writes.push({ pathname, body })
        rev += 1
        program = { id: 'program-1', version: 1, status: 'published', ...body }
        client = { ...client, program }
        return json(route, detail())
      }

      if (pathname === '/api/personal/appointments' && method === 'POST') {
        writes.push({ pathname, body })
        rev += 1
        const appointment = { id: 'appointment-1', ...body }
        appointments = [...appointments, appointment]
        client = { ...client, nextAppointment: appointment }
        return json(route, workspace())
      }

      if (pathname === '/api/personal/receivables' && method === 'POST') {
        writes.push({ pathname, body })
        rev += 1
        const receivable = { id: 'receivable-1', ...body }
        receivables = [...receivables, receivable]
        client = {
          ...client,
          finance: {
            expectedCents: body.amountCents,
            receivedCents: 0,
            openCents: body.amountCents,
            overdueCents: 0,
            months: [{ period: body.period, expectedCents: body.amountCents, receivedCents: 0 }],
          },
        }
        return json(route, workspace())
      }

      return json(route, { error: `unmocked ${method} ${pathname}` }, 501)
    },
  }
}

async function assertViewport(page, viewport) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement
    const grid = document.querySelector('.personal-dashboard-grid')
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0
    return { overflow: root.scrollWidth - window.innerWidth, columns }
  })
  expect(metrics.overflow).toBeLessThanOrEqual(1)
  expect(metrics.columns).toBe(viewport.width >= 1000 ? 3 : 1)
}

async function assertBottomBarClear(page, viewport) {
  if (viewport.width >= 1000) return
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector('main')
    const tabbar = document.querySelector('#tabbar')
    if (!main || !tabbar) return false
    return main.getBoundingClientRect().bottom <= tabbar.getBoundingClientRect().top - 7
  })).toBe(true)
}

async function assertFinanceDetailReadable(page, viewport) {
  if (viewport.width !== 768) return
  const historyPanel = page.locator('.finance-detail-layout > .personal-panel')
  await expect(historyPanel).toBeVisible()
  const box = await historyPanel.boundingBox()
  expect(box?.width || 0).toBeGreaterThan(480)
}

for (const viewport of VIEWPORTS) {
  test(`fluxo profissional completo em ${viewport.name}`, async ({ page }, testInfo) => {
    const fixtures = apiFixtures()
    const consoleErrors = []
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', error => consoleErrors.push(error.message))
    await page.setViewportSize(viewport)
    await page.route('**/api/**', route => fixtures.handle(route))

    await page.goto('/#/personal')
    await expect(page.getByRole('heading', { name: 'Central de comando do Personal' })).toBeVisible()
    await expect(page.getByText('Ana Teste').first()).toBeVisible()
    await assertViewport(page, viewport)

    await page.getByText('Ana Teste').first().click()
    await expect(page.getByRole('heading', { name: 'Ana Teste' })).toBeVisible()

    await page.getByRole('link', { name: 'Medidas' }).click()
    const measurementForm = page.getByRole('form', { name: 'Registrar medida do aluno' })
    await measurementForm.locator('[name="measurementValue"]').fill('82,4')
    await measurementForm.locator('[name="observedAt"]').fill('2026-08-29')
    await measurementForm.getByRole('button', { name: 'Registrar medida' }).click()
    await expect(page.getByRole('cell', { name: '82,4 kg' })).toBeVisible()

    await page.getByRole('link', { name: 'Treino' }).click()
    const programForm = page.getByRole('form', { name: 'Editor do programa de treino' })
    await programForm.locator('[name="programName"]').fill('Força da Ana')
    await programForm.getByRole('button', { name: 'Criar rotina' }).click()
    await programForm.locator('[name^="routineName-"]').fill('Treino A')
    await programForm.locator('[name="exerciseSearch"]').fill('agachamento')
    await programForm.locator('.exercise-search-results button').first().click()
    await programForm.locator('[name^="reps-"]').fill('8-12')
    await programForm.locator('[name^="note-"]').fill('Controle a descida por 3 segundos')
    await programForm.getByRole('button', { name: 'Publicar programa' }).click()
    await expect(page.getByText('Versão 1')).toBeVisible()

    await page.getByRole('link', { name: 'Agenda' }).click()
    await page.getByRole('button', { name: 'Agendar aula' }).click()
    const appointmentForm = page.getByRole('form', { name: 'Agendar aula' })
    await appointmentForm.locator('[name="appointmentDate"]').fill('2026-08-29')
    await appointmentForm.locator('[name="appointmentTime"]').fill('08:00')
    await appointmentForm.locator('[name="appointmentNote"]').fill('Avaliar amplitude do agachamento')
    await appointmentForm.getByRole('button', { name: 'Salvar aula' }).click()
    await expect(page.getByText('Avaliar amplitude do agachamento')).toBeVisible()

    await page.getByRole('link', { name: 'Financeiro' }).click()
    await page.getByRole('button', { name: 'Nova cobrança' }).click()
    const receivableForm = page.getByRole('form', { name: 'Criar cobrança' })
    await receivableForm.locator('[name="receivablePeriod"]').fill('2026-08')
    await receivableForm.locator('[name="receivableDueOn"]').fill('2026-08-29')
    await receivableForm.locator('[name="receivableAmount"]').fill('300,00')
    await receivableForm.getByRole('button', { name: 'Salvar cobrança' }).click()
    await expect(page.getByText('R$ 300,00').first()).toBeVisible()
    await assertFinanceDetailReadable(page, viewport)

    const byPath = pathname => fixtures.writes.find(write => write.pathname === pathname)?.body
    expect(byPath('/api/personal/measurements')).toMatchObject({ clientId: 'client-1', kind: 'weight', side: null, value: 82.4, unit: 'kg', observedAt: '2026-08-29', rev: 1 })
    expect(byPath('/api/personal/program')).toMatchObject({ clientId: 'client-1', name: 'Força da Ana' })
    expect(byPath('/api/personal/program').routines[0].ex[0]).toMatchObject({ reps: '8-12', note: 'Controle a descida por 3 segundos' })
    expect(byPath('/api/personal/appointments')).toMatchObject({ clientId: 'client-1', startsAt: '2026-08-29T11:00:00.000Z', endsAt: '2026-08-29T12:00:00.000Z', status: 'scheduled' })
    expect(byPath('/api/personal/receivables')).toMatchObject({ clientId: 'client-1', period: '2026-08', dueOn: '2026-08-29', amountCents: 30000, status: 'open' })

    await assertBottomBarClear(page, viewport)
    await page.screenshot({ path: testInfo.outputPath(`personal-${viewport.name}.png`), fullPage: true })
    expect(consoleErrors).toEqual([])

    await page.getByRole('link', { name: 'Medidas' }).click()
    fixtures.revokeMeasurement()
    await measurementForm.locator('[name="measurementValue"]').fill('83')
    await measurementForm.getByRole('button', { name: 'Registrar medida' }).click()
    await expect(page.locator('#toast')).toContainText('Permissão revogada')
    await expect(page.getByRole('navigation', { name: 'Navegação do aluno' })).toBeVisible()
    await expect(page.getByText('Ana Teste')).toHaveCount(0)
    expect(consoleErrors.filter(message => !message.includes('403 (Forbidden)'))).toEqual([])
  })
}
