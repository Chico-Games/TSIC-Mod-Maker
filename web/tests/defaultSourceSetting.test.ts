import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  setDefaultSourceHandle, getDefaultSourceHandle, clearDefaultSourceHandle,
} from '../src/persistence/defaultSourceSetting';

test('default source handle round-trips through IndexedDB', async () => {
  const fakeHandle = { name: 'starter-project', kind: 'directory' } as any;
  await setDefaultSourceHandle(fakeHandle);
  const got = await getDefaultSourceHandle();
  assert.equal(got?.name, 'starter-project');
});

test('clearDefaultSourceHandle removes the stored handle', async () => {
  await clearDefaultSourceHandle();
  assert.equal(await getDefaultSourceHandle(), null);
});
