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
  const noPath = JSON.stringify({ id: 'X', class: 'C' });
  const noClass = JSON.stringify({ id: 'X', asset_path: '/Game/X' });
  const issues = validateBatch([
    { folder: 'a', name: 'x.json', text: noId },
    { folder: 'a', name: 'y.json', text: noPath },
    { folder: 'a', name: 'z.json', text: noClass },
  ]);
  const missing = issues.filter((i): i is Extract<StructuralIssue, { kind: 'missing-field' }> =>
    i.kind === 'missing-field',
  );
  assert.equal(missing.length, 3);
  assert.deepEqual(
    missing.map((i) => i.field).sort(),
    ['asset_path', 'class', 'id'],
  );
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
