# Layout Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-12-layout-editor-design.md`

**Goal:** A new top-level "Layouts" tab that lets users open `LYD_*.json` files, edit `LayoutObject` arrays in a 3D viewport with transform gizmos, run Unreal-parity search-query resolution against gameplay tags, and persist back to JSON — without ever opening Unreal for layout authoring.

**Architecture:** Three-pane shell (Outliner / Viewport / Details). The Viewport uses `three` + `@react-three/fiber` + `@react-three/drei` to render `LayoutObject` AABBs from the `StaticMesh` catalog's `bounds`. The Resolver is pure TypeScript (no React, no three) and ports `ALayoutLevelScriptActor::VisualiseFurniture` + `FLayoutObject::AddToTile`. The Details panel reuses `TypedValueEditor` from Workstream A so AssetRefPicker / TagPicker / StructRows render automatically.

**Tech Stack:** React 18, TypeScript, Zustand (existing), `three` + `@react-three/fiber` + `@react-three/drei` (new). Node 22 `node:test`. Playwright for UI smoke.

**Commit policy:** Commit at the end of every Task. Repo on `main`; one Unreal-side dep (the `LYD_*` JSONs already exist post-Workstream-A re-export).

---

## File Structure

**`web/src/components/layouts/` (new feature root)**

| File | Status | Responsibility |
|---|---|---|
| `LayoutsTab.tsx` | Create | Top-level three-pane shell + toolbar. Mounts Outliner / Viewport / Details. |
| `Toolbar.tsx` | Create | Layout picker, seed input, tile-tag override, Visualise / Save / Reroll buttons, dirty indicator. |
| `Outliner/Outliner.tsx` | Create | Selection-aware tree of LayoutObjects. |
| `Outliner/OutlinerRow.tsx` | Create | One outliner row: type-icon + display name + error dot. |
| `Outliner/icons.tsx` | Create | Five SVG icons (Proxy, Layout, EnemySpawn, LootSpawn, VisualHelper). |
| `Viewport/Viewport.tsx` | Create | `<Canvas>` host + OrbitControls + ground grid + lighting. |
| `Viewport/LayoutObjectMesh.tsx` | Create | One AABB per resolved actor; type-tinted; click handler. |
| `Viewport/SelectionGizmo.tsx` | Create | `<TransformControls>` bound to single selection. |
| `Viewport/StatusBillboard.tsx` | Create | Floating text above each actor with resolver status. |
| `Viewport/camera.ts` | Create | Frame-camera-to-content helper. |
| `Details/DetailsPanel.tsx` | Create | Wraps `TypedValueEditor` on the selected envelope; multi-select diff badge. |
| `resolver/searchTree.ts` | Create | Indexes definitions by gameplay-tag for fast query lookup. |
| `resolver/proxySearchQuery.ts` | Create | Port of `FProxySearchTreeQuery::QueryTags`. |
| `resolver/randomStream.ts` | Create | Mulberry32 PRNG seeded by `seed + seed_offset`. |
| `resolver/resolver.ts` | Create | Top-level `resolve(layoutObject, ctx, seed) → ResolvedActor`. |
| `types.ts` | Create | `LayoutObject`, `DefinitionFilter`, `ProxySearchTreeQuery`, `ResolvedActor` TypeScript types. |

**`web/src/store/` (existing, extend)**

| File | Status | Responsibility |
|---|---|---|
| `layoutResolverStore.ts` | Create | Caches the search tree (built once per definitions load); memoizes `resolve()` per `(index, seed, tileTags)`. |
| `layoutEditorStore.ts` | Create | `selectedLayoutKey`, `selectedIndices`, `gizmoMode`, `seed`, `tileTagsOverride`. |
| `appStore.ts` | Modify | Add `'layouts'` to `AppTab` union; setTab logic. |

**`web/src/persistence/`**

| File | Status | Responsibility |
|---|---|---|
| `dataSource.ts` | Modify | Drop `isLayoutFolder()` filter from both `HttpDataSource.readManifest()` and `FsaDataSource.readManifest()`. |

**`web/scripts/`**

| File | Status | Responsibility |
|---|---|---|
| `sync-base-definitions.mjs` | Modify | Drop `isLayoutFolder()` skip; layouts mirror into starter-project. |

**`web/tests/` (extend)**

| File | Status | Responsibility |
|---|---|---|
| `layoutResolver.test.ts` | Create | Unit tests for resolver — every status case in the spec table. |
| `layoutSearchTree.test.ts` | Create | Unit tests for tag indexing + parent-inclusion + `bNot`. |

**Other**

| File | Status | Responsibility |
|---|---|---|
| `web/src/components/Header.tsx` | Modify | Add "Layouts" tab to the top nav. |
| `web/data-smoke.mjs` | Modify | Add resolver pass: load every `LYD_*`, resolve with `{ seed: 0, tileTags: layout.gameplay_tags }`, report status counts; cycles = failure. |
| `web/savedload-ui-smoke.mjs` | Modify | Add Layouts-tab scenario: open `LYD_Bathroom_All`, confirm outliner row count and Details panel render. |
| `web/package.json` | Modify | Add `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three`. |

---

## Phase 1: Bundled defaults bring in layouts

### Task 1.1: Drop `isLayoutFolder` filter (sync + dataSource)

**Files:**
- Modify: `web/scripts/sync-base-definitions.mjs:18,61`
- Modify: `web/src/persistence/dataSource.ts:41,71-72,129`

- [ ] **Step 1: Edit `web/scripts/sync-base-definitions.mjs`**

Delete the `isLayoutFolder` function (line ~18) and the skip on line ~61:

```js
// DELETE:
function isLayoutFolder(name) {
  return /^layout/i.test(name);
}

// In the per-folder loop, DELETE:
if (isLayoutFolder(name)) continue;
```

- [ ] **Step 2: Edit `web/src/persistence/dataSource.ts`**

Delete the `isLayoutFolder` function (line ~41) and remove the filters:

```ts
// DELETE the function.

// In HttpDataSource.readManifest, change from:
folders: (json.folders ?? []).filter((f: string) => !isLayoutFolder(f)),
files: (json.files ?? []).filter((f: any) => !isLayoutFolder(f.folder)),
// to:
folders: json.folders ?? [],
files: json.files ?? [],

// In FsaDataSource.readManifest, DELETE:
if (isLayoutFolder(name)) continue;
```

- [ ] **Step 3: Run `npm run sync-defaults`**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm run sync-defaults
```

Expected: prints something like `[sync-defaults] wrote 2172 files` (was 1921). The new ~251 files are layout definitions.

- [ ] **Step 4: Verify layouts appear**

```
ls "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web/public/starter-project/layout_definitions" | head -5
```

Expected: 5 `LYD_*.json` filenames.

- [ ] **Step 5: Run existing tests + typecheck — confirm nothing broke**

```
npm test && npm run typecheck
```

Expected: 95 passed (matches pre-Workstream-B baseline). The filter removal doesn't affect any test.

- [ ] **Step 6: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/scripts/sync-base-definitions.mjs web/src/persistence/dataSource.ts web/public/starter-project/layout_definitions/
git commit -m "build(layouts): drop isLayoutFolder filter; bundle 251 LYD_* in starter-project"
```

---

## Phase 2: Types + three.js dependencies

### Task 2.1: Install three.js stack

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install dependencies**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm install three@^0.169.0 @react-three/fiber@^8.17.0 @react-three/drei@^9.114.0
npm install --save-dev @types/three@^0.169.0
```

`drei` pins to `@react-three/fiber@8.x` which works with React 18 (the project's React version per `package.json`). If npm errors with peer-dep complaints, add `--legacy-peer-deps`.

- [ ] **Step 2: Confirm versions land in `package.json`**

```
grep -E "three|fiber|drei" web/package.json
```

Expected: four lines (`three`, `@react-three/fiber`, `@react-three/drei`, `@types/three`).

- [ ] **Step 3: Run typecheck — no type errors from the new deps**

```
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/package.json web/package-lock.json
git commit -m "build(deps): add three + @react-three/{fiber,drei} for the Layouts tab"
```

### Task 2.2: TypeScript types for LayoutObject

**Files:**
- Create: `web/src/components/layouts/types.ts`

- [ ] **Step 1: Create `web/src/components/layouts/types.ts`**

```ts
/** Type-safe shapes for the LayoutObject and DefinitionFilter envelopes
 *  that the exporter emits. These are IDE-only — the runtime JSON is
 *  consumed directly via the existing TypedValueEditor envelopes. */

export type TypedFloat = { type: 'float'; value: number };
export type TypedInt = { type: 'int'; value: number };
export type TypedBool = { type: 'bool'; value: boolean };
export type TypedString = { type: 'string'; value: string };

export type TypedVector = {
  type: 'struct';
  struct_name: 'Vector';
  value: { x: TypedFloat; y: TypedFloat; z: TypedFloat };
};

export type TypedRotator = {
  type: 'struct';
  struct_name: 'Rotator' | 'Quat';
  value: Record<string, TypedFloat>;
};

export type TypedTransform = {
  type: 'struct';
  struct_name: 'Transform';
  value: {
    translation: TypedVector;
    rotation: TypedRotator;
    scale_3d: TypedVector;
  };
};

export type ESearchQuery =
  | 'None'
  | 'HasAnyInclParents'
  | 'HasAnyExact'
  | 'HasAllInclParents'
  | 'HasAllExact';

export type ProxySearchTreeQuery = {
  type: 'struct';
  struct_name: 'ProxySearchTreeQuery';
  value: {
    search_query: { type: 'enum'; enum_name: 'ESearchQuery'; value: ESearchQuery };
    tags: { type: 'gameplay_tag_container'; value: string[] };
    b_not: TypedBool;
  };
};

export type DefinitionFilter = {
  type: 'struct';
  struct_name: 'DefinitionFilter';
  value: {
    seed_offset: TypedInt;
    search_queries: { type: 'array'; value: ProxySearchTreeQuery[]; element_type?: unknown };
    tile_requirements: { type: 'array'; value: ProxySearchTreeQuery[]; element_type?: unknown };
    spawn_chance_over: TypedFloat;
    spawn_chance_under: TypedFloat;
  };
};

export type ELayoutActorType =
  | 'ProxyActor'
  | 'Layout'
  | 'EnemySpawnPoint'
  | 'LootSpawnPoint'
  | 'VisualHelper';

export type DefinitionRef = {
  type: 'definition_ref';
  class: string;
  value: string;
};

export type LayoutObject = {
  type: 'struct';
  struct_name: 'LayoutObject';
  value: {
    layout_actor_type: { type: 'enum'; enum_name: 'ELayoutActorType' | 'LayoutActorType'; value: string };
    b_visual_helper: TypedBool;
    definition_filter: DefinitionFilter;
    furniture_definition?: DefinitionRef;
    layout_definition?: DefinitionRef;
    enemy_spawn_point_definition?: DefinitionRef;
    loot_spawn_point_definition?: DefinitionRef;
    transform: TypedTransform;
  };
};

/** Parsed enum value: the JSON shows enum values like
 *  `"<ELayoutActorType.PROXY_ACTOR: 0>"` or `"PROXY_ACTOR"`. This helper
 *  normalizes to our union string. */
export function parseLayoutActorType(raw: string): ELayoutActorType {
  const upper = raw.toUpperCase();
  if (upper.includes('PROXY_ACTOR')) return 'ProxyActor';
  if (upper.includes('LAYOUT')) return 'Layout';
  if (upper.includes('ENEMY_SPAWN')) return 'EnemySpawnPoint';
  if (upper.includes('LOOT_SPAWN')) return 'LootSpawnPoint';
  if (upper.includes('VISUAL_HELPER')) return 'VisualHelper';
  return 'ProxyActor';
}

export type ResolverStatus =
  | { kind: 'ok'; chosenDefinitionId: string; meshPath: string | null; bounds: { min: [number, number, number]; max: [number, number, number] } | null }
  | { kind: 'not-configured' }
  | { kind: 'filtered-by-tile-requirements' }
  | { kind: 'spawn-chance-skipped'; over: number; under: number }
  | { kind: 'no-matches' }
  | { kind: 'missing-mesh'; chosenDefinitionId: string }
  | { kind: 'cycle'; path: string[] };

export type ResolvedActor = {
  layoutObject: LayoutObject;
  actorType: ELayoutActorType;
  status: ResolverStatus;
  transform: TypedTransform;
  /** Populated only when actorType is 'Layout' and status is 'ok'. */
  children?: ResolvedActor[];
  /** Layout key in `definitionsStore.definitions`. */
  ownerLayoutKey: string;
  /** Index into the owner layout's `layout_objects.value` array. */
  ownerIndex: number;
};
```

- [ ] **Step 2: Typecheck**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/types.ts
git commit -m "feat(layouts): types for LayoutObject + DefinitionFilter + ResolvedActor"
```

---

## Phase 3: Resolver (the Visualise Furniture pipeline in TypeScript)

### Task 3.1: Mulberry32 PRNG

**Files:**
- Create: `web/src/components/layouts/resolver/randomStream.ts`
- Create: `web/tests/layoutRandomStream.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// web/tests/layoutRandomStream.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStream, pickFloat, pickIndex } from '../src/components/layouts/resolver/randomStream';

test('makeStream(seed) is deterministic — same seed yields same sequence', () => {
  const a = makeStream(42);
  const b = makeStream(42);
  for (let i = 0; i < 10; i++) {
    assert.equal(pickFloat(a), pickFloat(b));
  }
});

test('different seeds yield different sequences', () => {
  const a = makeStream(42);
  const b = makeStream(43);
  // Probabilistically improbable that the first three samples all match.
  let same = 0;
  for (let i = 0; i < 3; i++) {
    if (pickFloat(a) === pickFloat(b)) same++;
  }
  assert.ok(same < 3, 'expected at least one difference in first 3 samples');
});

test('pickFloat returns a number in [0, 1)', () => {
  const s = makeStream(0);
  for (let i = 0; i < 50; i++) {
    const v = pickFloat(s);
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('pickIndex returns a valid index for a non-empty array', () => {
  const s = makeStream(7);
  for (let i = 0; i < 20; i++) {
    const idx = pickIndex(s, 5);
    assert.ok(idx >= 0 && idx < 5, `out of range: ${idx}`);
  }
});

test('pickIndex on empty returns -1', () => {
  const s = makeStream(0);
  assert.equal(pickIndex(s, 0), -1);
});
```

- [ ] **Step 2: Run; verify FAIL** (`Cannot find module`)

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm test
```

- [ ] **Step 3: Implement**

```ts
// web/src/components/layouts/resolver/randomStream.ts
/** Mulberry32 PRNG. Deterministic same-seed → same sequence within the web
 *  editor. NOT byte-compatible with Unreal's FRandomStream — runtime
 *  determinism stays Unreal-side; the web editor is for authoring. */

export type RandomStream = { state: number };

export function makeStream(seed: number): RandomStream {
  // Mulberry32 needs a non-zero 32-bit seed.
  const s = (seed | 0) || 1;
  return { state: s >>> 0 };
}

export function pickFloat(s: RandomStream): number {
  s.state = (s.state + 0x6D2B79F5) | 0;
  let t = s.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pickIndex(s: RandomStream, length: number): number {
  if (length <= 0) return -1;
  return Math.floor(pickFloat(s) * length);
}

export function pickInRange(s: RandomStream, min: number, max: number): number {
  return min + pickFloat(s) * (max - min);
}
```

- [ ] **Step 4: Run tests; verify PASS**

```
npm test
```

Expected: 100 passed (95 + 5 new).

- [ ] **Step 5: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/resolver/randomStream.ts web/tests/layoutRandomStream.test.ts
git commit -m "feat(layouts): Mulberry32 PRNG for deterministic query resolution"
```

### Task 3.2: ProxySearchTreeQuery::QueryTags port

**Files:**
- Create: `web/src/components/layouts/resolver/proxySearchQuery.ts`
- Create: `web/tests/layoutProxySearchQuery.test.ts`

This ports `FProxySearchTreeQuery::QueryTags` from `C:/Users/Administrator/Documents/Unreal Projects/TSIC/Source/TSIC/Public/Structs/WorldGeneration/ProxySearchTreeQuery.h`. The four enum modes:
- `HasAnyInclParents` — tags-to-query has any of the query's tags OR any of their parents.
- `HasAnyExact` — tags-to-query has any of the query's tags (exact match only).
- `HasAllInclParents` — tags-to-query has all of the query's tags OR their parents.
- `HasAllExact` — tags-to-query has all of the query's tags (exact match only).
- `bNot = true` inverts the result.

"Parents" means dotted-tag ancestors: `Tile.Biome.Bathroom` is a child of `Tile.Biome` and `Tile`.

- [ ] **Step 1: Write failing tests**

```ts
// web/tests/layoutProxySearchQuery.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryMatches } from '../src/components/layouts/resolver/proxySearchQuery';
import type { ProxySearchTreeQuery } from '../src/components/layouts/types';

function mkQuery(search_query: string, tags: string[], b_not = false): ProxySearchTreeQuery {
  return {
    type: 'struct',
    struct_name: 'ProxySearchTreeQuery',
    value: {
      search_query: { type: 'enum', enum_name: 'ESearchQuery', value: search_query as any },
      tags: { type: 'gameplay_tag_container', value: tags },
      b_not: { type: 'bool', value: b_not },
    },
  };
}

test('HasAnyExact: matches when any query tag is present exactly', () => {
  const q = mkQuery('HasAnyExact', ['Tile.Biome.Bathroom']);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom']), true);
  assert.equal(queryMatches(q, ['Tile.Biome']), false);
  assert.equal(queryMatches(q, ['Other.Tag']), false);
});

test('HasAnyInclParents: matches when target carries a child of a query tag', () => {
  const q = mkQuery('HasAnyInclParents', ['Tile.Biome']);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom']), true);
  assert.equal(queryMatches(q, ['Tile.Biome']), true);
  assert.equal(queryMatches(q, ['Tile']), false);
});

test('HasAllInclParents: every query tag must be present (or via parent inclusion)', () => {
  const q = mkQuery('HasAllInclParents', ['Tile.Biome', 'Layout.Type.Tile']);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom', 'Layout.Type.Tile']), true);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom']), false);
});

test('HasAllExact: every query tag must match exactly', () => {
  const q = mkQuery('HasAllExact', ['A.B', 'C.D']);
  assert.equal(queryMatches(q, ['A.B', 'C.D', 'E.F']), true);
  assert.equal(queryMatches(q, ['A.B.X', 'C.D']), false);
});

test('bNot inverts the result', () => {
  const q = mkQuery('HasAnyExact', ['A.B'], true);
  assert.equal(queryMatches(q, ['A.B']), false);
  assert.equal(queryMatches(q, ['Other']), true);
});

test('empty query tags: HasAny* never matches; HasAll* always matches', () => {
  assert.equal(queryMatches(mkQuery('HasAnyExact', []), ['A']), false);
  assert.equal(queryMatches(mkQuery('HasAnyInclParents', []), ['A']), false);
  assert.equal(queryMatches(mkQuery('HasAllExact', []), ['A']), true);
  assert.equal(queryMatches(mkQuery('HasAllInclParents', []), ['A']), true);
});

test('None mode: always matches (parity with Unreal)', () => {
  const q = mkQuery('None', ['anything']);
  assert.equal(queryMatches(q, []), true);
});
```

- [ ] **Step 2: Run; verify FAIL**

```
npm test
```

- [ ] **Step 3: Implement**

```ts
// web/src/components/layouts/resolver/proxySearchQuery.ts
import type { ProxySearchTreeQuery, ESearchQuery } from '../types';

/** Returns true if `candidate` is `parent` or a dotted descendant. */
function isOrChild(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(parent + '.');
}

/** Does `targetTags` contain `query` (or one of its descendants when `inclParents`)? */
function targetHasTag(targetTags: string[], query: string, inclParents: boolean): boolean {
  if (!inclParents) return targetTags.includes(query);
  return targetTags.some((t) => isOrChild(t, query));
}

/** Port of FProxySearchTreeQuery::QueryTags. */
export function queryMatches(q: ProxySearchTreeQuery, targetTags: string[]): boolean {
  const mode = q.value.search_query.value as ESearchQuery;
  const queryTags = q.value.tags.value;
  const bNot = q.value.b_not.value;

  let raw: boolean;
  switch (mode) {
    case 'None':
      raw = true;
      break;
    case 'HasAnyExact':
      raw = queryTags.some((qt) => targetHasTag(targetTags, qt, false));
      break;
    case 'HasAnyInclParents':
      raw = queryTags.some((qt) => targetHasTag(targetTags, qt, true));
      break;
    case 'HasAllExact':
      raw = queryTags.every((qt) => targetHasTag(targetTags, qt, false));
      break;
    case 'HasAllInclParents':
      raw = queryTags.every((qt) => targetHasTag(targetTags, qt, true));
      break;
    default:
      raw = false;
  }
  return bNot ? !raw : raw;
}

/** Run a series of queries — returns true only when ALL queries match. */
export function allQueriesMatch(queries: ProxySearchTreeQuery[], targetTags: string[]): boolean {
  return queries.every((q) => queryMatches(q, targetTags));
}
```

- [ ] **Step 4: Run; verify PASS**

```
npm test
```

Expected: 107 passed (100 + 7 new).

- [ ] **Step 5: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/resolver/proxySearchQuery.ts web/tests/layoutProxySearchQuery.test.ts
git commit -m "feat(layouts): port FProxySearchTreeQuery::QueryTags to TypeScript"
```

### Task 3.3: Search tree — index definitions by gameplay tag

**Files:**
- Create: `web/src/components/layouts/resolver/searchTree.ts`
- Create: `web/tests/layoutSearchTree.test.ts`

A search tree maps each gameplay tag → list of definition refs that carry it. Built once per definitions load. The resolver consumes this to answer "give me all FurnitureDefinitions matching these queries."

- [ ] **Step 1: Write failing tests**

```ts
// web/tests/layoutSearchTree.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchTree, defsMatchingAllQueries } from '../src/components/layouts/resolver/searchTree';
import type { ProxySearchTreeQuery } from '../src/components/layouts/types';

function mkDef(id: string, klass: string, tags: string[]) {
  return {
    id,
    json: {
      id, asset_path: `/Game/${id}`,
      class: klass, parent_classes: [],
      properties: {
        gameplay_tags: { type: 'gameplay_tag_container', value: tags },
      },
    },
    dirty: false,
  } as any;
}

function mkQuery(mode: string, tags: string[], bNot = false): ProxySearchTreeQuery {
  return {
    type: 'struct', struct_name: 'ProxySearchTreeQuery',
    value: {
      search_query: { type: 'enum', enum_name: 'ESearchQuery', value: mode as any },
      tags: { type: 'gameplay_tag_container', value: tags },
      b_not: { type: 'bool', value: bNot },
    },
  };
}

test('buildSearchTree indexes definitions by tag', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom', 'Entity.Door'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_C', mkDef('FD_C', 'UFurnitureDefinition', ['Entity.Door'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  assert.equal(tree.allDefIds.length, 3);
});

test('defsMatchingAllQueries with HasAnyInclParents picks both bathroom defs', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_C', mkDef('FD_C', 'UFurnitureDefinition', ['Tile.Biome.Carpark'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const q = [mkQuery('HasAnyInclParents', ['Tile.Biome.Bathroom'])];
  const matches = defsMatchingAllQueries(tree, q);
  assert.deepEqual(matches.map((d) => d.id).sort(), ['FD_A', 'FD_B']);
});

test('bNot filters out matching defs', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Carpark'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const q = [mkQuery('HasAnyExact', ['Tile.Biome.Bathroom'], true)];
  const matches = defsMatchingAllQueries(tree, q);
  assert.deepEqual(matches.map((d) => d.id), ['FD_B']);
});

test('two AND queries: both must match', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom', 'Entity.Door'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_C', mkDef('FD_C', 'UFurnitureDefinition', ['Entity.Door'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const q = [
    mkQuery('HasAnyInclParents', ['Tile.Biome.Bathroom']),
    mkQuery('HasAnyInclParents', ['Entity.Door']),
  ];
  const matches = defsMatchingAllQueries(tree, q);
  assert.deepEqual(matches.map((d) => d.id), ['FD_A']);
});

test('empty queries: every def matches', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const matches = defsMatchingAllQueries(tree, []);
  assert.equal(matches.length, 1);
});

test('different class filter excludes non-matching defs', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tag'])],
    ['LYD_X', mkDef('LYD_X', 'ULayoutDefinition', ['Tag'])],
  ]);
  const fTree = buildSearchTree(defs, 'UFurnitureDefinition');
  assert.equal(fTree.allDefIds.length, 1);
  assert.equal(fTree.allDefIds[0], 'FD_A');
});
```

- [ ] **Step 2: Run; verify FAIL**

```
npm test
```

- [ ] **Step 3: Implement**

```ts
// web/src/components/layouts/resolver/searchTree.ts
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

/** Build a search tree of every definition whose `class` matches `klass` (or
 *  its bareName equivalent). Pulls `gameplay_tags` off each. */
export function buildSearchTree(
  defs: Map<string, { id: string; json: any; dirty: boolean }>,
  klass: string,
): SearchTree {
  const bareKlass = klass.startsWith('U') ? klass.slice(1) : klass;
  const allDefs: SearchTreeDef[] = [];
  for (const [, rec] of defs) {
    const recClass = rec.json?.class;
    if (recClass !== klass && recClass !== bareKlass) continue;
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
```

- [ ] **Step 4: Run; verify PASS**

```
npm test
```

Expected: 113 passed (107 + 6 new).

- [ ] **Step 5: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/resolver/searchTree.ts web/tests/layoutSearchTree.test.ts
git commit -m "feat(layouts): SearchTree indexes definitions by gameplay-tag"
```

### Task 3.4: Top-level resolver

**Files:**
- Create: `web/src/components/layouts/resolver/resolver.ts`
- Create: `web/tests/layoutResolver.test.ts`

`resolve(layoutObject, ctx, seed)` runs every gate from the spec's status table.

- [ ] **Step 1: Write failing tests**

```ts
// web/tests/layoutResolver.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/components/layouts/resolver/resolver';
import { buildSearchTree } from '../src/components/layouts/resolver/searchTree';
import type { LayoutObject } from '../src/components/layouts/types';

function mkDef(id: string, klass: string, tags: string[], extra: any = {}) {
  return {
    id, json: {
      id, asset_path: `/Game/${id}`, class: klass, parent_classes: [],
      properties: {
        gameplay_tags: { type: 'gameplay_tag_container', value: tags },
        ...extra,
      },
    }, dirty: false,
  } as any;
}

function mkLayoutObject(over: Partial<LayoutObject['value']> = {}): LayoutObject {
  return {
    type: 'struct', struct_name: 'LayoutObject',
    value: {
      layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: 'PROXY_ACTOR' },
      b_visual_helper: { type: 'bool', value: false },
      definition_filter: {
        type: 'struct', struct_name: 'DefinitionFilter',
        value: {
          seed_offset: { type: 'int', value: -1 },
          search_queries: { type: 'array', value: [] as any },
          tile_requirements: { type: 'array', value: [] as any },
          spawn_chance_over: { type: 'float', value: 0 },
          spawn_chance_under: { type: 'float', value: 1 },
        },
      },
      transform: {
        type: 'struct', struct_name: 'Transform',
        value: {
          translation: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 0 }, y: { type: 'float', value: 0 }, z: { type: 'float', value: 0 } } },
          rotation: { type: 'struct', struct_name: 'Rotator', value: { pitch: { type: 'float', value: 0 }, yaw: { type: 'float', value: 0 }, roll: { type: 'float', value: 0 } } },
          scale_3d: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 1 }, y: { type: 'float', value: 1 }, z: { type: 'float', value: 1 } } },
        },
      },
      ...over,
    },
  };
}

test('not-configured: no ref and no queries', () => {
  const lo = mkLayoutObject();
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: ['Tile.Biome.X'], seed: 0,
    definitions: new Map(),
    catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'not-configured');
});

test('filtered-by-tile-requirements: tile reqs do not match', () => {
  const lo = mkLayoutObject({
    definition_filter: {
      type: 'struct', struct_name: 'DefinitionFilter',
      value: {
        seed_offset: { type: 'int', value: -1 },
        search_queries: { type: 'array', value: [{
          type: 'struct', struct_name: 'ProxySearchTreeQuery',
          value: {
            search_query: { type: 'enum', enum_name: 'ESearchQuery', value: 'HasAnyExact' },
            tags: { type: 'gameplay_tag_container', value: ['Entity.Door'] },
            b_not: { type: 'bool', value: false },
          },
        }] as any },
        tile_requirements: { type: 'array', value: [{
          type: 'struct', struct_name: 'ProxySearchTreeQuery',
          value: {
            search_query: { type: 'enum', enum_name: 'ESearchQuery', value: 'HasAnyExact' },
            tags: { type: 'gameplay_tag_container', value: ['Tile.Biome.Required'] },
            b_not: { type: 'bool', value: false },
          },
        }] as any },
        spawn_chance_over: { type: 'float', value: 0 },
        spawn_chance_under: { type: 'float', value: 1 },
      },
    },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Entity.Door'])]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: ['Tile.Biome.Other'], seed: 0,
    definitions: defs, catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'filtered-by-tile-requirements');
});

test('spawn-chance-skipped: roll outside range', () => {
  const lo = mkLayoutObject({
    furniture_definition: { type: 'definition_ref', class: 'FurnitureDefinition', value: 'FD_A' },
    definition_filter: {
      type: 'struct', struct_name: 'DefinitionFilter',
      value: {
        seed_offset: { type: 'int', value: -1 },
        search_queries: { type: 'array', value: [] as any },
        tile_requirements: { type: 'array', value: [] as any },
        spawn_chance_over: { type: 'float', value: 0.9 },
        spawn_chance_under: { type: 'float', value: 1.0 },
      },
    },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', [], { static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/M.M' } })]]);
  // With seed=1, the first roll is well below 0.9
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 1,
    definitions: defs,
    catalogLookup: () => ({ path: '/Game/M.M', name: 'M', folder: '/Game', package_guid: '', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }),
  });
  assert.equal(r.status.kind, 'spawn-chance-skipped');
});

test('no-matches: search queries find zero defs', () => {
  const lo = mkLayoutObject({
    definition_filter: {
      type: 'struct', struct_name: 'DefinitionFilter',
      value: {
        seed_offset: { type: 'int', value: -1 },
        search_queries: { type: 'array', value: [{
          type: 'struct', struct_name: 'ProxySearchTreeQuery',
          value: {
            search_query: { type: 'enum', enum_name: 'ESearchQuery', value: 'HasAnyExact' },
            tags: { type: 'gameplay_tag_container', value: ['Nonexistent'] },
            b_not: { type: 'bool', value: false },
          },
        }] as any },
        tile_requirements: { type: 'array', value: [] as any },
        spawn_chance_over: { type: 'float', value: 0 },
        spawn_chance_under: { type: 'float', value: 1 },
      },
    },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Other'])]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs, catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'no-matches');
});

test('ok: direct furniture ref with mesh', () => {
  const lo = mkLayoutObject({
    furniture_definition: { type: 'definition_ref', class: 'FurnitureDefinition', value: 'FD_A' },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', [], { static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/M.M' } })]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs,
    catalogLookup: (cls, path) => cls === 'StaticMesh' && path === '/Game/M.M'
      ? { path, name: 'M', folder: '/Game', package_guid: '', bounds: { min: [0, 0, 0], max: [1, 1, 1] } } : null,
  });
  assert.equal(r.status.kind, 'ok');
  if (r.status.kind === 'ok') {
    assert.equal(r.status.chosenDefinitionId, 'FD_A');
    assert.equal(r.status.meshPath, '/Game/M.M');
    assert.deepEqual(r.status.bounds, { min: [0, 0, 0], max: [1, 1, 1] });
  }
});

test('missing-mesh: chosen def has no static_mesh ref', () => {
  const lo = mkLayoutObject({
    furniture_definition: { type: 'definition_ref', class: 'FurnitureDefinition', value: 'FD_A' },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', [])]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs, catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'missing-mesh');
});

test('cycle: nested layout refs itself', () => {
  const innerLO = mkLayoutObject({
    layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: 'LAYOUT' },
    layout_definition: { type: 'definition_ref', class: 'LayoutDefinition', value: 'LYD_X' },
  });
  const layoutJson = {
    id: 'LYD_X', asset_path: '/Game/LYD_X', class: 'ULayoutDefinition', parent_classes: [],
    properties: {
      gameplay_tags: { type: 'gameplay_tag_container', value: [] },
      layout_objects: { type: 'array', value: [innerLO] },
    },
  };
  const defs = new Map([['LYD_X', { id: 'LYD_X', json: layoutJson, dirty: false } as any]]);

  const outerLO = mkLayoutObject({
    layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: 'LAYOUT' },
    layout_definition: { type: 'definition_ref', class: 'LayoutDefinition', value: 'LYD_X' },
  });
  const r = resolve({
    layoutObject: outerLO, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs, catalogLookup: () => null,
    visitedLayouts: new Set(['LYD_X']),  // simulate we already entered it
  });
  assert.equal(r.status.kind, 'cycle');
});
```

- [ ] **Step 2: Run; verify FAIL**

```
npm test
```

- [ ] **Step 3: Implement**

```ts
// web/src/components/layouts/resolver/resolver.ts
import type {
  LayoutObject,
  ResolvedActor,
  ResolverStatus,
  TypedTransform,
  ELayoutActorType,
  DefinitionRef,
} from '../types';
import { parseLayoutActorType } from '../types';
import type { AssetCatalogEntry } from '../../../persistence/dataSource';
import { allQueriesMatch } from './proxySearchQuery';
import { buildSearchTree, defsMatchingAllQueries } from './searchTree';
import { makeStream, pickFloat, pickIndex } from './randomStream';

export type ResolveContext = {
  layoutObject: LayoutObject;
  ownerLayoutKey: string;
  ownerIndex: number;
  tileTags: string[];
  seed: number;
  definitions: Map<string, { id: string; json: any; dirty: boolean }>;
  /** Returns the catalog entry for `cls` + `path`, or null when absent. */
  catalogLookup: (cls: string, path: string) => AssetCatalogEntry | null;
  /** Names of layouts already entered higher in the recursion. Used for
   *  cycle detection. Top-level callers pass undefined or an empty Set. */
  visitedLayouts?: Set<string>;
};

const KLASS_BY_TYPE: Record<Exclude<ELayoutActorType, 'VisualHelper'>, string> = {
  ProxyActor: 'UFurnitureDefinition',
  Layout: 'ULayoutDefinition',
  EnemySpawnPoint: 'UEnemySpawnPointDefinition',
  LootSpawnPoint: 'ULootSpawnPointDefinition',
};

const REF_KEY_BY_TYPE: Record<Exclude<ELayoutActorType, 'VisualHelper'>, keyof LayoutObject['value']> = {
  ProxyActor: 'furniture_definition',
  Layout: 'layout_definition',
  EnemySpawnPoint: 'enemy_spawn_point_definition',
  LootSpawnPoint: 'loot_spawn_point_definition',
};

export function resolve(ctx: ResolveContext): ResolvedActor {
  const lo = ctx.layoutObject;
  const actorType = parseLayoutActorType(lo.value.layout_actor_type.value);

  const out: ResolvedActor = {
    layoutObject: lo,
    actorType,
    status: { kind: 'ok', chosenDefinitionId: '', meshPath: null, bounds: null } as ResolverStatus,
    transform: lo.value.transform,
    ownerLayoutKey: ctx.ownerLayoutKey,
    ownerIndex: ctx.ownerIndex,
  };

  // VisualHelper renders but doesn't resolve a target.
  if (actorType === 'VisualHelper' || lo.value.b_visual_helper.value === true) {
    out.status = { kind: 'ok', chosenDefinitionId: '', meshPath: null, bounds: null };
    return out;
  }

  const filter = lo.value.definition_filter.value;
  const refKey = REF_KEY_BY_TYPE[actorType as Exclude<ELayoutActorType, 'VisualHelper'>];
  const directRef = lo.value[refKey] as DefinitionRef | undefined;
  const hasDirectRef = directRef && typeof directRef.value === 'string' && directRef.value.length > 0;
  const queries = filter.search_queries.value;
  const tileReqs = filter.tile_requirements.value;

  // Not-configured: no ref AND no queries.
  if (!hasDirectRef && queries.length === 0) {
    out.status = { kind: 'not-configured' };
    return out;
  }

  // Tile requirements gate.
  if (tileReqs.length > 0 && !allQueriesMatch(tileReqs, ctx.tileTags)) {
    out.status = { kind: 'filtered-by-tile-requirements' };
    return out;
  }

  // Spawn chance gate. Use a stream seeded by (seed + seed_offset + ownerIndex)
  // so different actors roll independently but reproducibly.
  const seedOffset = filter.seed_offset.value;
  const baseSeed = (ctx.seed | 0) + (seedOffset === -1 ? ctx.ownerIndex : seedOffset);
  const stream = makeStream(baseSeed);
  const roll = pickFloat(stream);
  const over = filter.spawn_chance_over.value;
  const under = filter.spawn_chance_under.value;
  if (roll < over || roll >= under) {
    out.status = { kind: 'spawn-chance-skipped', over, under };
    return out;
  }

  // Pick a definition.
  let chosenDefId: string | null = null;
  if (hasDirectRef && directRef) {
    chosenDefId = directRef.value;
  } else {
    // Run search queries against the appropriate class's defs.
    const klass = KLASS_BY_TYPE[actorType as Exclude<ELayoutActorType, 'VisualHelper'>];
    const tree = buildSearchTree(ctx.definitions, klass);
    const matches = defsMatchingAllQueries(tree, queries);
    if (matches.length === 0) {
      out.status = { kind: 'no-matches' };
      return out;
    }
    const idx = pickIndex(stream, matches.length);
    chosenDefId = matches[idx].id;
  }

  // VisualHelper handled above; the remaining cases need rendering data.
  if (actorType === 'ProxyActor') {
    // Look up mesh + bounds via the catalog.
    const defRec = ctx.definitions.get(chosenDefId);
    const sm = defRec?.json?.properties?.static_mesh;
    const meshPath = (sm?.value as string | null | undefined) ?? null;
    if (!meshPath) {
      out.status = { kind: 'missing-mesh', chosenDefinitionId: chosenDefId };
      return out;
    }
    const entry = ctx.catalogLookup('StaticMesh', meshPath);
    out.status = {
      kind: 'ok',
      chosenDefinitionId: chosenDefId,
      meshPath,
      bounds: entry?.bounds ?? null,
    };
    return out;
  }

  if (actorType === 'Layout') {
    const visited = ctx.visitedLayouts ?? new Set<string>();
    if (visited.has(chosenDefId)) {
      out.status = { kind: 'cycle', path: [...visited, chosenDefId] };
      return out;
    }
    const innerVisited = new Set(visited);
    innerVisited.add(chosenDefId);
    // Recurse into the inner layout's objects.
    const innerRec = ctx.definitions.get(chosenDefId);
    const innerObjs = (innerRec?.json?.properties?.layout_objects?.value as LayoutObject[] | undefined) ?? [];
    const children: ResolvedActor[] = innerObjs.map((inner, i) => resolve({
      layoutObject: inner,
      ownerLayoutKey: chosenDefId!,
      ownerIndex: i,
      tileTags: ctx.tileTags,
      seed: ctx.seed,
      definitions: ctx.definitions,
      catalogLookup: ctx.catalogLookup,
      visitedLayouts: innerVisited,
    }));
    out.status = { kind: 'ok', chosenDefinitionId: chosenDefId, meshPath: null, bounds: null };
    out.children = children;
    return out;
  }

  // EnemySpawnPoint / LootSpawnPoint: just record the chosen def.
  out.status = { kind: 'ok', chosenDefinitionId: chosenDefId, meshPath: null, bounds: null };
  return out;
}
```

- [ ] **Step 4: Run; verify PASS**

```
npm test
```

Expected: 120 passed (113 + 7 new).

- [ ] **Step 5: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/resolver/resolver.ts web/tests/layoutResolver.test.ts
git commit -m "feat(layouts): resolver ports VisualiseFurniture pipeline to TS"
```

---

## Phase 4: Stores

### Task 4.1: `layoutResolverStore`

**Files:**
- Create: `web/src/store/layoutResolverStore.ts`

Caches resolver outputs per `(layoutKey, seed, tileTags-hash)`. Invalidated when definitions change or when the cached layout is dirtied.

- [ ] **Step 1: Implement**

```ts
// web/src/store/layoutResolverStore.ts
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
        definitions,
        catalogLookup,
        visitedLayouts: new Set([layoutKey]),
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
```

- [ ] **Step 2: Verify typecheck**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/store/layoutResolverStore.ts
git commit -m "feat(layouts): layoutResolverStore caches resolved actors"
```

### Task 4.2: `layoutEditorStore`

**Files:**
- Create: `web/src/store/layoutEditorStore.ts`

Holds Layouts-tab-specific UI state: selected layout, multi-selection indices, gizmo mode, seed, tile tag override.

- [ ] **Step 1: Implement**

```ts
// web/src/store/layoutEditorStore.ts
import { create } from 'zustand';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

type State = {
  selectedLayoutKey: string | null;
  selectedIndices: number[];
  gizmoMode: GizmoMode;
  seed: number;
  /** When empty, the resolver should use the layout's own gameplay_tags. */
  tileTagsOverride: string[];
  setLayout: (key: string | null) => void;
  setSelection: (indices: number[]) => void;
  toggleSelection: (index: number) => void;
  extendSelection: (toIndex: number) => void;
  clearSelection: () => void;
  setGizmoMode: (m: GizmoMode) => void;
  setSeed: (n: number) => void;
  rerollSeed: () => void;
  setTileTagsOverride: (t: string[]) => void;
};

export const useLayoutEditorStore = create<State>((set, get) => ({
  selectedLayoutKey: null,
  selectedIndices: [],
  gizmoMode: 'translate',
  seed: -1,
  tileTagsOverride: [],

  setLayout: (key) => set({ selectedLayoutKey: key, selectedIndices: [] }),
  setSelection: (indices) => set({ selectedIndices: indices }),
  toggleSelection: (i) => {
    const cur = get().selectedIndices;
    set({ selectedIndices: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] });
  },
  extendSelection: (toIndex) => {
    const cur = get().selectedIndices;
    if (cur.length === 0) { set({ selectedIndices: [toIndex] }); return; }
    const last = cur[cur.length - 1];
    const lo = Math.min(last, toIndex), hi = Math.max(last, toIndex);
    const range: number[] = [];
    for (let i = lo; i <= hi; i++) range.push(i);
    set({ selectedIndices: range });
  },
  clearSelection: () => set({ selectedIndices: [] }),
  setGizmoMode: (m) => set({ gizmoMode: m }),
  setSeed: (n) => set({ seed: n | 0 }),
  rerollSeed: () => set((s) => ({ seed: (s.seed === -1 ? 0 : s.seed) + 1 })),
  setTileTagsOverride: (t) => set({ tileTagsOverride: t }),
}));
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

- [ ] **Step 3: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/store/layoutEditorStore.ts
git commit -m "feat(layouts): layoutEditorStore for selection + gizmo + preview controls"
```

### Task 4.3: Register `layouts` tab in appStore

**Files:**
- Modify: `web/src/store/appStore.ts`
- Modify: `web/src/components/Header.tsx`

- [ ] **Step 1: Edit `appStore.ts`** — add `'layouts'` to the `AppTab` union. Find:

```ts
export type AppTab = 'recipes-loot' | 'items' | 'furniture' | 'definitions' | 'validations';
```

Change to:

```ts
export type AppTab = 'recipes-loot' | 'items' | 'furniture' | 'definitions' | 'layouts' | 'validations';
```

- [ ] **Step 2: Edit `Header.tsx`** — find the tab buttons block (look for `setTab(`) and add a Layouts button alongside the others. Mirror the existing button's class names + spacing:

```tsx
<button onClick={() => setTab('layouts')} className={tab === 'layouts' ? 'active' : ''}>Layouts</button>
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

Expected: clean. Any tab consumer that exhaustively switches `AppTab` will need the `'layouts'` case added — fix those inline.

- [ ] **Step 4: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/store/appStore.ts web/src/components/Header.tsx
git commit -m "feat(layouts): wire 'layouts' tab into appStore + Header"
```

---

## Phase 5: Layouts tab shell

### Task 5.1: `LayoutsTab` + empty Toolbar

**Files:**
- Create: `web/src/components/layouts/LayoutsTab.tsx`
- Create: `web/src/components/layouts/Toolbar.tsx`
- Modify: `web/src/App.tsx` (mount `<LayoutsTab />` when `tab === 'layouts'`)

- [ ] **Step 1: Create `LayoutsTab.tsx`**

```tsx
// web/src/components/layouts/LayoutsTab.tsx
import { Toolbar } from './Toolbar';

export function LayoutsTab() {
  return (
    <div className="layouts-tab">
      <Toolbar />
      <div className="layouts-panes">
        <div className="layouts-outliner">{/* Outliner placeholder */}</div>
        <div className="layouts-viewport">{/* Viewport placeholder */}</div>
        <div className="layouts-details">{/* Details placeholder */}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `Toolbar.tsx` skeleton**

```tsx
// web/src/components/layouts/Toolbar.tsx
import { useLayoutEditorStore } from '../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../store/definitionsStore';

export function Toolbar() {
  const selectedLayoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const setLayout = useLayoutEditorStore((s) => s.setLayout);
  const seed = useLayoutEditorStore((s) => s.seed);
  const setSeed = useLayoutEditorStore((s) => s.setSeed);
  const rerollSeed = useLayoutEditorStore((s) => s.rerollSeed);
  const definitions = useDefinitionsStore((s) => s.definitions);

  const layouts = [...definitions.values()]
    .filter((d) => d.json?.class === 'ULayoutDefinition' || d.json?.class === 'LayoutDefinition')
    .map((d) => d.id)
    .sort();

  return (
    <div className="layouts-toolbar">
      <select
        value={selectedLayoutKey ?? ''}
        onChange={(e) => setLayout(e.target.value || null)}
      >
        <option value="">— pick a layout —</option>
        {layouts.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      <label className="layouts-toolbar-seed">
        Seed
        <input
          type="number"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
        />
      </label>
      <button onClick={rerollSeed}>Reroll</button>
    </div>
  );
}
```

- [ ] **Step 3: Add CSS** in `web/src/styles.css` (append at the bottom):

```css
.layouts-tab { display: flex; flex-direction: column; height: 100%; }
.layouts-toolbar { display: flex; gap: 0.5em; padding: 0.5em; align-items: center; border-bottom: 1px solid var(--border, #444); }
.layouts-toolbar-seed { display: inline-flex; gap: 0.25em; align-items: center; }
.layouts-toolbar-seed input { width: 6em; padding: 0.15em 0.4em; background: transparent; border: 1px solid var(--border, #444); border-radius: 0.25em; }
.layouts-panes { display: grid; grid-template-columns: 220px 1fr 320px; flex: 1; min-height: 0; }
.layouts-outliner { border-right: 1px solid var(--border, #444); overflow-y: auto; }
.layouts-viewport { background: #111; min-height: 0; }
.layouts-details { border-left: 1px solid var(--border, #444); overflow-y: auto; }
```

- [ ] **Step 4: Edit `App.tsx`** — find the tab-switch render block (probably a switch on `tab`) and add:

```tsx
import { LayoutsTab } from './components/layouts/LayoutsTab';

// In the tab dispatch:
{tab === 'layouts' && <LayoutsTab />}
```

- [ ] **Step 5: Typecheck + dev sanity**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm run typecheck
npm run dev
```

Click the new "Layouts" tab. Confirm the empty shell appears with the layout dropdown populated by ~251 `LYD_*` entries (post-Phase-1).

- [ ] **Step 6: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/ web/src/App.tsx web/src/styles.css
git commit -m "feat(layouts): tab shell + toolbar with layout picker + seed"
```

### Task 5.2: Outliner

**Files:**
- Create: `web/src/components/layouts/Outliner/Outliner.tsx`
- Create: `web/src/components/layouts/Outliner/OutlinerRow.tsx`
- Create: `web/src/components/layouts/Outliner/icons.tsx`
- Modify: `web/src/components/layouts/LayoutsTab.tsx` (mount the Outliner)

- [ ] **Step 1: Create `icons.tsx`** with five small SVG icons (one per `ELayoutActorType`):

```tsx
// web/src/components/layouts/Outliner/icons.tsx
import type { ELayoutActorType } from '../types';

export function TypeIcon({ kind }: { kind: ELayoutActorType }) {
  const c = kind === 'Layout' ? '#5af' :
            kind === 'EnemySpawnPoint' ? '#f55' :
            kind === 'LootSpawnPoint' ? '#fc4' :
            kind === 'VisualHelper' ? '#aaa' :
            '#ccc';
  if (kind === 'Layout') {
    // Nested-layout: two stacked rectangles
    return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="3" width="10" height="8" stroke={c} fill="none"/><rect x="4" y="5" width="6" height="4" stroke={c} fill="none"/></svg>;
  }
  if (kind === 'EnemySpawnPoint') {
    return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" stroke={c} fill="none"/><line x1="7" y1="2" x2="7" y2="12" stroke={c}/></svg>;
  }
  if (kind === 'LootSpawnPoint') {
    return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="7,2 12,5 12,11 7,12 2,11 2,5" stroke={c} fill="none"/></svg>;
  }
  if (kind === 'VisualHelper') {
    return <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7 Q7 2 12 7 Q7 12 2 7" stroke={c} fill="none"/><circle cx="7" cy="7" r="1" fill={c}/></svg>;
  }
  // ProxyActor — a simple cube outline
  return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="3" width="8" height="8" stroke={c} fill="none"/></svg>;
}
```

- [ ] **Step 2: Create `OutlinerRow.tsx`**

```tsx
// web/src/components/layouts/Outliner/OutlinerRow.tsx
import { TypeIcon } from './icons';
import type { ResolvedActor } from '../types';

type Props = {
  resolved: ResolvedActor;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
};

function deriveName(r: ResolvedActor): string {
  const lo = r.layoutObject.value;
  switch (r.actorType) {
    case 'ProxyActor': {
      const ref = lo.furniture_definition?.value;
      if (ref) return `Proxy: ${ref}`;
      const qCount = lo.definition_filter.value.search_queries.value.length;
      return `Proxy: SearchQuery (${qCount} ${qCount === 1 ? 'tag' : 'tags'})`;
    }
    case 'Layout':
      return `Layout: ${lo.layout_definition?.value ?? '(unset)'}`;
    case 'EnemySpawnPoint':
      return `EnemySpawn: ${lo.enemy_spawn_point_definition?.value ?? '(unset)'}`;
    case 'LootSpawnPoint':
      return `LootSpawn: ${lo.loot_spawn_point_definition?.value ?? '(unset)'}`;
    case 'VisualHelper':
      return 'Visual Helper';
  }
}

export function OutlinerRow({ resolved, selected, onClick }: Props) {
  const name = deriveName(resolved);
  const isError = resolved.status.kind !== 'ok' && resolved.status.kind !== 'spawn-chance-skipped' && resolved.status.kind !== 'filtered-by-tile-requirements';
  return (
    <div
      className={`outliner-row${selected ? ' selected' : ''}`}
      onClick={onClick}
    >
      <TypeIcon kind={resolved.actorType} />
      <span className="outliner-row-name">{name}</span>
      {isError && <span className="outliner-row-error" title={resolved.status.kind} />}
    </div>
  );
}
```

- [ ] **Step 3: Create `Outliner.tsx`**

```tsx
// web/src/components/layouts/Outliner/Outliner.tsx
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useLayoutResolverStore } from '../../../store/layoutResolverStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { OutlinerRow } from './OutlinerRow';

export function Outliner() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const seed = useLayoutEditorStore((s) => s.seed);
  const tileTagsOverride = useLayoutEditorStore((s) => s.tileTagsOverride);
  const selected = useLayoutEditorStore((s) => s.selectedIndices);
  const setSelection = useLayoutEditorStore((s) => s.setSelection);
  const toggleSelection = useLayoutEditorStore((s) => s.toggleSelection);
  const extendSelection = useLayoutEditorStore((s) => s.extendSelection);
  const resolveLayout = useLayoutResolverStore((s) => s.resolveLayout);

  if (!layoutKey) return <div className="outliner-empty">No layout selected.</div>;

  const layoutRec = useDefinitionsStore.getState().definitions.get(layoutKey);
  const tileTags = tileTagsOverride.length > 0
    ? tileTagsOverride
    : (layoutRec?.json?.properties?.gameplay_tags?.value as string[] | undefined) ?? [];
  const resolved = resolveLayout(layoutKey, seed, tileTags);

  return (
    <div className="outliner">
      {resolved.map((r, i) => (
        <OutlinerRow
          key={i}
          resolved={r}
          selected={selected.includes(i)}
          onClick={(e) => {
            if (e.shiftKey) extendSelection(i);
            else if (e.ctrlKey || e.metaKey) toggleSelection(i);
            else setSelection([i]);
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `LayoutsTab.tsx`** — replace the `{/* Outliner placeholder */}` comment with `<Outliner />` (import accordingly).

- [ ] **Step 5: CSS** in `styles.css`:

```css
.outliner-empty { padding: 0.5em; opacity: 0.6; font-style: italic; }
.outliner-row { display: flex; align-items: center; gap: 0.4em; padding: 0.25em 0.5em; cursor: pointer; }
.outliner-row:hover { background: var(--def-bg-hover, #222); }
.outliner-row.selected { background: var(--accent, #2a4a6a); }
.outliner-row-name { flex: 1; font-size: 0.9em; }
.outliner-row-error { width: 0.5em; height: 0.5em; background: #f44; border-radius: 50%; }
```

- [ ] **Step 6: Typecheck + dev sanity**

```
npm run typecheck
npm run dev
```

Pick `LYD_Bathroom_All` in the toolbar. Outliner should list ~30 rows. Click rows; selection highlight should update.

- [ ] **Step 7: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/ web/src/styles.css
git commit -m "feat(layouts): Outliner with type icons + selection"
```

### Task 5.3: Details panel

**Files:**
- Create: `web/src/components/layouts/Details/DetailsPanel.tsx`
- Modify: `web/src/components/layouts/LayoutsTab.tsx`

- [ ] **Step 1: Create `DetailsPanel.tsx`**

```tsx
// web/src/components/layouts/Details/DetailsPanel.tsx
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { useAppSchemaStore } from '../../../store/appSchemaStore';
import { TypedPropertiesEditor, type RefAdapter } from '../../TypedValueEditor';

export function DetailsPanel() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const selectedIndices = useLayoutEditorStore((s) => s.selectedIndices);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const getPropertyMeta = useAppSchemaStore((s) => s.getPropertyMeta);
  const lookupContainerType = useAppSchemaStore((s) => s.lookupContainerType);
  const lookupArrayElementClass = useAppSchemaStore((s) => s.lookupArrayElementClass);
  const getEnumMembers = useAppSchemaStore((s) => s.getEnumMembers);

  if (!layoutKey || selectedIndices.length === 0) {
    return <div className="details-empty">Select an actor to edit its properties.</div>;
  }

  const layoutRec = definitions.get(layoutKey);
  const objects = (layoutRec?.json?.properties?.layout_objects?.value as any[] | undefined) ?? [];

  // Single-select first; multi-select is Task 5.5 (deferred).
  const idx = selectedIndices[0];
  const lo = objects[idx];
  if (!lo) return <div className="details-empty">(stale selection)</div>;

  const refAdapter: RefAdapter = {
    getPropertyMeta,
    lookupContainerType,
    lookupArrayElementClass,
    getEnumMembers,
  } as RefAdapter;

  return (
    <div className="details-panel">
      <TypedPropertiesEditor
        properties={lo.value}
        onChange={(next) => {
          updateValueAtPath(layoutKey, ['properties', 'layout_objects', 'value', idx, 'value'], next);
        }}
        refAdapter={refAdapter}
        showAllFields={true}
        parentTypeName="LayoutObject"
      />
    </div>
  );
}
```

If `RefAdapter` doesn't expose exactly those fields, copy the existing usage from `DefinitionsTab.tsx` — the adapter shape there is the canonical reference.

- [ ] **Step 2: Wire into `LayoutsTab.tsx`** — replace `{/* Details placeholder */}` with `<DetailsPanel />`.

- [ ] **Step 3: CSS**

```css
.details-empty { padding: 1em; opacity: 0.6; font-style: italic; }
.details-panel { padding: 0.5em; }
```

- [ ] **Step 4: Typecheck + dev sanity**

```
npm run typecheck
npm run dev
```

Select an outliner row in `LYD_Bathroom_All`. Confirm the Details panel renders the LayoutObject's properties (transform expanded as struct rows, ref pickers, etc.).

- [ ] **Step 5: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/Details/ web/src/components/layouts/LayoutsTab.tsx web/src/styles.css
git commit -m "feat(layouts): Details panel via TypedPropertiesEditor"
```

---

## Phase 6: 3D viewport

### Task 6.1: `Viewport` host

**Files:**
- Create: `web/src/components/layouts/Viewport/Viewport.tsx`
- Modify: `web/src/components/layouts/LayoutsTab.tsx`

- [ ] **Step 1: Implement `Viewport.tsx`**

```tsx
// web/src/components/layouts/Viewport/Viewport.tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useLayoutResolverStore } from '../../../store/layoutResolverStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';
import { LayoutObjectMesh } from './LayoutObjectMesh';

export function Viewport() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const seed = useLayoutEditorStore((s) => s.seed);
  const tileTagsOverride = useLayoutEditorStore((s) => s.tileTagsOverride);

  if (!layoutKey) {
    return <div className="viewport-empty">No layout selected.</div>;
  }

  const layoutRec = useDefinitionsStore.getState().definitions.get(layoutKey);
  const tileTags = tileTagsOverride.length > 0
    ? tileTagsOverride
    : (layoutRec?.json?.properties?.gameplay_tags?.value as string[] | undefined) ?? [];
  const resolved = useLayoutResolverStore.getState().resolveLayout(layoutKey, seed, tileTags);

  return (
    <Canvas camera={{ position: [800, 800, 800], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[400, 600, 200]} intensity={0.6} />
      <Grid args={[2000, 2000]} cellColor="#333" sectionColor="#555" infiniteGrid />
      {resolved.map((r, i) => <LayoutObjectMesh key={i} resolved={r} index={i} />)}
      <OrbitControls makeDefault />
    </Canvas>
  );
}
```

- [ ] **Step 2: Wire into `LayoutsTab.tsx`** — replace `{/* Viewport placeholder */}` with `<Viewport />`.

- [ ] **Step 3: CSS**

```css
.viewport-empty { padding: 2em; text-align: center; opacity: 0.6; }
.layouts-viewport canvas { display: block; }
```

The `LayoutObjectMesh` is implemented in Task 6.2; this task will leave a broken import. That's OK — we land Task 6.2 next.

- [ ] **Step 4: Commit** (broken intermediate state is fine — Task 6.2 lands immediately after)

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/Viewport/Viewport.tsx web/src/components/layouts/LayoutsTab.tsx web/src/styles.css
git commit -m "feat(layouts): Viewport host (Canvas + OrbitControls + Grid)"
```

### Task 6.2: `LayoutObjectMesh`

**Files:**
- Create: `web/src/components/layouts/Viewport/LayoutObjectMesh.tsx`
- Create: `web/src/components/layouts/Viewport/StatusBillboard.tsx`

- [ ] **Step 1: Implement `LayoutObjectMesh.tsx`**

```tsx
// web/src/components/layouts/Viewport/LayoutObjectMesh.tsx
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { StatusBillboard } from './StatusBillboard';
import type { ResolvedActor } from '../types';

const TINT_BY_TYPE: Record<string, string> = {
  ProxyActor: '#cccccc',
  Layout: '#5588ff',
  EnemySpawnPoint: '#ff5555',
  LootSpawnPoint: '#ffcc44',
  VisualHelper: '#888888',
};

const ERROR_TINT = '#ff3333';

function readVector(env: any): [number, number, number] {
  const v = env?.value;
  return [v?.x?.value ?? 0, v?.y?.value ?? 0, v?.z?.value ?? 0];
}

function readRotator(env: any): [number, number, number] {
  // Three uses radians; Unreal uses degrees. Convert.
  const v = env?.value;
  const pitch = (v?.pitch?.value ?? 0) * Math.PI / 180;
  const yaw = (v?.yaw?.value ?? 0) * Math.PI / 180;
  const roll = (v?.roll?.value ?? 0) * Math.PI / 180;
  return [pitch, yaw, roll];
}

export function LayoutObjectMesh({ resolved, index }: { resolved: ResolvedActor; index: number }) {
  const selectedIndices = useLayoutEditorStore((s) => s.selectedIndices);
  const setSelection = useLayoutEditorStore((s) => s.setSelection);

  const t = resolved.transform.value;
  const translation = readVector(t.translation);
  const rotation = readRotator(t.rotation);
  const scale = readVector(t.scale_3d);

  const isOk = resolved.status.kind === 'ok';
  const tint = isOk ? (TINT_BY_TYPE[resolved.actorType] ?? '#aaa') : ERROR_TINT;
  const selected = selectedIndices.includes(index);

  // Box size from bounds; default to 100³ if no bounds.
  let size: [number, number, number] = [100, 100, 100];
  if (resolved.status.kind === 'ok' && resolved.status.bounds) {
    const b = resolved.status.bounds;
    size = [
      Math.max(10, b.max[0] - b.min[0]),
      Math.max(10, b.max[1] - b.min[1]),
      Math.max(10, b.max[2] - b.min[2]),
    ];
  }

  // Recurse for nested layouts.
  if (resolved.children && resolved.children.length > 0) {
    return (
      <group position={translation} rotation={rotation as any} scale={scale}>
        {resolved.children.map((child, ci) => (
          <LayoutObjectMesh key={ci} resolved={child} index={index * 1000 + ci} />
        ))}
        <StatusBillboard resolved={resolved} position={[0, size[2] + 50, 0]} />
      </group>
    );
  }

  return (
    <group
      position={translation}
      rotation={rotation as any}
      scale={scale}
      onClick={(e) => { e.stopPropagation(); setSelection([index]); }}
    >
      <mesh>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={tint}
          transparent
          opacity={isOk ? 0.6 : 0.4}
          wireframe={resolved.actorType === 'EnemySpawnPoint' || resolved.actorType === 'LootSpawnPoint'}
        />
      </mesh>
      {selected && (
        <mesh>
          <boxGeometry args={[size[0] * 1.05, size[1] * 1.05, size[2] * 1.05]} />
          <meshBasicMaterial color="#ffeb3b" wireframe />
        </mesh>
      )}
      <StatusBillboard resolved={resolved} position={[0, size[2] + 50, 0]} />
    </group>
  );
}
```

- [ ] **Step 2: Implement `StatusBillboard.tsx`**

```tsx
// web/src/components/layouts/Viewport/StatusBillboard.tsx
import { Html } from '@react-three/drei';
import type { ResolvedActor } from '../types';

function statusText(r: ResolvedActor): { text: string; cls: string } | null {
  switch (r.status.kind) {
    case 'ok':
      return null;
    case 'not-configured':
      return { text: 'No definition or queries', cls: 'sb-error' };
    case 'filtered-by-tile-requirements':
      return { text: 'Filtered by tile requirements', cls: 'sb-info' };
    case 'spawn-chance-skipped':
      return { text: `Spawn chance (${r.status.over.toFixed(2)} – ${r.status.under.toFixed(2)})`, cls: 'sb-info' };
    case 'no-matches':
      return { text: 'No matching definitions', cls: 'sb-error' };
    case 'missing-mesh':
      return { text: `Missing mesh: ${r.status.chosenDefinitionId}`, cls: 'sb-error' };
    case 'cycle':
      return { text: `Layout cycle: ${r.status.path.join(' → ')}`, cls: 'sb-error' };
  }
}

export function StatusBillboard({ resolved, position }: { resolved: ResolvedActor; position: [number, number, number] }) {
  const s = statusText(resolved);
  if (!s) return null;
  return (
    <Html position={position} center distanceFactor={500} sprite>
      <div className={`status-billboard ${s.cls}`}>{s.text}</div>
    </Html>
  );
}
```

- [ ] **Step 3: CSS**

```css
.status-billboard { background: rgba(0, 0, 0, 0.75); color: #fff; padding: 0.15em 0.4em; border-radius: 0.25em; font-size: 11px; white-space: nowrap; pointer-events: none; }
.status-billboard.sb-error { color: #ff8888; }
.status-billboard.sb-info { color: #cccccc; }
```

- [ ] **Step 4: Dev sanity**

```
npm run dev
```

Open `LYD_Bathroom_All`. The viewport should show ~30 boxes scattered in 3D space; click a box → outliner highlights the matching row; selection wireframe appears in yellow.

- [ ] **Step 5: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/Viewport/ web/src/styles.css
git commit -m "feat(layouts): LayoutObjectMesh renders AABBs + status overlays"
```

### Task 6.3: `SelectionGizmo` (TransformControls)

**Files:**
- Create: `web/src/components/layouts/Viewport/SelectionGizmo.tsx`
- Modify: `web/src/components/layouts/Viewport/Viewport.tsx`
- Modify: `web/src/components/layouts/Toolbar.tsx` (add W/E/R gizmo-mode hotkeys + buttons)

- [ ] **Step 1: Implement `SelectionGizmo.tsx`**

```tsx
// web/src/components/layouts/Viewport/SelectionGizmo.tsx
import { TransformControls } from '@react-three/drei';
import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';

export function SelectionGizmo() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const selected = useLayoutEditorStore((s) => s.selectedIndices);
  const gizmoMode = useLayoutEditorStore((s) => s.gizmoMode);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const definitions = useDefinitionsStore((s) => s.definitions);

  // Hidden target object the gizmo manipulates; we mirror its transform
  // back into the JSON envelope on drag-end.
  const targetRef = useRef<THREE.Object3D>(null);

  // Sync the target to the selected LayoutObject's transform.
  useEffect(() => {
    if (!layoutKey || selected.length !== 1 || !targetRef.current) return;
    const idx = selected[0];
    const rec = definitions.get(layoutKey);
    const lo = rec?.json?.properties?.layout_objects?.value?.[idx];
    if (!lo) return;
    const t = lo.value.transform.value;
    targetRef.current.position.set(
      t.translation.value.x.value, t.translation.value.y.value, t.translation.value.z.value);
    targetRef.current.rotation.set(
      (t.rotation.value.pitch?.value ?? 0) * Math.PI / 180,
      (t.rotation.value.yaw?.value ?? 0) * Math.PI / 180,
      (t.rotation.value.roll?.value ?? 0) * Math.PI / 180,
    );
    targetRef.current.scale.set(
      t.scale_3d.value.x.value, t.scale_3d.value.y.value, t.scale_3d.value.z.value);
  }, [layoutKey, selected, definitions]);

  if (!layoutKey || selected.length !== 1) return null;

  const idx = selected[0];

  const onDragEnd = () => {
    if (!targetRef.current) return;
    const rec = definitions.get(layoutKey);
    const lo = rec?.json?.properties?.layout_objects?.value?.[idx];
    if (!lo) return;
    const t = lo.value.transform;

    const next = JSON.parse(JSON.stringify(t));
    const o = targetRef.current;
    next.value.translation.value.x.value = o.position.x;
    next.value.translation.value.y.value = o.position.y;
    next.value.translation.value.z.value = o.position.z;
    next.value.rotation.value.pitch.value = o.rotation.x * 180 / Math.PI;
    next.value.rotation.value.yaw.value = o.rotation.y * 180 / Math.PI;
    next.value.rotation.value.roll.value = o.rotation.z * 180 / Math.PI;
    next.value.scale_3d.value.x.value = o.scale.x;
    next.value.scale_3d.value.y.value = o.scale.y;
    next.value.scale_3d.value.z.value = o.scale.z;

    updateValueAtPath(layoutKey, ['properties', 'layout_objects', 'value', idx, 'value', 'transform'], next);
  };

  return (
    <>
      <object3D ref={targetRef} />
      <TransformControls
        object={targetRef.current ?? undefined}
        mode={gizmoMode}
        onMouseUp={onDragEnd}
      />
    </>
  );
}
```

- [ ] **Step 2: Add `<SelectionGizmo />` inside `<Canvas>`** in `Viewport.tsx`.

- [ ] **Step 3: Add W/E/R hotkeys + toolbar buttons** in `Toolbar.tsx` for `gizmoMode`:

```tsx
// Add to imports
import { useEffect } from 'react';

// Inside the component body:
const gizmoMode = useLayoutEditorStore((s) => s.gizmoMode);
const setGizmoMode = useLayoutEditorStore((s) => s.setGizmoMode);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'w' || e.key === 'W') setGizmoMode('translate');
    else if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
    else if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [setGizmoMode]);

// In the JSX, after the Reroll button:
<div className="gizmo-buttons">
  <button className={gizmoMode === 'translate' ? 'active' : ''} onClick={() => setGizmoMode('translate')}>Move (W)</button>
  <button className={gizmoMode === 'rotate' ? 'active' : ''} onClick={() => setGizmoMode('rotate')}>Rotate (E)</button>
  <button className={gizmoMode === 'scale' ? 'active' : ''} onClick={() => setGizmoMode('scale')}>Scale (R)</button>
</div>
```

- [ ] **Step 4: Dev sanity**

```
npm run dev
```

Pick `LYD_Bathroom_All`, click an outliner row, drag the gizmo handles. Translation/rotation/scale should write back to the JSON; the Details panel rows should update.

- [ ] **Step 5: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/Viewport/SelectionGizmo.tsx web/src/components/layouts/Viewport/Viewport.tsx web/src/components/layouts/Toolbar.tsx
git commit -m "feat(layouts): SelectionGizmo with translate/rotate/scale modes"
```

---

## Phase 7: Tile-tag override + Save + Add/Delete/Duplicate

### Task 7.1: Tile-tag override in toolbar

**Files:**
- Modify: `web/src/components/layouts/Toolbar.tsx`

- [ ] **Step 1: Add a `TagPicker` for the tile-tag override**

```tsx
// In Toolbar.tsx, after the Reroll button:
import { TagPicker } from '../pickers/TagPicker';

// In the body:
const tileTagsOverride = useLayoutEditorStore((s) => s.tileTagsOverride);
const setTileTagsOverride = useLayoutEditorStore((s) => s.setTileTagsOverride);

// In the JSX:
<div className="tile-tag-override">
  <span className="label">Tile tags override:</span>
  <TagPicker multi value={tileTagsOverride} onChange={(v) => setTileTagsOverride(v as string[])} />
</div>
```

- [ ] **Step 2: Wire resolver invalidation** — picking different tile tags should invalidate the resolver cache. Add to `layoutEditorStore.setTileTagsOverride`:

```ts
import { useLayoutResolverStore } from './layoutResolverStore';

// Change setTileTagsOverride:
setTileTagsOverride: (t) => {
  set({ tileTagsOverride: t });
  useLayoutResolverStore.getState().invalidate();
},
// Also call invalidate from setSeed:
setSeed: (n) => {
  set({ seed: n | 0 });
  useLayoutResolverStore.getState().invalidate();
},
rerollSeed: () => {
  set((s) => ({ seed: (s.seed === -1 ? 0 : s.seed) + 1 }));
  useLayoutResolverStore.getState().invalidate();
},
```

- [ ] **Step 3: Dev sanity**

```
npm run dev
```

Add a tile tag override; viewport + outliner should re-resolve to show how queries behave under the new tile context.

- [ ] **Step 4: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/Toolbar.tsx web/src/store/layoutEditorStore.ts
git commit -m "feat(layouts): tile-tags override + resolver cache invalidation"
```

### Task 7.2: Save button + dirty indicator

**Files:**
- Modify: `web/src/components/layouts/Toolbar.tsx`

- [ ] **Step 1: Add a Save button hooked into `definitionsStore.saveOne`**

```tsx
// In Toolbar.tsx imports:
import { useDefinitionsStore } from '../../store/definitionsStore';

// In body:
const dirty = useDefinitionsStore((s) => s.dirty);
const saveOne = useDefinitionsStore((s) => s.saveOne);
const isDirty = selectedLayoutKey ? dirty.has(selectedLayoutKey) : false;

// JSX:
<button
  disabled={!isDirty || !selectedLayoutKey}
  onClick={() => selectedLayoutKey && saveOne(selectedLayoutKey)}
>
  Save{isDirty ? ' ●' : ''}
</button>
```

- [ ] **Step 2: Dev sanity**

```
npm run dev
```

Drag a gizmo → Save button enables with red dot. Click Save → it disables; the JSON on disk reflects the change.

- [ ] **Step 3: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/Toolbar.tsx
git commit -m "feat(layouts): toolbar Save button + dirty indicator"
```

### Task 7.3: Add / Delete / Duplicate

**Files:**
- Modify: `web/src/components/layouts/Toolbar.tsx` (Add dropdown)
- Modify: `web/src/components/layouts/LayoutsTab.tsx` (Delete + Ctrl+D key handlers)

- [ ] **Step 1: Add dropdown** in `Toolbar.tsx`:

```tsx
// Helper: build a default LayoutObject envelope for a given type.
function defaultLayoutObject(actorType: string) {
  return {
    type: 'struct',
    struct_name: 'LayoutObject',
    value: {
      layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: actorType },
      b_visual_helper: { type: 'bool', value: false },
      definition_filter: {
        type: 'struct', struct_name: 'DefinitionFilter',
        value: {
          seed_offset: { type: 'int', value: -1 },
          search_queries: { type: 'array', element_type: null, value: [] },
          tile_requirements: { type: 'array', element_type: null, value: [] },
          spawn_chance_over: { type: 'float', value: 0 },
          spawn_chance_under: { type: 'float', value: 1 },
        },
      },
      transform: {
        type: 'struct', struct_name: 'Transform',
        value: {
          translation: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 0 }, y: { type: 'float', value: 0 }, z: { type: 'float', value: 0 } } },
          rotation: { type: 'struct', struct_name: 'Rotator', value: { pitch: { type: 'float', value: 0 }, yaw: { type: 'float', value: 0 }, roll: { type: 'float', value: 0 } } },
          scale_3d: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 1 }, y: { type: 'float', value: 1 }, z: { type: 'float', value: 1 } } },
        },
      },
    },
  };
}

const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
const definitions = useDefinitionsStore((s) => s.definitions);

const onAdd = (actorType: string) => {
  if (!selectedLayoutKey) return;
  const rec = definitions.get(selectedLayoutKey);
  const cur = rec?.json?.properties?.layout_objects?.value as any[] | undefined ?? [];
  const next = [...cur, defaultLayoutObject(actorType)];
  updateValueAtPath(selectedLayoutKey, ['properties', 'layout_objects', 'value'], next);
};

// JSX:
<select onChange={(e) => { if (e.target.value) { onAdd(e.target.value); e.target.value = ''; } }} value="">
  <option value="">+ Add…</option>
  <option value="ProxyActor">Proxy</option>
  <option value="Layout">Layout</option>
  <option value="EnemySpawnPoint">EnemySpawn</option>
  <option value="LootSpawnPoint">LootSpawn</option>
  <option value="VisualHelper">VisualHelper</option>
</select>
```

- [ ] **Step 2: Add `Delete` + `Ctrl+D` keyboard handlers** in `LayoutsTab.tsx`:

```tsx
import { useEffect } from 'react';
import { useLayoutEditorStore } from '../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../store/definitionsStore';

// In body:
const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
const selected = useLayoutEditorStore((s) => s.selectedIndices);
const clearSelection = useLayoutEditorStore((s) => s.clearSelection);
const definitions = useDefinitionsStore((s) => s.definitions);
const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!layoutKey || selected.length === 0) return;
    const rec = definitions.get(layoutKey);
    const cur = (rec?.json?.properties?.layout_objects?.value as any[] | undefined) ?? [];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const next = cur.filter((_, i) => !selected.includes(i));
      updateValueAtPath(layoutKey, ['properties', 'layout_objects', 'value'], next);
      clearSelection();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      const dupes = selected.map((i) => JSON.parse(JSON.stringify(cur[i])));
      // Offset translation.x by 50 so duplicates don't overlap.
      for (const d of dupes) {
        const x = d?.value?.transform?.value?.translation?.value?.x;
        if (x) x.value += 50;
      }
      const next = [...cur, ...dupes];
      updateValueAtPath(layoutKey, ['properties', 'layout_objects', 'value'], next);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [layoutKey, selected, definitions, clearSelection, updateValueAtPath]);
```

- [ ] **Step 3: Dev sanity**

```
npm run dev
```

Click Add → new row appears in outliner + box in viewport. Select a row, press Delete → removed. Select, Ctrl+D → duplicate appears offset.

- [ ] **Step 4: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/src/components/layouts/
git commit -m "feat(layouts): add / delete / duplicate LayoutObjects"
```

---

## Phase 8: Smoke tests

### Task 8.1: Extend `data-smoke.mjs`

**Files:**
- Modify: `web/data-smoke.mjs`

- [ ] **Step 1: Add layout resolver pass at the end of `main()`**

```js
// In data-smoke.mjs, after the existing cross-check block:

// Layout resolver pass — load every LYD_*, resolve, report status counts.
// Cycles are real authoring bugs; missing-mesh / no-matches / not-configured
// are informational counts the user can investigate.
const layouts = [];
for (const { folder, id, json } of byId.values()) {
  if (folder === 'layout_definitions') layouts.push({ id, json });
}
console.log(`[data-smoke] resolving ${layouts.length} layouts...`);

// Pure JS port of just enough of the resolver to run as a script.
// (Reusing the actual resolver.ts requires a build step; the data-smoke
// stays a plain node script. So this is a duplicate of the resolver
// gates — kept intentionally minimal.)
function queryMatches(q, tags) {
  const mode = q?.value?.search_query?.value;
  const qt = q?.value?.tags?.value ?? [];
  const bNot = !!q?.value?.b_not?.value;
  const incl = (cand, p) => cand === p || cand.startsWith(p + '.');
  const has = (qt0, includeParents) => includeParents
    ? tags.some((t) => incl(t, qt0))
    : tags.includes(qt0);
  let raw;
  if (mode === 'None') raw = true;
  else if (mode === 'HasAnyExact') raw = qt.some((x) => has(x, false));
  else if (mode === 'HasAnyInclParents') raw = qt.some((x) => has(x, true));
  else if (mode === 'HasAllExact') raw = qt.every((x) => has(x, false));
  else if (mode === 'HasAllInclParents') raw = qt.every((x) => has(x, true));
  else raw = false;
  return bNot ? !raw : raw;
}

const counts = { ok: 0, 'not-configured': 0, 'no-matches': 0, 'missing-mesh': 0, cycle: 0, 'spawn-chance-skipped': 0, 'filtered-by-tile-requirements': 0 };
let cycleErrors = 0;
for (const { id, json } of layouts) {
  const tileTags = json.properties?.gameplay_tags?.value ?? [];
  const objects = json.properties?.layout_objects?.value ?? [];
  function resolveOne(lo, visited) {
    const filter = lo.value.definition_filter.value;
    const queries = filter.search_queries.value;
    const tileReqs = filter.tile_requirements.value;
    const actorType = lo.value.layout_actor_type.value;
    const refKey = actorType.includes('LAYOUT') ? 'layout_definition' :
                   actorType.includes('PROXY') ? 'furniture_definition' :
                   actorType.includes('ENEMY') ? 'enemy_spawn_point_definition' :
                   actorType.includes('LOOT') ? 'loot_spawn_point_definition' : null;
    const directRef = refKey ? lo.value[refKey]?.value : null;
    if (!directRef && queries.length === 0) return 'not-configured';
    if (tileReqs.length > 0 && !tileReqs.every((q) => queryMatches(q, tileTags))) return 'filtered-by-tile-requirements';
    if (directRef && actorType.includes('LAYOUT')) {
      if (visited.has(directRef)) return 'cycle';
      const inner = byId.get(directRef);
      if (inner) {
        const innerVisited = new Set(visited); innerVisited.add(directRef);
        for (const child of inner.json.properties?.layout_objects?.value ?? []) resolveOne(child, innerVisited);
      }
    }
    return 'ok';
  }
  for (const lo of objects) {
    const r = resolveOne(lo, new Set([id]));
    counts[r] = (counts[r] ?? 0) + 1;
    if (r === 'cycle') { cycleErrors++; fail(`layout cycle in ${id}`); }
  }
}
console.log(`[data-smoke] layout resolver counts: ${JSON.stringify(counts)}`);
if (cycleErrors > 0) console.log(`[data-smoke] ${cycleErrors} layout cycles detected (real bug)`);
```

- [ ] **Step 2: Run**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm run data-smoke
```

Expected: a counts line; zero cycles preferred (any cycles indicate a real authoring bug in the source data).

- [ ] **Step 3: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/data-smoke.mjs
git commit -m "test(data-smoke): resolve every LYD_* and report status counts"
```

### Task 8.2: Playwright scenario

**Files:**
- Modify: `web/savedload-ui-smoke.mjs`

- [ ] **Step 1: Add a new scenario at the end of the existing scenarios**

```js
// Append to savedload-ui-smoke.mjs (before the success banner)

async function scenarioLayoutsTab(page) {
  console.log('[savedload-smoke] scenario: Layouts tab loads LYD_Bathroom_All');

  // Auto-load starter project + dismiss drift gate (existing helpers).
  // ... mirror the existing scenarios' setup. ...

  // Switch to the Layouts tab.
  await page.click('button:has-text("Layouts")');
  await page.waitForSelector('.layouts-tab');

  // Pick LYD_Bathroom_All.
  await page.selectOption('.layouts-toolbar select', 'LYD_Bathroom_All');

  // Outliner should populate with ~30 rows. Be tolerant of count drift.
  const rowCount = await page.locator('.outliner-row').count();
  if (rowCount < 10 || rowCount > 50) {
    throw new Error(`[savedload-smoke] expected ~30 outliner rows for LYD_Bathroom_All, got ${rowCount}`);
  }

  // Click the first row.
  await page.locator('.outliner-row').first().click();

  // Details panel should render the LayoutObject's properties.
  await page.waitForSelector('.details-panel .def-field', { timeout: 5000 });

  console.log('[savedload-smoke] ✓ Layouts tab renders LYD_Bathroom_All');
}
```

Wire `scenarioLayoutsTab` into the test runner the same way other scenarios are.

- [ ] **Step 2: Run**

```
npm run smoke:savedload
```

If pre-existing Test 2 is still failing, the new scenario may not run. Verify in isolation first (mirror what was done for the AssetRefPicker scenario in Task 9.2 of the prior plan).

- [ ] **Step 3: Commit**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor"
git add web/savedload-ui-smoke.mjs
git commit -m "test(smoke): Layouts tab renders LYD_Bathroom_All with outliner + details"
```

---

## Final verification

- [ ] **Run the full gate**

```
cd "C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web"
npm run typecheck && npm test && npm run data-smoke && npm run build
```

Expected: typecheck clean, ≈120 node tests passing, data-smoke prints expected layout counts, build clean.

- [ ] **Dev-server walkthrough** (manual)

```
npm run dev
```

1. Open `Layouts` tab.
2. Pick `LYD_Bathroom_All`.
3. Confirm: ~30 boxes appear in 3D viewport, ~30 rows in outliner, Details panel responds to row clicks.
4. Drag a translate gizmo → translation in Details updates → Save button shows dirty dot.
5. Click Save → dirty clears; reload page → changes persist.
6. Try an empty `tile-tags override` of just `['Tile.Biome.Carpark']` → see how search-query LayoutObjects re-resolve.
7. Add a new ProxyActor via the Add dropdown; delete it with the Delete key.

---

## Spec coverage check (self-review)

| Spec section | Plan task |
|---|---|
| Drop `isLayoutFolder` filter | Task 1.1 |
| three.js + react-three-fiber dependencies | Task 2.1 |
| `LayoutObject` / `DefinitionFilter` types | Task 2.2 |
| Mulberry32 PRNG | Task 3.1 |
| `FProxySearchTreeQuery::QueryTags` port | Task 3.2 |
| Search tree indexing | Task 3.3 |
| Top-level resolver with all status kinds | Task 3.4 |
| `layoutResolverStore` cache | Task 4.1 |
| `layoutEditorStore` UI state | Task 4.2 |
| `'layouts'` tab in `appStore` + Header | Task 4.3 |
| Three-pane shell + Toolbar | Task 5.1 |
| Outliner with type-icons + selection | Task 5.2 |
| Details panel reusing TypedPropertiesEditor | Task 5.3 |
| 3D viewport host (Canvas + OrbitControls + Grid) | Task 6.1 |
| AABB rendering per actor + status billboard | Task 6.2 |
| TransformControls + W/E/R hotkeys | Task 6.3 |
| Tile-tag override toolbar control | Task 7.1 |
| Save button + dirty indicator | Task 7.2 |
| Add / Delete / Duplicate | Task 7.3 |
| `data-smoke.mjs` resolver pass | Task 8.1 |
| Playwright Layouts-tab scenario | Task 8.2 |
| Nested-layout preview (recurse) | Covered inside Task 3.4 (resolver `children`) + Task 6.2 (recursive render) |
| Cycle detection | Covered inside Task 3.4 |
| Multi-select Details panel diff badges | **Deferred to a follow-up — Task 5.3 ships single-select only; the spec mentions multi-select as a desirable behavior but it's not load-bearing for v1** |
| Camera framing helper (`camera.ts`) | **Deferred — OrbitControls' default centering is sufficient; revisit if users complain** |

Two items deferred from the spec — both are quality-of-life features that don't block the core workflow. Flagging here so future iterations can pick them up.
