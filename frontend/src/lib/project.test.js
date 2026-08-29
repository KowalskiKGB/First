import { describe, expect, it } from 'vitest'
import { APP_NAME, APP_SLUG, APP_URL, REPO } from './demo.js'

describe('project identity', () => {
  it('offers the corresponding source for this independent deployment', () => {
    expect(APP_NAME).toBe('First')
    expect(APP_SLUG).toBe('first')
    expect(APP_URL).toBe('https://first.rocketxsistemas.com.br')
    expect(REPO).toBe('https://github.com/KowalskiKGB/First')
  })
})
