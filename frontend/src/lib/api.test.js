import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, bioLabel } from './api.js'

afterEach(() => vi.restoreAllMocks())

describe('passkey biometric label', () => {
  it('follows the app language, whose default is Brazilian Portuguese', () => {
    expect(bioLabel()).toMatch(/biometria|impressão digital/)
    expect(bioLabel('en')).toMatch(/fingerprint|Face ID|Touch ID/)
  })
})

describe('API errors', () => {
  it('keeps the server revision on a stale-write response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({ error: 'stale revision', rev: 19 }),
    })

    await expect(api('/api/gym/favorite', { method: 'PUT', body: '{}' }))
      .rejects.toMatchObject({ message: 'stale revision', status: 409, rev: 19 })
  })
})
