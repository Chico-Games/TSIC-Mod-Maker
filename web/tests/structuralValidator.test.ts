import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBatch, type StructuralIssue } from '../src/persistence/structuralValidator';

const good = JSON.stringify({ id: 'ID_Foo_CI', asset_path: '/Game/X', class: 'BP_X_C' });

test('clean batch yields no issues', () => {
  const issues = validateBatch([
    { folder: 'constructable_item_definitions', name: 'ID_Foo_CI.json', text: good },
  ]);
  assert.deepEqual(issues, []);
});

test('invalid-json kind on parse failure', () => {
  const issues = validateBatch([
    { folder: 'x', name: 'bad.json', text: '{ not json' },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'invalid-json');
});

test('missing-field kind for each required key', () => {
  const noId = JSON.stringify({ asset_path: '/Game/X', class: 'C' });
  const noClass = JSON.stringify({ id: 'X', asset_path: '/Game/X' });
  const issues = validateBatch([
    { folder: 'a', name: 'x.json', text: noId },
    { folder: 'a', name: 'z.json', text: noClass },
  ]);
  const missing = issues.filter((i): i is Extract<StructuralIssue, { kind: 'missing-field' }> =>
    i.kind === 'missing-field',
  );
  assert.equal(missing.length, 2);
  assert.deepEqual(
    missing.map((i) => i.field).sort(),
    ['class', 'id'],
  );
});

test('missing asset_path is allowed (data-only defs have no .uasset)', () => {
  const noPath = JSON.stringify({ id: 'HK_Accept', class: 'HotkeyDefinition' });
  const issues = validateBatch([
    { folder: 'hotkey_definitions', name: 'HK_Accept.json', text: noPath },
  ]);
  assert.deepEqual(issues, []);
});

test('id-mismatch kind when json.id != filename stem', () => {
  const mis = JSON.stringify({ id: 'ID_Other_CI', asset_path: '/Game/X', class: 'C' });
  const issues = validateBatch([
    { folder: 'a', name: 'ID_Foo_CI.json', text: mis },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'id-mismatch');
});

test('only flags problematic files', () => {
  const issues = validateBatch([
    { folder: 'a', name: 'x.json', text: 'garbage' },
    { folder: 'a', name: 'good.json', text: JSON.stringify({ id: 'good', asset_path: '/Game/X', class: 'C' }) },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].file, 'x.json');
});

test('empty array yields no issues', () => {
  assert.deepEqual(validateBatch([]), []);
});

test('top-level array is treated as invalid-json', () => {
  const issues = validateBatch([{ folder: 'a', name: 'x.json', text: '[]' }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'invalid-json');
});

test('top-level number is treated as invalid-json', () => {
  const issues = validateBatch([{ folder: 'a', name: 'x.json', text: '42' }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'invalid-json');
});

test('object with no fields yields two missing-field issues (id + class)', () => {
  const issues = validateBatch([
    { folder: 'a', name: 'empty.json', text: '{}' },
  ]);
  // No id-mismatch since json.id is absent; asset_path is optional.
  assert.equal(issues.length, 2);
  for (const i of issues) assert.equal(i.kind, 'missing-field');
});

test('empty-string id/class fail missing-field (asset_path optional)', () => {
  const issues = validateBatch([
    { folder: 'a', name: 'x.json', text: JSON.stringify({ id: '', asset_path: '', class: '' }) },
  ]);
  assert.equal(issues.length, 2);
  for (const i of issues) assert.equal(i.kind, 'missing-field');
});

test('case-insensitive .json suffix stripping for id-mismatch', () => {
  const issues = validateBatch([
    {
      folder: 'a',
      name: 'ID_Foo_CI.JSON',
      text: JSON.stringify({ id: 'ID_Foo_CI', asset_path: '/Game/X', class: 'C' }),
    },
  ]);
  assert.deepEqual(issues, []);
});

test('blockingKeys excludes id-mismatch (non-blocking)', async () => {
  const { blockingKeys } = await import('../src/persistence/structuralValidator');
  const issues = validateBatch([
    {
      folder: 'a',
      name: 'ID_Foo_CI.json',
      text: JSON.stringify({ id: 'ID_Other_CI', asset_path: '/Game/X', class: 'C' }),
    },
    { folder: 'a', name: 'bad.json', text: '{' },
  ]);
  const blockers = blockingKeys(issues);
  assert.equal(blockers.size, 1);
  assert.ok(blockers.has('a/bad.json'));
});
