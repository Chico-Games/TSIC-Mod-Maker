import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { projectKey, saveDraft, loadDraft, clearDraft, listKeys } from '../src/persistence/draftStore';
import type { DefinitionRecord } from '../src/store/definitionsStore';

const meta = { schema_version: 1, name: 'Proj' };
const rec: DefinitionRecord = {
  folder: 'f',
  id: 'ID_X_CI',
  json: { id: 'ID_X_CI' },
  originalText: '{}',
  diskId: 'ID_X_CI',
  diskFolder: 'f',
};

before(async () => {
  // Clean any leftover state from previous test runs.
  for (const k of await listKeys()) await clearDraft(k);
});

test('projectKey is stable and includes name + handleName', () => {
  assert.equal(projectKey(meta, 'mockHandle'), projectKey(meta, 'mockHandle'));
  assert.notEqual(projectKey(meta, 'a'), projectKey(meta, 'b'));
  assert.notEqual(
    projectKey({ ...meta, name: 'Other' }, 'mockHandle'),
    projectKey(meta, 'mockHandle'),
  );
});

test('save / load / clear roundtrip', async () => {
  const key = projectKey(meta, 'h-roundtrip');
  await saveDraft(key, [['f/ID_X_CI', rec]]);
  const r = await loadDraft(key);
  assert.ok(r !== null);
  assert.equal(r!.records.length, 1);
  assert.equal(r!.records[0][0], 'f/ID_X_CI');
  assert.equal((r!.records[0][1] as DefinitionRecord).id, 'ID_X_CI');
  assert.ok(typeof r!.savedAt === 'number');
  await clearDraft(key);
  assert.equal(await loadDraft(key), null);
});

test('listKeys reflects current drafts', async () => {
  await saveDraft('k1', []);
  await saveDraft('k2', []);
  const keys = await listKeys();
  assert.ok(keys.includes('k1'));
  assert.ok(keys.includes('k2'));
  await clearDraft('k1');
  await clearDraft('k2');
});

test('save with empty records is a valid roundtrip', async () => {
  const key = 'k-empty';
  await saveDraft(key, []);
  const r = await loadDraft(key);
  assert.ok(r !== null);
  assert.equal(r!.records.length, 0);
  await clearDraft(key);
});

test('different projects isolate their drafts', async () => {
  const keyA = projectKey({ schema_version: 1, name: 'ProjectA' }, 'handleA');
  const keyB = projectKey({ schema_version: 1, name: 'ProjectB' }, 'handleB');
  const recA: DefinitionRecord = { ...rec, id: 'A' };
  const recB: DefinitionRecord = { ...rec, id: 'B' };
  await saveDraft(keyA, [['f/A', recA]]);
  await saveDraft(keyB, [['f/B', recB]]);
  const draftA = await loadDraft(keyA);
  const draftB = await loadDraft(keyB);
  assert.ok(draftA && draftB);
  assert.equal((draftA!.records[0][1] as DefinitionRecord).id, 'A');
  assert.equal((draftB!.records[0][1] as DefinitionRecord).id, 'B');
  await clearDraft(keyA);
  await clearDraft(keyB);
});

test('saveDraft overwrites prior payload for same key', async () => {
  const key = 'k-overwrite';
  await saveDraft(key, [['f/X', { ...rec, id: 'X' }]]);
  await saveDraft(key, [['f/Y', { ...rec, id: 'Y' }]]);
  const r = await loadDraft(key);
  assert.equal(r!.records.length, 1);
  assert.equal((r!.records[0][1] as DefinitionRecord).id, 'Y');
  await clearDraft(key);
});

test('clearDraft is idempotent', async () => {
  await clearDraft('never-existed');
  await clearDraft('never-existed');
  assert.equal(await loadDraft('never-existed'), null);
});

test('savedAt is monotonically non-decreasing across re-saves', async () => {
  const key = 'k-monotonic';
  await saveDraft(key, []);
  const t1 = (await loadDraft(key))!.savedAt;
  await new Promise((r) => setTimeout(r, 5));
  await saveDraft(key, []);
  const t2 = (await loadDraft(key))!.savedAt;
  assert.ok(t2 >= t1);
  await clearDraft(key);
});
