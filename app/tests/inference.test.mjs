import test from 'node:test';
import assert from 'node:assert/strict';
import { config, publicInfo, json, stream, S, validateJSON, usage } from '../lib/inference.mjs';
import { systemFor } from '../lib/seats.mjs';

const keys = ['AI_PROVIDER', 'INFERENCE_PROFILE', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ALLOW_NO_KEY', 'SEAT_MODEL', 'CHAIR_MODEL', 'JSON_OUTPUT_MODE', 'BRAIN_CONTEXT', 'INFERENCE_TIMEOUT_MS'];
const originals = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
function configure(extra = {}) {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-only-key', ...extra });
}
function restore() {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (originals[key] === undefined) delete process.env[key];
    else process.env[key] = originals[key];
  }
}
const schema = S.obj({ title: S.str, options: S.arr(S.enum('A', 'B')), weight: S.int });
const good = { title: 'Test', options: ['A', 'B'], weight: 2 };
function completion(content = JSON.stringify(good), finish_reason = 'stop') {
  return Response.json({ choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 20, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 5 } } });
}
function sse(frames) {
  const bytes = new TextEncoder().encode(frames.join('\r\n\r\n'));
  // Single-byte chunks exercise framing and multibyte UTF-8 boundaries.
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('inference compatibility', async t => {
  try {
    await t.test('budget preset and model overrides; public config contains no secrets', () => {
      configure({ INFERENCE_PROFILE: 'budget' });
      assert.equal(config().models.seat, 'google/gemini-2.5-flash-lite');
      assert.equal(config().models.chair, 'openai/gpt-4.1-mini');
      assert.equal(config().context, 'compact');
      assert.ok(!JSON.stringify(publicInfo()).includes('test-only-key'));
      process.env.CHAIR_MODEL = 'custom/chair';
      assert.equal(config().models.chair, 'custom/chair');
      configure({ AI_PROVIDER: 'anthropic', INFERENCE_PROFILE: 'budget' });
      assert.equal(config().models.seat, 'claude-haiku-4-5');
    });
    await t.test('compact prompts reduce size without dropping source register', () => {
      configure({ BRAIN_CONTEXT: 'full' });
      const full = systemFor('graham')[0].text;
      process.env.BRAIN_CONTEXT = 'compact';
      const compact = systemFor('graham')[0].text;
      assert.ok(compact.length < full.length * 0.7);
      assert.match(compact, /sources.md/);
      assert.match(compact, /_hot.md/);
      assert.ok(!compact.includes('===== brains/paul-graham/positions.md'));
    });
    await t.test('OpenRouter Chair sends strict schema and requires compatible routing', async () => {
      configure();
      globalThis.fetch = async (url, opts) => {
        assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
        assert.equal(opts.headers.Authorization, 'Bearer test-only-key');
        const body = JSON.parse(opts.body);
        assert.equal(body.messages[0].role, 'system');
        assert.equal(body.response_format.json_schema.strict, true);
        assert.deepEqual(body.response_format.json_schema.schema, schema);
        assert.equal(body.provider.require_parameters, true);
        assert.equal(body.max_tokens, 400);
        return completion();
      };
      const before = { ...usage };
      assert.deepEqual(await json({ model: config().models.chair, system: 'chair', prompt: 'decision', schema, maxTokens: 400 }), good);
      assert.equal(usage.input - before.input, 15);
      assert.equal(usage.cacheRead - before.cacheRead, 5);
      assert.equal(usage.output - before.output, 8);
    });
    await t.test('OpenRouter SSE handles comments, split UTF-8 and empty usage choices', async () => {
      configure();
      globalThis.fetch = async (_, opts) => {
        const body = JSON.parse(opts.body);
        assert.equal(body.stream_options.include_usage, true);
        assert.deepEqual(body.messages[0], { role: 'system', content: 'brain' });
        assert.equal(body.system, undefined);
        return sse([': OPENROUTER PROCESSING', 'data: {"choices":[{"delta":{"content":"Munger’s "},"finish_reason":null}]}', 'data: {"choices":[{"delta":{"content":"card"},"finish_reason":"stop"}]}', 'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}', 'data: [DONE]']);
      };
      const deltas = [];
      const text = await stream({ model: 'cheap/model', system: [{ type: 'text', text: 'brain', cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'decision' }], onText: d => deltas.push(d) });
      assert.equal(text, 'Munger’s card');
      assert.equal(deltas.join(''), text);
    });
    await t.test('mid-stream errors and incomplete responses cannot become scored cards', async () => {
      configure();
      for (const frames of [
        ['data: {"error":{"message":"secret payload"}}'],
        ['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}', 'data: [DONE]'],
        ['data: {"choices":[{"delta":{"content":"partial"}}]}'],
        ['data: [DONE]'],
        ['data: {"choices":[{"delta":{"content":"partial"}}]}', 'data: [DONE]'],
      ]) {
        globalThis.fetch = async () => sse(frames);
        await assert.rejects(stream({ model: 'model', system: 'brain', messages: [] }));
      }
    });
    await t.test('invalid Chair JSON, enum values, missing fields and truncation fail closed', async () => {
      configure();
      for (const body of ['not json', '{}', JSON.stringify({ ...good, options: ['X'] }), JSON.stringify({ ...good, extra: true })]) {
        globalThis.fetch = async () => completion(body);
        await assert.rejects(json({ model: 'model', system: 'chair', prompt: 'decision', schema }));
      }
      globalThis.fetch = async () => completion(JSON.stringify(good), 'length');
      await assert.rejects(json({ model: 'model', system: 'chair', prompt: 'decision', schema }), /did not finish normally/);
      assert.throws(() => validateJSON({ ...good, weight: '2' }, schema), /expected integer/);
    });
    await t.test('local compatible endpoints support explicit keyless and prompt-only mode', async () => {
      configure({ AI_PROVIDER: 'openai', OPENAI_BASE_URL: 'http://localhost:11434/v1/', OPENAI_ALLOW_NO_KEY: 'true', SEAT_MODEL: 'local-model', CHAIR_MODEL: 'local-model', JSON_OUTPUT_MODE: 'prompt' });
      globalThis.fetch = async (url, opts) => {
        assert.equal(url, 'http://localhost:11434/v1/chat/completions');
        assert.equal(opts.headers.Authorization, undefined);
        const body = JSON.parse(opts.body);
        assert.equal(body.response_format, undefined);
        assert.equal(body.provider, undefined);
        assert.match(body.messages[0].content, /"required"/);
        return completion('```json\n' + JSON.stringify(good) + '\n```');
      };
      assert.equal(publicInfo().hasKey, true);
      assert.deepEqual(await json({ model: 'local-model', system: 'chair', prompt: 'decision', schema }), good);
      process.env.OPENAI_BASE_URL = 'https://example.com/v1';
      assert.throws(config, /loopback/);
    });
    await t.test('JSON object mode is explicit; no unsupported auto fallback or extra paid retry', async () => {
      configure({ JSON_OUTPUT_MODE: 'json_object' });
      globalThis.fetch = async (_, opts) => {
        assert.deepEqual(JSON.parse(opts.body).response_format, { type: 'json_object' });
        return completion();
      };
      assert.deepEqual(await json({ model: 'model', system: '', prompt: '', schema }), good);
      let requests = 0;
      globalThis.fetch = async () => { requests++; return new Response('secret payload', { status: 401 }); };
      await assert.rejects(json({ model: 'model', system: '', prompt: '', schema }), /HTTP 401/);
      assert.equal(requests, 1);
    });
    await t.test('missing selected-provider key fails before fetch', async () => {
      configure(); delete process.env.OPENROUTER_API_KEY;
      globalThis.fetch = async () => { assert.fail('must not call provider'); };
      assert.equal(publicInfo().hasKey, false);
      await assert.rejects(json({ model: 'model', system: '', prompt: '', schema }), /OPENROUTER_API_KEY/);
    });
    await t.test('existing Anthropic request format is preserved and Chair output validated', async () => {
      configure({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-anthropic-key' });
      globalThis.fetch = async (url, opts) => {
        assert.equal(url, 'https://api.anthropic.com/v1/messages');
        const body = JSON.parse(opts.body);
        assert.equal(opts.headers['x-api-key'], 'test-anthropic-key');
        assert.deepEqual(body.output_config.format.schema, schema);
        return Response.json({ content: [{ type: 'text', text: JSON.stringify(good) }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 10 } });
      };
      assert.deepEqual(await json({ model: 'claude', system: 'chair', prompt: 'decision', schema }), good);
    });
  } finally { restore(); }
});
