import { describe, expect, it } from 'vitest'

import { canActivateProvider, emptyProviderDraft, filterProviderModels, safeDevError, usageKpis } from './dev-ai-ui.js'

describe('Dev AI panel helpers', () => {
  it('never hydrates the provider secret into an editable draft', () => {
    expect(emptyProviderDraft({
      provider: 'openai', selectedModel: 'gpt-5', configured: true,
      keyFingerprint: 'sha256:secret-ish', testStatus: 'success', testedAt: '2026-08-29T12:00:00Z',
    })).toMatchObject({ provider: 'openai', selectedModel: 'gpt-5', apiKey: '' })
    expect(emptyProviderDraft()).toEqual({ provider: 'openai', selectedModel: '', apiKey: '' })
  })

  it('allows activation only for the exact saved model and successful test', () => {
    const slot = { configured: true, selectedModel: 'gpt-5', testStatus: 'success', testedAt: '2026-08-29T12:00:00Z' }
    expect(canActivateProvider(slot, { selectedModel: 'gpt-5', apiKey: '' })).toBe(true)
    expect(canActivateProvider(slot, { selectedModel: 'gpt-5-mini', apiKey: '' })).toBe(false)
    expect(canActivateProvider({ ...slot, testStatus: 'failed' }, { selectedModel: 'gpt-5', apiKey: '' })).toBe(false)
    expect(canActivateProvider({ ...slot, testedAt: null }, { selectedModel: 'gpt-5', apiKey: '' })).toBe(false)
    expect(canActivateProvider(slot, { selectedModel: 'gpt-5', apiKey: 'nova-chave' })).toBe(false)
    expect(canActivateProvider(null, null)).toBe(false)
  })

  it('filters models case-insensitively and derives success and average latency', () => {
    expect(filterProviderModels(['gpt-5', 'GPT-5-mini', 'o3'], 'mini')).toEqual(['GPT-5-mini'])
    expect(usageKpis({ requests: 10, failures: 2, totalTokens: 1234, latencyMs: 4200 })).toEqual({
      requests: 10, successes: 8, failures: 2, totalTokens: 1234, averageLatencyMs: 420,
    })
    expect(filterProviderModels(['gpt-5', 'o3'], '')).toEqual(['gpt-5', 'o3'])
    expect(usageKpis({ requests: 0, failures: 8, totalTokens: -1, latencyMs: 500 })).toEqual({
      requests: 0, successes: 0, failures: 0, totalTokens: 0, averageLatencyMs: 0,
    })
    expect(usageKpis({ requests: 2, failures: 5 })).toMatchObject({ requests: 2, successes: 0, failures: 2 })
  })

  it('maps Dev failures to safe copy without echoing provider or credential details', () => {
    expect(safeDevError({ status: 401, message: 'password=leaked' }, 'Operation failed')).toBe('Invalid Dev credential.')
    expect(safeDevError({ status: 403 }, 'Operation failed')).toBe('Invalid Dev credential.')
    expect(safeDevError({ status: 429, message: 'internal rate key' }, 'Operation failed')).toBe('Too many attempts. Try again later.')
    expect(safeDevError({ status: 502, message: 'The provider credential was rejected.' }, 'Operation failed')).toBe('The provider credential was rejected.')
    expect(safeDevError({ status: 500, message: 'upstream credential material' }, 'Operation failed')).toBe('Operation failed')
  })
})
