import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import AppointmentForm from '../components/personal/AppointmentForm.jsx'
import MeasurementForm from '../components/personal/MeasurementForm.jsx'
import MoneyBars from '../components/personal/MoneyBars.jsx'
import ProgramEditor from '../components/personal/ProgramEditor.jsx'
import ReceivableForm from '../components/personal/ReceivableForm.jsx'
import { buildSets } from './history.js'
import * as timeZoneForms from './personal-forms.js'
import {
  formatBRL,
  fortalezaInterval,
  measurementPayload,
  normalizeProgram,
  reaisToCents,
  reorderItem,
  searchExerciseCatalog,
} from './personal-forms.js'

describe('program helpers', () => {
  it('normalizes a program into a bounded payload without catalogue data', () => {
    const source = {
      id: 'program-1',
      name: `  ${'P'.repeat(100)}  `,
      routines: [{
        id: 'routine-1',
        name: ' Força ',
        ex: [{
          id: 'squat', sets: 99, reps: 0, rest: 9999, note: '  firme  ',
          img: 'squat.webp', n: 'Barbell Squat', catalogue: { huge: true },
        }],
      }],
      week: { 1: 'routine-1', 7: 'routine-1', 2: 'missing' },
      versions: [{ routines: ['old'] }],
    }

    const normalized = normalizeProgram(source)

    expect(normalized).toEqual({
      id: 'program-1',
      name: 'P'.repeat(90),
      routines: [{
        id: 'routine-1',
        name: 'Força',
        ex: [{ id: 'squat', sets: 20, reps: 1, rest: 1800, note: 'firme' }],
      }],
      week: { 1: 'routine-1' },
    })
    expect(normalized).not.toBe(source)
    expect(normalized.routines[0]).not.toBe(source.routines[0])
  })

  it('searches canonical and pt-BR names without accents', () => {
    const catalogue = [{ id: 'raise', n: 'Dumbbell Lateral Raise' }]
    const localizedName = () => 'Elevação lateral com halteres'

    expect(searchExerciseCatalog(catalogue, 'elevacao halteres', localizedName)).toEqual(catalogue)
    expect(searchExerciseCatalog(catalogue, 'dumbbell raise', localizedName)).toEqual(catalogue)
    expect(searchExerciseCatalog(catalogue, 'supino', localizedName)).toEqual([])
  })

  it('preserves and bounds canonical repetition ranges without changing integers', () => {
    const normalized = normalizeProgram({
      routines: [{
        id: 'routine-1',
        ex: [
          { id: 'range', reps: '8-12' },
          { id: 'bounded-range', reps: ' 008 - 1200 ' },
          { id: 'integer', reps: 12 },
          { id: 'reversed', reps: '12-8' },
        ],
      }],
    })

    expect(normalized.routines[0].ex.map(exercise => exercise.reps)).toEqual(['8-12', '8-999', 12, 10])
  })

  it('reorders without mutating the original array', () => {
    const original = Object.freeze(['a', 'b', 'c'])

    expect(reorderItem(original, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(original).toEqual(['a', 'b', 'c'])
    expect(reorderItem(original, -1, 1)).toBe(original)
  })

  it('turns a published Personal program into an executable weekly routine without replacing manual plans', () => {
    const source = {
      routines: [{ id: 'manual', name: 'Meu treino', ex: [] }],
      week: { 0: 'manual' },
      workouts: [],
      exWeights: {},
    }
    const program = {
      id: 'program-1',
      version: 2,
      name: 'Hipertrofia',
      routines: [{
        id: 'routine-a',
        name: 'Treino A',
        ex: [{ id: '0043', sets: 4, reps: '8-12', rest: 90, note: 'Amplitude controlada' }],
      }],
      week: { 1: 'routine-a' },
    }
    const merge = timeZoneForms.mergePublishedPrograms || (() => null)

    const merged = merge(source, [program])

    expect(merged).toMatchObject({
      routines: [
        { id: 'manual', name: 'Meu treino' },
        {
          id: 'personal-program-1-routine-a',
          name: 'Treino A',
          _personalProgramId: 'program-1',
          _personalProgramName: 'Hipertrofia',
          _personalVersion: 2,
          ex: [{
            id: '0043', sets: 4, reps: 12, repsMin: 8, repsMax: 12,
            prog: 'double', prescribedRepsLabel: '8-12', weight: 0,
            rest: 90, note: 'Amplitude controlada',
          }],
        },
      ],
      week: { 0: 'manual' },
      sourceSchedules: {
        personal: [{
          sourceType: 'personal', planId: 'program-1', version: 2, label: 'Hipertrofia', active: true,
          week: { 1: 'personal-program-1-routine-a' },
        }],
      },
    })
    expect(buildSets(merged, merged.routines[1].ex[0])).toEqual([
      { w: 0, r: 12, done: false },
      { w: 0, r: 12, done: false },
      { w: 0, r: 12, done: false },
      { w: 0, r: 12, done: false },
    ])
    expect(source).toEqual({ routines: [{ id: 'manual', name: 'Meu treino', ex: [] }], week: { 0: 'manual' }, workouts: [], exWeights: {} })
  })

  it('removes only Personal-managed routines when the active connection no longer publishes them', () => {
    const merge = timeZoneForms.mergePublishedPrograms || (() => null)
    const merged = merge({
      routines: [
        { id: 'manual', name: 'Meu treino', ex: [] },
        { id: 'personal-old-a', name: 'Antigo', _personalProgramId: 'old', ex: [] },
      ],
      week: { 3: 'manual' },
      sourceSchedules: {
        ai: [{ sourceType: 'ai', planId: 'ai-1', version: 4, active: true, week: { 1: 'ai-a' } }],
        personal: [{ sourceType: 'personal', planId: 'old', version: 1, active: true, week: { 1: 'personal-old-a' } }],
      },
    }, [])

    expect(merged).toMatchObject({
      routines: [{ id: 'manual', name: 'Meu treino', ex: [] }],
      week: { 3: 'manual' },
      sourceSchedules: {
        ai: [{ sourceType: 'ai', planId: 'ai-1', version: 4, active: true, week: { 1: 'ai-a' } }],
        personal: [],
      },
    })
  })
  it('renders financial months returned by the workspace API', () => {
    const markup = renderToStaticMarkup(React.createElement(MoneyBars, {
      months: [{ month: '2026-08', expectedCents: 30000, receivedCents: 12000 }],
    }))

    expect(markup).toContain('ago de 26')
    expect(markup).toMatch(/R\$\s*300,00/)
    expect(markup).toMatch(/R\$\s*120,00/)
  })
})

describe('finance and Fortaleza helpers', () => {
  it('formats integer cents as BRL', () => {
    expect(formatBRL(123456)).toMatch(/R\$\s?1\.234,56/)
  })

  it.each([
    ['0,01', 1],
    ['12', 1200],
    ['12,3', 1230],
    ['1.234,56', 123456],
    ['1234.56', 123456],
  ])('parses %s reais into integer cents', (value, cents) => {
    expect(reaisToCents(value)).toBe(cents)
  })

  it.each(['', '0', '0,00', '-1,00', '1,234', '12,345', '1.23,45', 'abc', '1000000,01'])('rejects invalid reais value %s', value => {
    expect(() => reaisToCents(value)).toThrow('Valor em reais inválido')
  })

  it('builds a deterministic interval using Fortaleza fixed offset', () => {
    expect(fortalezaInterval('2026-08-29', '06:15', 45)).toEqual({
      startsAt: '2026-08-29T09:15:00.000Z',
      endsAt: '2026-08-29T10:00:00.000Z',
    })
  })

  it('rejects impossible local dates and times', () => {
    expect(() => fortalezaInterval('2026-02-30', '08:00', 60)).toThrow('Data ou hora inválida')
    expect(() => fortalezaInterval('2026-08-29', '24:00', 60)).toThrow('Data ou hora inválida')
  })

  it('builds and displays appointments in the trainer profile timezone', () => {
    expect(timeZoneForms.timeZoneInterval('2026-08-29', '08:15', 60, 'America/New_York')).toEqual({
      startsAt: '2026-08-29T12:15:00.000Z',
      endsAt: '2026-08-29T13:15:00.000Z',
    })

    const markup = renderToStaticMarkup(React.createElement(AppointmentForm, {
      clients: [{ id: 'client-1', name: 'Ana' }],
      appointment: {
        id: 'appointment-1', clientId: 'client-1',
        startsAt: '2026-08-29T12:15:00.000Z', endsAt: '2026-08-29T13:15:00.000Z',
      },
      timeZone: 'America/New_York',
      onSubmit: vi.fn(),
    }))

    expect(markup).toMatch(/name="appointmentTime"[^>]*value="08:15"/)
    expect(markup).toContain('America/New_York')
  })

  it('derives today and local fields from Date and numeric timestamps', () => {
    const now = new Date('2026-08-30T01:00:00.000Z')

    expect(timeZoneForms.todayInTimeZone(now, 'America/Fortaleza')).toBe('2026-08-29')
    expect(timeZoneForms.timeZoneFields(now.getTime(), 'America/Fortaleza')).toEqual({
      date: '2026-08-29',
      time: '22:00',
    })
  })
})

describe('measurement helper', () => {
  it('returns the canonical unit and side for bilateral measurements', () => {
    expect(measurementPayload({
      clientId: 'client-1', kind: 'arm', side: 'right', value: '32,4', observedAt: '2026-08-28',
    }, '2026-08-29')).toEqual({
      clientId: 'client-1', kind: 'arm', side: 'right', value: 32.4, unit: 'cm', observedAt: '2026-08-28',
    })
  })

  it('drops side for non-bilateral measurements', () => {
    expect(measurementPayload({
      clientId: 'client-1', kind: 'weight', side: 'left', value: 80, observedAt: '2026-08-29',
    }, '2026-08-29')).toMatchObject({ kind: 'weight', side: null, value: 80, unit: 'kg' })
  })

  it('rejects missing sides, implausible values and future dates', () => {
    expect(() => measurementPayload({ kind: 'calf', value: 35, observedAt: '2026-08-29' }, '2026-08-29')).toThrow('Informe o lado')
    expect(() => measurementPayload({ kind: 'bodyFat', value: 90, observedAt: '2026-08-29' }, '2026-08-29')).toThrow('Medida fora do intervalo')
    expect(() => measurementPayload({ kind: 'waist', value: 80, observedAt: '2026-08-30' }, '2026-08-29')).toThrow('Data inválida')
  })
})

describe('controlled form markup', () => {
  const clients = [{ id: 'client-1', name: 'Ana' }]

  it('renders every controlled component without a store provider', () => {
    const onSubmit = vi.fn()
    const markup = [
      renderToStaticMarkup(React.createElement(ProgramEditor, { clientId: 'client-1', program: null, onPublish: onSubmit })),
      renderToStaticMarkup(React.createElement(MeasurementForm, { clientId: 'client-1', onSubmit })),
      renderToStaticMarkup(React.createElement(AppointmentForm, { clients, onSubmit })),
      renderToStaticMarkup(React.createElement(ReceivableForm, { clients, onSubmit })),
      renderToStaticMarkup(React.createElement(MoneyBars, { months: [] })),
    ].join(' ')

    expect(markup).toContain('Publicar programa')
    expect(markup).toContain('Registrar medida')
    expect(markup).toContain('Salvar aula')
    expect(markup).toContain('Salvar cobrança')
    expect(markup).toContain('Histórico financeiro dos últimos seis meses')
  })

  it('shows a paid timestamp on its Fortaleza calendar date while editing', () => {
    const markup = renderToStaticMarkup(React.createElement(ReceivableForm, {
      clients,
      receivable: {
        id: 'receivable-1', clientId: 'client-1', period: '2026-08', dueOn: '2026-08-29',
        amountCents: 10000, status: 'paid', paidAt: '2026-08-30T01:00:00.000Z', paymentMethod: 'pix',
      },
      onSubmit: vi.fn(),
    }))

    expect(markup).toMatch(/name="paidOn"[^>]*value="2026-08-29"/)
  })

  it('starts a new receivable with a blank amount and disabled save', () => {
    const markup = renderToStaticMarkup(React.createElement(ReceivableForm, { clients, onSubmit: vi.fn() }))

    expect(markup).toMatch(/name="receivableAmount"[^>]*value=""/)
    expect(markup).toMatch(/<button[^>]*disabled[^>]*><span>Salvar cobrança<\/span><\/button>/)
  })
})
