import { create } from 'zustand';
import type { DataSource, AssetCatalogEntry } from '../persistence/dataSource';

type Status = AssetCatalogEntry[] | 'loading' | 'missing';

type State = {
  dataSource: DataSource | null;
  catalogs: Record<string, Status>;
  inflight: Record<string, Promise<AssetCatalogEntry[]>>;
  setDataSource: (ds: DataSource | null) => void;
  loadCatalog: (className: string) => Promise<AssetCatalogEntry[]>;
  lookupByPath: (className: string, path: string) => AssetCatalogEntry | null;
  lookupByGuid: (className: string, guid: string) => AssetCatalogEntry | null;
};

export const useAssetCatalogStore = create<State>((set, get) => ({
  dataSource: null,
  catalogs: {},
  inflight: {},

  setDataSource: (ds) => set({ dataSource: ds, catalogs: {}, inflight: {} }),

  loadCatalog: async (className) => {
    const cached = get().catalogs[className];
    if (Array.isArray(cached)) return cached;
    if (cached === 'missing') return [];
    const inflight = get().inflight[className];
    if (inflight) return inflight;

    const ds = get().dataSource;
    if (!ds) return [];

    set((s) => ({ catalogs: { ...s.catalogs, [className]: 'loading' } }));
    const promise = (async () => {
      const cat = await ds.readCatalog(className);
      if (!cat) {
        set((s) => {
          const nextInflight = { ...s.inflight };
          delete nextInflight[className];
          return {
            catalogs: { ...s.catalogs, [className]: 'missing' as const },
            inflight: nextInflight,
          };
        });
        return [];
      }
      set((s) => {
        const nextInflight = { ...s.inflight };
        delete nextInflight[className];
        return {
          catalogs: { ...s.catalogs, [className]: cat.entries },
          inflight: nextInflight,
        };
      });
      return cat.entries;
    })();
    set((s) => ({ inflight: { ...s.inflight, [className]: promise } }));
    return promise;
  },

  lookupByPath: (className, path) => {
    const cached = get().catalogs[className];
    if (!Array.isArray(cached)) return null;
    return cached.find((e) => e.path === path) ?? null;
  },

  lookupByGuid: (className, guid) => {
    const cached = get().catalogs[className];
    if (!Array.isArray(cached)) return null;
    return cached.find((e) => e.package_guid === guid) ?? null;
  },
}));
