import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  readFile: vi.fn(), writeFile: vi.fn(), cancel: vi.fn(), checkPermissions: vi.fn(),
  requestPermissions: vi.fn(), schedule: vi.fn(), share: vi.fn(),
}))

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { readFile: native.readFile, writeFile: native.writeFile },
  Directory: { Data: 'data', Cache: 'cache' }, Encoding: { UTF8: 'utf8' },
}))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {
  cancel: native.cancel, checkPermissions: native.checkPermissions,
  requestPermissions: native.requestPermissions, schedule: native.schedule,
} }))
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }))

import { setLang } from './i18n.js'
import * as mobile from './mobile.js'

const { nativeLoad, nativeSave, reminderNotifications, shareExport, syncReminder } = mobile

describe('reminderNotifications', () => {
  beforeAll(() => setLang('pt'))
  beforeEach(() => {
    vi.clearAllMocks()
    native.cancel.mockResolvedValue(undefined)
    native.checkPermissions.mockResolvedValue({ display: 'granted' })
    native.requestPermissions.mockResolvedValue({ display: 'granted' })
    native.schedule.mockResolvedValue(undefined)
  })

  it('uses the session count and workout selector destination when a weekday has multiple options', () => {
    const state = {
      routines: [
        { id: 'manual', name: 'Manual' }, { id: 'personal', name: 'Personal' }, { id: 'ai', name: 'IA' },
      ],
      week: { 1: 'manual' },
      dayPlan: {},
      sourceSchedules: {
        personal: [{ sourceType: 'personal', planId: 'p1', version: 1, active: true, week: { 1: 'personal' } }],
        ai: [{ sourceType: 'ai', planId: 'a1', version: 1, active: true, week: { 1: 'ai' } }],
      },
    }

    const notifications = reminderNotifications(state, 8, 30)

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      id: 101,
      body: 'Você tem 3 sessões disponíveis.',
      extra: { url: '#/workout', optionCount: 3 },
      schedule: { on: { weekday: 2, hour: 8, minute: 30 }, allowWhileIdle: true },
    })
  })

  it('loads and saves the private native snapshot without leaking storage failures', async () => {
    native.readFile.mockResolvedValueOnce({ data: '{"unit":"kg"}' })

    await expect(nativeLoad()).resolves.toEqual({ unit: 'kg' })
    expect(native.readFile).toHaveBeenCalledWith(expect.objectContaining({ directory: 'data', encoding: 'utf8' }))

    await nativeSave({ unit: 'lb' })
    expect(native.writeFile).toHaveBeenCalledWith(expect.objectContaining({ directory: 'data', data: '{"unit":"lb"}', encoding: 'utf8' }))

    native.readFile.mockRejectedValueOnce(new Error('missing'))
    await expect(nativeLoad()).resolves.toBeNull()
    native.writeFile.mockRejectedValueOnce(new Error('full'))
    await expect(nativeSave({ unit: 'kg' })).resolves.toBeUndefined()
  })

  it('keeps reminders disabled without prompting and clears previous schedules', async () => {
    await expect(syncReminder({ reminder: { on: false } })).resolves.toBe(true)

    expect(native.cancel).toHaveBeenCalledOnce()
    expect(native.checkPermissions).not.toHaveBeenCalled()
    expect(native.schedule).not.toHaveBeenCalled()
  })

  it('schedules the available sessions after permission is granted', async () => {
    const state = {
      reminder: { on: true, time: '06:45' }, routines: [{ id: 'manual', name: 'Manual' }],
      week: { 1: 'manual' }, dayPlan: {}, sourceSchedules: { personal: [], ai: [] },
    }

    await expect(syncReminder(state)).resolves.toBe(true)

    expect(native.schedule).toHaveBeenCalledWith({ notifications: [expect.objectContaining({
      id: 101, body: 'Hoje, Manual está no plano — vamos!',
      schedule: { on: { weekday: 2, hour: 6, minute: 45 }, allowWhileIdle: true },
    })] })
  })

  it('requests permission only after an interactive action and fails closed otherwise', async () => {
    const state = { reminder: { on: true }, routines: [{ id: 'manual', name: 'Manual' }], week: { 1: 'manual' }, dayPlan: {}, sourceSchedules: {} }
    native.checkPermissions.mockResolvedValue({ display: 'prompt' })

    await expect(syncReminder(state, false)).resolves.toBe(false)
    expect(native.requestPermissions).not.toHaveBeenCalled()

    await expect(syncReminder(state, true)).resolves.toBe(true)
    expect(native.requestPermissions).toHaveBeenCalledOnce()

    native.checkPermissions.mockRejectedValueOnce(new Error('plugin unavailable'))
    await expect(syncReminder(state, true)).resolves.toBe(false)
  })

  it('shares an export from the native cache directory', async () => {
    native.writeFile.mockResolvedValue({ uri: 'file:///cache/first.json' })

    await shareExport('{"ok":true}', 'first.json')

    expect(native.writeFile).toHaveBeenCalledWith({ path: 'first.json', directory: 'cache', data: '{"ok":true}', encoding: 'utf8' })
    expect(native.share).toHaveBeenCalledWith({ title: 'first.json', url: 'file:///cache/first.json' })
  })
})

describe('Android hardware back button', () => {
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  function setupBackButton(sheets = []) {
    let listener
    const remove = vi.fn().mockResolvedValue(undefined)
    const app = {
      addListener: vi.fn(async (eventName, callback) => {
        listener = callback
        expect(eventName).toBe('backButton')
        return { remove }
      }),
      exitApp: vi.fn().mockResolvedValue(undefined),
    }
    const closeSheet = vi.fn()
    const goBack = vi.fn()
    const cleanup = mobile.registerAndroidBackButton({
      loadApp: async () => app,
      getSheets: () => sheets,
      closeSheet,
      goBack,
    })
    return {
      app, closeSheet, goBack, remove, cleanup,
      async press(canGoBack) {
        await flush()
        expect(app.addListener).toHaveBeenCalledOnce()
        expect(listener).toEqual(expect.any(Function))
        await listener({ canGoBack })
      },
    }
  }

  it('closes only the uppermost unlocked sheet before touching router history', async () => {
    const back = setupBackButton([
      { id: 'lower', locked: false },
      { id: 'top', locked: false },
    ])

    await back.press(true)

    expect(back.closeSheet).toHaveBeenCalledOnce()
    expect(back.closeSheet).toHaveBeenCalledWith('top')
    expect(back.goBack).not.toHaveBeenCalled()
    expect(back.app.exitApp).not.toHaveBeenCalled()
  })

  it('consumes back while the uppermost sheet is locked', async () => {
    const back = setupBackButton([{ id: 'required-weight', locked: true }])

    await back.press(true)

    expect(back.closeSheet).not.toHaveBeenCalled()
    expect(back.goBack).not.toHaveBeenCalled()
    expect(back.app.exitApp).not.toHaveBeenCalled()
  })

  it('uses browser history when the WebView reports a previous route', async () => {
    const back = setupBackButton([])

    await back.press(true)

    expect(back.goBack).toHaveBeenCalledOnce()
    expect(back.closeSheet).not.toHaveBeenCalled()
    expect(back.app.exitApp).not.toHaveBeenCalled()
  })

  it('exits the Android app when there is no sheet or route to return to', async () => {
    const back = setupBackButton([])

    await back.press(false)

    expect(back.app.exitApp).toHaveBeenCalledOnce()
    expect(back.closeSheet).not.toHaveBeenCalled()
    expect(back.goBack).not.toHaveBeenCalled()
  })

  it('removes a late native listener when React cleans up during registration', async () => {
    let resolveApp
    const remove = vi.fn().mockResolvedValue(undefined)
    const app = {
      addListener: vi.fn(async () => ({ remove })),
      exitApp: vi.fn(),
    }
    const cleanup = mobile.registerAndroidBackButton({
      loadApp: () => new Promise(resolve => { resolveApp = resolve }),
      getSheets: () => [],
      closeSheet: vi.fn(),
      goBack: vi.fn(),
    })

    await cleanup()
    resolveApp(app)
    await flush()

    expect(app.addListener).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    await cleanup()
    expect(remove).toHaveBeenCalledOnce()
  })
})
