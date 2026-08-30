import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('mobile API requests', () => {
  it('uses native HTTP so the Capacitor asset host cannot swallow authentication requests', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_MOBILE', '1')
    vi.stubEnv('VITE_API_BASE', 'https://first.example')
    const nativeRequest = vi.fn().mockResolvedValue({ status: 200, data: { user: { id: 'student-1', name: 'Ana' } } })
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
      CapacitorHttp: { request: nativeRequest },
    }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('request was swallowed by the local WebView host'))
    const { api } = await import('./api.js')

    const loginBody = JSON.stringify({ email: 'ana@example.com', password: 'abc123' })
    await expect(api('/api/auth/login', {
      method: 'POST',
      body: loginBody,
    })).resolves.toEqual({ user: { id: 'student-1', name: 'Ana' } })
    await expect(api('/api/me')).resolves.toEqual({ user: { id: 'student-1', name: 'Ana' } })

    expect(nativeRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: 'https://first.example/api/auth/login',
      method: 'POST',
      data: loginBody,
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-First-Client': 'capacitor',
      }),
    }))
    expect(nativeRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: 'https://first.example/api/me',
      method: 'GET',
    }))
    nativeRequest.mockResolvedValueOnce({ status: 401, data: { error: 'not signed in' } })
    await expect(api('/api/me')).rejects.toMatchObject({ message: 'not signed in', status: 401 })
    expect(nativeRequest.mock.calls[0][0].headers).not.toHaveProperty('Origin')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
