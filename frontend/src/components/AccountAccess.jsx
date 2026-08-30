import { useId, useRef, useState } from 'react'

import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button, NumberField, TextField } from './ui.jsx'

const EMPTY_VALUES = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  inviteCode: '',
  weightKg: '',
  targetWeightKg: '',
  heightM: '',
  waistCm: '',
  armCm: '',
  goal: '',
}

const GOALS = [
  ['', 'Choose later'],
  ['weight_loss', 'Lose weight'],
  ['muscle_gain', 'Gain muscle'],
  ['both', 'Both'],
]

const heightInMetres = heightCm => {
  const value = Number(heightCm)
  return Number.isFinite(value) && value > 0
    ? (value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : ''
}

const normalizeHeightInput = input => {
  const value = String(input ?? '').trim().replace('.', ',')
  const digits = value.replace(/\D/g, '')
  if (/^\d{3,4}$/.test(digits) && !value.startsWith('1,')) return `${digits[0]},${digits.slice(1, 3)}`
  return value.slice(0, 4)
}

const heightInCentimetres = heightM => {
  const value = Number(String(heightM).replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? Math.round(value > 3 ? value : value * 100) : null
}

function accessDraft(initialValues) {
  const { heightCm, ...values } = initialValues
  return { ...EMPTY_VALUES, ...values, heightM: values.heightM != null ? normalizeHeightInput(values.heightM) : heightInMetres(heightCm) }
}

function registrationPayload(values) {
  const payload = {
    fullName: values.fullName.trim(),
    email: values.email.trim(),
    password: values.password,
  }
  if (values.inviteCode?.trim()) payload.inviteCode = values.inviteCode.trim().toUpperCase()
  for (const key of ['weightKg', 'targetWeightKg', 'waistCm', 'armCm', 'goal']) {
    if (values[key] !== '' && values[key] != null) payload[key] = values[key]
  }
  const heightCm = heightInCentimetres(values.heightM)
  if (heightCm) payload.heightCm = heightCm
  return payload
}

export function AccountAccess({
  mode = 'login',
  onModeChange,
  onSubmit,
  busy = false,
  error = '',
  initialValues = {},
  inviteOnly = false,
  onClose,
}) {
  const prefix = useId()
  const [values, setValues] = useState(() => accessDraft(initialValues))
  const [validationError, setValidationError] = useState('')
  const confirmPasswordRef = useRef(null)
  const register = mode === 'register'
  const field = name => ({
    value: values[name] ?? '',
    onChange: event => setValues(current => ({ ...current, [name]: event.target.value })),
  })
  const numberField = name => ({
    value: values[name],
    onChange: value => setValues(current => ({ ...current, [name]: value })),
  })
  const submit = event => {
    event.preventDefault()
    if (register && values.password !== values.confirmPassword) {
      setValidationError(t('Passwords do not match.'))
      confirmPasswordRef.current?.focus()
      return
    }
    setValidationError('')
    const credentials = { email: values.email.trim(), password: values.password }
    onSubmit?.(register ? registrationPayload(values) : credentials)
  }

  return (
    <section className="account-access" aria-labelledby={`${prefix}-title`}>
      <div className="account-access-heading">
        {onClose ? <button type="button" className="iconbtn account-access-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button> : null}
        <span className="account-access-eyebrow">{t(register ? 'New training profile' : 'Your training profile')}</span>
        <h2 id={`${prefix}-title`}>{t(register ? 'Create account' : 'Sign in')}</h2>
        <p>{t(register
          ? 'Create your account now. You can complete the body details later.'
          : 'Sign in to sync your workouts and build a weekly plan with AI.')}</p>
      </div>

      {error || validationError ? <p id={`${prefix}-form-error`} className="form-error" role="alert">{validationError || error}</p> : null}

      <form className="account-access-form" onSubmit={submit}>
        <fieldset className="account-access-section" disabled={busy}>
          <legend>{t('Access')}</legend>
          {register ? (
            <label htmlFor={`${prefix}-fullName`}>
              <span>{t('Full name')}</span>
              <TextField id={`${prefix}-fullName`} name="fullName" type="text" autoComplete="name" maxLength={80} required {...field('fullName')} />
            </label>
          ) : null}

          <label htmlFor={`${prefix}-email`}>
            <span>{t('Email')}</span>
            <TextField id={`${prefix}-email`} name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} maxLength={254} required {...field('email')} />
          </label>

          <label htmlFor={`${prefix}-password`}>
            <span>{t('Password')}</span>
            <TextField id={`${prefix}-password`} name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={6} maxLength={128} required {...field('password')} />
            {register ? <small>{t('Use at least 6 characters.')}</small> : null}
          </label>

          {register ? (
            <label htmlFor={`${prefix}-confirmPassword`}>
              <span>{t('Confirm password')}</span>
              <TextField
                ref={confirmPasswordRef}
                id={`${prefix}-confirmPassword`}
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
                aria-invalid={validationError ? true : undefined}
                aria-describedby={validationError ? `${prefix}-form-error` : undefined}
                value={values.confirmPassword}
                onChange={event => {
                  const confirmPassword = event.target.value
                  setValues(current => ({ ...current, confirmPassword }))
                  if (validationError && confirmPassword === values.password) setValidationError('')
                }}
              />
            </label>
          ) : null}

          {register && inviteOnly ? (
            <label htmlFor={`${prefix}-inviteCode`}>
              <span>{t('Invite code')}</span>
              <TextField id={`${prefix}-inviteCode`} name="inviteCode" type="text" autoComplete="one-time-code" maxLength={40} required {...field('inviteCode')} />
              <small>{t('This app is invite-only — enter the code you were given.')}</small>
            </label>
          ) : null}
        </fieldset>

          {register ? (
            <fieldset className="account-access-section account-access-profile" disabled={busy}>
              <legend>{t('Body and goal')}</legend>
              <div className="account-access-profile-copy">
                <strong>{t('Help us personalize your training')}</strong>
                <span>{t('These details are optional and can be changed in your profile.')}</span>
              </div>
              <div className="account-access-measures">
                <label className="measure-card" htmlFor={`${prefix}-weightKg`}>
                  <span>{t('Current weight')} (kg)</span>
                  <NumberField id={`${prefix}-weightKg`} name="weightKg" aria-label={`${t('Current weight')} em kg`} autoComplete="off" decimal nullable placeholder="kg" {...numberField('weightKg')} />
                </label>
                <label className="measure-card" htmlFor={`${prefix}-targetWeightKg`}>
                  <span>{t('Target weight')} (kg)</span>
                  <NumberField id={`${prefix}-targetWeightKg`} name="targetWeightKg" aria-label={`${t('Target weight')} em kg`} autoComplete="off" decimal nullable placeholder="kg" {...numberField('targetWeightKg')} />
                </label>
                <label className="measure-card" htmlFor={`${prefix}-heightM`}>
                  <span>{t('Height')} (m)</span>
                  <TextField id={`${prefix}-heightM`} name="heightM" type="text" inputMode="decimal" aria-label={`${t('Height')} em metros`} autoComplete="off" placeholder="1,77" value={values.heightM} onChange={event => setValues(current => ({ ...current, heightM: normalizeHeightInput(event.target.value) }))} />
                </label>
                <label className="measure-card" htmlFor={`${prefix}-waistCm`}>
                  <span>{t('Waist')} (cm)</span>
                  <NumberField id={`${prefix}-waistCm`} name="waistCm" aria-label={`${t('Waist')} em cm`} autoComplete="off" decimal nullable placeholder="cm" {...numberField('waistCm')} />
                </label>
                <label className="measure-card" htmlFor={`${prefix}-armCm`}>
                  <span>{t('Arm')} (cm)</span>
                  <NumberField id={`${prefix}-armCm`} name="armCm" aria-label={`${t('Arm')} em cm`} autoComplete="off" decimal nullable placeholder="cm" {...numberField('armCm')} />
                </label>
              </div>
              <fieldset className="account-access-goals">
                <legend>{t('Main goal')}</legend>
                {GOALS.map(([value, label]) => (
                  <label key={value || 'later'} className="account-access-goal">
                    <input type="radio" name="goal" value={value} checked={values.goal === value} onChange={event => setValues(current => ({ ...current, goal: event.target.value }))} autoComplete="off" />
                    <span>{t(label)}</span>
                  </label>
                ))}
              </fieldset>
            </fieldset>
          ) : null}

          <Button type="submit" variant="primary" className="account-access-submit" disabled={busy}>
            {busy ? t('Please wait…') : t(register ? 'Create my account' : 'Sign in')}
          </Button>
      </form>

      <button
        type="button"
        className="account-access-switch"
        onClick={() => {
          setValidationError('')
          onModeChange?.(register ? 'login' : 'register')
        }}
        disabled={busy}
      >
        {t(register ? 'Already have an account' : 'Create account')}
      </button>
    </section>
  )
}
