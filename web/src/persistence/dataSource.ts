import type { ProjectMeta } from '../store/definitionsStore';

export interface DataSourceManifest {
  folders: string[];
  files: Array<{ folder: string; ids: string[] }>;
}

export type AssetCatalogEntry = {
  path: string;
  name: string;
  folder: string;
  package_guid: string;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  thumbnail?: string;
};
export type AssetCatalog = {
  schema_version: number;
  class: string;
  entries: AssetCatalogEntry[];
};

export interface DataSource {
  readonly kind: 'http' | 'fsa';
  readonly readOnly: boolean;
  readonly displayName: string;
  readManifest(): Promise<DataSourceManifest>;
  readFile(folder: string, id: string): Promise<string>;
  writeFile?(folder: string, id: string, text: string): Promise<void>;
  deleteFile?(folder: string, id: string): Promise<void>;
  renameFile?(fromFolder: string, fromId: string, toFolder: string, toId: string): Promise<void>;
  readProjectMeta(): Promise<ProjectMeta | null>;
  writeProjectMeta?(meta: ProjectMeta): Promise<void>;
  /** Lazy per-class catalog read. Returns null when the class file is missing. */
  readCatalog(className: string): Promise<AssetCatalog | null>;
  /** Flat sorted tag list. Returns [] when the sidecar is missing. */
  readTags(): Promise<string[]>;
  /** path → expected package_guid (may be ""). Returns {} when sidecar missing. */
  readAssetRefs(): Promise<Record<string, string>>;
}

function isLayoutFolder(name: string): boolean {
  return /^layout/i.test(name);
}

/** HTTP-backed read-only DataSource. Used for the Starter project. */
export class HttpDataSource implements DataSource {
  readonly kind = 'http' as const;
  readonly readOnly = true;
  readonly displayName = 'Starter project';

  private readonly fetcher: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    fetcher?: typeof fetch,
  ) {
    // Default fetch must be invoked with `this === globalThis`; storing the
    // unbound function on the instance and calling `this.fetcher(...)` would
    // throw "Illegal invocation". Bind here so callers can use the method
    // form without ceremony.
    this.fetcher = fetcher
      ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (() => { throw new Error('no fetch'); }) as any);
  }

  async readManifest(): Promise<DataSourceManifest> {
    const url = `${this.baseUrl}/manifest.json`;
    const r = await this.fetcher(url);
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    const json = JSON.parse(await r.text());
    return {
      folders: (json.folders ?? []).filter((f: string) => !isLayoutFolder(f)),
      files: (json.files ?? []).filter((f: any) => !isLayoutFolder(f.folder)),
    };
  }

  async readFile(folder: string, id: string): Promise<string> {
    const url = `${this.baseUrl}/${folder}/${id}.json`;
    const r = await this.fetcher(url);
    if (!r.ok) throw new Error(`file ${folder}/${id} ${r.status}`);
    return r.text();
  }

  async readProjectMeta(): Promise<ProjectMeta> {
    return { schema_version: 1, name: 'Starter project' };
  }

  async readCatalog(className: string): Promise<AssetCatalog | null> {
    const url = `${this.baseUrl}/.assets/${className}.json`;
    const r = await this.fetcher(url);
    if (!r.ok) return null;
    return JSON.parse(await r.text());
  }

  async readTags(): Promise<string[]> {
    const url = `${this.baseUrl}/.gameplay-tags.json`;
    const r = await this.fetcher(url);
    if (!r.ok) return [];
    return JSON.parse(await r.text()).tags ?? [];
  }

  async readAssetRefs(): Promise<Record<string, string>> {
    const url = `${this.baseUrl}/.asset-refs.json`;
    const r = await this.fetcher(url);
    if (!r.ok) return {};
    return JSON.parse(await r.text()).expected_guids ?? {};
  }

  // writeFile / deleteFile / renameFile / writeProjectMeta intentionally undefined.
}

const PROJECT_META_FILE = 'project.json';

/** FSA-backed read/write DataSource. Wraps a FileSystemDirectoryHandle. */
export class FsaDataSource implements DataSource {
  readonly kind = 'fsa' as const;
  readonly readOnly = false;

  constructor(public readonly rootHandle: FileSystemDirectoryHandle) {}

  get displayName(): string { return this.rootHandle.name; }

  async readManifest(): Promise<DataSourceManifest> {
    const folders: string[] = [];
    const files: Array<{ folder: string; ids: string[] }> = [];
    // @ts-ignore — .entries() is part of the FSA spec; TS libs sometimes lag.
    for await (const [name, entry] of this.rootHandle.entries()) {
      if ((entry as any).kind !== 'directory') continue;
      if (name.startsWith('.')) continue;
      if (isLayoutFolder(name)) continue;
      folders.push(name);
      const ids: string[] = [];
      // @ts-ignore
      for await (const [fileName, fileEntry] of (entry as FileSystemDirectoryHandle).entries()) {
        if ((fileEntry as any).kind !== 'file') continue;
        if (!fileName.toLowerCase().endsWith('.json')) continue;
        ids.push(fileName.replace(/\.json$/i, ''));
      }
      ids.sort();
      files.push({ folder: name, ids });
    }
    folders.sort();
    files.sort((a, b) => a.folder.localeCompare(b.folder));
    return { folders, files };
  }

  async readFile(folder: string, id: string): Promise<string> {
    const dir = await this.rootHandle.getDirectoryHandle(folder);
    const fh = await dir.getFileHandle(`${id}.json`);
    const file = await fh.getFile();
    return file.text();
  }

  async writeFile(folder: string, id: string, text: string): Promise<void> {
    const dir = await this.rootHandle.getDirectoryHandle(folder, { create: true });
    const fh = await dir.getFileHandle(`${id}.json`, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(text);
    await w.close();
  }

  async deleteFile(folder: string, id: string): Promise<void> {
    const dir = await this.rootHandle.getDirectoryHandle(folder);
    await (dir as any).removeEntry(`${id}.json`);
  }

  async renameFile(fromFolder: string, fromId: string, toFolder: string, toId: string): Promise<void> {
    const text = await this.readFile(fromFolder, fromId);
    await this.writeFile(toFolder, toId, text);
    if (fromFolder !== toFolder || fromId !== toId) {
      await this.deleteFile(fromFolder, fromId);
    }
  }

  async readProjectMeta(): Promise<ProjectMeta | null> {
    try {
      const fh = await this.rootHandle.getFileHandle(PROJECT_META_FILE);
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch (e: any) {
      // Real FSA throws DOMException with name='NotFoundError'. Test mocks
      // sometimes throw plain Error with 'NotFoundError' as message. Accept both.
      if (e?.name === 'NotFoundError' || e?.message === 'NotFoundError') return null;
      throw e;
    }
  }

  async writeProjectMeta(meta: ProjectMeta): Promise<void> {
    const fh = await this.rootHandle.getFileHandle(PROJECT_META_FILE, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(JSON.stringify(meta, null, 2));
    await w.close();
  }

  async readCatalog(className: string): Promise<AssetCatalog | null> {
    try {
      const assets = await this.rootHandle.getDirectoryHandle('.assets');
      const fh = await assets.getFileHandle(`${className}.json`);
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch (e: any) {
      if (e?.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async readTags(): Promise<string[]> {
    try {
      const fh = await this.rootHandle.getFileHandle('.gameplay-tags.json');
      const file = await fh.getFile();
      return JSON.parse(await file.text()).tags ?? [];
    } catch (e: any) {
      if (e?.name === 'NotFoundError') return [];
      throw e;
    }
  }

  async readAssetRefs(): Promise<Record<string, string>> {
    try {
      const fh = await this.rootHandle.getFileHandle('.asset-refs.json');
      const file = await fh.getFile();
      return JSON.parse(await file.text()).expected_guids ?? {};
    } catch (e: any) {
      if (e?.name === 'NotFoundError') return {};
      throw e;
    }
  }
}
