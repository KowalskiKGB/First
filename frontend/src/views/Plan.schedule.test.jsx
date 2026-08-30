import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const state = {
  routines: [
    { id: 'manual', name: 'Meu treino', emoji: 'dumbbell', ex: [] },
    { id: 'personal', name: 'Treino do Personal', emoji: 'clipboard', ex: [] },
    { id: 'ai', name: 'Treino IA', emoji: 'sparkles', ex: [] },
  ],
  week: { 1: 'manual' },
  sourceSchedules: {
    personal: [{ planId: 'personal-plan', version: 2, label: 'Hipertrofia', active: true, week: { 1: 'personal' } }],
    ai: [{ planId: 'ai-plan', version: 3, label: 'Plano IA v3', active: true, week: { 1: 'ai' } }],
  },
}

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: state, update: vi.fn() }) }))
vi.mock('../sheets.jsx', () => ({ dayAssignSheet: vi.fn(), loadStarterPlan: vi.fn(), planToolsSheet: vi.fn() }))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name, ...props }) => <i data-icon={name} {...props} /> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: value => value, DEFAULT_GLYPH: 'dumbbell' }))
vi.mock('../lib/format.js', () => ({ DAYN: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], exCount: String, uid: () => 'new' }))
vi.mock('../lib/i18n.js', () => ({ t: (message, ...args) => args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), message) }))
vi.mock('./AiPlanCard.jsx', () => ({ default: () => null }))

import Plan from './Plan.jsx'

describe('Plan weekly schedule', () => {
  it('shows manual, Personal and AI options on the same day', () => {
    const markup = renderToStaticMarkup(<Plan />)
    const schedule = markup.split('plan-week-list')[1].split('plan-routine-heading')[0]
    const monday = schedule.match(/<button[\s\S]*?<\/button>/)?.[0] || ''

    expect(monday).toContain('Meu treino')
    expect(monday).toContain('Treino do Personal')
    expect(monday).toContain('Treino IA')
    expect(monday).toContain('source-personal')
    expect(monday).toContain('source-ai')
  })
})
