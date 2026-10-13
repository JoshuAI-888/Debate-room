import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCharacters, validateCharacter } from '../lib/characters.mjs';
import { SEATS, systemFor, parseCard } from '../lib/seats.mjs';
test('default lineup includes Munger; original roles have complete brains', () => {
  assert.equal(SEATS.length, 8);
  assert.match(systemFor("munger")[0].text, /S003/);
  for (const role of loadCharacters().filter(s => s.kind === 'role')) {
    assert.equal(role.enabled, false);
    assert.deepEqual(validateCharacter(role), []);
  }
  assert.match(systemFor('graham')[0].text, /sources.md/);
  assert.ok(systemFor('graham')[0].text.length > 10000);
});
test('unsafe paths and unfinished activation are rejected', () => {
  const s = loadCharacters()[0];
  assert.ok(validateCharacter({ ...s, slug: '../escape' }).includes('Invalid slug'));
  assert.ok(validateCharacter({ ...s, status: 'draft' }).includes('Draft characters cannot be enabled'));
});
test('card scores and votes remain parseable', () => {
  const c = parseCard('STANCE: Conditional yes\nOPTION SCORES: A 3/10 · B 8/10\nCONFIDENCE: 4/5\nVOTE: amend', ['A','B']);
  assert.deepEqual(c.optionScores, { A: 3, B: 8 });
  assert.equal(c.vote, 'amend');
});
