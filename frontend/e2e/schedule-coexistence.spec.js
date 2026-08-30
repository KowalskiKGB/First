import { expect, test } from '@playwright/test'

const week = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, 'manual']))
const managedWeek = routineId => Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, routineId]))

const state = {
  unit: 'kg', restSec: 90, sound: false, keepAwake: false, lang: 'pt', theme: 'dark', accent: 'lime', body: 'male',
  bodyweight: [], workouts: [], exWeights: {}, active: null, customEx: [], dayPlan: {}, week,
  reminder: { on: false, time: '08:00', tz: null },
  routines: [
    { id: 'manual', name: 'Meu treino', emoji: 'dumbbell', ex: [] },
    { id: 'personal', name: 'Treino do Personal', emoji: 'clipboard', ex: [], _personalProgramId: 'personal-plan', _personalVersion: 2 },
    { id: 'ai', name: 'Treino IA', emoji: 'sparkles', ex: [], _aiGenerated: true, _aiPlanId: 'ai-plan', _aiVersion: 3 },
  ],
  sourceSchedules: {
    personal: [{ sourceType: 'personal', planId: 'personal-plan', version: 2, label: 'Hipertrofia', active: true, week: managedWeek('personal') }],
    ai: [{ sourceType: 'ai', planId: 'ai-plan', version: 3, label: 'Plano IA v3', active: true, week: managedWeek('ai') }],
  },
}

async function openSessionPicker(page, viewport = { width: 390, height: 844 }) {
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url())
    const body = pathname === '/api/me' ? { user: null } : pathname === '/api/data' ? { state } : { ok: true }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.addInitScript(saved => {
    localStorage.setItem('gym_guest', '1')
    localStorage.setItem('gym_state_v1', JSON.stringify(saved))
  }, state)
  await page.goto('/#/home')
  await page.locator('#tabbar button.start').click()
}

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`student chooses among coexisting sessions on ${viewport.name}`, async ({ page }, testInfo) => {
    const errors = { console: [], page: [] }
    page.on('console', message => { if (message.type() === 'error') errors.console.push(message.text()) })
    page.on('pageerror', error => errors.page.push(error.message))
    await openSessionPicker(page, viewport)

    const sheet = page.locator('.sheet')
    await expect(sheet.getByRole('heading', { name: 'Escolha a sessão' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Meu treino, Manual' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Treino do Personal, Personal' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Treino IA, IA' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`schedule-${viewport.name}.png`), fullPage: true, animations: 'disabled', caret: 'hide' })
    await sheet.getByRole('button', { name: 'Treino IA, IA' }).focus()
    await expect(sheet.getByRole('button', { name: 'Treino IA, IA' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.sheet').getByRole('heading', { name: 'Check-in rápido' })).toBeVisible()
    expect(errors.console).toEqual([])
    expect(errors.page).toEqual([])
  })
}

test('session sheet traps focus, closes with Escape and restores the opener', async ({ page }) => {
  await openSessionPicker(page)

  const opener = page.locator('#tabbar button.start')
  const dialog = page.getByRole('dialog', { name: 'Escolha a sessão' })
  const firstOption = dialog.getByRole('button', { name: 'Meu treino, Manual' })
  const lastOption = dialog.getByRole('button', { name: 'Treino IA, IA' })

  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(firstOption).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(lastOption).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(firstOption).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})
