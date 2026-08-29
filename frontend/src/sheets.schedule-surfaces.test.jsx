import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  state: null,
  sheetRender: null,
}))

vi.mock('./store/useStore.js', () => {
  const useStore = selector => selector({ S: harness.state })
  useStore.getState = () => ({ S: harness.state, update: vi.fn() })
  return { useStore }
})
vi.mock('./store/useUI.js', () => {
  const openSheet = render => { harness.sheetRender = render; return { close: vi.fn() } }
  const useUI = selector => selector({ openSheet, toast: vi.fn() })
  useUI.getState = () => ({ openSheet, toast: vi.fn() })
  return { useUI }
})
vi.mock('./lib/i18n.js', () => ({
  dateLocale: () => 'en-GB', getLang: () => 'en', INSTR_LANGS: [], instrFor: () => [],
  exerciseName: exercise => exercise?.n || '',
  t: (message, ...args) => args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), message),
}))
vi.mock('./lib/mobile.js', () => ({ MOBILE: false, shareExport: vi.fn() }))
vi.mock('./lib/nav.js', () => ({ nav: vi.fn() }))
vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('./components/Icon.jsx', () => ({
  ICON_NAMES: ['sparkles'],
  default: ({ name, className = '' }) => <i data-icon={name} className={className} />,
}))

import { calendarSheet, dayOverrideSheet, SessionPicker } from './sheets.jsx'

const managedRestState = () => ({
  routines: [{ id: 'ai-monday', name: 'AI Monday', emoji: 'sparkles', ex: [] }],
  week: {},
  dayPlan: { '2026-08-31': 'rest' },
  sourceSchedules: {
    personal: [],
    ai: [{ sourceType: 'ai', planId: 'plan-1', version: 1, active: true, week: { 1: 'ai-monday' } }],
  },
  workouts: [],
  unit: 'kg',
})

const openedMarkup = () => renderToStaticMarkup(harness.sheetRender(vi.fn()))

describe('schedule sheets with rest preference and managed availability', () => {
  beforeEach(() => {
    harness.state = managedRestState()
    harness.sheetRender = null
  })

  it('marks the managed session, not pure rest, as the effective day override', () => {
    dayOverrideSheet('2026-08-31')

    const markup = openedMarkup()
    const routineStart = markup.indexOf('AI Monday')
    const restStart = markup.indexOf('Prefer rest for this day')

    expect(restStart).toBeGreaterThan(routineStart)
    expect(markup).not.toContain('Rest / skip this day')
    expect(markup.slice(routineStart, restStart)).toContain('data-icon="check"')
    expect(markup.slice(restStart)).not.toContain('data-icon="check"')
  })

  it('marks the managed availability as rescheduled in the calendar', () => {
    calendarSheet('2026-08-15T12:00:00')

    expect(openedMarkup()).toContain('<span>31</span><i class="ovr"></i>')
  })

  it('routes the session chooser heading and count through the translation fallback', () => {
    const markup = renderToStaticMarkup(<SessionPicker options={[
      { sourceType: 'ai', planId: 'plan-1', routineId: 'ai-monday', label: 'Plano IA', routine: harness.state.routines[0] },
    ]} close={vi.fn()} />)

    expect(markup).toContain('<h3>Choose a session</h3>')
    expect(markup).toContain('You have 1 sessions available.')
  })
})
