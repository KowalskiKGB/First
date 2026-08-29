import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map()
vi.stubGlobal('localStorage', {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
})

let Agenda
let Finance
let PersonalHome
let StudentDetail
let Students
let useCollaboration

beforeAll(async () => {
  ;({ useCollaboration } = await import('../../store/useCollaboration.js'))
  ;({ default: Agenda } = await import('./Agenda.jsx'))
  ;({ default: Finance } = await import('./Finance.jsx'))
  ;({ default: PersonalHome } = await import('./PersonalHome.jsx'))
  ;({ default: StudentDetail } = await import('./StudentDetail.jsx'))
  ;({ default: Students } = await import('./Students.jsx'))
})

const client = {
  id: 'client-1', name: 'Ana Souza', goal: 'Hipertrofia', priority: 'urgent',
  reasons: ['Pagamento vencido'], targetSessionsPerWeek: 3,
  progress: { adherence: 58, workouts28d: 7, volume28d: 12500, recentWorkouts: [] },
  finance: { expectedCents: 30000, receivedCents: 0, openCents: 30000, overdueCents: 30000, months: [] },
}

const workspace = {
  rev: 4,
  kpis: { activeClients: 1, appointmentsToday: 1, appointments7d: 2, freeHoursToday: 2, averageAdherence: 58, priorities: { urgent: 1, attention: 0, ok: 0 } },
  finance: { expectedCents: 30000, receivedCents: 0, openCents: 30000, overdueCents: 30000, months: [] },
  availability: [{ weekday: 1, start: '06:00', end: '21:00', slotMinutes: 60 }],
  agenda: {
    today: [{ id: 'appointment-1', clientId: 'client-1', clientName: 'Ana Souza', startsAt: '2026-08-29T12:00:00.000Z', endsAt: '2026-08-29T13:00:00.000Z', status: 'confirmed' }],
    openSlots: [{ startsAt: '2026-08-29T13:00:00.000Z', endsAt: '2026-08-29T14:00:00.000Z' }],
  },
  clients: [client],
}

beforeEach(() => {
  useCollaboration.setState({
    ownerId: 'trainer-1', rev: 4, profile: { userId: 'trainer-1', roles: ['trainer'] },
    workspace, selected: 'client-1', loading: false, error: null, message: null,
    detail: {
      rev: 4, client,
      measurements: [{ id: 'measurement-1', kind: 'weight', value: 80, unit: 'kg', observedAt: '2026-08-20' }],
      appointments: workspace.agenda.today,
      receivables: [{ id: 'receivable-1', clientId: 'client-1', period: '2026-08', dueOn: '2026-08-20', amountCents: 30000, status: 'open' }],
      program: null,
    },
  })
})

const render = element => renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>)

describe('professional Personal views SSR', () => {
  it('renders the operational dashboard and priority reason', () => {
    const markup = render(<PersonalHome />)
    expect(markup).toContain('Today timeline')
    expect(markup).toContain('Pagamento vencido')
    expect(markup).toContain('New student')
  })

  it('renders student filters with status labels', () => {
    const markup = render(<Students />)
    expect(markup).toContain('Urgent')
    expect(markup).toContain('Attention')
    expect(markup).toContain('Up to date')
  })

  it('renders stable detail tabs from the URL', () => {
    const markup = render(
      <Routes><Route path="/personal/alunos/:id/:tab?" element={<StudentDetail />} /></Routes>,
    )
    expect(markup).toContain('Summary')
    expect(markup).toContain('Training')
    expect(markup).toContain('Evolution')
    expect(markup).toContain('Measurements')
    expect(markup).toContain('Schedule')
    expect(markup).toContain('Finances')
  })

  it('renders only today plus next classes on the global schedule', () => {
    const markup = render(<Agenda />)
    expect(markup).toContain('Today timeline')
    expect(markup).toContain('Next classes by student')
  })

  it('renders finance KPIs, textual history and client status', () => {
    const markup = render(<Finance />)
    expect(markup).toContain('Accounts receivable')
    expect(markup).toContain('Ana Souza')
    expect(markup).toContain('Overdue')
  })
})
