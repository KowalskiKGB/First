import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import AppointmentForm from '../components/personal/AppointmentForm.jsx'
import MeasurementForm from '../components/personal/MeasurementForm.jsx'
import MoneyBars from '../components/personal/MoneyBars.jsx'
import ProgramEditor from '../components/personal/ProgramEditor.jsx'
import ReceivableForm from '../components/personal/ReceivableForm.jsx'
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

  it('reorders without mutating the original array', () => {
    const original = Object.freeze(['a', 'b', 'c'])

    expect(reorderItem(original, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(original).toEqual(['a', 'b', 'c'])
    expect(reorderItem(original, -1, 1)).toBe(original)
  })
})

describe('finance and Fortaleza helpers', () => {
  it('formats integer cents as BRL', () => {
    expect(formatBRL(123456)).toMatch(/R\$\s?1\.234,56/)
  })

  it.each([
    ['0', 0],
    ['12', 1200],
    ['12,3', 1230],
    ['1.234,56', 123456],
    ['1234.56', 123456],
  ])('parses %s reais into integer cents', (value, cents) => {
    expect(reaisToCents(value)).toBe(cents)
  })

  it.each(['', '-1,00', '1,234', '12,345', '1.23,45', 'abc', '1000000,01'])('rejects invalid reais value %s', value => {
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
})
