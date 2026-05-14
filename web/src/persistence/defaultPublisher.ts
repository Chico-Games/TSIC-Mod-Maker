import type { DefaultProject, DefaultProjectMeta } from './defaultProject';
import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';

function canonicalTextOf(json: any): string {
  return JSON.stringify(json, null, 2) + '\n';
}

async function writeFile(
  root: FileSystemDirectoryHandle, folder: string, name: string, text: string,
) {
  const dir = folder
    ? await root.getDirectoryHandle(folder, { create: true } as any)
    : root;
  const fh = await dir.getFileHandle(name, { create: true } as any);
  const w = await (fh as any).createWritable();
  await w.write(text);
  await w.close();
}

async function deleteFileIfExists(root: FileSystemDirectoryHandle, folder: string, name: string) {
  try {
    const dir = await root.getDirectoryHandle(folder);
    await (dir as any).removeEntry(name);
  } catch { /* noop */ }
}

async function hasFile(root: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await root.getFileHandle(name); return true; } catch { return false; }
}

export async function publishAsNewDefaultVersion(
  target: FileSystemDirectoryHandle,
  working: Map<DefinitionsKey, DefinitionRecord>,
  current: DefaultProject,
  opts: { label?: string },
): Promise<DefaultProjectMeta> {
  if (!(await hasFile(target, 'manifest.json'))) {
    throw new Error('Target folder does not look like a default project (no manifest.json).');
  }

  // 1) Write every record in the working set as canonical text.
  const folderToIds = new Map<string, Set<string>>();
  for (const rec of working.values()) {
    const text = canonicalTextOf(rec.json);
    await writeFile(target, rec.folder, `${rec.id}.json`, text);
    if (!folderToIds.has(rec.folder)) folderToIds.set(rec.folder, new Set());
    folderToIds.get(rec.folder)!.add(rec.id);
  }

  // 2) Delete default-side files not in the working set.
  for (const k of current.records.keys()) {
    const slash = k.indexOf('/');
    const folder = k.slice(0, slash);
    const id = k.slice(slash + 1);
    if (!folderToIds.get(folder)?.has(id)) {
      await deleteFileIfExists(target, folder, `${id}.json`);
    }
  }

  // 3) Regenerate manifest.json.
  const folders = [...folderToIds.keys()].sort();
  const files = folders.map((f) => ({ folder: f, ids: [...folderToIds.get(f)!].sort() }));
  await writeFile(target, '', 'manifest.json',
    JSON.stringify({ folders, files, generatedAt: new Date().toISOString() }, null, 2) + '\n');

  // 4) Write default.json with bumped version.
  const nextMeta: DefaultProjectMeta = {
    schema_version: 1,
    version: current.meta.version + 1,
    label: opts.label ?? '',
    published_at: new Date().toISOString(),
  };
  await writeFile(target, '', 'default.json',
    JSON.stringify(nextMeta, null, 2) + '\n');
  return nextMeta;
}
