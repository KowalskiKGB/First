import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_WORKOUT_SCHEMA } from '../ai.js';
import {
  activateProvider,
  activeProvider,
  buildProviderRequest,
  decryptProviderKey,
  encryptProviderKey,
  failedGenerationUsage,
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
const providerTestPlan = () => ({
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
const hasSchemaKeyword = (value, keyword) => value && typeof value === 'object' && (
  Object.hasOwn(value, keyword) || Object.values(value).some(item => hasSchemaKeyword(item, keyword))
);

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
  assert.deepEqual(providerSlotsDto([], []).map(slot => slot.configured), [false, false, false]);
});

test('provider updates preserve an omitted key, reject custom hosts, and reset test state', () => {
  const created = upsertProvider([], { provider: 'openai', selectedModel: 'gpt-a', apiKey: 'key-a' }, masterKey, 'one');
  const tested = created.records.map(record => ({ ...record, testedAt: 'tested', testStatus: 'success', active: true }));
  const updated = upsertProvider(tested, { provider: 'openai', selectedModel: 'gpt-b' }, masterKey, 'two');
  assert.equal(decryptProviderKey(masterKey, updated.records[0].apiKeyEnc), 'key-a');
  assert.equal(updated.provider.testStatus, 'untested');
  assert.equal(updated.provider.active, false);
  assert.throws(() => upsertProvider([], { provider: 'openai', selectedModel: 'gpt', baseUrl: 'https://evil.example', apiKey: 'key' }, masterKey), /custom base URL/);
  assert.throws(() => upsertProvider([], { provider: 'unknown', selectedModel: 'model', apiKey: 'key' }, masterKey), /unsupported/);
  assert.throws(() => upsertProvider([], { provider: 'openai', selectedModel: '', apiKey: 'key' }, masterKey), /selectedModel/);
  assert.throws(() => upsertProvider([], { provider: 'openai', selectedModel: 'gpt' }, masterKey), /apiKey/);
  const unchanged = upsertProvider(tested, { provider: 'openai', selectedModel: 'gpt-a' }, masterKey, 'three');
  assert.equal(unchanged.provider.testStatus, 'success');
  assert.throws(() => decryptProviderKey(masterKey, 'invalid'), /invalid encrypted/);
});

test('provider key can be saved before choosing a model but cannot test or activate yet', async () => {
  let configured;
  assert.doesNotThrow(() => {
    configured = upsertProvider([], { provider: 'gemini', apiKey: 'key-b' }, masterKey, 'now');
  });

  assert.equal(configured.provider.configured, true);
  assert.equal(configured.provider.selectedModel, '');
  assert.equal(configured.provider.testStatus, 'untested');
  await assert.rejects(
    () => testProvider(configured.records, 'gemini', {
      masterKey,
      fetchImpl: async () => { throw new Error('fetch must not run without a model'); }
    }),
    /selectedModel required|model required/i
  );
  assert.throws(() => activateProvider(configured.records, 'gemini'), /successful test/);
});

test('Gemini uses camelCase structured output fields and keeps key only in header', () => {
  const request = buildProviderRequest('gemini', {
    apiKey: 'gemini-complete-key', model: 'gemini-test', prompt: 'return ok', schema
  });
  const body = JSON.parse(request.options.body);
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.options.headers['x-goog-api-key'], 'gemini-complete-key');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseJsonSchema, schema);
  assert.equal('responseSchema' in body.generationConfig, false);
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

test('provider requests remove only unsupported schema constraints without mutating the local contract', () => {
  const before = structuredClone(AI_WORKOUT_SCHEMA);
  const openai = JSON.parse(buildProviderRequest('openai', { apiKey: 'a', model: 'gpt', prompt: 'ok', schema: AI_WORKOUT_SCHEMA }).options.body);
  const gemini = JSON.parse(buildProviderRequest('gemini', { apiKey: 'b', model: 'gemini', prompt: 'ok', schema: AI_WORKOUT_SCHEMA }).options.body);
  const anthropic = JSON.parse(buildProviderRequest('anthropic', { apiKey: 'c', model: 'claude', prompt: 'ok', schema: AI_WORKOUT_SCHEMA }).options.body);

  assert.equal(hasSchemaKeyword(openai.text.format.schema, 'minLength'), true);
  assert.equal(hasSchemaKeyword(gemini.generationConfig.responseJsonSchema, 'minLength'), false);
  assert.equal(hasSchemaKeyword(gemini.generationConfig.responseJsonSchema, 'minimum'), true);
  for (const keyword of ['minimum', 'maximum', 'minLength', 'maxLength']) {
    assert.equal(hasSchemaKeyword(anthropic.output_config.format.schema, keyword), false, keyword);
  }
  assert.deepEqual(AI_WORKOUT_SCHEMA, before);
});

test('each provider must pass its adapted real workout schema before activation', async () => {
  const cases = [
    {
      provider: 'openai', model: 'gpt-test', key: 'openai-secret',
      schema: body => body.text.format.schema,
      response: { output_text: JSON.stringify(providerTestPlan()), usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } }
    },
    {
      provider: 'gemini', model: 'gemini-test', key: 'gemini-secret',
      schema: body => body.generationConfig.responseJsonSchema,
      response: {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(providerTestPlan()) }] } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 }
      }
    },
    {
      provider: 'anthropic', model: 'claude-test', key: 'anthropic-secret',
      schema: body => body.output_config.format.schema,
      response: {
        stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(providerTestPlan()) }],
        usage: { input_tokens: 4, output_tokens: 2 }
      }
    }
  ];

  for (const item of cases) {
    const { records } = upsertProvider([], {
      provider: item.provider, selectedModel: item.model, apiKey: item.key
    }, masterKey, '2026-08-29T12:00:00.000Z');
    assert.throws(() => activateProvider(records, item.provider, '2026-08-29T12:01:00.000Z'), /successful test/);
    let requestedSchema;
    const tested = await testProvider(records, item.provider, {
      masterKey,
      now: () => '2026-08-29T12:02:00.000Z',
      fetchImpl: async (_url, options) => {
        requestedSchema = item.schema(JSON.parse(options.body));
        return new Response(JSON.stringify(item.response), { status: 200 });
      }
    });
    assert.deepEqual(requestedSchema.required, AI_WORKOUT_SCHEMA.required);
    assert.equal(requestedSchema.properties.routines.type, 'array');
    assert.equal(tested.provider.testStatus, 'success');
    const active = activateProvider(tested.records, item.provider, '2026-08-29T12:03:00.000Z');
    assert.equal(activeProvider(active.records).provider, item.provider);
  }
});

test('failed structured slot test is persisted as failed and cannot become active', async () => {
  const { records } = upsertProvider([], { provider: 'anthropic', selectedModel: 'claude-test', apiKey: 'key' }, masterKey, 'now');
  const tested = await testProvider(records, 'anthropic', {
    masterKey,
    now: () => 'later',
    fetchImpl: async () => new Response(JSON.stringify({
      stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":false}' }],
      usage: { input_tokens: 19, output_tokens: 3 }
    }), { status: 200 })
  });
  assert.equal(tested.provider.testStatus, 'failed');
  assert.equal(tested.error, 'AI provider test failed');
  assert.deepEqual(tested.usage, { provider: 'anthropic', model: 'claude-test', inputTokens: 19, outputTokens: 3, totalTokens: 22 });
  assert.throws(() => activateProvider(tested.records, 'anthropic'), /successful test/);
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
  const entry = recordAiUsage([], result.usage, { status: 'success', studentId: 'student-a', latencyMs: 12, timestamp: '2026-08-29T12:00:00.000Z' });
  assert.deepEqual(result.value, { ok: true });
  assert.deepEqual(entry[0], {
    provider: 'gemini', model: 'gemini-test', status: 'success', inputTokens: 5,
    outputTokens: 3, totalTokens: 8, latencyMs: 12, studentId: 'student-a', timestamp: '2026-08-29T12:00:00.000Z'
  });
  assert.doesNotMatch(JSON.stringify(entry), /private prompt|\{\\"ok\\":true\}/);
  assert.equal(summarizeAiUsage(entry, '7d', new Date('2026-08-30T00:00:00.000Z')).totalTokens, 8);
});

test('runtime usage retention keeps the newest two thousand records', async () => {
  const { records } = upsertProvider([], { provider: 'gemini', selectedModel: 'gemini-test', apiKey: 'key-b' }, masterKey, '2026-08-29T12:00:00.000Z');
  const existing = Array.from({ length: 2000 }, (_, index) => ({
    provider: 'gemini',
    model: 'gemini-test',
    status: 'success',
    inputTokens: index,
    outputTokens: 0,
    totalTokens: index,
    latencyMs: 1,
    timestamp: `2026-08-29T12:${String(index % 60).padStart(2, '0')}:00.000Z`
  }));
  const fetchImpl = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 }
  }), { status: 200 });
  const result = await runStructuredOutput(records[0], { masterKey, fetchImpl, prompt: 'private prompt', schema });
  const retained = recordAiUsage(existing, result.usage, {
    status: 'success',
    studentId: 'student-a',
    latencyMs: 12,
    timestamp: '2026-08-29T13:00:00.000Z'
  });
  assert.equal(retained.length, 2000);
  assert.equal(retained[0].inputTokens, 1);
  assert.equal(retained.at(-1).studentId, 'student-a');
});

test('OpenAI and Anthropic alternate response shapes parse successfully', async () => {
  const openaiSlot = upsertProvider([], { provider: 'openai', selectedModel: 'gpt-test', apiKey: 'key-a' }, masterKey, 'now').records[0];
  const openai = await runStructuredOutput(openaiSlot, {
    masterKey, schema, prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({
      status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }]
    }), { status: 200 })
  });
  assert.deepEqual(openai.value, { ok: true });

  const anthropicSlot = upsertProvider([], { provider: 'anthropic', selectedModel: 'claude-test', apiKey: 'key-c' }, masterKey, 'now').records[0];
  const anthropic = await runStructuredOutput(anthropicSlot, {
    masterKey, schema, prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({
      stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n{"ok":true}\n```' }], usage: { input_tokens: 2, output_tokens: 1 }
    }), { status: 200 })
  });
  assert.equal(anthropic.usage.totalTokens, 3);
});

test('structured generation rejects refusals and truncated provider responses', async () => {
  const openaiSlot = upsertProvider([], { provider: 'openai', selectedModel: 'gpt-test', apiKey: 'key-a' }, masterKey, 'now').records[0];
  await assert.rejects(() => runStructuredOutput(openaiSlot, {
    masterKey,
    schema,
    prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete', output_text: '{"ok":true}' }), { status: 200 })
  }), /truncated/);
  await assert.rejects(() => runStructuredOutput(openaiSlot, {
    masterKey,
    schema,
    prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({
      status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }]
    }), { status: 200 })
  }), /refused/);

  const geminiSlot = upsertProvider([], { provider: 'gemini', selectedModel: 'gemini-test', apiKey: 'key-b' }, masterKey, 'now').records[0];
  await assert.rejects(() => runStructuredOutput(geminiSlot, {
    masterKey,
    schema,
    prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '{"ok":true}' }] } }]
    }), { status: 200 })
  }), /refused/);
  await assert.rejects(() => runStructuredOutput(geminiSlot, {
    masterKey,
    schema,
    prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"ok":true}' }] } }]
    }), { status: 200 })
  }), /truncated/);

  const anthropicSlot = upsertProvider([], { provider: 'anthropic', selectedModel: 'claude-test', apiKey: 'key-c' }, masterKey, 'now').records[0];
  await assert.rejects(() => runStructuredOutput(anthropicSlot, {
    masterKey,
    schema,
    prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"ok":true}' }] }), { status: 200 })
  }), /truncated/);

  for (const body of [
    { stop_reason: 'refusal', content: [{ type: 'text', text: JSON.stringify(providerTestPlan()) }], usage: { input_tokens: 8, output_tokens: 2 } },
    { stop_reason: 'end_turn', stop_details: { type: 'refusal' }, content: [{ type: 'text', text: JSON.stringify(providerTestPlan()) }], usage: { input_tokens: 7, output_tokens: 1 } }
  ]) {
    await assert.rejects(() => runStructuredOutput(anthropicSlot, {
      masterKey,
      schema: AI_WORKOUT_SCHEMA,
      prompt: 'private',
      fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 })
    }), error => /refused/.test(error.message) && error.usage?.totalTokens > 0);
  }
});

test('Anthropic refusal cannot mark a provider test successful and retains billed usage', async () => {
  const slot = upsertProvider([], { provider: 'anthropic', selectedModel: 'claude-test', apiKey: 'key-c' }, masterKey, 'now').records[0];
  const tested = await testProvider([slot], 'anthropic', {
    masterKey,
    now: () => 'later',
    fetchImpl: async () => new Response(JSON.stringify({
      stop_reason: 'refusal', content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 8, output_tokens: 2 }
    }), { status: 200 })
  });

  assert.equal(tested.provider.testStatus, 'failed');
  assert.equal(tested.error, 'AI provider test failed');
  assert.deepEqual(tested.usage, { provider: 'anthropic', model: 'claude-test', inputTokens: 8, outputTokens: 2, totalTokens: 10 });
  assert.throws(() => activateProvider(tested.records, 'anthropic'), /successful test/);
});

test('structured provider requests enforce their timeout', async () => {
  const slot = upsertProvider([], { provider: 'openai', selectedModel: 'gpt-timeout', apiKey: 'key-a' }, masterKey, 'now').records[0];
  const fetchImpl = async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const startedAt = Date.now();

  await assert.rejects(() => runStructuredOutput(slot, {
    masterKey, schema, prompt: 'private', fetchImpl, timeoutMs: 10
  }), /abort|timeout/i);
  assert.ok(Date.now() - startedAt < 1_000);
});

test('provider HTTP errors are sanitized and never include the complete key', async () => {
  const completeKey = 'complete-provider-key';
  const slot = upsertProvider([], { provider: 'anthropic', selectedModel: 'claude-test', apiKey: completeKey }, masterKey, 'now').records[0];
  await assert.rejects(() => runStructuredOutput(slot, {
    masterKey,
    schema,
    prompt: 'private',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `invalid ${completeKey}` } }), { status: 401 })
  }), error => !error.message.includes(completeKey) && /401/.test(error.message));
});

test('HTTP 200 structured failures carry normalized usage without retaining raw output', async () => {
  const cases = [
    {
      provider: 'openai', model: 'gpt-usage', key: 'key-a',
      body: { status: 'incomplete', output_text: 'SENTINEL_RAW_OPENAI', usage: { input_tokens: 11, output_tokens: 2, total_tokens: 13 } },
      usage: { provider: 'openai', model: 'gpt-usage', inputTokens: 11, outputTokens: 2, totalTokens: 13 }
    },
    {
      provider: 'gemini', model: 'gemini-usage', key: 'key-b',
      body: { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'SENTINEL_RAW_GEMINI' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 1, totalTokenCount: 8 } },
      usage: { provider: 'gemini', model: 'gemini-usage', inputTokens: 7, outputTokens: 1, totalTokens: 8 }
    },
    {
      provider: 'anthropic', model: 'claude-usage', key: 'key-c',
      body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'SENTINEL_RAW_ANTHROPIC not-json' }], usage: { input_tokens: 5, output_tokens: 3 } },
      usage: { provider: 'anthropic', model: 'claude-usage', inputTokens: 5, outputTokens: 3, totalTokens: 8 }
    }
  ];

  for (const item of cases) {
    const slot = upsertProvider([], {
      provider: item.provider, selectedModel: item.model, apiKey: item.key
    }, masterKey, 'now').records[0];
    await assert.rejects(() => runStructuredOutput(slot, {
      masterKey,
      schema,
      prompt: 'private',
      fetchImpl: async () => new Response(JSON.stringify(item.body), { status: 200 })
    }), error => {
      assert.deepEqual(error.usage, item.usage);
      assert.doesNotMatch(JSON.stringify(error), /SENTINEL_RAW/);
      return true;
    });
  }
});

test('malformed provider output never leaks response content through parse or test DTO errors', async () => {
  const sentinel = 'SENTINEL_PROVIDER_SECRET_PROMPT_RESPONSE';
  const slot = upsertProvider([], {
    provider: 'openai', selectedModel: 'gpt-test', apiKey: 'key-a'
  }, masterKey, 'now').records[0];
  const fetchImpl = async () => new Response(JSON.stringify({ output_text: `${sentinel} not-json` }), { status: 200 });

  await assert.rejects(
    () => runStructuredOutput(slot, { masterKey, schema, prompt: 'private', fetchImpl }),
    error => /invalid structured output/i.test(error.message) && !error.message.includes(sentinel)
  );

  const tested = await testProvider([slot], 'openai', { masterKey, fetchImpl, now: () => 'later' });
  assert.equal(tested.provider.testStatus, 'failed');
  assert.doesNotMatch(tested.error, new RegExp(sentinel));
  assert.match(tested.error, /provider test failed/i);
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

  calls.length = 0;
  const anthropicSlot = upsertProvider([], { provider: 'anthropic', selectedModel: 'claude-a', apiKey: 'anthropic-key' }, masterKey, 'now').records[0];
  assert.deepEqual(await listProviderModels(anthropicSlot, { masterKey, fetchImpl }), ['claude-a']);
  assert.ok(calls.every(call => !call.url.includes('anthropic-key')));

  const openaiSlot = upsertProvider([], { provider: 'openai', selectedModel: 'gpt-a', apiKey: 'openai-key' }, masterKey, 'now').records[0];
  assert.deepEqual(await listProviderModels(openaiSlot, {
    masterKey,
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] }), { status: 200 })
  }), ['gpt-a', 'gpt-b']);
  await assert.rejects(() => listProviderModels(null, { masterKey }), /not configured/);
});

test('Gemini model listing returns only generateContent models', async () => {
  const slot = upsertProvider([], { provider: 'gemini', selectedModel: 'gemini-a', apiKey: 'gemini-key' }, masterKey, 'now').records[0];

  const models = await listProviderModels(slot, {
    masterKey,
    fetchImpl: async () => new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/imagen-3.0-generate-002', supportedGenerationMethods: ['predict'] }
      ]
    }), { status: 200 })
  });

  assert.deepEqual(models, ['gemini-2.5-flash']);
});

test('usage summaries enforce windows, cutoff old rows, and count failures', () => {
  const rows = [
    { provider: 'openai', model: 'gpt', status: 'failed', inputTokens: 2, outputTokens: 1, totalTokens: 3, latencyMs: 4, timestamp: '2026-08-29T00:00:00.000Z' },
    { provider: 'openai', model: 'gpt', status: 'success', inputTokens: 99, outputTokens: 1, totalTokens: 100, latencyMs: 4, timestamp: '2026-07-01T00:00:00.000Z' }
  ];
  const summary = summarizeAiUsage(rows, '7d', new Date('2026-08-30T00:00:00.000Z'));
  assert.equal(summary.requests, 1);
  assert.equal(summary.failures, 1);
  assert.equal(summary.totalTokens, 3);
  assert.throws(() => summarizeAiUsage(rows, '1d'), /7d or 30d/);
});

test('failed invalid-plan generation retains billed provider tokens and only pre-usage failures use zeros', () => {
  const provider = { provider: 'openai', selectedModel: 'gpt-billed' };
  const generatedWithInvalidPlan = {
    value: { routines: [{ id: 'semantically-invalid' }] },
    usage: { provider: 'openai', model: 'gpt-billed', inputTokens: 17, outputTokens: 9, totalTokens: 26 }
  };
  const billed = recordAiUsage([], failedGenerationUsage(generatedWithInvalidPlan, provider), {
    status: 'failed', latencyMs: 44, timestamp: '2026-08-29T15:00:00.000Z'
  });
  assert.deepEqual(billed[0], {
    provider: 'openai', model: 'gpt-billed', status: 'failed', inputTokens: 17,
    outputTokens: 9, totalTokens: 26, latencyMs: 44, timestamp: '2026-08-29T15:00:00.000Z'
  });

  assert.deepEqual(failedGenerationUsage(undefined, provider), {
    provider: 'openai', model: 'gpt-billed', inputTokens: 0, outputTokens: 0, totalTokens: 0
  });
});
