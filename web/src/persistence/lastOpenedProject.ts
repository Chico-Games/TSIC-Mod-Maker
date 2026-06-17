// Remembers which project was opened most recently so bootstrap can reopen it
// by default (the user's "open the last project I had open" preference).
//
// Folder (FSA) projects are actually reopened from the FileSystemDirectoryHandle
// persisted under HANDLE_KEY in IndexedDB; this marker only needs to capture
// *which kind* was last open so bootstrap can decide between restoring that
// handle, reloading the Default/Starter project, or — on a genuine first launch
// only — honouring the pinned project. It lives in localStorage because it's a
// tiny synchronous hint read during boot, not the handle itself.

const KEY = 'tsic.last-opened.v1';

export type LastOpened =
  | { kind: 'starter' }
  | { kind: 'fsa'; name: string };

export function getLastOpened(): LastOpened | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { kind?: unknown; name?: unknown };
    if (j?.kind === 'starter') return { kind: 'starter' };
    if (j?.kind === 'fsa' && typeof j.name === 'string') return { kind: 'fsa', name: j.name };
    return null;
  } catch {
    return null;
  }
}

export function setLastOpenedStarter(): void {
  try { localStorage.setItem(KEY, JSON.stringify({ kind: 'starter' })); } catch { /* noop */ }
}

export function setLastOpenedFsa(name: string): void {
  try { localStorage.setItem(KEY, JSON.stringify({ kind: 'fsa', name })); } catch { /* noop */ }
}

export function clearLastOpened(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
