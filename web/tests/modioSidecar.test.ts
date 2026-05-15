import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySidecar, migrate } from '../src/modio/sidecar';

test('emptySidecar: defaults are sane', () => {
  const s = emptySidecar();
  assert.equal(s.schema_version, 1);
  assert.equal(s.env, 'live');
  assert.equal(s.mod_id, null);
  assert.equal(s.draft.name, '');
  assert.equal(s.draft.next_version, '0.1.0');
  assert.equal(s.last_pushed, null);
});

test('migrate: tolerates missing fields', () => {
  const s = migrate({ env: 'test', mod_id: 42, draft: { name: 'X' } });
  assert.ok(s !== null);
  assert.equal(s!.env, 'test');
  assert.equal(s!.mod_id, 42);
  assert.equal(s!.draft.name, 'X');
  // Defaults filled in:
  assert.equal(s!.draft.summary, '');
  assert.equal(s!.draft.next_version, '0.1.0');
  assert.deepEqual(s!.draft.tags, []);
});

test('migrate: keeps last_pushed when valid', () => {
  const s = migrate({
    mod_id: 1,
    last_pushed: { modfile_id: 9, md5: 'aaaa', size: 100, version: '0.1.0', date: 1715683200 },
  });
  assert.ok(s !== null);
  assert.deepEqual(s!.last_pushed, { modfile_id: 9, md5: 'aaaa', size: 100, version: '0.1.0', date: 1715683200 });
});

test('migrate: drops malformed last_pushed', () => {
  const s = migrate({ mod_id: 1, last_pushed: { modfile_id: 'wat' } });
  assert.ok(s !== null);
  assert.equal(s!.last_pushed, null);
});

test('migrate: returns null for non-object input', () => {
  assert.equal(migrate(null), null);
  assert.equal(migrate(undefined), null);
  assert.equal(migrate('string'), null);
});
