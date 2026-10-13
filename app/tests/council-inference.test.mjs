import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.AI_PROVIDER = 'openrouter';
process.env.OPENROUTER_API_KEY = 'mock-only';
process.env.INFERENCE_PROFILE = 'budget';
process.env.JSON_OUTPUT_MODE = 'json_schema';
const { startCouncil } = await import('../lib/council.mjs');
const { SEATS } = await import('../lib/seats.mjs');
const { SESSIONS_DIR } = await import('../lib/env.mjs');
const realFetch = globalThis.fetch;
const title = `inference-test-${Date.now()}`;
let requests = [], invalidOptions = false, badCard = false;

function chair(schema) {
  const p = schema.properties;
  if (p.title) return { title, decision: 'Try a reversible pricing experiment', brief: 'A test brief with cash and customer evidence.', options: invalidOptions ? [] : [{ id: 'A', label: 'Test new price' }, { id: 'B', label: 'Keep current price' }], assumptions: [], weights: SEATS.map(s => ({ seat: s.key, weight: s.key === 'hormozi' ? 3 : 1, reason: 'Relevant lens' })), quick_seats: ['hormozi', 'buffett', 'bezos', 'munger'] };
  if (p.cruxes) return { cruxes: [{ question: 'Will conversion decline?', sides: [{ position: 'Run a capped test', seats: ['hormozi'] }, { position: 'Keep downside limited', seats: ['buffett'] }] }], unanimous: true, note: 'Test the assumption.', pressure: [{ seat: 'buffett', ask: 'Challenge the evidence.' }] };
  if (p.option) return { option: 'A', label: 'GO', recommendation: 'Run a small test.', conditions: ['Cap test to ten clients.'], next_steps: ['Measure conversion next week.'], cheapest_test: 'Ten prospects', kill_criteria: 'Refund rate exceeds threshold' };
  return { label: 'GO', call: 'Run option A with a capped test.', override_note: '', why: [{ point: 'Reversible with a measurable downside.', seat: 'Bezos', framework: 'Two-way door' }], fights: [{ crux: 'Conversion', story: 'The council agreed to measure.' }], minority: { seat: 'Buffett', quote: 'Keep the loss capped.', would_have_to_be_true: 'Downside exceeds the cap.' }, amendments: [], conditions: ['Measure conversion'], next_steps: [{ when: 'Next week', action: 'Review test results.' }], cheapest_test: 'Ten prospects', kill_criteria: 'Excess refunds', revisit: 'After one week' };
}
function mockFetch(_, opts) {
  const body = JSON.parse(opts.body); requests.push(body);
  if (!body.stream) return Promise.resolve(Response.json({ choices: [{ message: { content: JSON.stringify(chair(body.response_format.json_schema.schema)) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30 } }));
  const text = `STANCE: Yes\nOPTION SCORES: ${badCard ? 'A 8/10' : 'A 8/10 · B 3/10'}\nPILLAR SCORE: 8/10\nCONFIDENCE: 4/5\nRUIN RISK: none\nDOOR: two-way\nTHE CALL: Run the test.\nVOTE: endorse\nFINAL SCORE: 8/10\nONE LINE FOR THE FOUNDER: Keep the loss capped.`;
  const frames = [{ choices: [{ delta: { content: text }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 60 } }];
  return Promise.resolve(new Response(frames.map(f => 'data: ' + JSON.stringify(f) + '\n\n').join('') + 'data: [DONE]\n\n'));
}
async function finished(session) {
  const deadline = Date.now() + 20000;
  while (session.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.notEqual(session.status, 'running', 'council should terminate');
  return session;
}

test('OpenRouter runner completes full and quick councils and persists replay events', async t => {
  globalThis.fetch = mockFetch;
  try {
    for (const mode of ['quick', 'full']) await t.test(`${mode} debate`, async () => {
      requests = [];
      const s = await finished(startCouncil('Mock pricing decision with customer and cash data.', mode));
      assert.equal(s.status, 'done');
      assert.ok(s.events.some(e => e.type === 'verdict'));
      assert.equal(s.state.verdict.recommended, 'A');
      assert.equal(s.state.verdict.scores.A.score, 8);
      assert.equal(s.state.verdict.scores.B.score, 3);
      const seats = mode === 'quick' ? 4 : SEATS.length;
      const rounds = mode === 'quick' ? 2 : 3;
      assert.equal(s.events.filter(e => e.type === 'seat_done').length, seats * rounds);
      assert.equal(requests.length, seats * rounds + (mode === 'quick' ? 3 : 4));
      const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'events.json'), 'utf8'));
      assert.equal(saved.status, 'done');
      assert.ok(saved.events.some(e => e.type === 'verdict'));
      assert.match(fs.readFileSync(path.join(s.dir, 'verdict.md'), 'utf8'), /Run option A/);
    });
    await t.test('empty Chair options fail before advisor calls', async () => {
      invalidOptions = true; requests = [];
      const s = await finished(startCouncil('Mock bad Chair options', 'quick'));
      assert.equal(s.status, 'error');
      assert.equal(requests.length, 1);
      assert.match(s.events.find(e => e.type === 'error').error, /distinct options/);
      invalidOptions = false;
    });
    await t.test('incomplete advisor scorecard cannot produce a verdict', async () => {
      badCard = true;
      const s = await finished(startCouncil('Mock incomplete scores', 'quick'));
      assert.equal(s.status, 'error');
      assert.ok(!s.events.some(e => e.type === 'verdict'));
      assert.match(s.events.find(e => e.type === 'error').error, /omitted option B/);

    });
  } finally {
    globalThis.fetch = realFetch;
    const dir = path.join(SESSIONS_DIR, `${new Date().toISOString().slice(0,10)}-${title}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  }
});
