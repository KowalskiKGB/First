import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDayTimeline,
  clientFinanceStatus,
  dateInTimeZone,
  filterAndSortClients,
  formatTimeInZone,
  measurementTrend,
  mutationErrorMessage,
  normalizeStudentTab,
  receivableDisplayStatus,
  upcomingFromClients,
} from './personal-view.js'

afterEach(() => vi.useRealTimers())

describe('personal workspace view derivations', () => {
  it('combines occupied and open slots in chronological order without inventing future entries', () => {
    const timeline = buildDayTimeline({
      today: [{
        id: 'appointment-1', clientName: 'Ana', status: 'confirmed',
        startsAt: '2026-08-29T12:00:00.000Z', endsAt: '2026-08-29T13:00:00.000Z',
      }],
      openSlots: [
        { startsAt: '2026-08-29T13:00:00.000Z', endsAt: '2026-08-29T14:00:00.000Z' },
        { startsAt: '2026-08-29T11:00:00.000Z', endsAt: '2026-08-29T12:00:00.000Z' },
      ],
    })

    expect(timeline.map(item => [item.kind, item.startsAt])).toEqual([
      ['open', '2026-08-29T11:00:00.000Z'],
      ['appointment', '2026-08-29T12:00:00.000Z'],
      ['open', '2026-08-29T13:00:00.000Z'],
    ])
  })

  it('searches without accents, filters explicit status and preserves urgency ordering immutably', () => {
    const clients = Object.freeze([
      Object.freeze({ id: 'ok', name: 'João', goal: 'Força', priority: 'ok' }),
      Object.freeze({ id: 'urgent', name: 'Álvaro', goal: 'Mobilidade', priority: 'urgent' }),
      Object.freeze({ id: 'attention', name: 'Bia', goal: 'Hipertrofia', priority: 'attention' }),
    ])

    expect(filterAndSortClients(clients, { query: 'alvaro', status: 'all' }).map(item => item.id)).toEqual(['urgent'])
    expect(filterAndSortClients(clients, { query: '', status: 'attention' }).map(item => item.id)).toEqual(['attention'])
    expect(filterAndSortClients(clients, { query: '', status: 'all' }).map(item => item.id)).toEqual(['urgent', 'attention', 'ok'])
    expect(clients.map(item => item.id)).toEqual(['ok', 'urgent', 'attention'])
  })

  it('normalizes stable student tabs and falls back to the summary', () => {
    expect(normalizeStudentTab('evolucao')).toBe('evolucao')
    expect(normalizeStudentTab('unknown')).toBe('resumo')
    expect(normalizeStudentTab()).toBe('resumo')
  })

  it('sorts and limits measurement trends while retaining side-specific series', () => {
    const measurements = [
      { id: '3', kind: 'arm', side: 'right', value: 33, observedAt: '2026-08-28' },
      { id: '1', kind: 'arm', side: 'left', value: 31, observedAt: '2026-08-01' },
      { id: '2', kind: 'arm', side: 'right', value: 32, observedAt: '2026-08-14' },
      { id: 'weight', kind: 'weight', side: null, value: 80, observedAt: '2026-08-20' },
    ]

    expect(measurementTrend(measurements, 'arm', 'right').map(item => item.id)).toEqual(['2', '3'])
  })

  it('derives overdue only from an open receivable past its due date', () => {
    expect(receivableDisplayStatus({ status: 'open', dueOn: '2026-08-28' }, '2026-08-29')).toBe('overdue')
    expect(receivableDisplayStatus({ status: 'paid', dueOn: '2026-08-20' }, '2026-08-29')).toBe('paid')
    expect(receivableDisplayStatus({ status: 'waived', dueOn: '2026-08-20' }, '2026-08-29')).toBe('waived')
  })

  it('uses the professional timezone for class time and the Fortaleza business date', () => {
    expect(formatTimeInZone('2026-08-29T01:00:00.000Z', 'en-GB', 'America/Fortaleza')).toBe('22:00')
    expect(dateInTimeZone('2026-08-29T01:00:00.000Z', 'America/Fortaleza')).toBe('2026-08-28')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T01:00:00.000Z'))
    expect(receivableDisplayStatus({ status: 'open', dueOn: '2026-08-29' })).toBe('open')
  })

  it('provides an explicit explanation when professional permission is revoked', () => {
    expect(mutationErrorMessage(Object.assign(new Error('forbidden'), { status: 403 }))).toBe('Permission revoked')
    expect(mutationErrorMessage(Object.assign(new Error('conflict'), { status: 409 }))).toContain('keep this form open')
    expect(mutationErrorMessage(new Error('offline'))).toBe('offline')
  })

  it('fails safely for invalid dates, timezones and optional finance data', () => {
    expect(formatTimeInZone('invalid', 'pt-BR')).toBe('—')
    expect(formatTimeInZone('2026-08-29T01:00:00.000Z', 'en-GB', 'Invalid/Zone')).toBe('22:00')
    expect(dateInTimeZone('invalid')).toBe('')
    expect(dateInTimeZone('2026-08-29T01:00:00.000Z', 'Invalid/Zone')).toBe('2026-08-28')
    expect(clientFinanceStatus({ expectedCents: 100, receivedCents: 100 })).toBe('paid')
    expect(clientFinanceStatus({ expectedCents: 100 })).toBe('waived')
    expect(clientFinanceStatus()).toBe('none')
    expect(upcomingFromClients([{ name: 'Ana' }, { name: 'Bia', nextAppointment: { startsAt: '2026-08-30T12:00:00Z' } }])).toEqual([
      { clientName: 'Bia', startsAt: '2026-08-30T12:00:00Z' },
    ])
  })
})
