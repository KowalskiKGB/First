import { describe, expect, it } from 'vitest'
import { REPO } from './demo.js'

describe('project identity', () => {
  it('offers the corresponding source for this independent deployment', () => {
    expect(REPO).toBe('https://github.com/KowalskiKGB/First')
  })
})

