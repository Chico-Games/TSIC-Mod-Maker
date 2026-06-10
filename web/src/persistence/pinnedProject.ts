// A single "pinned" project folder the user can reopen in one click.
//
// The FileSystemDirectoryHandle is stored in the same IndexedDB kv store used
// for other handles. Browsers don't expose the handle's absolute OS path and
// can't open a folder from a typed path, so we also keep a human-readable
// *path hint* (in localStorage) purely to remind the user where to navigate
// the first time they grant access.

import { deleteHandle, getHandle, putHandle } from '../handleStore';

const PINNED_KEY = 'pinned-project';
const PINNED_HINT_KEY = 'tsic.pinned-project.path-hint';

/** Default folder we suggest pinning: the game's DefaultProject definition pack.
 *  Shown as a navigation hint in the picker prompt / tooltip. */
export const DEFAULT_PINNED_PATH_HINT =
  'C:\\Users\\Administrator\\Documents\\Unreal Projects\\TSIC\\Content\\DefinitionPacks\\DefaultProject';

export async function getPinnedHandle(): Promise<FileSystemDirectoryHandle | null> {
  return getHandle<FileSystemDirectoryHandle>(PINNED_KEY);
}

export async function setPinnedHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await putHandle(PINNED_KEY, handle as any);
}

export async function clearPinnedHandle(): Promise<void> {
  await deleteHandle(PINNED_KEY);
}

/** The path hint shown to the user. Falls back to DEFAULT_PINNED_PATH_HINT. */
export function getPinnedPathHint(): string {
  try {
    return localStorage.getItem(PINNED_HINT_KEY) || DEFAULT_PINNED_PATH_HINT;
  } catch {
    return DEFAULT_PINNED_PATH_HINT;
  }
}

export function setPinnedPathHint(hint: string): void {
  try { localStorage.setItem(PINNED_HINT_KEY, hint); } catch { /* noop */ }
}
