import { env } from './env.mjs';
import * as anthropic from './anthropic.mjs';

const PRESETS = {
  anthropic: {
    standard: { seat: 'claude-sonnet-4-6', chair: 'claude-opus-4-6' },
    budget: { seat: 'claude-haiku-4-5', chair: 'claude-sonnet-4-6' },
  },
  openrouter: {
    standard: { seat: 'openai/gpt-4.1-mini', chair: 'openai/gpt-4.1-mini' },
    budget: { seat: 'google/gemini-2.5-flash-lite', chair: 'openai/gpt-4.1-mini' },
  },
};
export { S } from './anthropic.mjs';
export const usage = anthropic.usage;

/** Secrets stay server-side; only publicInfo() is sent to the browser. */
export function config() {
  const provider = (env('AI_PROVIDER') || 'anthropic').toLowerCase();
  if (!['anthropic', 'openrouter', 'openai'].includes(provider)) throw new Error('AI_PROVIDER must be anthropic, openrouter, or openai');
  const profile = (env('INFERENCE_PROFILE') || 'standard').toLowerCase();
  if (!['standard', 'budget'].includes(profile)) throw new Error('INFERENCE_PROFILE must be standard or budget');
  const defaults = PRESETS[provider]?.[profile] || {};
  const models = { seat: env('SEAT_MODEL') || defaults.seat, chair: env('CHAIR_MODEL') || defaults.chair };
  if (!models.seat || !models.chair) throw new Error('Set SEAT_MODEL and CHAIR_MODEL for your OpenAI-compatible server');
  const context = env('BRAIN_CONTEXT') || (profile === 'budget' ? 'compact' : 'full');
  if (!['full', 'compact'].includes(context)) throw new Error('BRAIN_CONTEXT must be full or compact');
  const keyVariable = { anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY' }[provider];
  const apiKey = env(keyVariable);
  const localNoKey = provider === 'openai' && env('OPENAI_ALLOW_NO_KEY') === 'true';
  const baseURL = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : env('OPENAI_BASE_URL');
  if (provider === 'openai') {
    if (!baseURL) throw new Error('Set OPENAI_BASE_URL, including /v1, for your server');
    const url = new URL(baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('OPENAI_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment');
    if (localNoKey && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('OPENAI_ALLOW_NO_KEY is limited to loopback servers');
  }
  const jsonMode = env('JSON_OUTPUT_MODE') || 'json_schema';
  if (!['json_schema', 'json_object', 'prompt'].includes(jsonMode)) throw new Error('JSON_OUTPUT_MODE must be json_schema, json_object, or prompt');
  const timeoutMs = Number(env('INFERENCE_TIMEOUT_MS') || 120000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('INFERENCE_TIMEOUT_MS must be between 1000 and 600000');
  return { provider, profile, models, context, apiKey, keyVariable, baseURL, jsonMode, timeoutMs, ready: Boolean(apiKey) || localNoKey };
}
export function publicInfo() {
  const c = config();
  return { provider: c.provider, profile: c.profile, models: c.models, context: c.context, hasKey: c.ready, configurationError: c.ready ? '' : `Add ${c.keyVariable} to .env and restart the room.` };
}

function headers(c) {
  return { 'content-type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}), ...(c.provider === 'openrouter' ? { 'X-Title': 'Debate Room' } : {}) };
}
const RETRY = new Set([429, 500, 502, 503, 504, 529]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(c, body) {
  if (!c.ready) throw new Error(`Add ${c.keyVariable} to .env and restart the room.`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${c.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: headers(c), body: JSON.stringify(body), signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (RETRY.has(res.status) && attempt < 3) {
      await res.body?.cancel();
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      // Do not reflect upstream payloads which may contain credentials or prompts.
      throw new Error(`${c.provider} HTTP ${res.status}. Check credentials, credits, model availability, and JSON_OUTPUT_MODE.`);
    }
    return res;
  }
}
function systemText(system) {
  return typeof system === 'string' ? system : (system || []).map(b => b.text || '').join('\n\n');
}
function addUsage(u) {
  if (!u) return;
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  usage.input += Math.max(0, (u.prompt_tokens || 0) - cached);
  usage.output += u.completion_tokens || 0;
  usage.cacheRead += cached;
}

/** Parses SSE framing, including split UTF-8, CRLF, comments and multi-line events. */
async function* events(body) {
  if (!body) throw new Error('Inference response has no stream');
  const decoder = new TextDecoder();
  let buffer = '', data = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!line) { if (data.length) yield data.join('\n'); data = []; }
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim());
  if (data.length) yield data.join('\n');
}

export async function stream({ model, system, messages, maxTokens = 2000, onText = () => {} }) {
  const c = config();
  if (!c.ready) throw new Error(`Add ${c.keyVariable} to .env and restart the room.`);
  if (c.provider === 'anthropic') return anthropic.stream({ model, system, messages, maxTokens, onText });
  const body = { model, messages: [{ role: 'system', content: systemText(system) }, ...messages], max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } };
  const res = await request(c, body);
  usage.calls++;
  let text = '', finish = null, done = false, finalUsage;
  for await (const data of events(res.body)) {
    if (data === '[DONE]') { done = true; break; }
    let ev;
    try { ev = JSON.parse(data); } catch { throw new Error(`${c.provider} sent malformed streaming data`); }
    if (ev.error) throw new Error(`${c.provider} stream failed; check provider logs`);
    if (ev.usage) finalUsage = ev.usage;
    const choice = ev.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    const delta = choice?.delta?.content;
    if (typeof delta === 'string') { text += delta; onText(delta); }
  }
  addUsage(finalUsage);
  if (!text.trim()) throw new Error(`${c.provider} returned an empty advisor response`);
  if (finish !== 'stop') throw new Error(`${c.provider} advisor stopped with ${finish}; no complete card was accepted`);
  if (!done && !finish) throw new Error(`${c.provider} stream ended before completion`);
  return text;
}

/** Validator for the exact schema subset generated by this app's S helpers. */
export function validateJSON(value, schema, location = '$') {
  const fail = message => { throw new Error(`Chair JSON ${location}: ${message}`); };
  if (schema.enum && !schema.enum.includes(value)) fail('value is outside the allowed enum');
  switch (schema.type) {
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object');
      for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
      for (const [key, item] of Object.entries(value)) {
        if (schema.properties?.[key]) validateJSON(item, schema.properties[key], `${location}.${key}`);
        else if (schema.additionalProperties === false) fail(`unexpected ${key}`);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) fail('expected array');
      value.forEach((item, i) => validateJSON(item, schema.items, `${location}[${i}]`));
      break;
    case 'integer': if (!Number.isInteger(value)) fail('expected integer'); break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected number'); break;
    case 'string': case 'boolean': if (typeof value !== schema.type) fail(`expected ${schema.type}`); break;
    default: fail('unsupported schema type');
  }
  return value;
}
export async function json({ model, system, prompt, schema, maxTokens = 4000 }) {
  const c = config();
  if (!c.ready) throw new Error(`Add ${c.keyVariable} to .env and restart the room.`);
  if (c.provider === 'anthropic') return validateJSON(await anthropic.json({ model, system, prompt, schema, maxTokens }), schema);
  const body = {
    model, max_tokens: maxTokens, stream: false,
    messages: [{ role: 'system', content: systemText(system) + '\nReturn only a JSON object matching this schema. No Markdown or commentary.\n' + JSON.stringify(schema) }, { role: 'user', content: prompt }],
  };
  if (c.jsonMode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'council_response', strict: true, schema } };
  if (c.jsonMode === 'json_object') body.response_format = { type: 'json_object' };
  if (c.provider === 'openrouter' && c.jsonMode !== 'prompt') body.provider = { require_parameters: true };
  const res = await request(c, body);
  usage.calls++;
  const response = await res.json();
  addUsage(response.usage);
  if (response.error) throw new Error(`${c.provider} Chair request failed; check provider logs`);
  const choice = response.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new Error(`${c.provider} Chair did not finish normally (${choice?.finish_reason || 'missing completion'})`);
  if (choice.message?.refusal) throw new Error(`${c.provider} Chair refused the request`);
  const text = choice.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${c.provider} returned empty Chair JSON`);
  let result;
  try { result = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')); }
  catch { throw new Error('Chair returned invalid JSON. Choose a stronger Chair model or use JSON_OUTPUT_MODE=json_schema.'); }
  return validateJSON(result, schema);
}
