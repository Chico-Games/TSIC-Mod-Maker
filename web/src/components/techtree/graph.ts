// Tech-tree graph model.
//
// The old view drew three node kinds (item / recipe / station) and wired them
// with one edge per input and per output. That produced a node for every
// recipe — nearly always named after its own output, so the canvas read
// "Arm Club → Arm Club" — plus a curtain of station→recipe membership edges
// spanning the full height of the layout.
//
// Here the recipe is *collapsed onto the edge*: nodes are things you can hold
// or place, edges are "this recipe turns that into this". Station membership
// becomes a node/edge attribute, not geometry.

import type { DefinitionRecord } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';

export type RecipeKind = 'craft' | 'plant' | 'upgrade';
export type ThingKind = 'item' | 'furniture';

export interface TechRecipe {
  id: string;
  label: string;
  folder: string;
  kind: RecipeKind;
  level: number;
  duration: number;
  inputs: Array<{ id: string; qty: number }>;
  outputs: Array<{ id: string; qty: number }>;
  /** Station ids offering this recipe. Empty for upgrades (reached via the
   *  construction/upgrade flow, which has no ARR). */
  stations: string[];
  upgradeTier?: number;
}

export interface TechNode {
  id: string;
  label: string;
  folder: string;
  kind: ThingKind;
  producedBy: string[];
  consumedBy: string[];
  stations: string[];
  /** Longest chain of recipes from a raw material. 0 = raw. */
  depth: number;
  /** Lowest recipe `level` that can produce this. 0 = raw. */
  level: number;
  isRaw: boolean;
  isTerminal: boolean;
  /** No recipe produces it and no recipe consumes it, yet something
   *  references it — usually a typo or an orphaned definition. */
  isDangling: boolean;
  /** Every route that produces this passes through itself, so it can never
   *  be crafted from raw materials. */
  isUnreachable: boolean;
}

export interface TechEdge {
  id: string;
  from: string;
  to: string;
  recipeId: string;
  qtyIn: number;
  qtyOut: number;
  level: number;
  kind: RecipeKind;
}

export interface TechStation {
  id: string;
  label: string;
  folder: string;
  recipes: string[];
}

export interface TechGraph {
  nodes: Map<string, TechNode>;
  edges: TechEdge[];
  recipes: Map<string, TechRecipe>;
  stations: Map<string, TechStation>;
  /** Recipes whose declared output resolves to nothing renderable. */
  brokenRecipes: string[];
  maxDepth: number;
}

const RECIPE_FOLDERS: Record<string, RecipeKind> = {
  craft_recipe_definitions: 'craft',
  plant_recipe_definitions: 'plant',
  furniture_upgrade_recipe: 'upgrade',
};

const STATION_FOLDERS = new Set([
  'crafting_station_definitions',
  'production_station_definitions',
  'plantable_definitions',
]);

const FURNITURE_FOLDER_RE = /furniture|constructable|storage|elevator|toggleable|damageable/;

/** Definitions are stored as typed envelopes (`{type, value}`) at runtime but
 *  land on disk lean (`16`). Unwrap either. */
function unwrap(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return v.value;
  return v;
}

function readRef(prop: any): string {
  const v = unwrap(prop);
  return typeof v === 'string' ? v : '';
}

function readNumber(prop: any, fallback: number): number {
  const n = Number(unwrap(prop));
  return Number.isFinite(n) ? n : fallback;
}

/** Read an `input`/`output` quantity map in either envelope or lean form. */
function readQtyMap(prop: any): Array<{ id: string; qty: number }> {
  const raw = unwrap(prop);
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; qty: number }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(unwrap(entry.key) ?? '');
    if (!id) continue;
    const qty = readNumber(entry.value, 1);
    out.push({ id, qty });
  }
  return out;
}

function readStringArray(prop: any): string[] {
  const raw = unwrap(prop);
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(unwrap(v) ?? '')).filter(Boolean);
}

export function buildTechGraph(
  definitions: Map<string, DefinitionRecord>,
  findKeyById: (id: string) => string | null,
): TechGraph {
  const byId = new Map<string, DefinitionRecord>();
  for (const rec of definitions.values()) {
    if (!byId.has(rec.id)) byId.set(rec.id, rec);
  }

  const recipes = new Map<string, TechRecipe>();
  const stations = new Map<string, TechStation>();
  const nodes = new Map<string, TechNode>();
  const edges: TechEdge[] = [];
  const brokenRecipes: string[] = [];

  const folderOf = (id: string): string => {
    const direct = byId.get(id);
    if (direct) return direct.folder;
    const key = findKeyById(id);
    return key ? definitions.get(key)?.folder ?? '' : '';
  };

  const touchNode = (id: string): TechNode => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const folder = folderOf(id);
    const node: TechNode = {
      id,
      label: humanizeAssetId(id),
      folder,
      kind: FURNITURE_FOLDER_RE.test(folder) ? 'furniture' : 'item',
      producedBy: [],
      consumedBy: [],
      stations: [],
      depth: 0,
      level: 0,
      isRaw: true,
      isTerminal: true,
      isDangling: false,
      isUnreachable: false,
    };
    nodes.set(id, node);
    return node;
  };

  // ---- Pass 1: recipes -------------------------------------------------
  for (const rec of definitions.values()) {
    const kind = RECIPE_FOLDERS[rec.folder];
    if (!kind) continue;

    const props = rec.json?.properties ?? {};
    const inputs = readQtyMap(props.input);
    let outputs = readQtyMap(props.output);

    // Furniture upgrades declare an empty `output` and put the result in
    // `upgraded_furniture_definition`. The old view only read `output`, so all
    // 122 of them rendered as dead ends feeding nothing.
    if (kind === 'upgrade' && outputs.length === 0) {
      const upgraded = readRef(props.upgraded_furniture_definition);
      if (upgraded) outputs = [{ id: upgraded, qty: 1 }];
    }

    const recipe: TechRecipe = {
      id: rec.id,
      label: humanizeAssetId(rec.id),
      folder: rec.folder,
      kind,
      level: readNumber(props.level, 1),
      duration: readNumber(props.duration, 0),
      inputs,
      outputs,
      stations: [],
      upgradeTier: props.upgrade_tier !== undefined ? readNumber(props.upgrade_tier, 0) : undefined,
    };
    recipes.set(recipe.id, recipe);
    if (outputs.length === 0) brokenRecipes.push(recipe.id);
  }

  // ---- Pass 2: stations via ARR ---------------------------------------
  for (const rec of definitions.values()) {
    if (!STATION_FOLDERS.has(rec.folder)) continue;
    const arrId = readRef(rec.json?.properties?.available_recipe_rules_definition);
    if (!arrId) continue;
    const arr = byId.get(arrId) ?? (findKeyById(arrId) ? definitions.get(findKeyById(arrId)!) : undefined);
    if (!arr) continue;
    const rules = unwrap(arr.json?.properties?.production_machine_rules);
    const recipeIds = readStringArray(rules?.recipes);
    if (recipeIds.length === 0) continue;

    stations.set(rec.id, {
      id: rec.id,
      label: humanizeAssetId(rec.id),
      folder: rec.folder,
      recipes: recipeIds,
    });
    for (const rid of recipeIds) {
      const r = recipes.get(rid);
      if (r && !r.stations.includes(rec.id)) r.stations.push(rec.id);
    }
  }

  // ---- Pass 3: nodes + collapsed edges --------------------------------
  for (const recipe of recipes.values()) {
    for (const out of recipe.outputs) {
      const outNode = touchNode(out.id);
      outNode.producedBy.push(recipe.id);
      outNode.isRaw = false;
      for (const st of recipe.stations) {
        if (!outNode.stations.includes(st)) outNode.stations.push(st);
      }
    }
    for (const inp of recipe.inputs) {
      const inNode = touchNode(inp.id);
      inNode.consumedBy.push(recipe.id);
      inNode.isTerminal = false;
    }
    // One edge per (input, output) pair; siblings share `recipeId` so the
    // view can highlight a whole recipe as a unit.
    for (const inp of recipe.inputs) {
      for (const out of recipe.outputs) {
        if (inp.id === out.id) continue; // seed→seed self-loop
        edges.push({
          id: `${recipe.id}:${inp.id}->${out.id}`,
          from: inp.id,
          to: out.id,
          recipeId: recipe.id,
          qtyIn: inp.qty,
          qtyOut: out.qty,
          level: recipe.level,
          kind: recipe.kind,
        });
      }
    }
  }

  for (const node of nodes.values()) {
    node.isDangling = node.producedBy.length === 0 && node.consumedBy.length === 0;
  }

  // ---- Pass 4: depth + level ------------------------------------------
  // Depth is the fewest crafting steps from raw materials, computed as a
  // least fixpoint: start every craftable at infinity and relax downwards.
  //
  // It has to be a *minimum*, not the longest path. The pack contains genuine
  // cycles — a seed recipe consumes a seed and outputs more of the same seed —
  // and longest-path relaxation just walks such a loop forever, which is how
  // every item ended up reporting the iteration cap as its tier. A minimum
  // converges because going round a loop can never make a thing cheaper.
  const INF = Number.POSITIVE_INFINITY;
  const depth = new Map<string, number>();
  for (const node of nodes.values()) {
    depth.set(node.id, node.producedBy.length === 0 ? 0 : INF);
  }

  for (let i = 0; i <= nodes.size; i++) {
    let changed = false;
    for (const recipe of recipes.values()) {
      let inDepth = 0;
      for (const inp of recipe.inputs) {
        inDepth = Math.max(inDepth, depth.get(inp.id) ?? INF);
      }
      // An ingredient we can't reach yet says nothing about the output.
      if (!Number.isFinite(inDepth)) continue;
      for (const out of recipe.outputs) {
        if (inDepth + 1 < (depth.get(out.id) ?? INF)) {
          depth.set(out.id, inDepth + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  let maxDepth = 0;
  for (const node of nodes.values()) {
    const d = depth.get(node.id) ?? INF;
    // Still infinite ⇒ every route to it passes through itself. Real content
    // bug, surfaced in the audit rather than silently drawn at some tier.
    node.isUnreachable = !Number.isFinite(d);
    node.depth = node.isUnreachable ? 0 : d;
    if (!node.isUnreachable) maxDepth = Math.max(maxDepth, node.depth);

    node.level =
      node.producedBy.length === 0
        ? 0
        : Math.min(...node.producedBy.map((r) => recipes.get(r)?.level ?? 1));
  }

  return { nodes, edges, recipes, stations, brokenRecipes, maxDepth };
}

// ---------------------------------------------------------------------------
// Traversal helpers
// ---------------------------------------------------------------------------

export interface Neighbourhood {
  /** node id → hop distance (negative upstream, positive downstream, 0 = focus) */
  hops: Map<string, number>;
  edgeIds: Set<string>;
}

/** Everything within `up` hops upstream and `down` hops downstream of `rootId`. */
export function neighbourhood(
  graph: TechGraph,
  rootId: string,
  up: number,
  down: number,
): Neighbourhood {
  const hops = new Map<string, number>([[rootId, 0]]);
  const edgeIds = new Set<string>();

  const inbound = new Map<string, TechEdge[]>();
  const outbound = new Map<string, TechEdge[]>();
  for (const e of graph.edges) {
    (inbound.get(e.to) ?? inbound.set(e.to, []).get(e.to)!).push(e);
    (outbound.get(e.from) ?? outbound.set(e.from, []).get(e.from)!).push(e);
  }

  const walk = (dir: 'up' | 'down', limit: number) => {
    let frontier = [rootId];
    for (let d = 1; d <= limit; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const list = dir === 'up' ? inbound.get(id) ?? [] : outbound.get(id) ?? [];
        for (const e of list) {
          edgeIds.add(e.id);
          const other = dir === 'up' ? e.from : e.to;
          if (hops.has(other)) continue;
          hops.set(other, dir === 'up' ? -d : d);
          next.push(other);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
  };

  walk('up', up);
  walk('down', down);
  return { hops, edgeIds };
}

export interface CostLine {
  id: string;
  label: string;
  folder: string;
  qty: number;
  depth: number;
  /** Recipe chosen to produce this, if any. */
  via?: string;
  children: CostLine[];
  isRaw: boolean;
  /** Set when the rollup hit a cycle and stopped descending. */
  cyclic?: boolean;
}

/** Pick the recipe used when an item has several producers: lowest level
 *  first, then fewest inputs — i.e. the cheapest way the player would do it. */
function preferredRecipe(graph: TechGraph, node: TechNode): TechRecipe | undefined {
  const candidates = node.producedBy
    .map((r) => graph.recipes.get(r))
    .filter((r): r is TechRecipe => !!r);
  if (candidates.length === 0) return undefined;
  return candidates.slice().sort((a, b) => a.level - b.level || a.inputs.length - b.inputs.length)[0];
}

/** Recursively expand `rootId` into the raw materials it bottoms out in. */
export function rollupCost(graph: TechGraph, rootId: string, wanted = 1): CostLine | null {
  const root = graph.nodes.get(rootId);
  if (!root) return null;

  const expand = (id: string, qty: number, seen: Set<string>, depth: number): CostLine => {
    const node = graph.nodes.get(id);
    const label = node?.label ?? humanizeAssetId(id);
    const folder = node?.folder ?? '';
    if (!node || node.producedBy.length === 0) {
      return { id, label, folder, qty, depth, children: [], isRaw: true };
    }
    if (seen.has(id)) {
      return { id, label, folder, qty, depth, children: [], isRaw: false, cyclic: true };
    }
    const recipe = preferredRecipe(graph, node);
    if (!recipe) return { id, label, folder, qty, depth, children: [], isRaw: true };

    const produced = recipe.outputs.find((o) => o.id === id)?.qty || 1;
    const runs = Math.ceil(qty / produced);
    const nextSeen = new Set(seen).add(id);
    const children = recipe.inputs
      .filter((inp) => inp.id !== id)
      .map((inp) => expand(inp.id, inp.qty * runs, nextSeen, depth + 1));

    return { id, label, folder, qty, depth, via: recipe.id, children, isRaw: false };
  };

  return expand(rootId, wanted, new Set(), 0);
}

/** Flatten a cost tree to a raw-material total. */
export function flattenRaw(line: CostLine): Map<string, { label: string; folder: string; qty: number }> {
  const totals = new Map<string, { label: string; folder: string; qty: number }>();
  const visit = (l: CostLine) => {
    if (l.isRaw || l.cyclic) {
      const cur = totals.get(l.id);
      if (cur) cur.qty += l.qty;
      else totals.set(l.id, { label: l.label, folder: l.folder, qty: l.qty });
      return;
    }
    l.children.forEach(visit);
  };
  visit(line);
  return totals;
}

/** How much of the tree collapses if this material vanishes — the honest
 *  "load-bearing" measure, as opposed to a raw consumer count. */
export function transitiveDependents(graph: TechGraph): Map<string, number> {
  const outbound = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = outbound.get(e.from);
    if (list) list.push(e.to);
    else outbound.set(e.from, [e.to]);
  }
  const result = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of outbound.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    result.set(id, seen.size - 1);
  }
  return result;
}
