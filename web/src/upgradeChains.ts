// Upgrade-chain index for stations and damageable furniture.
//
// A "chain" is a sequence of assets linked via the
// `upgrade_recipe → upgraded_furniture_definition` relationship.
// Tier-pill grouping in the rails uses this index — the previous,
// name-only `familyKey(id)` heuristic still acts as a fallback so
// related siblings that aren't yet wired via upgrade recipes still
// render as a family.
//
// Building the index walks every loaded record once, indexes the
// upgrade edges, then merges by union-find with the name-based
// family key so a chain that's PARTIALLY linked still shows every
// member.

import type { DefinitionsKey, DefinitionRecord } from './store/definitionsStore';

export interface ChainMember {
  /** Storage key (folder/id). */
  key: DefinitionsKey;
  /** Asset id. */
  id: string;
  /** Position in the chain — 1 = root. */
  tier: number;
}

export interface ChainIndex {
  /** chainId → ordered members (root first). */
  chains: Map<string, ChainMember[]>;
  /** assetId → chainId so a row can find its family without scanning. */
  byId: Map<string, string>;
  /** assetId → next-tier asset id (when linked via upgrade_recipe). */
  nextOf: Map<string, string>;
  /** assetId → previous-tier asset id (reverse of nextOf). */
  prevOf: Map<string, string>;
}

/** Strip the trailing `_XX` exporter tag and any inline `Tier\d+`
 *  segment so two stations differing only by tier hash to the same
 *  key. Mirrors the previous in-rail helper. */
export function familyKey(id: string): string {
  const noTag = id.replace(/_[A-Z]{2,3}$/, '');
  const noTier = noTag.replace(/Tier\d+/g, '');
  return noTier;
}

/** Read an asset's `upgrade_recipe` ref → resolve to a recipe asset
 *  → return that recipe's `upgraded_furniture_definition` ref value
 *  (the "next tier" id). null when any link is missing. */
function readUpgradeNext(
  rec: DefinitionRecord,
  byIdToKey: (id: string) => DefinitionsKey | null,
  records: Map<DefinitionsKey, DefinitionRecord>,
): string | null {
  const r: any = rec.json?.properties?.upgrade_recipe;
  const recipeId = r && typeof r === 'object' ? String(r.value ?? '') : '';
  if (!recipeId) return null;
  const recipeKey = byIdToKey(recipeId);
  if (!recipeKey) return null;
  const recipeRec = records.get(recipeKey);
  const t: any = recipeRec?.json?.properties?.upgraded_furniture_definition;
  const target = t && typeof t === 'object' ? String(t.value ?? '') : '';
  return target || null;
}

/** Build a chain index over the records returned by the predicate.
 *  `belongs(rec)` filters which records participate (e.g. all
 *  station classes for the Stations rail). */
export function buildUpgradeChains(
  records: Map<DefinitionsKey, DefinitionRecord>,
  belongs: (rec: DefinitionRecord) => boolean,
): ChainIndex {
  const byIdToKey = (id: string): DefinitionsKey | null => {
    if (!id) return null;
    for (const [k, r] of records) if (r.id === id) return k;
    return null;
  };

  // Phase 1: collect every directed edge via upgrade_recipe links.
  const nextOf = new Map<string, string>();
  const prevOf = new Map<string, string>();
  for (const rec of records.values()) {
    if (!belongs(rec)) continue;
    const next = readUpgradeNext(rec, byIdToKey, records);
    if (!next) continue;
    // Both endpoints must belong, otherwise the edge spans an
    // unrelated class — ignore it.
    const targetKey = byIdToKey(next);
    if (!targetKey) continue;
    const targetRec = records.get(targetKey);
    if (!targetRec || !belongs(targetRec)) continue;
    nextOf.set(rec.id, next);
    prevOf.set(next, rec.id);
  }

  // Phase 2: union-find. Edges are upgrade links; we also union by
  // name-based familyKey so siblings whose upgrade chain isn't yet
  // wired still group.
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let cur = a;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!;
      parent.set(cur, parent.get(p) ?? p);
      cur = parent.get(cur)!;
    }
    return cur;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const rec of records.values()) {
    if (!belongs(rec)) continue;
    if (!parent.has(rec.id)) parent.set(rec.id, rec.id);
  }
  // Union by upgrade edge.
  for (const [from, to] of nextOf) union(from, to);
  // Union by name-based family — only when there's no edge already
  // linking THIS member to its name siblings (otherwise we'd merge
  // arbitrary same-named-but-unrelated chains).
  const familyToMembers = new Map<string, string[]>();
  for (const rec of records.values()) {
    if (!belongs(rec)) continue;
    const fk = familyKey(rec.id);
    const list = familyToMembers.get(fk) ?? [];
    list.push(rec.id);
    familyToMembers.set(fk, list);
  }
  for (const [, members] of familyToMembers) {
    if (members.length < 2) continue;
    for (let i = 1; i < members.length; i++) union(members[0], members[i]);
  }

  // Phase 3: bucket members by their root, then order each chain by
  // following upgrade edges from the root forward.
  const buckets = new Map<string, string[]>();
  for (const rec of records.values()) {
    if (!belongs(rec)) continue;
    const root = find(rec.id);
    const list = buckets.get(root) ?? [];
    list.push(rec.id);
    buckets.set(root, list);
  }

  const chains = new Map<string, ChainMember[]>();
  const byId = new Map<string, string>();

  for (const [chainId, members] of buckets) {
    if (members.length === 0) continue;
    // Linear chain: find the start (member with no incoming edge that
    // belongs to THIS bucket) and walk forward.
    const memberSet = new Set(members);
    const incomingFromBucket = new Set<string>();
    for (const m of members) {
      const next = nextOf.get(m);
      if (next && memberSet.has(next)) incomingFromBucket.add(next);
    }
    const starts = members.filter((m) => !incomingFromBucket.has(m));
    const ordered: string[] = [];
    const seen = new Set<string>();
    // Walk from each start and chain forward. If multiple starts
    // exist (disconnected siblings unioned via name only), order by
    // id.
    starts.sort((a, b) => a.localeCompare(b));
    for (const s of starts) {
      let cur: string | undefined = s;
      while (cur && memberSet.has(cur) && !seen.has(cur)) {
        ordered.push(cur);
        seen.add(cur);
        cur = nextOf.get(cur);
      }
    }
    // Mop up anything we missed (disconnected back-references).
    for (const m of members) {
      if (!seen.has(m)) {
        ordered.push(m);
        seen.add(m);
      }
    }
    const chain: ChainMember[] = ordered.map((id, i) => {
      // Find the storage key for this id.
      let key: DefinitionsKey | null = null;
      for (const [k, r] of records) {
        if (r.id === id) { key = k; break; }
      }
      return { key: key ?? id, id, tier: i + 1 };
    });
    chains.set(chainId, chain);
    for (const m of chain) byId.set(m.id, chainId);
  }

  return { chains, byId, nextOf, prevOf };
}
