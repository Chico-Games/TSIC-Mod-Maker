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

export interface DefaultProject {
  meta: DefaultProjectMeta;
  /** Parsed JSON, keyed `${folder}/${id}`. */
  records: Map<string, any>;
  /** Canonical re-serialised text for diffing, keyed `${folder}/${id}`. */
  texts: Map<string, string>;
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

export async function loadDefaultProjectFromFsa(
  handle: FileSystemDirectoryHandle,
): Promise<DefaultProject> {
  // Manifest
  const manifestText = await (await (await handle.getFileHandle('manifest.json')).getFile()).text();
  const manifest: { folders: string[]; files: { folder: string; ids: string[] }[] } =
    JSON.parse(manifestText);

  // default.json (optional)
  let meta = FALLBACK_META;
  try {
    const fh = await handle.getFileHandle('default.json');
    const text = await (await fh.getFile()).text();
    const parsed = parseDefaultProjectMeta(JSON.parse(text));
    if (parsed.ok) meta = parsed.meta;
  } catch (e: any) {
    if (e?.name !== 'NotFoundError' && e?.message !== 'NotFoundError') throw e;
  }

  const records = new Map<string, any>();
  const texts = new Map<string, string>();
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
  return { meta, records, texts };
}
