// Persistent "projects root" — a single user-chosen folder under which each
// project lives in its own subfolder. Stored as an FSA directory handle in the
// existing 'kv' IndexedDB store under PROJECTS_ROOT_KEY.

import { deleteHandle, ensurePermission, getHandle, putHandle } from '../handleStore';
import type { ProjectMeta } from '../store/definitionsStore';

export const PROJECTS_ROOT_KEY = 'projects-root';

export interface ProjectListing {
  /** Subdirectory name on disk — used as the handle name. */
  folderName: string;
  /** Display name: project.json `name` if present, else folderName. */
  name: string;
  /** True when the subfolder contained a readable project.json. */
  hasMeta: boolean;
}

export async function getProjectsRoot(): Promise<FileSystemDirectoryHandle | null> {
  return getHandle<FileSystemDirectoryHandle>(PROJECTS_ROOT_KEY);
}

export async function setProjectsRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  await putHandle(PROJECTS_ROOT_KEY, handle);
}

export async function clearProjectsRoot(): Promise<void> {
  await deleteHandle(PROJECTS_ROOT_KEY);
}

/** Enumerate immediate subdirectories of `root`. Each subdir that contains a
 *  project.json is included with its parsed `name`; subdirs without one are
 *  still listed (hasMeta:false) so legacy folders show up. Sorted by name. */
export async function listProjectsInRoot(
  root: FileSystemDirectoryHandle,
): Promise<ProjectListing[]> {
  const out: ProjectListing[] = [];
  const anyRoot = root as any;
  if (typeof anyRoot.values !== 'function') return out;
  for await (const entry of anyRoot.values() as AsyncIterable<FileSystemHandle>) {
    if (entry.kind !== 'directory') continue;
    const dir = entry as FileSystemDirectoryHandle;
    let meta: ProjectMeta | null = null;
    try {
      const fh = await dir.getFileHandle('project.json');
      const f = await fh.getFile();
      meta = JSON.parse(await f.text()) as ProjectMeta;
    } catch { /* no project.json — still list */ }
    out.push({
      folderName: dir.name,
      name: meta?.name ?? dir.name,
      hasMeta: meta != null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Resolve (or create) a child subdirectory under the projects root by name.
 *  Caller is responsible for permission. Returns the child handle. */
export async function getOrCreateProjectFolder(
  root: FileSystemDirectoryHandle,
  folderName: string,
): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle(folderName, { create: true });
}

/** True when a subdirectory with that name already exists under the root. */
export async function projectFolderExists(
  root: FileSystemDirectoryHandle,
  folderName: string,
): Promise<boolean> {
  try {
    await root.getDirectoryHandle(folderName);
    return true;
  } catch {
    return false;
  }
}

/** Verify the root handle still has readwrite permission. */
export async function ensureProjectsRootPermission(
  root: FileSystemDirectoryHandle,
): Promise<boolean> {
  return ensurePermission(root, 'readwrite');
}
