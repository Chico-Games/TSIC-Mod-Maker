import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDb, DRAFTS_STORE, RECENTS_STORE, KV_STORE } from '../src/persistence/db';

test('shared db opens with all three object stores', async () => {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  assert.ok(names.includes(KV_STORE), `missing ${KV_STORE}`);
  assert.ok(names.includes(DRAFTS_STORE), `missing ${DRAFTS_STORE}`);
  assert.ok(names.includes(RECENTS_STORE), `missing ${RECENTS_STORE}`);
  db.close();
});
