import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateProvider,
  activeProvider,
  buildProviderRequest,
  decryptProviderKey,
  encryptProviderKey,
  listProviderModels,
  providerSlotsDto,
  recordAiUsage,
  runStructuredOutput,
  summarizeAiUsage,
  testProvider,
  upsertProvider
} from '../ai-providers.js';

const masterKey = '11'.repeat(32);
const schema = {
  type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } }
};

test('provider secrets use AES-256-GCM with a strict environment master key', () => {
  const encrypted = encryptProviderKey(masterKey, 'complete-secret-key');
  assert.doesNotMatch(encrypted, /complete-secret-key/);
  assert.equal(decryptProviderKey(masterKey, encrypted), 'complete-secret-key');
  assert.throws(() => encryptProviderKey('not-a-32-byte-hex-key', 'secret'), /AI_CONFIG_MASTER_KEY/);
});

test('provider slots are exact and DTOs never expose encrypted or complete keys', () => {
  const { records } = upsertProvider([], {
    provider: 'openai', selectedModel: 'gpt-test', apiKey: 'complete-secret-key'
  }, masterKey, '2026-08-29T12:00:00.000Z');
  const slots = providerSlotsDto(records, []);
  assert.deepEqual(slots.map(slot => slot.provider), ['openai', 'gemini', 'anthropic']);
  assert.equal(slots[0].configured, true);
  assert.equal(slots[0].selectedModel, 'gpt-test');
  assert.ok(slots[0].keyFingerprint);
  assert.doesNotMatch(JSON.stringify(slots), /complete-secret-key|apiKey|apiKeyEnc/);
});

test('Gemini uses camelCase structured output fields and keeps key only in header', () => {
  const request = buildProviderRequest('gemini', {
    apiKey: 'gemini-complete-key', model: 'gemini-test', prompt: 'return ok', schema
  });
  const body = JSON.parse(request.options.body);
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.options.headers['x-goog-api-key'], 'gemini-complete-key');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema, schema);
  assert.equal('response_mime_type' in body.generationConfig, false);
});

test('official OpenAI and Anthropic structured output contracts are used', () => {
  const openai = buildProviderRequest('openai', { apiKey: 'openai-key', model: 'gpt-test', prompt: 'ok', schema });
  const openaiBody = JSON.parse(openai.options.body);
  assert.equal(openai.url, 'https://api.openai.com/v1/responses');
  assert.equal(openaiBody.store, false);
  assert.equal(openaiBody.text.format.type, 'json_schema');

  const anthropic = buildProviderRequest('anthropic', { apiKey: 'anthropic-key', model: 'claude-test', prompt: 'ok', schema });
  const anthropicBody = JSON.parse(anthropic.options.body);
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/messages');
  assert.ok(anthropic.options.headers['anthropic-version']);
  assert.equal(anthropicBody.output_config.format.type, 'json_schema');
});

test('activation is rejected until the same slot passes a real structured output request', async () => {
  const { records } = upsertProvider([], {
    provider: 'openai', selectedModel: 'gpt-test', apiKey: 'complete-secret-key'
  }, masterKey, '2026-08-29T12:00:00.000Z');
  assert.throws(() => activateProvider(records, 'openai', '2026-08-29T12:01:00.000Z'), /successful test/);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ output_text: '{"ok":true}', usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } }), { status: 200 });
  };
  const tested = await testProvider(records, 'openai', { masterKey, fetchImpl, now: () => '2026-08-29T12:02:00.000Z' });
  assert.equal(calls, 1);
  assert.equal(tested.provider.testStatus, 'success');
  const active = activateProvider(tested.records, 'openai', '2026-08-29T12:03:00.000Z');
  assert.equal(activeProvider(active.records).provider, 'openai');
});

test('generation refuses missing tested active slot and never falls back to another configured key', () => {
  const openai = upsertProvider([], { provider: 'openai', selectedModel: 'gpt-test', apiKey: 'key-a' }, masterKey, '2026-08-29T12:00:00.000Z');
  const gemini = upsertProvider(openai.records, { provider: 'gemini', selectedModel: 'gemini-test', apiKey: 'key-b' }, masterKey, '2026-08-29T12:00:00.000Z');
  assert.equal(activeProvider(gemini.records), null);
});

test('structured generation normalizes token usage without retaining prompt or response', async () => {
  const { records } = upsertProvider([], { provider: 'gemini', selectedModel: 'gemini-test', apiKey: 'key-b' }, masterKey, '2026-08-29T12:00:00.000Z');
  const fetchImpl = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 }
  }), { status: 200 });
  const result = await runStructuredOutput(records[0], { masterKey, fetchImpl, prompt: 'private prompt', schema });
  const entry = recordAiUsage([], result.usage, { status: 'success', latencyMs: 12, timestamp: '2026-08-29T12:00:00.000Z' });
  assert.deepEqual(result.value, { ok: true });
  assert.deepEqual(entry[0], {
    provider: 'gemini', model: 'gemini-test', status: 'success', inputTokens: 5,
    outputTokens: 3, totalTokens: 8, latencyMs: 12, timestamp: '2026-08-29T12:00:00.000Z'
  });
  assert.doesNotMatch(JSON.stringify(entry), /private prompt|\{\\"ok\\":true\}/);
  assert.equal(summarizeAiUsage(entry, '7d', new Date('2026-08-30T00:00:00.000Z')).totalTokens, 8);
});

test('model listing follows Gemini and Anthropic pagination without keys in URLs', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('generativelanguage')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-a' }], nextPageToken: calls.length === 1 ? 'next' : undefined }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ id: 'claude-a' }], has_more: false }), { status: 200 });
  };
  const geminiSlot = upsertProvider([], { provider: 'gemini', selectedModel: 'gemini-a', apiKey: 'gemini-key' }, masterKey, 'now').records[0];
  assert.deepEqual(await listProviderModels(geminiSlot, { masterKey, fetchImpl }), ['gemini-a']);
  assert.ok(calls.every(call => !call.url.includes('gemini-key')));
});
