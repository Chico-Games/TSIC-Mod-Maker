export interface DefaultProjectMeta {
  schema_version: number;
  version: number;
  label: string;
  published_at: string;
}

export type ParseMetaResult =
  | { ok: true; meta: DefaultProjectMeta }
  | { ok: false; reason: 'malformed' | 'bad-version' };

export function parseDefaultProjectMeta(raw: unknown): ParseMetaResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed' };
  const r = raw as Record<string, unknown>;
  const sv = r.schema_version;
  const v = r.version;
  if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 1) return { ok: false, reason: 'bad-version' };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { ok: false, reason: 'bad-version' };
  const label = typeof r.label === 'string' ? r.label : '';
  const published_at = typeof r.published_at === 'string' ? r.published_at : new Date(0).toISOString();
  return { ok: true, meta: { schema_version: sv, version: v, label, published_at } };
}

/** A default-project's mod identity, read from `mod.json`. This is the mod's
 *  RELEASE identity (semver `version`), distinct from the editor's integer
 *  publish counter in `DefaultProjectMeta.version` — never conflate the two. */
export interface ModIdentity {
  id: string;
  displayName: string;
  version: string;
}

export interface DefaultProject {
  meta: DefaultProjectMeta;
  /** Parsed JSON, keyed `${folder}/${id}`. */
  records: Map<string, any>;
  /** Canonical re-serialised text for diffing, keyed `${folder}/${id}`. */
  texts: Map<string, string>;
  /** Present when the source is a default-project (had `mod.json`). Identity
   *  only — the publish counter stays in `meta.version`. */
  modIdentity?: ModIdentity;
}

/** Validate a parsed `mod.json`. Returns null when it isn't a usable identity. */
export function parseModIdentity(raw: unknown): ModIdentity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    displayName: typeof r.displayName === 'string' ? r.displayName : r.id,
    version: typeof r.version === 'string' ? r.version : String(r.version ?? ''),
  };
}

const FALLBACK_META: DefaultProjectMeta = {
  schema_version: 1,
  version: 0,
  label: '',
  published_at: new Date(0).toISOString(),
};

function canonical(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2) + '\n';
  } catch {
    return text;
  }
}

export async function loadDefaultProjectFromHttp(
  baseUrl: string,
  fetcher: typeof fetch = fetch.bind(globalThis),
): Promise<DefaultProject> {
  const stripped = baseUrl.replace(/\/$/, '');
  const manifestResp = await fetcher(`${stripped}/manifest.json`);
  if (!manifestResp.ok) throw new Error(`default manifest ${manifestResp.status}`);
  const manifest: { folders: string[]; files: { folder: string; ids: string[] }[] } =
    JSON.parse(await manifestResp.text());

  let meta = FALLBACK_META;
  try {
    const r = await fetcher(`${stripped}/default.json`);
    if (r.ok) {
      const parsed = parseDefaultProjectMeta(JSON.parse(await r.text()));
      if (parsed.ok) meta = parsed.meta;
    }
  } catch { /* fall through to FALLBACK_META */ }

  const records = new Map<string, any>();
  const texts = new Map<string, string>();
  // Flatten to a flat work list, then chew through it with a fixed-size worker
  // pool. The starter-project ships thousands of files; firing them all at
  // once gives Chrome ERR_INSUFFICIENT_RESOURCES.
  const work: { folder: string; id: string }[] = [];
  for (const f of manifest.files) {
    for (const id of f.ids) work.push({ folder: f.folder, id });
  }
  const concurrency = 32;
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const i = next++;
      if (i >= work.length) return;
      const { folder, id } = work[i];
      let raw: string;
      try {
        const fr = await fetcher(`${stripped}/${folder}/${id}.json`);
        if (!fr.ok) continue;
        raw = await fr.text();
      } catch { continue; }
      const text = canonical(raw);
      try {
        records.set(`${folder}/${id}`, JSON.parse(text));
        texts.set(`${folder}/${id}`, text);
      } catch { /* skip malformed */ }
    }
  });
  await Promise.all(workers);
  return { meta, records, texts };
}

export type DefaultProjectSource =
  | { kind: 'http'; baseUrl: string }
  | { kind: 'fsa'; handle: FileSystemDirectoryHandle };

/** True if `name` exists as a file directly under `handle`. */
async function fileExists(handle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await handle.getFileHandle(name); return true; }
  catch { return false; }
}

/** Read + parse one root-level JSON file; null if absent/unreadable/malformed.
 *  Used for the optional root meta files (`default.json`, `mod.json`). */
async function readRootJson(handle: FileSystemDirectoryHandle, name: string): Promise<any | null> {
  try {
    const fh = await handle.getFileHandle(name);
    return JSON.parse(await (await fh.getFile()).text());
  } catch { return null; }
}

/** Enumerate definitions in a default-project by DIRECTORY SCAN — NOT the
 *  `.manifest.json`, which is an asset index that omits data-only def folders
 *  (hotkey_/input_behavior_/situation_definitions). Keeps any `*.json` with a
 *  top-level string `id`; skips dotted dirs (`.assets`), `_schema.json`, and
 *  dotted/sidecar files. Keyed `${folder}/${filenameStem}`. */
async function scanDefinitionsFsa(
  root: FileSystemDirectoryHandle,
  records: Map<string, any>,
  texts: Map<string, string>,
): Promise<void> {
  for await (const [folderName, entry] of (root as any).entries()) {
    if ((entry as any).kind !== 'directory' || folderName.startsWith('.')) continue;
    let dir: FileSystemDirectoryHandle;
    try { dir = await root.getDirectoryHandle(folderName); }
    catch { continue; }
    for await (const [fileName, fEntry] of (dir as any).entries()) {
      if ((fEntry as any).kind !== 'file') continue;
      if (!fileName.endsWith('.json') || fileName === '_schema.json' || fileName.startsWith('.')) continue;
      let raw: string;
      try { raw = await (await (await dir.getFileHandle(fileName)).getFile()).text(); }
      catch { continue; }
      const text = canonical(raw);
      let json: any;
      try { json = JSON.parse(text); } catch { continue; }
      if (typeof json?.id !== 'string') continue; // shape filter: skip sidecars/catalogs
      const id = fileName.slice(0, -'.json'.length);
      records.set(`${folderName}/${id}`, json);
      texts.set(`${folderName}/${id}`, text);
    }
  }
}

export async function loadDefaultProjectFromFsa(
  handle: FileSystemDirectoryHandle,
): Promise<DefaultProject> {
  // Convention: a default-project ships `.manifest.json` / `mod.json`; the
  // editor's own starter-project ships an (undotted) `manifest.json`. We must
  // NOT use the dotted manifest to enumerate (it's an asset index that drops
  // data-only categories) — directory-scan default-projects instead.
  const isDefaultProject =
    (await fileExists(handle, '.manifest.json')) || (await fileExists(handle, 'mod.json'));

  // default.json (optional) — the editor's integer publish counter.
  let meta = FALLBACK_META;
  const metaRaw = await readRootJson(handle, 'default.json');
  if (metaRaw) {
    const parsed = parseDefaultProjectMeta(metaRaw);
    if (parsed.ok) meta = parsed.meta;
  }

  // mod.json (optional) — release identity, NOT the publish counter.
  const modIdentity = parseModIdentity(await readRootJson(handle, 'mod.json')) ?? undefined;

  const records = new Map<string, any>();
  const texts = new Map<string, string>();

  if (isDefaultProject) {
    await scanDefinitionsFsa(handle, records, texts);
  } else {
    // Editor convention: enumerate from the complete `manifest.json`.
    const manifestText = await (await (await handle.getFileHandle('manifest.json')).getFile()).text();
    const manifest: { folders: string[]; files: { folder: string; ids: string[] }[] } =
      JSON.parse(manifestText);
    for (const f of manifest.files) {
      let dir: FileSystemDirectoryHandle;
      try { dir = await handle.getDirectoryHandle(f.folder); }
      catch { continue; }
      for (const id of f.ids) {
        try {
          const fh = await dir.getFileHandle(`${id}.json`);
          const raw = await (await fh.getFile()).text();
          const text = canonical(raw);
          records.set(`${f.folder}/${id}`, JSON.parse(text));
          texts.set(`${f.folder}/${id}`, text);
        } catch { /* skip missing/malformed */ }
      }
    }
  }

  return { meta, records, texts, modIdentity };
}
