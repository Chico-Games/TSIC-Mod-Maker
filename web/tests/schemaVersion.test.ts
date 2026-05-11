import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSupported, isFuture, parseMeta, SUPPORTED_VERSION } from '../src/persistence/schemaVersion';

test('SUPPORTED_VERSION is a positive integer', () => {
  assert.ok(Number.isInteger(SUPPORTED_VERSION) && SUPPORTED_VERSION >= 1);
});

test('isSupported / isFuture partition the space', () => {
  assert.equal(isSupported(1), true);
  assert.equal(isFuture(1), false);
  assert.equal(isSupported(SUPPORTED_VERSION + 1), false);
  assert.equal(isFuture(SUPPORTED_VERSION + 1), true);
  assert.equal(isSupported(0), false);
  assert.equal(isSupported(Number.NaN), false);
  assert.equal(isFuture(Number.NaN), false);
});

test('parseMeta accepts a valid project.json shape', () => {
  const res = parseMeta({ schema_version: 1, name: 'P', ue_sync_path: 'X' });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.meta.name, 'P');
});

test('parseMeta rejects missing version', () => {
  const res = parseMeta({ name: 'P' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'no-version');
});

test('parseMeta rejects missing name', () => {
  const res = parseMeta({ schema_version: 1 });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'malformed');
});

test('parseMeta rejects non-object', () => {
  assert.equal(parseMeta(null).ok, false);
  assert.equal(parseMeta(42).ok, false);
  assert.equal(parseMeta('hi').ok, false);
  assert.equal(parseMeta([]).ok, false);
});
