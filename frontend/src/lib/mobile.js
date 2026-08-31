// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per
// planned weekday — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n.js'
import { APP_SLUG } from './demo.js'
import { scheduledRoutineOptionsForWeekday } from './schedule.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'

const FILE = `${APP_SLUG}-state.json`

export function requestBrowserLocation(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation?.getCurrentPosition) {
      reject(Object.assign(new Error('Geolocation is unavailable.'), { code: 0 }))
      return
    }
    geolocation.getCurrentPosition(position => {
      const latitude = Number(position?.coords?.latitude)
      const longitude = Number(position?.coords?.longitude)
      const accuracy = Number(position?.coords?.accuracy)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        reject(Object.assign(new Error('Geolocation returned invalid coordinates.'), { code: 2 }))
        return
      }
      resolve({ latitude, longitude, ...(Number.isFinite(accuracy) ? { accuracy } : {}) })
    }, reject, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 })
  })
}

// Registers Android's hardware-back listener without importing the native plugin in
// web builds. Dependencies stay explicit so React can clean up an in-flight dynamic
// import safely under StrictMode.
export function registerAndroidBackButton({ loadApp, getSheets, closeSheet, handleBack, goBack }) {
  let disposed = false
  let handle = null
  let removed = false

  const remove = async () => {
    disposed = true
    if (!handle || removed) return
    removed = true
    try { await handle.remove() } catch { /* native teardown is best-effort */ }
  }

  let loading
  try { loading = Promise.resolve(loadApp()) } catch { loading = Promise.reject() }
  void loading.then(async ({ App: app }) => {
    handle = await app.addListener('backButton', ({ canGoBack }) => {
      if (disposed) return
      const sheets = getSheets() || []
      const top = sheets.at(-1)
      if (top) {
        if (!top.locked) closeSheet(top.id)
        return
      }
      if (handleBack?.()) return
      if (canGoBack) goBack()
      else void app.exitApp()
    })
    if (disposed) await remove()
  }).catch(() => {})

  return remove
}

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

export function reminderNotifications(S, hour, minute) {
  return Array.from({ length: 7 }, (_, day) => {
    const options = scheduledRoutineOptionsForWeekday(S, day)
    if (!options.length) return null
    return {
      id: 100 + day,
      title: t('Workout day'),
      body: options.length > 1
        ? t('You have {0} sessions available.', options.length)
        : t('{0} is on the plan today — let’s go!', options[0].routine.name),
      extra: { url: '#/workout', optionCount: options.length },
      schedule: { on: { weekday: day + 1, hour, minute }, allowWhileIdle: true },
    }
  }).filter(Boolean)
}

// (Re)schedule the workout-day reminder: one repeating notification per weekday that has a
// routine in the weekly plan. Cheap enough to run after any state change — the plan or the
// reminder time may just have been edited. `interactive` gates the OS permission prompt to
// the Settings toggle; a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: 100 + d })) }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const [hour, minute] = (r.time || '08:00').split(':').map(Number)
    const notifications = reminderNotifications(S, hour, minute)
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}
