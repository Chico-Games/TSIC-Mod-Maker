import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { addRecent, listRecents, removeRecent } from '../src/persistence/recentProjects';

const fakeHandle = (n: string) => ({ kind: 'directory', name: n }) as unknown as FileSystemDirectoryHandle;

beforeEach(async () => {
  for (const r of await listRecents()) await removeRecent(r.handleName);
});

test('listRecents starts empty after cleanup', async () => {
  assert.deepEqual(await listRecents(), []);
});

test('addRecent stores and lists with lastOpened', async () => {
  await addRecent({ name: 'P1', handleName: 'h1', handle: fakeHandle('h1') });
  const list = await listRecents();
  assert.equal(list.length, 1);
  assert.equal(list[0].handleName, 'h1');
  assert.equal(list[0].name, 'P1');
  assert.ok(typeof list[0].lastOpened === 'number');
});

test('addRecent dedupes by handleName and bumps lastOpened', async () => {
  await addRecent({ name: 'P', handleName: 'dup', handle: fakeHandle('dup') });
  const first = (await listRecents())[0].lastOpened;
  await new Promise((r) => setTimeout(r, 5));
  await addRecent({ name: 'P', handleName: 'dup', handle: fakeHandle('dup') });
  const list = await listRecents();
  assert.equal(list.length, 1);
  assert.ok(list[0].lastOpened > first, 'lastOpened should advance');
});

test('listRecents is sorted desc by lastOpened and capped at 8', async () => {
  for (let i = 0; i < 12; i++) {
    await addRecent({ name: `P${i}`, handleName: `h${i}`, handle: fakeHandle(`h${i}`) });
    await new Promise((r) => setTimeout(r, 2));
  }
  const list = await listRecents();
  assert.equal(list.length, 8);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].lastOpened >= list[i].lastOpened);
  }
  // Most recent insertion wins.
  assert.equal(list[0].handleName, 'h11');
});

test('removeRecent drops the entry', async () => {
  await addRecent({ name: 'P', handleName: 'rm', handle: fakeHandle('rm') });
  await removeRecent('rm');
  const list = await listRecents();
  assert.equal(list.find((r) => r.handleName === 'rm'), undefined);
});
