import { describe, expect, it } from 'vitest'

import { canActivateProvider, emptyProviderDraft, filterProviderModels, usageKpis } from './dev-ai-ui.js'

describe('Dev AI panel helpers', () => {
  it('never hydrates the provider secret into an editable draft', () => {
    expect(emptyProviderDraft({
      provider: 'openai', selectedModel: 'gpt-5', configured: true,
      keyFingerprint: 'sha256:secret-ish', testStatus: 'success', testedAt: '2026-08-29T12:00:00Z',
    })).toMatchObject({ provider: 'openai', selectedModel: 'gpt-5', apiKey: '' })
  })

  it('allows activation only for the exact saved model and successful test', () => {
    const slot = { configured: true, selectedModel: 'gpt-5', testStatus: 'success', testedAt: '2026-08-29T12:00:00Z' }
    expect(canActivateProvider(slot, { selectedModel: 'gpt-5', apiKey: '' })).toBe(true)
    expect(canActivateProvider(slot, { selectedModel: 'gpt-5-mini', apiKey: '' })).toBe(false)
    expect(canActivateProvider({ ...slot, testStatus: 'failed' }, { selectedModel: 'gpt-5', apiKey: '' })).toBe(false)
  })

  it('filters models case-insensitively and derives success and average latency', () => {
    expect(filterProviderModels(['gpt-5', 'GPT-5-mini', 'o3'], 'mini')).toEqual(['GPT-5-mini'])
    expect(usageKpis({ requests: 10, failures: 2, totalTokens: 1234, latencyMs: 4200 })).toEqual({
      requests: 10, successes: 8, failures: 2, totalTokens: 1234, averageLatencyMs: 420,
    })
  })
})
