import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDealsTarget } from '../src/lib/sales-target-validation.ts';

test('accepts whole number targets including zero', () => {
  assert.equal(parseDealsTarget('0'), 0);
  assert.equal(parseDealsTarget('42'), 42);
  assert.equal(parseDealsTarget(' 120 '), 120);
});

test('rejects empty, decimal, negative, non-numeric, and out-of-range targets', () => {
  for (const value of ['', '   ', '1.5', '-1', 'ten', '1,000', '1000001']) {
    assert.throws(() => parseDealsTarget(value), { message: /whole-number/ });
  }
});
