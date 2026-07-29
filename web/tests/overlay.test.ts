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

import { computeOverlay } from '../src/persistence/overlay';

test('computeOverlay: unchanged-from-default keys produce no overrides/additions', () => {
  const def = makeDefault({ 'items/A': { id: 'A' }, 'items/B': { id: 'B' } });
  const compose = composeWorkingSet(def, {
    overrides: new Map(), overrideTexts: new Map(), additions: new Map(), tombstones: new Set(),
  });
  const diff = computeOverlay(def, compose.definitions);
  assert.equal(diff.overrides.size, 0);
  assert.equal(diff.additions.size, 0);
  assert.equal(diff.tombstones.size, 0);
});

test('computeOverlay: edited default key is an override', () => {
  const def = makeDefault({ 'items/A': { id: 'A', v: 1 } });
  const compose = composeWorkingSet(def, {
    overrides: new Map(), overrideTexts: new Map(), additions: new Map(), tombstones: new Set(),
  });
  const rec = compose.definitions.get('items/A')!;
  rec.json = { id: 'A', v: 999 };
  const diff = computeOverlay(def, compose.definitions);
  assert.equal(diff.overrides.size, 1);
  assert.equal(diff.overrides.get('items/A').v, 999);
  assert.equal(diff.additions.size, 0);
});

test('computeOverlay: missing default key is a tombstone', () => {
  const def = makeDefault({ 'items/A': { id: 'A' } });
  const diff = computeOverlay(def, new Map()); // empty working set
  assert.equal(diff.tombstones.size, 1);
  assert.ok(diff.tombstones.has('items/A'));
});

test('computeOverlay: not-in-default key is an addition', () => {
  const def = makeDefault({});
  const compose = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map([['items/X', { id: 'X' }]]),
    tombstones: new Set(),
  });
  const diff = computeOverlay(def, compose.definitions);
  assert.equal(diff.additions.size, 1);
  assert.equal(diff.additions.get('items/X').id, 'X');
});

// ── Bug 3 regression: lean⇆envelope representation mismatch ─────────────────
// On disk (default) records are LEAN; the working set holds ENVELOPE JSON. The
// two canonical texts never match, so before the fix computeOverlay flagged
// EVERY record as an override and Save-As wrote the whole tree. The fix: pass a
// `key → lean text` map so the comparison is lean-vs-lean.
//
// Model it with a lean text that differs from the working record's own
// canonical (envelope) text, exactly like the real pack.
test('computeOverlay: envelope working set with NO edits produces zero overrides (Bug 3)', () => {
  const leanText = '{\n  "id": "A",\n  "properties": {\n    "v": 1\n  }\n}\n';
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-07-07T00:00:00Z' },
    records: new Map([['items/A', { id: 'A', properties: { v: 1 } }]]),
    texts: new Map([['items/A', leanText]]),
  };
  // Working record in ENVELOPE form — its canonical text differs from lean.
  const envelopeJson = { id: 'A', properties: { v: { type: 'int', value: 1 } } };
  const working = new Map([['items/A', {
    folder: 'items', id: 'A', json: envelopeJson,
    originalText: JSON.stringify(envelopeJson, null, 2) + '\n', diskFolder: 'items', diskId: 'A',
  }]]) as any;

  // Sanity: without the lean map the old comparison wrongly flags an override.
  assert.equal(computeOverlay(def, working).overrides.size, 1);

  // With the lean map (what the writer would emit), zero overrides / additions.
  const workingLean = new Map([['items/A', leanText]]);
  const diff = computeOverlay(def, working, workingLean);
  assert.equal(diff.overrides.size, 0, 'unchanged record must not be an override');
  assert.equal(diff.additions.size, 0);
  assert.equal(diff.tombstones.size, 0);
});

test('computeOverlay: exactly one edited envelope record is an override (Bug 3)', () => {
  const leanA = '{\n  "id": "A",\n  "properties": {\n    "v": 1\n  }\n}\n';
  const leanB = '{\n  "id": "B",\n  "properties": {\n    "v": 2\n  }\n}\n';
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-07-07T00:00:00Z' },
    records: new Map<string, any>([
      ['items/A', { id: 'A', properties: { v: 1 } }],
      ['items/B', { id: 'B', properties: { v: 2 } }],
    ]),
    texts: new Map([['items/A', leanA], ['items/B', leanB]]),
  };
  const mkRec = (id: string, json: any) => ({
    folder: 'items', id, json,
    originalText: JSON.stringify(json, null, 2) + '\n', diskFolder: 'items', diskId: id,
  });
  const working = new Map<string, any>([
    ['items/A', mkRec('A', { id: 'A', properties: { v: { type: 'int', value: 1 } } })],
    ['items/B', mkRec('B', { id: 'B', properties: { v: { type: 'int', value: 2 } } })],
  ]);
  // B edited (v: 2 → 99); A unchanged. Lean texts reflect the writer's output.
  const workingLean = new Map([
    ['items/A', leanA],
    ['items/B', '{\n  "id": "B",\n  "properties": {\n    "v": 99\n  }\n}\n'],
  ]);
  const diff = computeOverlay(def, working, workingLean);
  assert.equal(diff.overrides.size, 1);
  assert.ok(diff.overrides.has('items/B'), 'only the edited record is an override');
  assert.equal(diff.additions.size, 0);
});
