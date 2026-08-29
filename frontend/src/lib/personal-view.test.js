import { describe, expect, it } from 'vitest'

import {
  buildDayTimeline,
  filterAndSortClients,
  measurementTrend,
  normalizeStudentTab,
  receivableDisplayStatus,
} from './personal-view.js'

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
})
