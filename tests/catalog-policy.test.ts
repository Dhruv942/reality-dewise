import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPriceBand } from '../src/modules/catalog/catalog.policy';

test('classifies exact real-estate price-band boundaries', () => {
  assert.equal(classifyPriceBand(99_999), 'THOUSANDS');
  assert.equal(classifyPriceBand(100_000), 'LAKHS');
  assert.equal(classifyPriceBand(99_99_999), 'LAKHS');
  assert.equal(classifyPriceBand(1_00_00_000), 'UP_TO_2_CR');
  assert.equal(classifyPriceBand(2_00_00_000), 'UP_TO_2_CR');
  assert.equal(classifyPriceBand(2_00_00_001), 'ABOVE_2_TO_4_CR');
  assert.equal(classifyPriceBand(4_00_00_000), 'ABOVE_2_TO_4_CR');
  assert.equal(classifyPriceBand(4_00_00_001), 'ABOVE_4_TO_6_CR');
  assert.equal(classifyPriceBand(6_00_00_001), 'ABOVE_6_TO_8_CR');
  assert.equal(classifyPriceBand(8_00_00_001), 'ABOVE_8_CR');
});

test('classifies a range as mixed when it crosses bands and unknown when absent', () => {
  assert.equal(classifyPriceBand(null), 'UNKNOWN');
  assert.equal(classifyPriceBand(undefined), 'UNKNOWN');
  assert.equal(classifyPriceBand(1_00_00_000, 2_00_00_000), 'UP_TO_2_CR');
  assert.equal(classifyPriceBand(1_99_00_000, 2_01_00_000), 'MIXED');
});

test('rejects negative and inverted price ranges', () => {
  assert.throws(() => classifyPriceBand(-1), /Price cannot be negative/);
  assert.throws(() => classifyPriceBand(2_00_000, 1_00_000), /minimum price cannot exceed maximum price/);
});
