import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('mobile API requests', () => {
  it('uses absolute URLs and a CSRF-safe client marker without forging Origin', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_MOBILE', '1')
    vi.stubEnv('VITE_API_BASE', 'https://first.example')
    const response = { ok: true, json: vi.fn().mockResolvedValue({ ok: true }) }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const { api } = await import('./api.js')

    await expect(api('/api/me')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('https://first.example/api/me', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-First-Client': 'capacitor',
      }),
    }))
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Origin')
  })
})
