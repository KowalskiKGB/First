import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/i18n.js', () => ({
  t: (message, ...args) => args.reduce((text, value, index) => text.replaceAll(`{${index}}`, value), message),
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('./ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  NumberField: ({ decimal, nullable, value, ...props }) => <input value={value ?? ''} {...props} />,
  TextField: props => <input {...props} />,
}))

import { AccountAccess } from './AccountAccess.jsx'

const fieldNames = markup => [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(match => match[1])
const fieldTag = (markup, name) => markup.match(new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bname="${name}"[^>]*>`))?.[0] || ''

describe('AccountAccess', () => {
  it('offers a focused email/password login and a registration switch', () => {
    const markup = renderToStaticMarkup(<AccountAccess mode="login" onModeChange={() => {}} onSubmit={() => {}} onClose={() => {}} />)

    expect(fieldNames(markup)).toEqual(['email', 'password'])
    expect(fieldTag(markup, 'email')).toContain('type="email"')
    expect(fieldTag(markup, 'email')).toContain('autoComplete="email"')
    expect(fieldTag(markup, 'email')).not.toContain('spellCheck="true"')
    expect(fieldTag(markup, 'password')).toContain('type="password"')
    expect(fieldTag(markup, 'password')).toContain('autoComplete="current-password"')
    expect(markup).toContain('aria-label="Close"')
    expect(markup).toContain('Create account')
  })

  it('collects required credentials and optional training-profile data on registration', () => {
    const markup = renderToStaticMarkup(<AccountAccess mode="register" onModeChange={() => {}} onSubmit={() => {}} />)

    expect(fieldNames(markup)).toEqual([
      'fullName', 'email', 'password', 'weightKg', 'heightCm', 'waistCm', 'armCm', 'goal',
    ])
    expect(fieldTag(markup, 'fullName')).toContain('required=""')
    expect(fieldTag(markup, 'email')).toContain('required=""')
    expect(fieldTag(markup, 'password')).toContain('required=""')
    for (const name of ['weightKg', 'heightCm', 'waistCm', 'armCm', 'goal']) {
      expect(fieldTag(markup, name)).not.toContain('required=""')
      expect(fieldTag(markup, name)).toContain('autoComplete="off"')
    }
    expect(markup).toContain('Lose weight')
    expect(markup).toContain('Gain muscle')
    expect(markup).toContain('Both')
    expect(markup).toContain('Already have an account')
  })

  it('asks for an invite code only when the instance requires one', () => {
    const openMarkup = renderToStaticMarkup(<AccountAccess mode="register" onModeChange={() => {}} onSubmit={() => {}} />)
    const inviteMarkup = renderToStaticMarkup(<AccountAccess mode="register" inviteOnly onModeChange={() => {}} onSubmit={() => {}} />)

    expect(fieldNames(openMarkup)).not.toContain('inviteCode')
    expect(fieldNames(inviteMarkup)).toContain('inviteCode')
    expect(fieldTag(inviteMarkup, 'inviteCode')).toContain('required=""')
  })
})
