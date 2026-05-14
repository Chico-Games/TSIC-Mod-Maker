import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeWorkingSet } from '../src/persistence/overlay';
import type { DefaultProject } from '../src/persistence/defaultProject';

function makeDefault(records: Record<string, any>): DefaultProject {
  const rec = new Map<string, any>();
  const txt = new Map<string, string>();
  for (const [k, v] of Object.entries(records)) {
    rec.set(k, v);
    txt.set(k, JSON.stringify(v, null, 2) + '\n');
  }
  return {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' },
    records: rec,
    texts: txt,
  };
}

test('composeWorkingSet: pure default with empty overlay returns the default', () => {
  const def = makeDefault({ 'items/A': { id: 'A' }, 'items/B': { id: 'B' } });
  const out = composeWorkingSet(def, {
    overrides: new Map(), overrideTexts: new Map(), additions: new Map(), tombstones: new Set(),
  });
  assert.equal(out.definitions.size, 2);
  assert.deepEqual([...out.definitions.keys()].sort(), ['items/A', 'items/B']);
  const a = out.definitions.get('items/A')!;
  assert.equal(a.json.id, 'A');
  assert.equal(a.diskFolder, 'items');
  assert.equal(a.diskId, 'A');
  // originalText comes from the default's canonical text.
  assert.equal(a.originalText, '{\n  "id": "A"\n}\n');
});

test('composeWorkingSet: overrides replace default records', () => {
  const def = makeDefault({ 'items/A': { id: 'A', val: 1 } });
  const overrideText = '{\n  "id": "A",\n  "val": 99\n}\n';
  const out = composeWorkingSet(def, {
    overrides: new Map([['items/A', JSON.parse(overrideText)]]),
    overrideTexts: new Map([['items/A', overrideText]]),
    additions: new Map(),
    tombstones: new Set(),
  });
  const a = out.definitions.get('items/A')!;
  assert.equal(a.json.val, 99);
  assert.equal(a.originalText, overrideText);
});

test('composeWorkingSet: additions are included', () => {
  const def = makeDefault({});
  const text = '{\n  "id": "X"\n}\n';
  const out = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map([['items/X', JSON.parse(text)]]),
    tombstones: new Set(),
  });
  assert.equal(out.definitions.size, 1);
  assert.equal(out.definitions.get('items/X')!.json.id, 'X');
});

test('composeWorkingSet: tombstones remove default records', () => {
  const def = makeDefault({ 'items/A': { id: 'A' }, 'items/B': { id: 'B' } });
  const out = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map(),
    tombstones: new Set(['items/A']),
  });
  assert.equal(out.definitions.size, 1);
  assert.equal(out.definitions.get('items/A'), undefined);
});

test('composeWorkingSet: folders list contains every folder used', () => {
  const def = makeDefault({ 'items/A': { id: 'A' } });
  const text = '{}\n';
  const out = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map([['recipes/R', JSON.parse(text)]]),
    tombstones: new Set(),
  });
  assert.deepEqual([...out.folders].sort(), ['items', 'recipes']);
});
