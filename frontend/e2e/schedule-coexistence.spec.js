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

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`student chooses among coexisting sessions on ${viewport.name}`, async ({ page }, testInfo) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"not signed in"}' }))
    await page.addInitScript(saved => {
      localStorage.setItem('gym_guest', '1')
      localStorage.setItem('gym_state_v1', JSON.stringify(saved))
    }, state)

    await page.goto('/#/home')
    await page.locator('#tabbar button.start').click()

    const sheet = page.locator('.sheet')
    await expect(sheet.getByRole('heading', { name: 'Escolha a sessão' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Meu treino, Manual' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Treino do Personal, Personal' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Treino IA, IA' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`schedule-${viewport.name}.png`), fullPage: true })
    await sheet.getByRole('button', { name: 'Treino IA, IA' }).focus()
    await expect(sheet.getByRole('button', { name: 'Treino IA, IA' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.sheet').getByRole('heading', { name: 'Check-in rápido' })).toBeVisible()
    expect(errors).toEqual([])
  })
}
