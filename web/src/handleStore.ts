// Tiny IndexedDB-backed key-value store for FileSystemDirectoryHandle persistence.
// Handles can be cloned into IndexedDB; on the next visit we re-acquire
// permission via queryPermission/requestPermission.

import { openDb, KV_STORE } from './persistence/db';
const STORE = KV_STORE;

export async function putHandle(key: string, handle: any): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getHandle<T = any>(key: string): Promise<T | null> {
  const db = await openDb();
  const result = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result ?? null) as T | null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function deleteHandle(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  const opts = { mode };
  const anyH = handle as any;
  if (typeof anyH.queryPermission !== 'function') return true;
  const status = await anyH.queryPermission(opts);
  if (status === 'granted') return true;
  const req = await anyH.requestPermission(opts);
  return req === 'granted';
}
