import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDefaultProjectMeta } from '../src/persistence/defaultProject';

test('parseDefaultProjectMeta accepts a full meta', () => {
  const r = parseDefaultProjectMeta({
    schema_version: 1, version: 4, label: 'spring', published_at: '2026-05-14T00:00:00Z',
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.meta.version, 4);
});

test('parseDefaultProjectMeta accepts minimal meta with default label and zero published_at', () => {
  const r = parseDefaultProjectMeta({ schema_version: 1, version: 0 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.meta.label, '');
    assert.equal(r.meta.version, 0);
    assert.equal(typeof r.meta.published_at, 'string');
  }
});

test('parseDefaultProjectMeta rejects non-integer version', () => {
  const r = parseDefaultProjectMeta({ schema_version: 1, version: 1.5 });
  assert.equal(r.ok, false);
});

test('parseDefaultProjectMeta rejects non-object input', () => {
  assert.equal(parseDefaultProjectMeta(null).ok, false);
  assert.equal(parseDefaultProjectMeta('hi').ok, false);
});

test('parseDefaultProjectMeta rejects non-positive schema_version', () => {
  assert.equal(parseDefaultProjectMeta({ schema_version: 0, version: 1 }).ok, false);
  assert.equal(parseDefaultProjectMeta({ schema_version: -1, version: 1 }).ok, false);
});
