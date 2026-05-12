import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStream, pickFloat, pickIndex } from '../src/components/layouts/resolver/randomStream';

test('makeStream(seed) is deterministic — same seed yields same sequence', () => {
  const a = makeStream(42);
  const b = makeStream(42);
  for (let i = 0; i < 10; i++) {
    assert.equal(pickFloat(a), pickFloat(b));
  }
});

test('different seeds yield different sequences', () => {
  const a = makeStream(42);
  const b = makeStream(43);
  let same = 0;
  for (let i = 0; i < 3; i++) {
    if (pickFloat(a) === pickFloat(b)) same++;
  }
  assert.ok(same < 3, 'expected at least one difference in first 3 samples');
});

test('pickFloat returns a number in [0, 1)', () => {
  const s = makeStream(0);
  for (let i = 0; i < 50; i++) {
    const v = pickFloat(s);
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('pickIndex returns a valid index for a non-empty array', () => {
  const s = makeStream(7);
  for (let i = 0; i < 20; i++) {
    const idx = pickIndex(s, 5);
    assert.ok(idx >= 0 && idx < 5, `out of range: ${idx}`);
  }
});

test('pickIndex on empty returns -1', () => {
  const s = makeStream(0);
  assert.equal(pickIndex(s, 0), -1);
});
