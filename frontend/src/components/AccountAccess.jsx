import { useId, useState } from 'react'

import { t } from '../lib/i18n.js'
import { Button, NumberField, TextField } from './ui.jsx'

const EMPTY_VALUES = {
  fullName: '',
  email: '',
  password: '',
  weightKg: null,
  heightCm: null,
  waistCm: null,
  armCm: null,
  goal: '',
}

function registrationPayload(values) {
  const payload = {
    fullName: values.fullName.trim(),
    email: values.email.trim(),
    password: values.password,
  }
  for (const key of ['weightKg', 'heightCm', 'waistCm', 'armCm', 'goal']) {
    if (values[key] !== '' && values[key] != null) payload[key] = values[key]
  }
  return payload
}

export function AccountAccess({
  mode = 'login',
  onModeChange,
  onSubmit,
  busy = false,
  error = '',
  initialValues = {},
}) {
  const prefix = useId()
  const [values, setValues] = useState(() => ({ ...EMPTY_VALUES, ...initialValues }))
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
    const credentials = { email: values.email.trim(), password: values.password }
    onSubmit?.(register ? registrationPayload(values) : credentials)
  }

  return (
    <section className="account-access" aria-labelledby={`${prefix}-title`}>
      <div className="account-access-heading">
        <span className="account-access-eyebrow">{t(register ? 'New training profile' : 'Your training profile')}</span>
        <h2 id={`${prefix}-title`}>{t(register ? 'Create account' : 'Sign in')}</h2>
        <p>{t(register
          ? 'Create your account now. You can complete the body details later.'
          : 'Sign in to sync your workouts and build a weekly plan with AI.')}</p>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <form className="account-access-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          {register ? (
            <label htmlFor={`${prefix}-fullName`}>
              <span>{t('Full name')}</span>
              <TextField id={`${prefix}-fullName`} name="fullName" type="text" autoComplete="name" maxLength={80} required {...field('fullName')} />
            </label>
          ) : null}

          <label htmlFor={`${prefix}-email`}>
            <span>{t('Email')}</span>
            <TextField id={`${prefix}-email`} name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} required {...field('email')} />
          </label>

          <label htmlFor={`${prefix}-password`}>
            <span>{t('Password')}</span>
            <TextField id={`${prefix}-password`} name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={6} maxLength={128} required {...field('password')} />
            {register ? <small>{t('Use at least 6 characters.')}</small> : null}
          </label>

          {register ? (
            <div className="account-access-profile">
              <div className="account-access-profile-copy">
                <strong>{t('Help us personalize your training')}</strong>
                <span>{t('These details are optional and can be changed in your profile.')}</span>
              </div>
              <div className="account-access-measures">
                <label htmlFor={`${prefix}-weightKg`}>
                  <span>{t('Current weight')}</span>
                  <NumberField id={`${prefix}-weightKg`} name="weightKg" inputMode="decimal" decimal nullable placeholder={t('kg')} {...numberField('weightKg')} />
                </label>
                <label htmlFor={`${prefix}-heightCm`}>
                  <span>{t('Height')}</span>
                  <NumberField id={`${prefix}-heightCm`} name="heightCm" inputMode="decimal" decimal nullable placeholder={t('cm')} {...numberField('heightCm')} />
                </label>
                <label htmlFor={`${prefix}-waistCm`}>
                  <span>{t('Waist')}</span>
                  <NumberField id={`${prefix}-waistCm`} name="waistCm" inputMode="decimal" decimal nullable placeholder={t('cm')} {...numberField('waistCm')} />
                </label>
                <label htmlFor={`${prefix}-armCm`}>
                  <span>{t('Arm')}</span>
                  <NumberField id={`${prefix}-armCm`} name="armCm" inputMode="decimal" decimal nullable placeholder={t('cm')} {...numberField('armCm')} />
                </label>
              </div>
              <label htmlFor={`${prefix}-goal`}>
                <span>{t('Main goal')}</span>
                <select id={`${prefix}-goal`} className="field" name="goal" {...field('goal')}>
                  <option value="">{t('Choose later')}</option>
                  <option value="weight_loss">{t('Lose weight')}</option>
                  <option value="muscle_gain">{t('Gain muscle')}</option>
                  <option value="both">{t('Both')}</option>
                </select>
              </label>
            </div>
          ) : null}

          <Button type="submit" variant="primary" className="account-access-submit" disabled={busy}>
            {busy ? t('Please wait…') : t(register ? 'Create my account' : 'Sign in')}
          </Button>
        </fieldset>
      </form>

      <button
        type="button"
        className="account-access-switch"
        onClick={() => onModeChange?.(register ? 'login' : 'register')}
        disabled={busy}
      >
        {t(register ? 'Already have an account' : 'Create account')}
      </button>
    </section>
  )
}
