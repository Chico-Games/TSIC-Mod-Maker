// Store-bound convenience layer over the pure `inheritance.ts` model: resolves
// a record against the CURRENT working set, with a per-`definitions`-Map cache
// so list views (rails, spreadsheets, search indexing) can call
// `resolvedProps(rec)` per row without re-walking chains.
//
// The definitions Map is replaced (never mutated in place) on every edit, so
// keying the cache on the Map's identity makes invalidation automatic.

import { useDefinitionsStore, type DefinitionRecord, type DefinitionsKey } from './definitionsStore';
import {
  getExtendsId,
  resolveInherited,
  type InheritRec,
  type ResolvedInheritance,
} from './inheritance';

type Defs = Map<DefinitionsKey, DefinitionRecord>;

interface View {
  byId: Map<string, DefinitionRecord>;
  keyById: Map<string, DefinitionsKey>;
  /** parent id → ids of the records that directly extend it. */
  children: Map<string, string[]>;
  /** Resolution cache keyed by the record's json object. */
  resolved: WeakMap<object, ResolvedInheritance>;
}

const views = new WeakMap<Defs, View>();
const NO_CHILDREN: string[] = [];

function currentDefs(): Defs {
  return useDefinitionsStore.getState().definitions;
}

/** Indexes for one snapshot of the working set (built once per snapshot). */
export function inheritanceView(defs: Defs = currentDefs()): View {
  let v = views.get(defs);
  if (v) return v;
  const byId = new Map<string, DefinitionRecord>();
  const keyById = new Map<string, DefinitionsKey>();
  const children = new Map<string, string[]>();
  for (const [k, rec] of defs) {
    // First record wins on a duplicate id, matching `findKeyById`.
    if (!byId.has(rec.id)) {
      byId.set(rec.id, rec);
      keyById.set(rec.id, k);
    }
    const parent = getExtendsId(rec);
    if (parent) {
      const list = children.get(parent);
      if (list) list.push(rec.id);
      else children.set(parent, [rec.id]);
    }
  }
  v = { byId, keyById, children, resolved: new WeakMap() };
  views.set(defs, v);
  return v;
}

/** Full resolution (merged properties + provenance + chain + error). */
export function resolveRecord(rec: InheritRec, defs: Defs = currentDefs()): ResolvedInheritance {
  const view = inheritanceView(defs);
  const cacheKey = rec.json && typeof rec.json === 'object' ? (rec.json as object) : null;
  if (cacheKey) {
    const hit = view.resolved.get(cacheKey);
    if (hit) return hit;
  }
  const out = resolveInherited(rec, (id) => view.byId.get(id));
  if (cacheKey) view.resolved.set(cacheKey, out);
  return out;
}

/** The record's properties as the GAME sees them: its own values merged over
 *  its `extends` chain. Records that extend nothing return their own
 *  `properties` object untouched (no allocation), so this is safe to call from
 *  per-row render paths. Read-only — never write through the result. */
export function resolvedProps(
  rec: InheritRec | null | undefined,
  defs: Defs = currentDefs(),
): Record<string, any> {
  if (!rec) return {};
  if (!getExtendsId(rec)) return rec.json?.properties ?? {};
  return resolveRecord(rec, defs).properties;
}

/** `rec.json` with `properties` swapped for the resolved view — for readers
 *  that walk a path from the json root (class-browser columns). */
export function resolvedJson(rec: InheritRec, defs: Defs = currentDefs()): any {
  if (!getExtendsId(rec)) return rec.json;
  return { ...rec.json, properties: resolveRecord(rec, defs).properties };
}

/** Ids of the records that directly extend `id`. */
export function childIdsOf(id: string, defs: Defs = currentDefs()): string[] {
  return inheritanceView(defs).children.get(id) ?? NO_CHILDREN;
}
