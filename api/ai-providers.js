import crypto from 'node:crypto';
import { AI_WORKOUT_SCHEMA, validateAiWorkoutPlan } from './ai.js';

export const AI_PROVIDER_NAMES = Object.freeze(['openai', 'gemini', 'anthropic']);
const MASTER_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const INVALID_STRUCTURED_OUTPUT = 'AI provider returned invalid structured output';
const PROVIDER_TEST_FAILED = 'AI provider test failed';
const PROVIDER_CREDENTIAL_REJECTED = 'The provider credential was rejected.';
const PROVIDER_REQUEST_TIMED_OUT = 'AI provider request timeout.';
const PROVIDER_RESPONSE_TRUNCATED = 'provider_response_truncated';
const SAFE_PROVIDER_DIAGNOSTIC = Symbol('safeProviderDiagnostic');
const GEMINI_CREDENTIAL_REASONS = new Set([
  'API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED',
  'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED'
]);
const PROVIDER_TEST_VALUE = Object.freeze({
  justification: 'Plano diagnostico seguro.',
  routines: [{
    routineRef: 'diagnostic',
    name: 'Treino diagnostico',
    exercises: [{
      exerciseId: 'diagnostic', mode: 'reps', sets: 1, repMin: 8, repMax: 8,
      seconds: null, restSeconds: 60, progression: 'Mantenha a tecnica estavel.', note: ''
    }]
  }],
  schedule: [{ day: 0, routineRef: 'diagnostic' }]
});
const PROVIDER_TEST_PROMPT = `Retorne exatamente este AIWorkoutPlanV1 de diagnostico: ${JSON.stringify(PROVIDER_TEST_VALUE)}`;
const UNSUPPORTED_SCHEMA_KEYS = Object.freeze({
  gemini: new Set(['minLength', 'maxLength', 'anyOf']),
  anthropic: new Set(['minimum', 'maximum', 'minLength', 'maxLength'])
});

function masterKey(value) {
  if (!MASTER_KEY_PATTERN.test(String(value || ''))) {
    throw new Error('AI_CONFIG_MASTER_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters');
  }
  return Buffer.from(value, 'hex');
}

export function encryptProviderKey(masterKeyHex, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(masterKeyHex), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptProviderKey(masterKeyHex, value) {
  const [iv, tag, encrypted] = String(value || '').split('.');
  if (!iv || !tag || !encrypted) throw new Error('invalid encrypted provider key');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(masterKeyHex), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

function keyFingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function requireProvider(value) {
  const provider = String(value || '').trim();
  if (!AI_PROVIDER_NAMES.includes(provider)) throw new Error('unsupported provider');
  return provider;
}

function publicSlot(record, entries) {
  const metrics = summarizeAiUsage((entries || []).filter(entry => entry.provider === record?.provider), '30d');
  return {
    provider: record?.provider,
    selectedModel: record?.selectedModel || '',
    configured: !!record?.apiKeyEnc,
    keyFingerprint: record?.keyFingerprint || null,
    testedAt: record?.testedAt || null,
    testStatus: record?.testStatus || 'untested',
    active: !!record?.active,
    metrics
  };
}

export function providerSlotsDto(records = [], usage = []) {
  return AI_PROVIDER_NAMES.map(provider => publicSlot(records.find(record => record.provider === provider) || { provider }, usage));
}

export function upsertProvider(records = [], input, masterKeyHex, now = new Date().toISOString()) {
  const provider = requireProvider(input?.provider);
  if ('baseUrl' in (input || {}) || 'baseURL' in (input || {})) throw new Error('custom base URL is not supported');
  const existing = records.find(record => record.provider === provider);
  const hasSelectedModel = Object.hasOwn(input || {}, 'selectedModel');
  const selectedModel = hasSelectedModel
    ? String(input.selectedModel || '').trim().slice(0, 120)
    : existing?.selectedModel || '';
  if (hasSelectedModel && !selectedModel) throw new Error('selectedModel required');
  const apiKey = String(input?.apiKey || '').trim();
  if (!existing?.apiKeyEnc && !apiKey) throw new Error('apiKey required');
  if (apiKey) masterKey(masterKeyHex);
  const changed = !existing || selectedModel !== existing.selectedModel || !!apiKey;
  const next = {
    ...existing,
    provider,
    selectedModel,
    apiKeyEnc: apiKey ? encryptProviderKey(masterKeyHex, apiKey) : existing.apiKeyEnc,
    keyFingerprint: apiKey ? keyFingerprint(apiKey) : existing.keyFingerprint,
    testedAt: changed ? null : existing.testedAt,
    testStatus: changed ? 'untested' : existing.testStatus,
    active: changed ? false : !!existing.active,
    updatedAt: now
  };
  const nextRecords = [...records.filter(record => record.provider !== provider), next]
    .sort((a, b) => AI_PROVIDER_NAMES.indexOf(a.provider) - AI_PROVIDER_NAMES.indexOf(b.provider));
  return { records: nextRecords, provider: publicSlot(next, []) };
}

export function activateProvider(records = [], providerValue, now = new Date().toISOString()) {
  if (providerValue === null) return deactivateProviders(records, now);
  const provider = requireProvider(providerValue);
  const target = records.find(record => record.provider === provider);
  if (!target?.apiKeyEnc || target.testStatus !== 'success' || !target.testedAt) {
    throw new Error('provider requires a successful test before activation');
  }
  const nextRecords = records.map(record => ({ ...record, active: record.provider === provider, updatedAt: record.provider === provider ? now : record.updatedAt }));
  return { records: nextRecords, provider: publicSlot(nextRecords.find(record => record.provider === provider), []) };
}

export function deactivateProviders(records = [], now = new Date().toISOString()) {
  return {
    records: records.map(record => ({ ...record, active: false, updatedAt: record.active ? now : record.updatedAt })),
    provider: null
  };
}

export function activeProvider(records = []) {
  return records.find(record => record.active && record.apiKeyEnc && record.testStatus === 'success' && record.testedAt) || null;
}

function systemPrompt() {
  return 'Responda somente JSON valido que cumpra exatamente o schema solicitado.';
}

function schemaForProvider(provider, schema) {
  const unsupported = UNSUPPORTED_SCHEMA_KEYS[provider];
  if (!unsupported) return schema;
  const copy = value => {
    if (Array.isArray(value)) return value.map(copy);
    if (!value || typeof value !== 'object') return value;
    if (provider === 'gemini' && Array.isArray(value.anyOf)) {
      const nullable = value.anyOf.find(item => item?.type && item.type !== 'null');
      if (nullable) return { ...copy(nullable), nullable: true };
    }
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !unsupported.has(key))
      .map(([key, item]) => [key, copy(item)]));
  };
  return copy(schema);
}

export function buildProviderRequest(providerValue, { apiKey, model, prompt, schema }) {
  const provider = requireProvider(providerValue);
  const outputSchema = schemaForProvider(provider, schema);
  const isGpt5 = provider === 'openai' && /^gpt-5(?:$|[-.])/i.test(String(model || ''));
  if (provider === 'openai') return {
    url: 'https://api.openai.com/v1/responses',
    options: {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, store: false,
        input: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: prompt }],
        text: {
          format: { type: 'json_schema', name: 'structured_response', strict: true, schema: outputSchema },
          ...(isGpt5 ? { verbosity: 'low' } : {})
        },
        max_output_tokens: isGpt5 ? 8000 : 4000,
        ...(isGpt5 ? { reasoning: { effort: 'minimal' } } : {})
      })
    }
  };
  if (provider === 'gemini') return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    options: {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseFormat: { text: { mimeType: 'application/json', schema: outputSchema } } }
      })
    }
  };
  return {
    url: 'https://api.anthropic.com/v1/messages',
    options: {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 4000, system: systemPrompt(),
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: outputSchema } }
      })
    }
  };
}

function geminiCredentialRejected(url, data) {
  if (!url.includes('generativelanguage.googleapis.com')) return false;
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  if (details.some(detail => GEMINI_CREDENTIAL_REASONS.has(String(detail?.reason || '')))) return true;
  return /(?:api key.+not valid|api key.+reported as leaked)/i.test(String(data?.error?.message || ''));
}

async function fetchJson(fetchImpl, url, options, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const service = url.includes('generativelanguage.googleapis.com') ? 'Gemini model' : 'AI provider';
      const credentialRejected = [401, 403].includes(response.status) || geminiCredentialRejected(url, data);
      const error = new Error(credentialRejected
        ? PROVIDER_CREDENTIAL_REJECTED
        : `${service} request failed (${response.status})`);
      error.status = credentialRejected ? 422 : 502;
      error.expose = true;
      Object.defineProperty(error, SAFE_PROVIDER_DIAGNOSTIC, { value: true });
      throw error;
    }
    return data;
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    const timeout = new Error(PROVIDER_REQUEST_TIMED_OUT);
    timeout.status = 502;
    timeout.expose = true;
    Object.defineProperty(timeout, SAFE_PROVIDER_DIAGNOSTIC, { value: true });
    throw timeout;
  } finally {
    clearTimeout(timer);
  }
}

function providerText(provider, data) {
  if (provider === 'openai') return typeof data.output_text === 'string'
    ? data.output_text
    : (data.output || []).flatMap(item => item.content || []).map(part => part.text || '').join('\n');
  if (provider === 'gemini') return (data.candidates || []).flatMap(item => item.content?.parts || []).map(part => part.text || '').join('\n');
  return (data.content || []).map(part => part.text || '').join('\n');
}

function parseStructured(value) {
  if (value && typeof value === 'object') return value;
  const source = String(value || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  try { return JSON.parse((fenced ? fenced[1] : source).trim()); }
  catch { throw new Error(INVALID_STRUCTURED_OUTPUT); }
}

function normalizedUsage(provider, model, data) {
  const source = provider === 'gemini' ? data.usageMetadata || {} : data.usage || {};
  const inputTokens = Number(source.input_tokens ?? source.promptTokenCount ?? 0) || 0;
  const outputTokens = Number(source.output_tokens ?? source.candidatesTokenCount ?? 0) || 0;
  const totalTokens = Number(source.total_tokens ?? source.totalTokenCount ?? inputTokens + outputTokens) || inputTokens + outputTokens;
  return { provider, model, inputTokens, outputTokens, totalTokens };
}

function truncatedResponseError() {
  const error = new Error('AI provider response was truncated');
  Object.defineProperty(error, 'failureCode', { value: PROVIDER_RESPONSE_TRUNCATED, enumerable: false });
  return error;
}

function assertCompleteResponse(provider, data) {
  if (provider === 'openai') {
    if (data.status === 'incomplete') throw truncatedResponseError();
    const refused = (data.output || []).flatMap(item => item.content || []).some(part => part.type === 'refusal' || part.refusal);
    if (refused) throw new Error('AI provider refused the structured request');
  }
  if (provider === 'gemini') {
    const reasons = (data.candidates || []).map(candidate => candidate.finishReason).filter(Boolean);
    if (reasons.includes('MAX_TOKENS')) throw truncatedResponseError();
    if (reasons.some(reason => !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(reason))) {
      throw new Error('AI provider refused the structured request');
    }
  }
  if (provider === 'anthropic') {
    if (data.stop_reason === 'max_tokens') throw truncatedResponseError();
    const refused = data.stop_reason === 'refusal' || data.stop_details?.type === 'refusal' ||
      (data.content || []).some(part => part.type === 'refusal' || part.refusal);
    if (refused) throw new Error('AI provider refused the structured request');
  }
}

function assertProviderTestOutput(value, slot, testedAt) {
  validateAiWorkoutPlan(value, {
    studentId: 'provider-diagnostic',
    version: 1,
    contextHash: '0'.repeat(64),
    profile: { ageBand: 'adult', availableDays: [0] },
    candidates: [{ id: 'diagnostic' }],
    provider: slot.provider,
    model: slot.selectedModel,
    now: testedAt,
    existingIds: []
  });
}

export async function runStructuredOutput(slot, { masterKey: masterKeyHex, fetchImpl = fetch, prompt, schema, timeoutMs }) {
  if (!slot?.apiKeyEnc) throw new Error('AI provider is not configured');
  const apiKey = decryptProviderKey(masterKeyHex, slot.apiKeyEnc);
  const request = buildProviderRequest(slot.provider, { apiKey, model: slot.selectedModel, prompt, schema });
  const data = await fetchJson(fetchImpl, request.url, request.options, timeoutMs);
  const usage = normalizedUsage(slot.provider, slot.selectedModel, data);
  try {
    assertCompleteResponse(slot.provider, data);
    return { value: parseStructured(providerText(slot.provider, data)), usage };
  } catch (error) {
    Object.defineProperty(error, 'usage', { value: usage, enumerable: false });
    throw error;
  }
}

export async function testProvider(records, providerValue, options) {
  const provider = requireProvider(providerValue);
  const slot = records.find(record => record.provider === provider);
  if (!slot?.apiKeyEnc) throw new Error('provider is not configured');
  if (!slot.selectedModel) throw new Error('selectedModel required');
  const testedAt = options.now?.() || new Date().toISOString();
  let usage;
  try {
    const result = await runStructuredOutput(slot, { ...options, prompt: PROVIDER_TEST_PROMPT, schema: AI_WORKOUT_SCHEMA });
    usage = result.usage;
    assertProviderTestOutput(result.value, slot, testedAt);
    const next = { ...slot, testedAt, testStatus: 'success', active: false };
    const nextRecords = records.map(record => record.provider === provider ? next : record);
    return { records: nextRecords, provider: publicSlot(next, []), usage };
  } catch (error) {
    usage ||= error?.usage;
    const next = { ...slot, testedAt, testStatus: 'failed', active: false };
    const nextRecords = records.map(record => record.provider === provider ? next : record);
    const publicError = error?.[SAFE_PROVIDER_DIAGNOSTIC] ? error.message : PROVIDER_TEST_FAILED;
    return { records: nextRecords, provider: publicSlot(next, []), error: publicError, ...(usage ? { usage } : {}) };
  }
}

function modelRequest(slot, apiKey, cursor) {
  if (slot.provider === 'openai') return {
    url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${apiKey}` }
  };
  if (slot.provider === 'gemini') return {
    url: `https://generativelanguage.googleapis.com/v1beta/models${cursor ? `?pageToken=${encodeURIComponent(cursor)}` : ''}`,
    headers: { 'x-goog-api-key': apiKey }
  };
  return {
    url: `https://api.anthropic.com/v1/models${cursor ? `?after_id=${encodeURIComponent(cursor)}` : ''}`,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  };
}

export async function listProviderModels(slot, { masterKey: masterKeyHex, fetchImpl = fetch }) {
  if (!slot?.apiKeyEnc) throw new Error('provider is not configured');
  const apiKey = decryptProviderKey(masterKeyHex, slot.apiKeyEnc);
  const models = [];
  let cursor = '';
  do {
    const request = modelRequest(slot, apiKey, cursor);
    const data = await fetchJson(fetchImpl, request.url, { headers: request.headers }, 20_000);
    const rows = slot.provider === 'gemini' ? data.models || [] : data.data || [];
    const compatible = slot.provider === 'gemini'
      ? rows.filter(model => !Array.isArray(model.supportedGenerationMethods) || model.supportedGenerationMethods.includes('generateContent'))
      : rows;
    models.push(...compatible.map(model => String(model.id || model.name || '').replace(/^models\//, '')).filter(Boolean));
    cursor = slot.provider === 'gemini' ? data.nextPageToken || '' : (data.has_more ? data.last_id || '' : '');
  } while (cursor);
  return [...new Set(models)].sort();
}

export function recordAiUsage(entries = [], usage, details) {
  const entry = {
    provider: usage.provider,
    model: usage.model,
    status: details.status,
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    totalTokens: usage.totalTokens || 0,
    latencyMs: Math.max(0, Math.round(details.latencyMs || 0)),
    ...(details.studentId ? { studentId: String(details.studentId).slice(0, 100) } : {}),
    timestamp: details.timestamp
  };
  return [...entries, entry].slice(-2_000);
}

export function failedGenerationUsage(generated, provider) {
  if (generated?.usage) return { ...generated.usage };
  return {
    provider: provider.provider,
    model: provider.selectedModel,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

export function summarizeAiUsage(entries = [], window = '30d', now = new Date()) {
  if (!['7d', '30d'].includes(window)) throw new Error('usage window must be 7d or 30d');
  const cutoff = new Date(now).getTime() - Number(window.slice(0, -1)) * 86_400_000;
  const rows = entries.filter(entry => new Date(entry.timestamp).getTime() >= cutoff);
  return rows.reduce((summary, entry) => ({
    requests: summary.requests + 1,
    inputTokens: summary.inputTokens + (entry.inputTokens || 0),
    outputTokens: summary.outputTokens + (entry.outputTokens || 0),
    totalTokens: summary.totalTokens + (entry.totalTokens || 0),
    failures: summary.failures + (entry.status === 'success' ? 0 : 1),
    latencyMs: summary.latencyMs + (entry.latencyMs || 0)
  }), { window, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, failures: 0, latencyMs: 0 });
}
