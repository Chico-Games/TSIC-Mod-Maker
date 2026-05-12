#!/usr/bin/env node
// One-shot: mirror upgradeChains.ts and print every chain the tool
// would build for the Furniture rail and the Stations rail. Flags
// chains formed only by name-heuristic ("name-only") and chains where
// a single upgrade target is reached by multiple sources (the
// "shared-target merge" that pulled chemical containers together).

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'public', 'base-definitions');

const FURNITURE_FOLDERS = new Set(['damageable_furniture_definitions']);
const STATION_FOLDERS = new Set([
  'crafting_station_definitions',
  'production_station_definitions',
  'plantable_definitions',
]);

function familyKey(id) {
  const noTag = id.replace(/_[A-Z]{2,3}$/, '');
  const noTier = noTag.replace(/Tier\d+/g, '');
  return noTier;
}

function refValue(t) {
  return t && typeof t === 'object' && t.type === 'definition_ref' ? String(t.value ?? '') : '';
}

async function loadAll() {
  const folders = (await readdir(ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const byId = new Map();
  for (const folder of folders) {
    const files = await readdir(join(ROOT, folder));
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const text = await readFile(join(ROOT, folder, f), 'utf8');
      try {
        byId.set(id, { folder, id, json: JSON.parse(text) });
      } catch {}
    }
  }
  return byId;
}

function readUpgradeNext(rec, byId) {
  const recipeId = refValue(rec.json?.properties?.upgrade_recipe);
  if (!recipeId) return null;
  const recipeRec = byId.get(recipeId);
  const target = refValue(recipeRec?.json?.properties?.upgraded_furniture_definition);
  return target || null;
}

function build(byId, belongs, label) {
  // Phase 1: edges
  const nextOf = new Map();
  const prevOf = new Map();
  // Track every edge as a tuple — Map collapses dupes by source key.
  const edges = [];
  for (const rec of byId.values()) {
    if (!belongs(rec)) continue;
    const next = readUpgradeNext(rec, byId);
    if (!next) continue;
    const targetRec = byId.get(next);
    if (!targetRec || !belongs(targetRec)) continue;
    nextOf.set(rec.id, next);
    prevOf.set(next, rec.id);
    edges.push([rec.id, next]);
  }

  // How many distinct sources reach each target (the "shared-target merge")?
  const incomingCount = new Map();
  for (const [, to] of edges) incomingCount.set(to, (incomingCount.get(to) ?? 0) + 1);

  // Phase 2: union-find
  const parent = new Map();
  const find = (a) => {
    let cur = a;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur);
      parent.set(cur, parent.get(p) ?? p);
      cur = parent.get(cur);
    }
    return cur;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const rec of byId.values()) {
    if (!belongs(rec)) continue;
    if (!parent.has(rec.id)) parent.set(rec.id, rec.id);
  }
  for (const [from, to] of edges) union(from, to);

  const familyToMembers = new Map();
  for (const rec of byId.values()) {
    if (!belongs(rec)) continue;
    const fk = familyKey(rec.id);
    const list = familyToMembers.get(fk) ?? [];
    list.push(rec.id);
    familyToMembers.set(fk, list);
  }
  // Track which unions came from the name heuristic.
  const nameUnioned = new Set();
  for (const [, members] of familyToMembers) {
    if (members.length < 2) continue;
    for (let i = 1; i < members.length; i++) {
      union(members[0], members[i]);
      nameUnioned.add(members[0]);
      nameUnioned.add(members[i]);
    }
  }

  // Phase 3: bucket and report
  const buckets = new Map();
  for (const rec of byId.values()) {
    if (!belongs(rec)) continue;
    const root = find(rec.id);
    const list = buckets.get(root) ?? [];
    list.push(rec.id);
    buckets.set(root, list);
  }

  console.log(`\n=== ${label} ===`);
  const chains = [...buckets.values()].filter((m) => m.length > 1);
  chains.sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`Total chains (>1 member): ${chains.length}`);
  for (const members of chains) {
    members.sort((a, b) => a.localeCompare(b));
    // Classify how this chain was formed.
    const edgeSet = new Set(edges.map(([a, b]) => `${a}->${b}`));
    const memberSet = new Set(members);
    const internalEdges = edges.filter(([a, b]) => memberSet.has(a) && memberSet.has(b));
    const sharedTargets = new Map();
    for (const [, b] of internalEdges) sharedTargets.set(b, (sharedTargets.get(b) ?? 0) + 1);
    const sharedTargetIds = [...sharedTargets.entries()].filter(([, c]) => c > 1).map(([t, c]) => `${t} (${c} sources)`);
    const onlyByName = internalEdges.length === 0;
    const tag = onlyByName
      ? '[NAME-ONLY]'
      : sharedTargetIds.length > 0
        ? `[SHARED-TARGET: ${sharedTargetIds.join('; ')}]`
        : '[upgrade-edges]';
    console.log(`  ${tag} ${members.join(' , ')}`);
    if (internalEdges.length > 0) {
      for (const [a, b] of internalEdges) console.log(`      ${a} -> ${b}`);
    }
  }
}

const byId = await loadAll();
console.log(`Loaded ${byId.size} assets from ${ROOT}`);
build(byId, (r) => FURNITURE_FOLDERS.has(r.folder), 'Furniture (damageable_furniture_definitions)');
build(byId, (r) => STATION_FOLDERS.has(r.folder), 'Stations (crafting/production/plantable)');
