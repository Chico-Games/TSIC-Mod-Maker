import type { DefaultProject, DefaultProjectMeta } from './defaultProject';
import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';
import { FsaDataSource } from './dataSource';

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
  // A default-project ships `.manifest.json`/`mod.json`; the editor's own
  // starter-project ships an undotted `manifest.json`. Accept either.
  const isDefaultProject =
    (await hasFile(target, '.manifest.json')) || (await hasFile(target, 'mod.json'));
  const isEditorProject = await hasFile(target, 'manifest.json');
  if (!isDefaultProject && !isEditorProject) {
    throw new Error('Target folder does not look like a default project (no manifest.json / .manifest.json / mod.json).');
  }

  // 1) Write every record in the working set. The editor's working set holds
  //    typed envelopes; route writes through FsaDataSource.writeFile so they're
  //    translated back to lean via the target pack's _schema.json and disk stays
  //    byte-identical to what the game reads. (No schema → passes through.)
  //    Track each record's non-empty asset_path for the asset-index manifest.
  const tds = new FsaDataSource(target);
  const folderToIds = new Map<string, Set<string>>();
  const assetPathOf = new Map<string, string>(); // `${folder}/${id}` -> asset_path
  for (const rec of working.values()) {
    await tds.writeFile(rec.folder, rec.id, canonicalTextOf(rec.json));
    if (!folderToIds.has(rec.folder)) folderToIds.set(rec.folder, new Set());
    folderToIds.get(rec.folder)!.add(rec.id);
    const ap = (rec.json as any)?.asset_path;
    if (typeof ap === 'string' && ap) assetPathOf.set(`${rec.folder}/${rec.id}`, ap);
  }

  // 2) Delete default-side files not in the working set. Scoped to `folder/id`
  //    record keys — root sidecars (mod.json, .class-hierarchy.json, …) are
  //    never in `current.records`, so they're preserved untouched.
  for (const k of current.records.keys()) {
    const slash = k.indexOf('/');
    const folder = k.slice(0, slash);
    const id = k.slice(slash + 1);
    if (!folderToIds.get(folder)?.has(id)) {
      await deleteFileIfExists(target, folder, `${id}.json`);
    }
  }

  // 3) Regenerate the manifest in the target's convention.
  const folders = [...folderToIds.keys()].sort();
  if (isDefaultProject) {
    // Asset INDEX: only records with a non-empty asset_path. Data-only defs
    // (hotkey_/input_behavior_/situation_…) are intentionally excluded, matching
    // the real export. mod.json + dotted sidecars are left untouched (passthrough).
    const assets: Record<string, Record<string, string>> = {};
    for (const folder of folders) {
      for (const id of [...folderToIds.get(folder)!].sort()) {
        const ap = assetPathOf.get(`${folder}/${id}`);
        if (!ap) continue;
        (assets[folder] ??= {})[id] = ap;
      }
    }
    await writeFile(target, '', '.manifest.json',
      JSON.stringify({ schema_version: 2, generated_at: new Date().toISOString(), assets }, null, 2) + '\n');
  } else {
    // Editor convention: complete folder/files enumeration.
    const files = folders.map((f) => ({ folder: f, ids: [...folderToIds.get(f)!].sort() }));
    await writeFile(target, '', 'manifest.json',
      JSON.stringify({ folders, files, generatedAt: new Date().toISOString() }, null, 2) + '\n');
  }

  // 4) Publish counter. Persisted in `default.json` for the editor's own
  //    starter-project; omitted for default-project targets (their release
  //    version is mod.json's semver, managed separately — don't pollute the
  //    folder with editor-internal metadata).
  const nextMeta: DefaultProjectMeta = {
    schema_version: 1,
    version: current.meta.version + 1,
    label: opts.label ?? '',
    published_at: new Date().toISOString(),
  };
  if (!isDefaultProject) {
    await writeFile(target, '', 'default.json', JSON.stringify(nextMeta, null, 2) + '\n');
  }
  return nextMeta;
}
