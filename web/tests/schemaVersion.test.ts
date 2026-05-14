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
  const res = parseMeta({ schema_version: 1, name: 'P' });
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

test('parseMeta classifies non-numeric schema_version as no-version', () => {
  const r = parseMeta({ schema_version: '1', name: 'P' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no-version');
});

test('isSupported / isFuture reject non-integer floats', () => {
  assert.equal(isSupported(1.5), false);
  assert.equal(isFuture(1.5), false);
  assert.equal(isSupported(-1), false);
});

test('isFuture is true exactly for v > SUPPORTED_VERSION', () => {
  for (let v = -2; v <= SUPPORTED_VERSION + 3; v++) {
    assert.equal(isFuture(v), v > SUPPORTED_VERSION && Number.isInteger(v));
  }
});

test('parseMeta preserves optional fields verbatim', () => {
  const raw = {
    schema_version: 1,
    name: 'P',
    description: 'hello',
    created_at: '2026-01-01T00:00:00Z',
  };
  const r = parseMeta(raw);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.meta.description, 'hello');
    assert.equal(r.meta.created_at, '2026-01-01T00:00:00Z');
  }
});

test('parseMeta accepts the new overlay v2 shape including based_on_default_version', () => {
  const r = parseMeta({ schema_version: 2, name: 'P', based_on_default_version: 3 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.meta.schema_version, 2);
    assert.equal((r.meta as any).based_on_default_version, 3);
  }
});

test('parseMeta accepts legacy v1 (no based_on_default_version)', () => {
  const r = parseMeta({ schema_version: 1, name: 'P' });
  assert.equal(r.ok, true);
});

test('SUPPORTED_VERSION is 2 (after overlay bump)', () => {
  assert.equal(SUPPORTED_VERSION, 2);
});
