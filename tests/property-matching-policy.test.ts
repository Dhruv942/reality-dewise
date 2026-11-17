import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePropertyName, fuzzyCandidates } from '../src/modules/property-matching/matching.policy';

test('normalizes portal names across punctuation, casing and whitespace', () => {
  assert.equal(normalizePropertyName(' Rustomjee-Elita / Phase 1 '), 'rustomjee elita phase 1');
  assert.equal(normalizePropertyName('RUSTOMJEE  ELITA'), 'rustomjee elita');
});

test('returns one reliable fuzzy candidate only when it beats the threshold and margin', () => {
  const one = fuzzyCandidates('Rustomjee Elita Phase 1', [{ id: 'p1', name: 'Rustomjee Elita' }, { id: 'p2', name: 'Lodha Altamount' }]);
  assert.equal(one.status, 'MATCHED');
  assert.equal(one.candidates[0].id, 'p1');
  assert.ok((one.candidates[0].confidence ?? 0) >= 0.85);

  const ambiguous = fuzzyCandidates('Rustomjee Elita', [{ id: 'p1', name: 'Rustomjee Elita East' }, { id: 'p2', name: 'Rustomjee Elita West' }]);
  assert.equal(ambiguous.status, 'AMBIGUOUS');
});
