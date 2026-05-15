import type { AssetCatalog, DataSource, DataSourceManifest } from '../persistence/dataSource';
import type { ProjectMeta } from '../store/definitionsStore';

/** A read-only DataSource backed by an in-memory map of `<folder>/<id>.json`
 *  text. Used by the mod.io "open mod as project" flow: a downloaded ZIP is
 *  unpacked into a Map and wrapped here so the existing
 *  `definitionsStore.loadFromDataSource` pipeline can ingest it unchanged. */
export class InMemoryDataSource implements DataSource {
  readonly kind = 'http' as const;
  readonly readOnly = true;
  readonly displayName: string;
  private readonly entries: Map<string, string>;
  private readonly projectMeta: ProjectMeta | null;

  constructor(
    displayName: string,
    /** Keyed `<folder>/<id>` → text. */
    entries: Map<string, string>,
    projectMeta?: ProjectMeta | null,
  ) {
    this.displayName = displayName;
    this.entries = entries;
    this.projectMeta = projectMeta ?? null;
  }

  async readManifest(): Promise<DataSourceManifest> {
    const folders = new Set<string>();
    const filesByFolder = new Map<string, string[]>();
    for (const k of this.entries.keys()) {
      const slash = k.indexOf('/');
      if (slash < 0) continue;
      const folder = k.slice(0, slash);
      const id = k.slice(slash + 1);
      folders.add(folder);
      const list = filesByFolder.get(folder) ?? [];
      list.push(id);
      filesByFolder.set(folder, list);
    }
    const folderList = [...folders].sort();
    const files = folderList.map((folder) => ({
      folder,
      ids: (filesByFolder.get(folder) ?? []).slice().sort(),
    }));
    return { folders: folderList, files };
  }

  async readFile(folder: string, id: string): Promise<string> {
    const text = this.entries.get(`${folder}/${id}`);
    if (text == null) throw new Error(`file ${folder}/${id} not found in in-memory source`);
    return text;
  }

  async readProjectMeta(): Promise<ProjectMeta | null> {
    return this.projectMeta;
  }

  // The fancy sidecars don't ship inside a mod ZIP — return empty.
  async readCatalog(_className: string): Promise<AssetCatalog | null> { return null; }
  async readTags(): Promise<string[]> { return []; }
  async readAssetRefs(): Promise<Record<string, string>> { return {}; }
}
