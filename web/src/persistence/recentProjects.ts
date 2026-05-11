import { openDb, RECENTS_STORE } from './db';

export interface RecentEntry {
  name: string;
  handleName: string;
  handle: FileSystemDirectoryHandle;
  lastOpened: number;
}

const CAP = 8;

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(RECENTS_STORE, mode);
      const store = tx.objectStore(RECENTS_STORE);
      Promise.resolve(fn(store)).then(resolve, reject);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function putRecord(record: object, key: string): Promise<void> {
  await withStore('readwrite', (s) =>
    new Promise<void>((res, rej) => {
      const req = s.put(record, key);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    }),
  );
}

export async function addRecent(entry: Omit<RecentEntry, 'lastOpened'>): Promise<void> {
  const full: RecentEntry = { ...entry, lastOpened: Date.now() };
  try {
    await putRecord(full, entry.handleName);
  } catch (e) {
    // Real-browser FileSystemDirectoryHandles survive structured clone, but
    // mocks / non-FSA objects can throw DataCloneError. Fall back to
    // storing only the serializable fields so the recent at least shows
    // up in the dropdown — openRecent will then route through the picker.
    if ((e as DOMException)?.name === 'DataCloneError') {
      try {
        await putRecord(
          { name: entry.name, handleName: entry.handleName, lastOpened: full.lastOpened },
          entry.handleName,
        );
      } catch (e2) {
        console.warn('[recents] addRecent fallback failed', e2);
        return;
      }
    } else {
      console.warn('[recents] addRecent failed', e);
      return;
    }
  }
  try {
    const all = await listRecents();
    if (all.length > CAP) {
      for (const r of all.slice(CAP)) await removeRecent(r.handleName);
    }
  } catch (e) {
    console.warn('[recents] cap enforcement failed', e);
  }
}

export async function listRecents(): Promise<RecentEntry[]> {
  return withStore('readonly', (s) =>
    new Promise<RecentEntry[]>((res, rej) => {
      const req = s.getAll();
      req.onsuccess = () => {
        const all = (req.result as RecentEntry[]) ?? [];
        all.sort((a, b) => b.lastOpened - a.lastOpened);
        res(all);
      };
      req.onerror = () => rej(req.error);
    }),
  );
}

export async function removeRecent(handleName: string): Promise<void> {
  await withStore('readwrite', (s) =>
    new Promise<void>((res, rej) => {
      const req = s.delete(handleName);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    }),
  );
}
