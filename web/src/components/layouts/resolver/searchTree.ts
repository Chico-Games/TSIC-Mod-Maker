import type { ProxySearchTreeQuery } from '../types';
import { allQueriesMatch } from './proxySearchQuery';

/** A def that the resolver might pick. We hold a thin reference to its
 *  JSON; the resolver pulls bounds/mesh/etc. from other stores as needed. */
export type SearchTreeDef = {
  id: string;
  tags: string[];
  json: any; // the full record's `json` field
};

export type SearchTree = {
  klass: string;
  allDefs: SearchTreeDef[];
  /** Convenience for callers that only need IDs. */
  allDefIds: string[];
};

/** Pull plain tag strings out of a gameplay-tags property envelope. Handles
 *  both the `gameplay_tag_container` shape (`value: string[]`) and the generic
 *  array-of-typed-strings shape the lean→envelope converter falls back to when
 *  `_schema.json` carries no entry for the property (e.g. `gameplay_tags` on
 *  ULayoutDefinition → `value: Array<{ type:'string', value:string }>`).
 *  Without this, tag string ops (`.startsWith`, `.includes`) crash on the
 *  envelope objects. */
export function tagStrings(env: any): string[] {
  const v = env?.value;
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? x.value : null))
    .filter((s): s is string => typeof s === 'string');
}

/** Build a search tree of every definition whose `class` matches `klass`
 *  OR whose `parent_classes` list contains `klass`. Bare and U-prefixed names
 *  both match. Pulls `gameplay_tags` off each. */
export function buildSearchTree(
  defs: Map<string, { id: string; json: any }>,
  klass: string,
): SearchTree {
  const norm = (s: string | undefined) => (s ? (s.startsWith('U') ? s : 'U' + s) : '');
  const target = norm(klass);
  const allDefs: SearchTreeDef[] = [];
  for (const [, rec] of defs) {
    const recClass = norm(rec.json?.class);
    if (!recClass) continue;
    const parents = (rec.json?.parent_classes as string[] | undefined) ?? [];
    const matches = recClass === target || parents.some((p) => norm(p) === target);
    if (!matches) continue;
    const tags = tagStrings(rec.json?.properties?.gameplay_tags);
    allDefs.push({ id: rec.id, tags, json: rec.json });
  }
  return { klass, allDefs, allDefIds: allDefs.map((d) => d.id) };
}

/** Returns every def in `tree` whose tags satisfy every query. */
export function defsMatchingAllQueries(
  tree: SearchTree,
  queries: ProxySearchTreeQuery[],
): SearchTreeDef[] {
  if (queries.length === 0) return tree.allDefs.slice();
  return tree.allDefs.filter((d) => allQueriesMatch(queries, d.tags));
}
