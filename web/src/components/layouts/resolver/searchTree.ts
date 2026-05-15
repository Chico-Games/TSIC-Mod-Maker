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
    const tagsEnv = rec.json?.properties?.gameplay_tags;
    const tags = (tagsEnv?.value as string[] | undefined) ?? [];
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
