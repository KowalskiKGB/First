import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF } from '../store/useStore.js'
import { useCollaboration } from '../store/useCollaboration.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ } from '../lib/format.js'
import { effortOf } from '../lib/history.js'
import { api, IS_ANDROID } from '../lib/api.js'
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { DEFAULT_LANG, t, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { APP_NAME, DEMO, REPO } from '../lib/demo.js'
import { MOBILE, shareExport, syncReminder } from '../lib/mobile.js'
import { mediaEnabled } from '../lib/exercises.js'
import { confirmSheet, importFromApp } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField, NumberField } from '../components/ui.jsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update, replaceState, signOut, signOutAll, resetDemo } = useStore()
  const profile = useCollaboration(s => s.profile)
  const profileOwnerId = useCollaboration(s => s.ownerId)
  const context = useCollaboration(s => s.context)
  const setContext = useCollaboration(s => s.setContext)
  const activateTrainer = useCollaboration(s => s.activateTrainer)
  const loadCollaboration = useCollaboration(s => s.load)
  const resetCollaboration = useCollaboration(s => s.reset)
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const wakeOK = wakeLockSupported()

  const doExport = async () => {
    const json = JSON.stringify(S, null, 2)
    const name = 'first-backup-' + todayISO() + '.json'
    // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not a First backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), data), true); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  const editProfile = () => useUI.getState().openSheet(close => <ProfileEditor close={close} />)
  const choosePortal = next => {
    setContext(next, user)
    nav(next === 'trainer' ? '/personal' : '/home')
  }
  const activatePersonal = async () => {
    try {
      await activateTrainer()
      await loadCollaboration(user)
      setContext('trainer', user)
      nav('/personal')
      toast(t('Personal profile activated'))
    } catch (error) { toast(error.message || t('Could not activate Personal')) }
  }
  // Ends the profile's sessions on every device — this one included, so on success it lands in
  // the same place as the plain sign-out above (home, local data cleared). On failure nothing
  // local is touched: still signed in here, and say so rather than leaving a half-signed-out app.
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. You can sign in again with your email and password.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* Authentication starts on Home; Settings only edits an existing profile. */}
    {DEMO ? <Section title={t('Demo')}>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym').replace('openGym', APP_NAME)} subtitle={t('Sync across your devices while keeping control of your data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </Section> : user ? <Section title={t('Profile')}>
        <Row icon="personCircle" iconTint="var(--acc)" title={user.name} subtitle={user.email || t('Email not informed')} accessory="chevron" onClick={editProfile} />
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
        <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
      </Section> : null}

    {user && profileOwnerId === user.id && profile && <Section title={t('Portal')}>
      {profile.roles?.includes('trainer') ? (
        profile.roles.includes('student') ? (
          <Row icon="person" iconTint="var(--acc)" title={t('Use First as')}>
            <Segmented className="seg-inline"
              options={[{ value: 'student', label: t('Student') }, { value: 'trainer', label: t('Personal') }]}
              value={context === 'trainer' ? 'trainer' : 'student'} onChange={choosePortal} />
          </Row>
        ) : (
          <Row icon="chart" iconTint="var(--acc)" title={t('Open Personal portal')} accessory="chevron" onClick={() => choosePortal('trainer')} />
        )
      ) : (
        <Row icon="chart" iconTint="var(--acc)" title={t('Activate Personal profile')}
          subtitle={t('Organize students, schedules and receivables without mixing them with your own training.')}
          accessory="chevron" onClick={activatePersonal} />
      )}
    </Section>}

    {/* ---------- general ---------- */}
    <Section title={t('General')} footer={t('Note: switching units only changes the label — logged numbers are not converted.')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={S.lang || DEFAULT_LANG} onChange={v => update(s => { s.lang = v })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => update(s => { s.unit = v })} />
      </Row>
    </Section>

    {/* ---------- during a workout ---------- */}
    <Section title={t('During a workout')} footer={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : null}>
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))} />
      {(wakeOK || !MOBILE) && (
        <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
          subtitle={wakeOK ? null : t('Not supported in this browser.')}>
          <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
            onChange={v => update(s => { s.keepAwake = v })} />
        </Row>
      )}
      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')}>
        <Switch checked={!!S.sound} onChange={v => update(s => { s.sound = v })} />
      </Row>
      {/* Two names for the same judgement, so the column asks in the scale you already think in.
          The (i) sits before the control — you read it on the way to the choice, not after it. */}
      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
    </Section>

    {(user || MOBILE) && <NotificationsCard S={S} update={update} toast={toast} />}

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' ? 'light' : 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>

    {/* ---------- data: fill it, bring things over, back it up, wipe it ---------- */}
    <Section title={t('Data')}>
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { resetCollaboration(); replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    {/* "Add to Home screen" makes no sense inside the native app */}
    {!MOBILE && <Section title={t('Tip')}>
      <Row icon="lightbulb" iconTint="var(--yellow)"
        title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
        subtitle={t('to install openGym as a full-screen app.').replace('openGym', APP_NAME) + ' ' + (user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!'))} />
    </Section>}

    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      {APP_NAME} · {t('free & open source (AGPL v3)')}<br />
      <a href={REPO} target="_blank" rel="noopener">código-fonte</a> · dados de exercícios: hasaneyldrm/exercises-dataset (MIT)
      {mediaEnabled && <><br />mídia visual: <a href="https://gymvisual.com/" target="_blank" rel="noopener noreferrer">© Gym visual</a></>}
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

function NotificationsCard({ S, update, toast }) {
  if (MOBILE) return <MobileReminderCard S={S} update={update} toast={toast} />
  return <PushCard S={S} update={update} toast={toast} />
}

// Mobile build: the reminder is a native local notification scheduled on planned weekdays —
// no push server involved. The schedule itself is (re)synced by the store on every persist;
// this card only owns the OS permission prompt when the switch turns on.
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section title={t('Notifications')}
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
    </Section>
  )
}

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  if (!supported) return (
    <Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      title={t('Notifications')}
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer alerts, even if openGym is closed.').replace('openGym', APP_NAME)}>
        <Switch checked={on} disabled={busy} onChange={toggle} />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}

const PROFILE_GOALS = [
  ['weight_loss', 'Lose weight'],
  ['muscle_gain', 'Gain muscle'],
  ['both', 'Both'],
]

const kgFromLocal = (weight, unit) => unit === 'lb' ? weight * 0.45359237 : weight
const localFromKg = (weight, unit) => unit === 'lb' ? weight / 0.45359237 : weight
const rounded = value => Math.round(Number(value) * 10) / 10
const normalizedGoal = goal => goal === 'lose_weight' ? 'weight_loss' : goal === 'gain_muscle' ? 'muscle_gain' : goal || ''

function profileDraft(user, S, profile = {}) {
  const latestWeight = (S.bodyweight || []).slice(-1)[0]?.w
  const localProfile = S.aiProfile || {}
  const measurements = { ...(localProfile.measurements || {}), ...(profile.measurements || {}) }
  return {
    fullName: user?.name || '',
    email: user?.email || '',
    weightKg: profile.weightKg ?? (latestWeight ? rounded(kgFromLocal(latestWeight, S.unit)) : ''),
    heightCm: profile.heightCm ?? localProfile.heightCm ?? '',
    waistCm: measurements.waistCm ?? '',
    armCm: measurements.armCm ?? '',
    goal: normalizedGoal(profile.goal ?? localProfile.goal),
    measurements,
  }
}

function validOptional(value, min, max) {
  return value === '' || value == null || (Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max)
}

function ProfileEditor({ close }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const setUser = useStore(s => s.setUser)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [draft, setDraft] = useState(() => profileDraft(user, S))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    api('/api/profile')
      .then(response => { if (mounted) setDraft(profileDraft(response.user || user, S, response.profile)) })
      .catch(() => { if (mounted) setError(t('Could not load your profile. You can still edit the data saved on this device.')) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  const patch = next => setDraft(current => ({ ...current, ...next }))
  const save = async event => {
    event.preventDefault()
    setError('')
    const fullName = draft.fullName.trim()
    if (!fullName) { setError(t('Enter your full name.')); return }
    if (!validOptional(draft.weightKg, 20, 350)) { setError(t('Enter a valid weight.')); return }
    if (!validOptional(draft.heightCm, 80, 250)) { setError(t('Enter a valid height.')); return }
    if (!validOptional(draft.waistCm, 10, 250) || !validOptional(draft.armCm, 10, 250)) {
      setError(t('Enter valid body measurements.')); return
    }

    const measurements = { ...draft.measurements }
    if (draft.waistCm === '' || draft.waistCm == null) delete measurements.waistCm
    else measurements.waistCm = Number(draft.waistCm)
    if (draft.armCm === '' || draft.armCm == null) delete measurements.armCm
    else measurements.armCm = Number(draft.armCm)
    const payload = { fullName, measurements }
    if (draft.goal) payload.goal = draft.goal
    if (draft.weightKg !== '' && draft.weightKg != null) payload.weightKg = Number(draft.weightKg)
    if (draft.heightCm !== '' && draft.heightCm != null) payload.heightCm = Number(draft.heightCm)

    setBusy(true)
    try {
      const response = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
      const nextUser = response.user || { ...user, name: fullName }
      const nextProfile = { ...payload, ...(response.profile || {}) }
      setUser(nextUser)
      update(state => {
        state.aiProfile = {
          ...DEF.aiProfile,
          ...(state.aiProfile || {}),
          heightCm: nextProfile.heightCm ?? state.aiProfile?.heightCm ?? '',
          goal: normalizedGoal(nextProfile.goal),
          measurements: { ...(state.aiProfile?.measurements || {}), ...(nextProfile.measurements || {}) },
        }
        if (nextProfile.weightKg > 0) {
          const date = todayISO()
          const weight = rounded(localFromKg(nextProfile.weightKg, state.unit))
          const existing = state.bodyweight.find(item => item.d === date)
          if (existing) { existing.w = weight; existing.t = Date.now() }
          else state.bodyweight.push({ d: date, w: weight, t: Date.now() })
          state.bodyweight.sort((a, b) => a.d.localeCompare(b.d))
        }
      })
      close()
      toast(t('Profile updated'))
    } catch (requestError) {
      setError(requestError.message || t('Could not save your profile.'))
    } finally { setBusy(false) }
  }

  return <>
    <h3>{t('Edit profile')}</h3>
    <p className="sheet-intro">{t('Keep your measurements current so your progress and AI recommendations stay useful.')}</p>
    {error ? <p className="form-error mutation-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted small" role="status">{t('Loading profile…')}</p> : null}
    <form className="personal-form" onSubmit={save} aria-label={t('Edit profile')} aria-busy={loading || busy}>
      <fieldset className="personal-fieldset" disabled={loading || busy}>
        <legend>{t('Account')}</legend>
        <label className="form-field"><span>{t('Full name')}</span><TextField name="profile-full-name" autoComplete="name" maxLength={80} required value={draft.fullName} onChange={event => patch({ fullName: event.target.value })} /></label>
        <label className="form-field"><span>{t('Email')}</span><TextField name="profile-email" type="email" autoComplete="email" value={draft.email} disabled /><small className="form-hint">{t('Changing your email requires a protected confirmation flow.')}</small></label>
      </fieldset>
      <fieldset className="personal-fieldset" disabled={loading || busy}>
        <legend>{t('Body and goal')}</legend>
        <div className="personal-form-grid compact">
          <label className="form-field"><span>{t('Current weight')} (kg)</span><NumberField className="field" name="profile-weight" value={draft.weightKg} nullable onChange={weightKg => patch({ weightKg })} /></label>
          <label className="form-field"><span>{t('Height (cm)')}</span><NumberField className="field" name="profile-height" value={draft.heightCm} decimal={false} nullable onChange={heightCm => patch({ heightCm })} /></label>
          <label className="form-field"><span>{t('Waist')} (cm)</span><NumberField className="field" name="profile-waist" value={draft.waistCm} nullable onChange={waistCm => patch({ waistCm })} /></label>
          <label className="form-field"><span>{t('Arm')} (cm)</span><NumberField className="field" name="profile-arm" value={draft.armCm} nullable onChange={armCm => patch({ armCm })} /></label>
        </div>
        <label className="form-field"><span>{t('Main goal')}</span><select className="field" name="profile-goal" value={draft.goal} onChange={event => patch({ goal: event.target.value })}><option value="">{t('Choose later')}</option>{PROFILE_GOALS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      </fieldset>
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={loading || busy}>{busy ? t('Saving…') : t('Save changes')}</Button>
        <Button type="button" variant="ghost" onClick={close} disabled={busy}>{t('Cancel')}</Button>
      </div>
    </form>
  </>
}
