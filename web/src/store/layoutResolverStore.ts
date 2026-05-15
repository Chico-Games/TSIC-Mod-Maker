import { create } from 'zustand';
import { useDefinitionsStore } from './definitionsStore';
import { useAssetCatalogStore } from './assetCatalogStore';
import { resolve, type ResolveContext } from '../components/layouts/resolver/resolver';
import type { ResolvedActor, LayoutObject } from '../components/layouts/types';

type Key = string; // `${layoutKey}|${seed}|${tileTagsCsv}`

function makeKey(layoutKey: string, seed: number, tileTags: string[]): Key {
  return `${layoutKey}|${seed}|${[...tileTags].sort().join(',')}`;
}

type State = {
  cache: Map<Key, ResolvedActor[]>;
  resolveLayout: (layoutKey: string, seed: number, tileTags: string[]) => ResolvedActor[];
  invalidate: (layoutKey?: string) => void;
};

export const useLayoutResolverStore = create<State>((set, get) => ({
  cache: new Map(),

  resolveLayout: (layoutKey, seed, tileTags) => {
    const key = makeKey(layoutKey, seed, tileTags);
    const cached = get().cache.get(key);
    if (cached) return cached;

    const definitions = useDefinitionsStore.getState().definitions;
    const layoutRec = definitions.get(layoutKey);
    if (!layoutRec) return [];

    // Build a bare-id-keyed index for in-resolver lookups (refs inside layouts
    // use bare IDs like `FD_Door` / `LYD_TileBase`, not full `folder/id` keys).
    const definitionsById = new Map<string, { id: string; json: any }>();
    for (const rec of definitions.values()) {
      definitionsById.set(rec.id, { id: rec.id, json: rec.json });
    }

    const objects = (layoutRec.json?.properties?.layout_objects?.value as LayoutObject[] | undefined) ?? [];

    const catalogStore = useAssetCatalogStore.getState();
    const catalogLookup = (cls: string, path: string) => catalogStore.lookupByPath(cls, path);

    const results: ResolvedActor[] = objects.map((lo, i) => {
      const ctx: ResolveContext = {
        layoutObject: lo,
        ownerLayoutKey: layoutKey,
        ownerIndex: i,
        tileTags,
        seed,
        definitions: definitionsById,
        catalogLookup,
        visitedLayouts: new Set([layoutRec.id]),
      };
      return resolve(ctx);
    });

    set((s) => {
      const next = new Map(s.cache);
      next.set(key, results);
      return { cache: next };
    });
    return results;
  },

  invalidate: (layoutKey) => {
    if (!layoutKey) {
      set({ cache: new Map() });
      return;
    }
    set((s) => {
      const next = new Map(s.cache);
      for (const k of next.keys()) if (k.startsWith(`${layoutKey}|`)) next.delete(k);
      return { cache: next };
    });
  },
}));

// Catalogs load async after a Layout may already have been resolved with
// bounds=null. Drop the resolver cache when the catalogs map changes so the
// next resolveLayout call re-runs with the now-populated bounds.
let lastCatalogs: unknown = useAssetCatalogStore.getState().catalogs;
useAssetCatalogStore.subscribe((s) => {
  if (s.catalogs === lastCatalogs) return;
  lastCatalogs = s.catalogs;
  useLayoutResolverStore.getState().invalidate();
});
