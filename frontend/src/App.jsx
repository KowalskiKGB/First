import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { hasData, useStore } from './store/useStore.js'
import { useCollaboration } from './store/useCollaboration.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { AccountAccess } from './components/AccountAccess.jsx'
import { api } from './lib/api.js'
import { ACCENTS, todayISO } from './lib/format.js'
import { DEFAULT_LANG, setLang, t, useLang } from './lib/i18n.js'
import { MOBILE, registerAndroidBackButton } from './lib/mobile.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'
import Admin from './views/Admin.jsx'
import DevPanel from './views/DevPanel.jsx'
import PersonalGuard from './views/personal/PersonalGuard.jsx'
import PersonalHome from './views/personal/PersonalHome.jsx'
import Students from './views/personal/Students.jsx'
import StudentDetail from './views/personal/StudentDetail.jsx'
import Agenda from './views/personal/Agenda.jsx'
import Finance from './views/personal/Finance.jsx'
import Connections from './views/student/Connections.jsx'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

const optionalNumber = value => value === '' || value == null ? undefined : Number(value)

function registrationBody(values) {
  const measurements = Object.fromEntries([
    ['waistCm', optionalNumber(values.waistCm)],
    ['armCm', optionalNumber(values.armCm)],
  ].filter(([, value]) => Number.isFinite(value)))
  return {
    email: values.email,
    fullName: values.fullName,
    password: values.password,
    ...(Number.isFinite(optionalNumber(values.weightKg)) ? { weightKg: optionalNumber(values.weightKg) } : {}),
    ...(Number.isFinite(optionalNumber(values.targetWeightKg)) ? { targetWeightKg: optionalNumber(values.targetWeightKg) } : {}),
    ...(Number.isFinite(optionalNumber(values.heightCm)) ? { heightCm: optionalNumber(values.heightCm) } : {}),
    ...(Object.keys(measurements).length ? { measurements } : {}),
    ...(values.goal ? { goal: values.goal } : {}),
    ...(values.inviteCode ? { inviteCode: values.inviteCode } : {}),
  }
}

function mergeRegistrationProfile(profile = {}, values = {}) {
  const weightKg = optionalNumber(profile.weightKg ?? values.weightKg)
  const targetWeightKg = optionalNumber(profile.targetWeightKg ?? values.targetWeightKg)
  const heightCm = optionalNumber(profile.heightCm ?? values.heightCm)
  const measurements = { ...(profile.measurements || {}) }
  for (const key of ['waistCm', 'armCm']) {
    const value = optionalNumber(values[key])
    if (measurements[key] == null && Number.isFinite(value)) measurements[key] = value
  }
  useStore.getState().update(state => {
    state.aiProfile = {
      ...state.aiProfile,
      ...(Number.isFinite(heightCm) ? { heightCm } : {}),
      ...(profile.goal || values.goal ? { goal: profile.goal || values.goal } : {}),
      measurements: { ...(state.aiProfile?.measurements || {}), ...measurements },
    }
    if (Number.isFinite(weightKg)) {
      const value = state.unit === 'lb' ? Math.round(weightKg * 22.046226218) / 10 : weightKg
      const date = todayISO()
      const timestamp = Date.now()
      const exists = state.bodyweight.some(entry => entry.d === date)
      state.bodyweight = exists
        ? state.bodyweight.map(entry => entry.d === date ? { ...entry, w: value, t: timestamp } : entry)
        : [...state.bodyweight, { d: date, w: value, t: timestamp }]
    }
    if (Number.isFinite(targetWeightKg)) {
      state.targetW = state.unit === 'lb' ? Math.round(targetWeightKg * 22.046226218) / 10 : targetWeightKg
    }
  }, false)
}

const localKg = (value, unit) => unit === 'lb' ? Number(value) / 2.2046226218 : Number(value)
const oneDecimal = value => Math.round(Number(value) * 10) / 10

function registrationInitialValues(state = {}) {
  const bodyweight = Array.isArray(state.bodyweight) ? state.bodyweight : []
  const latest = bodyweight.slice().sort((a, b) => String(b?.d || '').localeCompare(String(a?.d || '')))[0]
  const profile = state.aiProfile || {}
  const measurements = profile.measurements || {}
  const goal = profile.goal === 'lose_weight' ? 'weight_loss' : profile.goal === 'gain_muscle' ? 'muscle_gain' : profile.goal || ''
  return {
    ...(Number.isFinite(Number(latest?.w)) ? { weightKg: oneDecimal(localKg(latest.w, state.unit)) } : {}),
    ...(Number.isFinite(Number(state.targetW)) ? { targetWeightKg: oneDecimal(localKg(state.targetW, state.unit)) } : {}),
    ...(Number.isFinite(Number(profile.heightCm)) ? { heightCm: Number(profile.heightCm) } : {}),
    ...(Number.isFinite(Number(measurements.waistCm)) ? { waistCm: Number(measurements.waistCm) } : {}),
    ...(Number.isFinite(Number(measurements.armCm)) ? { armCm: Number(measurements.armCm) } : {}),
    ...(goal ? { goal } : {}),
  }
}

const validAuthUser = user => !!user && typeof user.id === 'string' && !!user.id && typeof user.name === 'string' && !!user.name.trim()

function AccountSheet({ initialMode, close }) {
  const [mode, setMode] = useState(initialMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const [initialValues] = useState(() => registrationInitialValues(useStore.getState().S))

  useEffect(() => {
    let current = true
    api('/api/config').then(config => {
      if (current) setInviteOnly(config.invite_only === true)
    }).catch(() => {})
    return () => { current = false }
  }, [])

  const submit = async values => {
    setBusy(true); setError('')
    try {
      const registering = mode === 'register'
      const hadLocalData = hasData(useStore.getState().S)
      const response = await api(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(registering ? registrationBody(values) : { email: values.email, password: values.password }),
      })
      let authenticatedUser = response?.user
      if (!validAuthUser(authenticatedUser)) {
        try { authenticatedUser = (await api('/api/me'))?.user } catch { authenticatedUser = null }
      }
      if (!validAuthUser(authenticatedUser)) throw new Error('The account response could not be confirmed. Please sign in again.')
      const store = useStore.getState()
      store.setUser(authenticatedUser)
      if (registering) {
        mergeRegistrationProfile(response.profile, values)
        await useStore.getState().pushState()
        useUI.getState().toast(t(hadLocalData ? 'Profile created — data from this device moved into it' : 'Welcome, {0}', authenticatedUser.name))
      } else {
        await store.pullState()
        useUI.getState().toast(t('Welcome back, {0}', authenticatedUser.name))
      }
      close()
    } catch (requestError) {
      setError(t(requestError?.message || (mode === 'register' ? 'Registration failed' : 'Sign-in failed')))
    } finally {
      setBusy(false)
    }
  }

  return <AccountAccess mode={mode} onModeChange={setMode} onSubmit={submit} busy={busy} error={error} initialValues={initialValues} inviteOnly={inviteOnly} onClose={close} />
}

function AccountAccessListener() {
  useEffect(() => {
    const open = event => {
      const initialMode = event.detail?.mode === 'register' ? 'register' : 'login'
      useUI.getState().openSheet(close => <AccountSheet initialMode={initialMode} close={close} />, { kind: 'center' })
    }
    window.addEventListener('first:account', open)
    return () => window.removeEventListener('first:account', open)
  }, [])
  return null
}

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const loadCollaboration = useCollaboration(s => s.load)
  const programs = useCollaboration(s => s.programs)
  const syncPersonalPrograms = useStore(s => s.syncPersonalPrograms)
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  useEffect(() => { setLang(S.lang || DEFAULT_LANG) }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || DEFAULT_LANG }, [langV, S.lang])
  useEffect(() => { loadCollaboration(useStore.getState().user) }, [loadCollaboration, user?.id, isGuest])
  useEffect(() => { if (Array.isArray(programs)) syncPersonalPrograms(programs) }, [programs, syncPersonalPrograms])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  if (!ready && !user && !isGuest) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/plan/r/:id" element={<RoutineEdit />} />
            <Route path="/workout" element={<Workout />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/history" element={<History />} />
            <Route path="/library" element={<Library />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
            <Route path="/personal" element={<PersonalGuard><PersonalHome /></PersonalGuard>} />
            <Route path="/personal/alunos" element={<PersonalGuard><Students /></PersonalGuard>} />
            <Route path="/personal/alunos/:id" element={<PersonalGuard><StudentDetail /></PersonalGuard>} />
            <Route path="/personal/alunos/:id/:tab" element={<PersonalGuard><StudentDetail /></PersonalGuard>} />
            <Route path="/personal/agenda" element={<PersonalGuard><Agenda /></PersonalGuard>} />
            <Route path="/personal/financeiro" element={<PersonalGuard><Finance /></PersonalGuard>} />
            <Route path="/aluno/conexoes" element={<Connections />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </ErrorBoundary>
      </div>
      <TabBar onStart={startFlow} />
      <RestTimer />
      <Modals />
      <Toast />
    </>
  )
}

function StudentApp() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  useEffect(() => {
    if (!MOBILE) return undefined
    return registerAndroidBackButton({
      loadApp: async () => (await import('@capacitor/app')).App,
      getSheets: () => useUI.getState().sheets,
      closeSheet: id => useUI.getState().closeSheet(id),
      goBack: () => window.history.back(),
    })
  }, [])
  return <>
    <AccountAccessListener />
    <HashRouter><Shell /></HashRouter>
  </>
}

function DevAdminApp() {
  useLang()
  useEffect(() => {
    applyPrefs('dark', 'lime')
    document.documentElement.lang = DEFAULT_LANG === 'pt' ? 'pt-BR' : DEFAULT_LANG
    void setLang(DEFAULT_LANG)
  }, [])
  return <><DevPanel /><Toast /></>
}

export default function App() {
  if (window.location.pathname.replace(/\/+$/, '') === '/devadmin') return <DevAdminApp />
  return <StudentApp />
}
