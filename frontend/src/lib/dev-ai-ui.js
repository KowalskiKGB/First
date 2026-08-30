export const DEV_PROVIDERS = Object.freeze([
  { provider: 'openai', name: 'OpenAI', product: 'ChatGPT' },
  { provider: 'gemini', name: 'Gemini', product: 'Google AI' },
  { provider: 'anthropic', name: 'Anthropic', product: 'Claude' },
])

export const emptyProviderDraft = slot => ({
  provider: slot?.provider || 'openai', selectedModel: slot?.selectedModel || '', apiKey: '',
})

export const canActivateProvider = (slot, draft) => !!(
  slot?.configured && slot.testStatus === 'success' && slot.testedAt
  && slot.selectedModel === draft?.selectedModel && !String(draft?.apiKey || '').trim()
)

export const filterProviderModels = (models, query) => {
  const needle = String(query || '').trim().toLocaleLowerCase('pt-BR')
  return needle ? models.filter(model => model.toLocaleLowerCase('pt-BR').includes(needle)) : models
}

export function usageKpis(usage = {}) {
  const requests = Math.max(0, Number(usage.requests) || 0)
  const failures = Math.min(requests, Math.max(0, Number(usage.failures) || 0))
  return {
    requests, successes: requests - failures, failures,
    totalTokens: Math.max(0, Number(usage.totalTokens) || 0),
    averageLatencyMs: requests ? Math.round((Number(usage.latencyMs) || 0) / requests) : 0,
  }
}

export function safeDevError(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return 'Invalid Dev credential.'
  if (error?.status === 429) return 'Too many attempts. Try again later.'
  if (error?.status === 422 && error?.message === 'The provider credential was rejected.') return error.message
  return fallback
}
