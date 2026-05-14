import type { DefinitionRecord } from '../store/definitionsStore';
import type { DefaultProject } from '../persistence/defaultProject';
import { makeZip, type ZipEntry } from './zip';
import { md5, md5OfBlob } from './md5';

/** Stable serialiser matching `definitionsStore.serializeDefinition`. */
export function serializeRecord(rec: DefinitionRecord): string {
  return JSON.stringify(rec.json, null, 2) + '\n';
}

/** Bare-id-keyed map of canonical text from the Default Project, used as the
 *  "base" to diff a working set against. Keyed as `${folder}/${id}`. */
export type StarterCatalog = Map<string, string>;

export interface PackedFileEntry {
  folder: string;
  id: string;
  md5: string;
  size: number;
}

export interface PackedMod {
  blob: Blob;
  md5: string;
  size: number;
  files: PackedFileEntry[];
  /** New files (not present in starter at all). */
  added: PackedFileEntry[];
  /** Files present in starter but with different content. */
  modified: PackedFileEntry[];
  /** Files present in starter, untouched locally — not in the ZIP, but
   *  reported for diff UI. */
  unchangedCount: number;
  manifestJson: string;
}

export interface PackOptions {
  /** Source-of-base label written into the generated mod.json. */
  baseSource: string;
  /** Editor version label written into mod.json. */
  editorVersion: string;
}

/** Build a delta ZIP: only records that differ from the starter catalog are
 *  included. The archive root holds a generated `mod.json` describing the
 *  contents; every JSON sits at `<folder>/<id>.json` exactly as it appears
 *  in the project tree. */
export async function buildDeltaZip(
  records: Iterable<DefinitionRecord>,
  starter: StarterCatalog,
  opts: PackOptions,
): Promise<PackedMod> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const fileEntries: PackedFileEntry[] = [];
  const added: PackedFileEntry[] = [];
  const modified: PackedFileEntry[] = [];
  let unchangedCount = 0;

  // Sort by folder/id so packing is deterministic — important for the
  // outer md5 to be stable across runs with no semantic changes.
  const sorted: DefinitionRecord[] = [];
  for (const r of records) sorted.push(r);
  sorted.sort((a, b) => a.folder.localeCompare(b.folder) || a.id.localeCompare(b.id));

  for (const rec of sorted) {
    const text = serializeRecord(rec);
    const key = `${rec.folder}/${rec.id}`;
    const baseText = starter.get(key);
    if (baseText != null && baseText === text) {
      unchangedCount++;
      continue;
    }
    const data = enc.encode(text);
    const hash = md5(data);
    const fe: PackedFileEntry = { folder: rec.folder, id: rec.id, md5: hash, size: data.length };
    fileEntries.push(fe);
    if (baseText == null) added.push(fe);
    else modified.push(fe);
    entries.push({ path: `${rec.folder}/${rec.id}.json`, data });
  }

  const manifest = {
    schema_version: 1,
    generated_by: 'tsic-definition-editor',
    generated_at: new Date().toISOString(),
    editor_version: opts.editorVersion,
    base: { source: opts.baseSource },
    files: fileEntries.map((f) => ({ folder: f.folder, id: f.id, md5: f.md5 })),
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  entries.unshift({ path: 'mod.json', data: enc.encode(manifestJson) });

  const blob = makeZip(entries);
  const outerMd5 = await md5OfBlob(blob);
  return {
    blob,
    md5: outerMd5,
    size: blob.size,
    files: fileEntries,
    added,
    modified,
    unchangedCount,
    manifestJson,
  };
}

/** Convert an already-loaded DefaultProject into the catalog format the packer
 *  expects. No I/O. Prefer this over `loadStarterCatalog` when the default is
 *  already in memory (it almost always is). */
export function defaultCatalogFromLoaded(d: DefaultProject): StarterCatalog {
  return new Map(d.texts);
}

/** @deprecated Use defaultCatalogFromLoaded with an in-memory DefaultProject instead. */
export async function loadStarterCatalog(
  baseUrl: string,
  fetcher: typeof fetch = fetch.bind(globalThis),
): Promise<StarterCatalog> {
  const { loadDefaultProjectFromHttp } = await import('../persistence/defaultProject');
  const d = await loadDefaultProjectFromHttp(baseUrl, fetcher);
  return defaultCatalogFromLoaded(d);
}

