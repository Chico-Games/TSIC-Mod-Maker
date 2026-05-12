# Layout Editor — Design

**Date:** 2026-05-12
**Status:** Approved (Workstream B of the layout-editor effort)
**Builds on:** `2026-05-12-lossless-export-and-pickers-design.md` (Workstream A — lossless exports, asset catalogs, pickers).

## Goal

A web-based layout editor that ports the day-to-day features of Unreal's `ALayoutLevelScriptActor` editor experience to the JSON exports produced by Workstream A. Users open `LYD_*.json`, edit `FLayoutObject` entries in a 3D viewport, persist back to JSON, and never have to open Unreal for layout authoring.

## Workflow targeted

The user wants the Unreal experience minus the engine:
- Open a layout, see all its `LayoutObject` entries as a 3D scene.
- Click an actor to inspect / edit its properties (transform, search queries, spawn chance, tile requirements).
- Use translate / rotate / scale gizmos to reposition.
- Visualise Furniture button resolves search queries and renders the picked meshes' bounding boxes.
- Test-seed + tile-tag override to preview how queries resolve under different tile contexts.
- World-Outliner-style list of all actors; Details-panel-style property pane.
- Save back to the source JSON.

## Decisions

- **Render shape:** 3D AABBs (axis-aligned bounding boxes from the `StaticMesh` catalog's `bounds`) — no real meshes, no thumbnails. Type-tinted (proxy / layout / spawn-point / visual-helper / error).
- **Edit shape:** click-select, full TransformControls (translate / rotate / scale gizmos), plus a Details panel for non-transform properties.
- **3D stack:** `three`, `@react-three/fiber`, `@react-three/drei`. Adds ≈150 KB gzipped.
- **Search-query resolution:** ported to TypeScript. Pure logic, no Unreal dependency. Mulberry32 PRNG (deterministic, but not byte-identical with Unreal's `FRandomStream`).
- **Scope per session:** one layout at a time; nested-layout refs recurse inline (with cycle detection). Multi-tile world preview is out of scope.
- **Bundled layouts:** drop the `isLayoutFolder()` filter in `sync-base-definitions.mjs` and `dataSource.ts` so the 251 `LYD_*` assets land in `web/public/starter-project/layout_definitions/`.
- **Details panel:** reuses `TypedValueEditor` from Workstream A so AssetRefPicker / TagPicker / StructRows all "just work" for layout properties.

## Architecture

```
Layouts tab
├── Toolbar                — layout picker, seed, tile-tag override, Visualise, Save
├── Outliner (left)        — tree of LayoutObjects, type-icon per row
├── Viewport (center)      — 3D AABB scene, TransformControls, status billboards
└── Details (right)        — TypedValueEditor on the selected envelope

New stores:
- layoutResolverStore       — pure logic: layoutObject → resolved entry
                              with status (ok / missing-mesh / no-matches /
                              cycle / spawn-chance-skipped / etc.)

Existing stores extended:
- definitionsStore          — drop `isLayoutFolder()` filter; add
                              `selectedLayoutKey` cursor; resolver search
                              tree rebuilt on definitions load
- appStore                  — `AppTab` gains `'layouts'`
- assetCatalogStore         — already lazy-loads StaticMesh bounds
- gameplayTagStore          — already loaded
```

## Loading

Two small plumbing changes lift the layout exclusion:

1. **`web/scripts/sync-base-definitions.mjs`** — remove the `isLayoutFolder` skip; layouts mirror into `public/starter-project/layout_definitions/`.
2. **`web/src/persistence/dataSource.ts`** — remove the matching filter in `HttpDataSource.readManifest()` and `FsaDataSource.readManifest()`.

After these land, `definitionsStore.definitions` will contain `ULayoutDefinition` entries alongside the others. Standard load path; no special handling.

## LayoutObject envelope (for type-safety only)

The JSON shape already exists from Workstream A. We add a TypeScript type for IDE hints:

```ts
type LayoutObject = {
  layout_actor_type: { type: 'enum'; enum_name: 'LayoutActorType'; value: string };
  b_visual_helper: { type: 'bool'; value: boolean };
  definition_filter: { type: 'struct'; struct_name: 'DefinitionFilter'; value: {
    seed_offset: { type: 'int'; value: number };
    search_queries: { type: 'array'; value: ProxySearchTreeQuery[] };
    tile_requirements: { type: 'array'; value: ProxySearchTreeQuery[] };
    spawn_chance_over: { type: 'float'; value: number };
    spawn_chance_under: { type: 'float'; value: number };
  } };
  furniture_definition?: { type: 'definition_ref'; class: string; value: string };
  layout_definition?:    { type: 'definition_ref'; class: 'LayoutDefinition'; value: string };
  enemy_spawn_point_definition?: { type: 'definition_ref'; class: 'EnemySpawnPointDefinition'; value: string };
  loot_spawn_point_definition?:  { type: 'definition_ref'; class: 'LootSpawnPointDefinition'; value: string };
  transform: { type: 'struct'; struct_name: 'Transform'; value: {
    translation: { type: 'struct'; struct_name: 'Vector'; value: { x: TypedFloat; y: TypedFloat; z: TypedFloat } };
    rotation:    { type: 'struct'; struct_name: 'Rotator' | 'Quat'; value: object };
    scale_3d:    { type: 'struct'; struct_name: 'Vector'; value: { x: TypedFloat; y: TypedFloat; z: TypedFloat } };
  } };
};
```

## Three-pane tab

```
web/src/components/layouts/
├── LayoutsTab.tsx              — three-pane shell + toolbar
├── Toolbar.tsx                 — controls described in §Toolbar
├── Outliner/
│   ├── Outliner.tsx            — selection + tree of LayoutObjects
│   ├── OutlinerRow.tsx         — one row: type-icon + display name
│   └── icons.tsx               — 5 SVG icons (one per ELayoutActorType)
├── Viewport/                   — see §Viewport
└── Details/
    └── DetailsPanel.tsx        — wraps TypedValueEditor on selection
```

### Selection model

A `LayoutEditorSelection` slice (on `appStore` or a small dedicated store): `{ layoutKey, indices: number[] }`. Shift-click extends; Ctrl-click toggles; Esc clears. Single-source-of-truth for the outliner highlight, the viewport's TransformControls target, and which envelope(s) the Details panel renders.

### Outliner display names

Match `ALayoutEditorActor::GenerateActorName`:

| LayoutObject shape | Display |
|---|---|
| Direct furniture ref | `Proxy: FD_Door` |
| Search-query only | `Proxy: SearchQuery (3 tags)` |
| Layout ref | `Layout: LYD_TileBase` |
| EnemySpawnPoint ref | `EnemySpawn: ESP_BoneHead` |
| LootSpawnPoint ref | `LootSpawn: LSP_CarPark_Furniture` |
| `b_visual_helper = true` | `Visual Helper` |

Failed resolutions append a red dot.

### Details panel

A `TypedValueEditor` instance bound to the selected envelope. Multi-select renders one editor — properties whose values match across all selected appear normally; properties whose values diverge render as `(multiple values)`. Edits propagate to every selected envelope.

## Viewport

```
Viewport/
├── Viewport.tsx           — <Canvas>, OrbitControls, lighting, ground grid
├── LayoutObjectMesh.tsx   — AABB per resolved actor; type-tinted
├── SelectionGizmo.tsx     — TransformControls bound to the selection
├── StatusBillboard.tsx    — text overlay above each actor
└── camera.ts              — frame-camera-to-content helper
```

### Type tints

| ELayoutActorType | Visual |
|---|---|
| ProxyActor | neutral grey solid |
| Layout | translucent blue solid (nested) |
| EnemySpawnPoint | red wireframe |
| LootSpawnPoint | gold wireframe |
| VisualHelper | dashed white outline |
| Resolution failed | solid red |

### Transform gizmos

When exactly one actor is selected, `<TransformControls>` mounts on its mesh group. Toolbar (or W/E/R) switches modes. Drag updates the transform envelope via `definitionsStore.updateValueAtPath` — the same write path everything else uses.

### Camera

`OrbitControls` with pan; Numpad-1/3/7 snap to front/side/top; double-click an actor frames camera to its bounds.

### Nested layouts

When `LayoutObject.layout_actor_type === Layout`, the resolver returns the inner layout's flattened `LayoutObject` list. The viewport renders them inline at the outer transform. A `visited` set blocks cycles, with the offending nested ref rendered as a red error indicator.

### Performance

Largest observed layout: ~30 objects (`LYD_Bathroom_All`). Most are smaller. Even 200 instanced AABBs is trivial for three.js; no instanced-rendering optimisation needed.

## Resolver

A pure-TypeScript port of `ALayoutLevelScriptActor::VisualiseFurniture` + `FLayoutObject::AddToTile`. No three.js, no React; testable in isolation.

```
web/src/components/layouts/resolver/
├── searchTree.ts          — tag → DefinitionRef[] index
├── proxySearchQuery.ts    — port of FProxySearchTreeQuery::QueryTags
├── randomStream.ts        — Mulberry32 PRNG, seeded
├── resolver.ts            — top-level resolve(layoutObject, ctx, seed)
└── tests/                 — unit tests
```

### Status table

For each `LayoutObject`, `resolve()` runs the same gates Unreal's `VisualiseFurniture` does, in order, returning one of:

| Status | When | UI |
|---|---|---|
| `not-configured` | No definition ref AND no search queries | Red: "No definition or search queries" |
| `filtered-by-tile-requirements` | `tile_requirements` don't match `ctx.tileTags` | White info: "Filtered by tile requirements" |
| `spawn-chance-skipped` | Random roll outside `[over, under]` | White info: "Spawn chance: N% (X.X – Y.Y)" |
| `no-matches` | Search queries found zero defs | Red: "No matching definitions found" |
| `missing-mesh` | Resolved a furniture def but `static_mesh` is null or absent from catalog | Red: "Missing mesh" |
| `cycle` | A nested-layout ref revisits a layout already entered | Red: "Recursive layout cycle: A → B → A" |
| `ok` | Resolved cleanly | No overlay |

For `ok`, the resolver returns `{ chosenDefinition, mesh: { path, bounds }, transform, children? }`. `children` is populated when type is `Layout`.

### Reused inputs

- **Search tree:** `Map<tag, DefinitionRef[]>` filtered by class. Built once per definitions load; cached on `layoutResolverStore`.
- **Bounds:** `assetCatalogStore`'s `StaticMesh` catalog (1591 entries already populated).
- **Tag tree + parent-inclusion:** `gameplayTagStore` (already loaded).

### Random parity

We use Mulberry32 seeded by `seed + seed_offset`. Same web-side seed always picks the same definition. Not byte-identical with Unreal's `FRandomStream` — an explicit non-goal; in-game determinism stays Unreal-side, the web editor is for authoring not runtime simulation.

## Toolbar

| Control | Behavior |
|---|---|
| Layout picker | Dropdown of all `LYD_*` definitions. Populates outliner on change. |
| Seed input | Integer. Default `-1` (re-rolled each time). Reroll button cycles `seed += 1`. |
| Tile-tag override | `TagPicker` (multi). Empty = use layout's own `gameplay_tags`. |
| Visualise | Force full re-resolve. Resolver memoizes per `(index, seed, tileTags)` so this is cheap. |
| Save | `definitionsStore.saveOne`. Disabled when not dirty. |
| Dirty indicator | "● unsaved" badge. |

Gizmo-mode buttons (W/E/R) live in the viewport, matching the Unreal convention.

## Save / load round-trip

- **Load:** user picks a layout; `definitionsStore` already has its JSON; selection resets; resolver runs; viewport renders.
- **Save:** every gizmo drag / details edit writes via `updateValueAtPath`. Save button persists via the store's existing FSA / HTTP write path. No special pre/post-save hook needed — `LayoutObject` values are typed envelopes the store already handles.

## Add / delete / duplicate

- **Add:** Toolbar dropdown with the five `ELayoutActorType` options → splice a default envelope into `layout_objects.value`.
- **Delete:** `Delete` key on selection → splice.
- **Duplicate:** `Ctrl+D` → deep-clone selected envelopes, offset translation.x slightly.

All three are array mutations on `properties.layout_objects.value` via `updateValueAtPath`. No new persistence code.

## Out of scope (v1)

- Drag-drop palette of furniture (use Add dropdown + Details picker).
- Multi-tile world preview.
- Streaming real UE meshes — AABBs only.
- Per-asset RNG parity with Unreal's `FRandomStream` (Mulberry32 instead).
- Search-query authoring UI beyond what `StructRows` + `TagPicker` give us.
- Undo/redo (audit `definitionsStore` for existing support during implementation; flag if missing).

## Testing

- **Unit:** `resolver.test.ts` covers each status from the table (12 tests). `searchTree.test.ts` covers tag indexing + parent-inclusion + `bNot` (6 tests).
- **Data smoke:** `data-smoke.mjs` extension loads every `LYD_*`, runs resolver with `{ seed: 0, tileTags: layout.gameplay_tags }`, reports per-status counts. Cycle = failure; other statuses = informational.
- **Playwright:** open `LYD_Bathroom_All`, confirm 30 objects in outliner, click row 0, confirm Details panel renders expected envelope.

## Risks

- **Three.js bundle size** (~150 KB gzipped). Acceptable; lazy-load Layouts tab if needed.
- **Resolver behavior drift vs Unreal** beyond the RNG choice — particularly around `seed_offset` semantics. Mitigation: unit tests against fixtures captured from a live Unreal run for known layouts.
- **Performance on the largest layouts** — 200+ objects might lag with a default Canvas. Mitigation: throttle re-resolve on rapid gizmo drag (`requestAnimationFrame` debounce).
- **Save-as-you-edit accidents** — a gizmo drag marks the layout dirty even before the user commits. Mitigation: only flip dirty on `pointerUp` of the gizmo, not on every frame of the drag.
