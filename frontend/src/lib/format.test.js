import { describe, expect, it, vi } from 'vitest'
import { durPart, exCount, fmtDur, fmtNum, fmtVol, isoOf, localTZ, todayISO, weekKey } from './format.js'
import { setLang } from './i18n.js'

describe('format helpers', () => {
  it('formats ISO dates without timezone drift', () => {
    const d = new Date('2026-08-29T23:30:00Z')

    expect(isoOf(d)).toBe('2026-08-29')
  })

  it('formats durations and omits unknown durations', () => {
    expect(fmtDur(59_000)).toBe('0 min')
    expect(fmtDur(65 * 60_000)).toBe('1h 5m')
    expect(durPart(59_000)).toEqual([])
    expect(durPart(60_000)).toEqual(['1 min'])
  })

  it('formats numbers, volume and exercise counts in pt-BR', async () => {
    await setLang('pt')

    expect(fmtNum(7535.04)).toBe('7.535')
    expect(fmtVol(7535.04, 'kg')).toBe('7.535 kg')
    expect(exCount(1)).toBe('1 exercício')
    expect(exCount(2)).toBe('2 exercícios')
  })

  it('creates stable ISO week keys around year boundaries', () => {
    expect(weekKey('2026-01-01')).toBe('2026-1')
    expect(weekKey('2026-12-31')).toBe('2026-53')
  })

  it('uses UTC when the runtime cannot resolve a timezone', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no intl')
    })

    expect(localTZ()).toBe('UTC')
    spy.mockRestore()
  })

  it('returns today as an ISO calendar date', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
