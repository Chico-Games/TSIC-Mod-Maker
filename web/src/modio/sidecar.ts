import type { DataSource } from '../persistence/dataSource';
import type { ModioEnv, ModioSidecar, ModioSidecarDraft } from './types';

export const SIDECAR_NAME = '.modio.json';

export function emptySidecar(env: ModioEnv = 'live'): ModioSidecar {
  return {
    schema_version: 1,
    env,
    mod_id: null,
    name_id: null,
    draft: emptyDraft(),
    last_pushed: null,
  };
}

function emptyDraft(): ModioSidecarDraft {
  return {
    name: '',
    summary: '',
    description_md: null,
    tags: [],
    logo_path: null,
    visible: 0,
    next_version: '0.1.0',
  };
}

/** Tolerant migrator: accepts an unknown JSON and returns a normalised
 *  sidecar, filling in any missing fields. Returns null on parse failure. */
export function migrate(raw: unknown): ModioSidecar | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const env: ModioEnv = r.env === 'test' ? 'test' : 'live';
  const out: ModioSidecar = emptySidecar(env);
  if (typeof r.mod_id === 'number') out.mod_id = r.mod_id;
  if (typeof r.name_id === 'string') out.name_id = r.name_id;
  const d = r.draft && typeof r.draft === 'object' ? r.draft as Record<string, any> : {};
  out.draft = {
    name: typeof d.name === 'string' ? d.name : '',
    summary: typeof d.summary === 'string' ? d.summary : '',
    description_md: typeof d.description_md === 'string' ? d.description_md : null,
    tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === 'string') as string[] : [],
    logo_path: typeof d.logo_path === 'string' ? d.logo_path : null,
    visible: d.visible === 1 ? 1 : 0,
    next_version: typeof d.next_version === 'string' && d.next_version ? d.next_version : '0.1.0',
  };
  const lp = r.last_pushed && typeof r.last_pushed === 'object' ? r.last_pushed as Record<string, any> : null;
  if (lp && typeof lp.modfile_id === 'number' && typeof lp.md5 === 'string') {
    out.last_pushed = {
      modfile_id: lp.modfile_id,
      md5: lp.md5,
      size: typeof lp.size === 'number' ? lp.size : 0,
      version: typeof lp.version === 'string' ? lp.version : null,
      date: typeof lp.date === 'number' ? lp.date : 0,
    };
  }
  return out;
}

/** Read .modio.json from the project root via the DataSource's rootHandle.
 *  Returns null when the file is absent or unreadable. */
export async function readSidecar(ds: DataSource | null): Promise<ModioSidecar | null> {
  if (!ds) return null;
  // Starter project (HTTP) doesn't carry a sidecar.
  if (ds.kind !== 'fsa') return null;
  const root = (ds as unknown as { rootHandle: FileSystemDirectoryHandle }).rootHandle;
  try {
    const fh = await root.getFileHandle(SIDECAR_NAME);
    const file = await fh.getFile();
    const text = await file.text();
    return migrate(JSON.parse(text));
  } catch (e: any) {
    if (e?.name === 'NotFoundError' || e?.message === 'NotFoundError') return null;
    // Anything else (corrupt JSON, etc.) — surface as null and let the caller
    // decide whether to overwrite.
    return null;
  }
}

export async function writeSidecar(ds: DataSource | null, sidecar: ModioSidecar): Promise<void> {
  if (!ds || ds.kind !== 'fsa') throw new Error('Cannot write .modio.json on a read-only data source. Use Save As first.');
  const root = (ds as unknown as { rootHandle: FileSystemDirectoryHandle }).rootHandle;
  const fh = await root.getFileHandle(SIDECAR_NAME, { create: true });
  const w = await (fh as any).createWritable();
  await w.write(JSON.stringify(sidecar, null, 2) + '\n');
  await w.close();
}

/** Save a logo file under `.modio/logo.<ext>` in the project root. Returns
 *  the relative path stored in the sidecar. */
export async function writeLogo(ds: DataSource | null, blob: Blob, extension: string): Promise<string> {
  if (!ds || ds.kind !== 'fsa') throw new Error('Cannot write logo on a read-only data source. Use Save As first.');
  const root = (ds as unknown as { rootHandle: FileSystemDirectoryHandle }).rootHandle;
  const dir = await root.getDirectoryHandle('.modio', { create: true });
  const fname = `logo.${extension}`;
  const fh = await dir.getFileHandle(fname, { create: true });
  const w = await (fh as any).createWritable();
  await w.write(await blob.arrayBuffer());
  await w.close();
  return `.modio/${fname}`;
}

/** Read a logo blob from the project root, if one has been saved. */
export async function readLogo(ds: DataSource | null, relPath: string): Promise<Blob | null> {
  if (!ds || ds.kind !== 'fsa') return null;
  const root = (ds as unknown as { rootHandle: FileSystemDirectoryHandle }).rootHandle;
  // relPath is `.modio/logo.png`
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  try {
    let dir: FileSystemDirectoryHandle = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch {
    return null;
  }
}
