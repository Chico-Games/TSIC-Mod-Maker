import { useEffect, useState } from 'react';
import { useDefinitionsStore, type DefinitionRecord, type DefinitionsKey } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';

/** Item artwork, resolved from a definition's `thumbnail` property.
 *
 *  The game pack points icons at `mod:icons/<name>`: a PNG under the mod's own
 *  `icons/` folder. The bundled Default Project ships them re-encoded small
 *  (`scripts/build-icons.mjs` → `starter-project/icons/<name>.webp`); a mod
 *  opened from disk can carry its own in `icons/<name>.png`. Anything that
 *  fails to resolve falls back to the folder's glyph, so a missing icon is
 *  never a broken image. */

type Defs = Map<DefinitionsKey, DefinitionRecord>;

interface Index {
  byId: Map<string, DefinitionRecord>;
  /** static item id → the item definition that owns it. */
  ownerOfStatic: Map<string, DefinitionRecord>;
}

const indexCache = new WeakMap<Defs, Index>();

function indexFor(defs: Defs): Index {
  let idx = indexCache.get(defs);
  if (idx) return idx;
  idx = { byId: new Map(), ownerOfStatic: new Map() };
  for (const rec of defs.values()) {
    if (!rec.json) continue;
    idx.byId.set(rec.id, rec);
    const partner = rec.json?.properties?.static_item_definition?.value;
    if (typeof partner === 'string' && partner) idx.ownerOfStatic.set(partner, rec);
  }
  indexCache.set(defs, idx);
  return idx;
}

/** The record whose name and artwork best represent `id` to a person. A
 *  static item (`FD_ScrapMetal_SI`) is the world-mesh half of an inventory
 *  item, has no icon of its own and usually no display name — so it borrows
 *  both from the item that owns it. */
export function presentedRecord(defs: Defs, id: string): DefinitionRecord | null {
  const idx = indexFor(defs);
  const rec = idx.byId.get(id) ?? null;
  if (!rec) return null;
  if (rec.folder === 'static_item_definitions') return idx.ownerOfStatic.get(id) ?? rec;
  return rec;
}

export function recordById(defs: Defs, id: string): DefinitionRecord | null {
  return indexFor(defs).byId.get(id) ?? null;
}

/** Human name for a definition id: its display name when it has one, else the
 *  id with its prefix/suffix stripped. */
export function presentedName(defs: Defs, id: string): string {
  const rec = presentedRecord(defs, id);
  const dn = rec?.json?.properties?.display_name?.value;
  if (typeof dn === 'string' && dn.trim()) return dn;
  return humanizeAssetId(id);
}

function thumbnailName(rec: DefinitionRecord | null): string | null {
  const t = rec?.json?.properties?.thumbnail?.value;
  if (typeof t !== 'string') return null;
  const m = t.match(/^mod:icons\/(.+)$/i);
  return m ? m[1].toLowerCase() : null;
}

const projectIconCache = new Map<string, Promise<string | null>>();

/** Read `icons/<name>.png` out of the opened project folder, if there is one. */
function projectIconUrl(name: string): Promise<string | null> {
  const handle = useDefinitionsStore.getState().directoryHandle;
  if (!handle) return Promise.resolve(null);
  const cacheKey = `${handle.name}/${name}`;
  let p = projectIconCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      try {
        const dir = await handle.getDirectoryHandle('icons');
        const file = await (await dir.getFileHandle(`${name}.png`)).getFile();
        return URL.createObjectURL(file);
      } catch {
        return null;
      }
    })();
    projectIconCache.set(cacheKey, p);
  }
  return p;
}

interface Props {
  /** Definition id to draw. */
  id: string;
  size?: number;
  className?: string;
}

export function ItemIcon({ id, size = 24, className }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const rec = presentedRecord(definitions, id);
  const name = thumbnailName(rec);
  const bundled = name ? `${(import.meta as any).env?.BASE_URL ?? "/"}starter-project/icons/${name}.webp` : null;
  // 0 = bundled, 1 = project folder, 2 = glyph
  const [stage, setStage] = useState(0);
  const [projectUrl, setProjectUrl] = useState<string | null>(null);
  useEffect(() => { setStage(0); setProjectUrl(null); }, [name]);
  useEffect(() => {
    if (stage !== 1 || !name) return;
    let live = true;
    void projectIconUrl(name).then((u) => {
      if (!live) return;
      if (u) setProjectUrl(u);
      else setStage(2);
    });
    return () => { live = false; };
  }, [stage, name]);

  const src = stage === 0 ? bundled : stage === 1 ? projectUrl : null;
  const theme = getFolderTheme((rec ?? recordById(definitions, id))?.folder ?? '');
  const style = { width: size, height: size, fontSize: Math.round(size * 0.62) };
  if (!name || stage === 2 || (stage === 1 && !projectUrl)) {
    return (
      <span className={`item-icon glyph ${className ?? ''}`} style={style} aria-hidden>
        {rec ? theme.emoji : '❔'}
      </span>
    );
  }
  return (
    <span className={`item-icon ${className ?? ''}`} style={style} aria-hidden>
      <img
        src={src ?? undefined}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setStage((s) => s + 1)}
      />
    </span>
  );
}
