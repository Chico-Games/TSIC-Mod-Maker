import type { DefinitionRecord, DefinitionsKey } from './definitionsStore';

/** One incoming reference into a target asset. */
export interface IncomingRef {
  ownerKey: DefinitionsKey;     // who holds the ref
  path: (string | number)[];    // path within owner.json to the ref envelope
  ownerFolder: string;          // convenience for grouping in the UI
}

/** All incoming references, keyed by target asset id (the bare id, not folder/id). */
export type ReferencedByIndex = Map<string, IncomingRef[]>;

/** Build the full index by walking every record's properties tree. */
export function buildReferencedByIndex(definitions: Map<DefinitionsKey, DefinitionRecord>): ReferencedByIndex {
  const out: ReferencedByIndex = new Map();
  for (const [ownerKey, rec] of definitions) {
    walk(rec.json?.properties, [], (targetId, path) => {
      const list = out.get(targetId) ?? [];
      list.push({ ownerKey, path: ['properties', ...path], ownerFolder: rec.folder });
      out.set(targetId, list);
    });
  }
  return out;
}

/** Apply an in-place delta when a single record's properties change.
 *  Removes every entry whose ownerKey === changedKey, then walks the
 *  record's properties and re-adds. Cheap when most records don't
 *  change at once.
 */
export function reindexRecord(
  index: ReferencedByIndex,
  ownerKey: DefinitionsKey,
  ownerFolder: string,
  newProperties: any,
): void {
  // Remove existing entries for this owner.
  for (const [targetId, list] of index) {
    const filtered = list.filter((r) => r.ownerKey !== ownerKey);
    if (filtered.length === 0) index.delete(targetId);
    else if (filtered.length !== list.length) index.set(targetId, filtered);
  }
  // Add new entries.
  walk(newProperties, [], (targetId, path) => {
    const list = index.get(targetId) ?? [];
    list.push({ ownerKey, path: ['properties', ...path], ownerFolder });
    index.set(targetId, list);
  });
}

/** Recursively walk a typed-envelope value, calling visit(targetId, path)
 *  for every {type:'definition_ref', value:'<id>'} envelope encountered.
 *  Empty refs (no value) are skipped.
 */
function walk(node: any, path: (string | number)[], visit: (targetId: string, path: (string | number)[]) => void): void {
  if (node == null) return;
  if (typeof node !== 'object') return;

  if (node.type === 'definition_ref') {
    const v = node.value;
    if (typeof v === 'string' && v.length > 0) visit(v, path);
    return;
  }
  if (node.type === 'array' && Array.isArray(node.value)) {
    for (let i = 0; i < node.value.length; i++) walk(node.value[i], [...path, i], visit);
    return;
  }
  if (node.type === 'map' && Array.isArray(node.value)) {
    for (let i = 0; i < node.value.length; i++) {
      const entry = node.value[i];
      if (entry?.key) walk(entry.key, [...path, i, 'key'], visit);
      if (entry?.value) walk(entry.value, [...path, i, 'value'], visit);
    }
    return;
  }
  if (node.type === 'struct' && node.value && typeof node.value === 'object') {
    for (const [k, v] of Object.entries(node.value)) walk(v, [...path, k], visit);
    return;
  }
  // Bare property bag (the top-level `properties` object) — recurse over keys.
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'value' || k === 'class' || k === 'element_type' || k === 'key_type' || k === 'value_type' || k === 'struct_name') continue;
    walk(v, [...path, k], visit);
  }
}
