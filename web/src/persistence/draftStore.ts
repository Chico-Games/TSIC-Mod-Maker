import { openDb, DRAFTS_STORE } from './db';
import type { DefinitionRecord, DefinitionsKey, ProjectMeta } from '../store/definitionsStore';

export function projectKey(meta: ProjectMeta, handleName: string): string {
  return `${meta.name}|${handleName}`;
}

export interface DraftPayload {
  records: Array<[DefinitionsKey, DefinitionRecord]>;
  savedAt: number;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, mode);
      const store = tx.objectStore(DRAFTS_STORE);
      Promise.resolve(fn(store)).then(resolve, reject);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(
  key: string,
  records: Array<[DefinitionsKey, DefinitionRecord]>,
): Promise<void> {
  try {
    await withStore('readwrite', (s) =>
      new Promise<void>((res, rej) => {
        const payload: DraftPayload = { records, savedAt: Date.now() };
        const req = s.put(payload, key);
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
      }),
    );
  } catch (e) {
    if ((e as DOMException)?.name === 'QuotaExceededError') {
      console.warn('[drafts] quota exceeded — drafts cache full');
      return;
    }
    throw e;
  }
}

export async function loadDraft(key: string): Promise<DraftPayload | null> {
  return withStore('readonly', (s) =>
    new Promise<DraftPayload | null>((res, rej) => {
      const req = s.get(key);
      req.onsuccess = () => res((req.result as DraftPayload | undefined) ?? null);
      req.onerror = () => rej(req.error);
    }),
  );
}

export async function clearDraft(key: string): Promise<void> {
  await withStore('readwrite', (s) =>
    new Promise<void>((res, rej) => {
      const req = s.delete(key);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    }),
  );
}

export async function listKeys(): Promise<string[]> {
  return withStore('readonly', (s) =>
    new Promise<string[]>((res, rej) => {
      const req = s.getAllKeys();
      req.onsuccess = () => res((req.result as IDBValidKey[]).map(String));
      req.onerror = () => rej(req.error);
    }),
  );
}
