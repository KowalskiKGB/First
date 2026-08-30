import { describe, expect, it } from 'vitest'

import { starterRoutines } from './starter.js'

describe('starter routines', () => {
  it('creates visible routine names in pt-BR instead of legacy English day labels', () => {
    const names = starterRoutines().map(routine => routine.name)

    expect(names).toEqual(['Dia de Empurrar', 'Dia de Puxar', 'Dia de Pernas'])
    expect(names.join(' ')).not.toMatch(/Push|Pull|Leg Day/i)
  })
})
