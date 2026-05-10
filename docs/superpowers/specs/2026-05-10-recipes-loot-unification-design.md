# Recipes & Loot Unification — design

Date: 2026-05-10. Authoring scope: full app rewrite to a single Definitions-folder data model. Supersedes the xlsx + Rust + projectStore architecture established in `2026-05-08-tsic-crafting-app-design.md` and the polish phases in `2026-05-09-typed-editor-polish-plan.md`.

## Goal

Every tab visualises and edits the same folder of typed-envelope JSON exports under
`<your-game-export>/Definitions/`. The current example folder is
`C:\Users\Administrator\Documents\Unreal Projects\TSIC\Tools\Export\test-output\Definitions`.

## Non-goals

- xlsx import / reimport / diff. Removed.
- `.json` project file save/load. Removed.
- Rust/WASM core. Removed.

## Top-level architecture

- Single zustand store: `definitionsStore`. The legacy `projectStore` is deleted.
- Header: `Open folder | Save | Save as… | Load bundled defaults | Search | Undo | Redo`.
- Tabs (in order): `Recipes & Loot`, `Furniture Loot`, `Definitions`, `Validations`.
- Drag-and-drop: a single `<DndContext>` at app root. A `web/src/dnd/dispatch.ts` dispatcher routes drops by `(dragType, dropType)` so every sub-tab plugs into the same handler.
- Bundled defaults: `web/public/base-definitions/` is a copy of the Definitions folder (sans `^layout` folders), produced by `npm run sync-defaults`. Loaded as the default working set when no folder handle is restored on startup.

## Data model crib (read this once)

| Folder | Class | Key shape |
|---|---|---|
| `craft_recipe_definitions/RD_*_CR.json` | `UCraftRecipeDefinition` | `input: map<def_ref, int>`, `output: map<def_ref, int>`, `duration: float`, `level: int`, `recipe_tags`, `crafting_bench_tags` |
| `plant_recipe_definitions/RD_*_PL.json` | `UPlantRecipeDefinition` | as above + `grow_stages: array<PlantGrowStage{ratio, start_scale, end_scale}>` |
| `furniture_upgrade_recipe/RD_*_CN.json` | `UFurnitureUpgradeRecipe` | `input`, `duration`, `level`, `upgrade_tier`, `upgraded_furniture_definition: def_ref<DamageableFurnitureDefinition>` |
| `available_recipe_rules_definitions/ARR_*.json` | `UAvailableRecipeRulesDefinition` | `production_machine_rules.recipes: array<def_ref<CraftRecipeDefinition>>` |
| `crafting_station_definitions/FD_*_CS.json` | `UCraftingStationDefinition` | `available_recipe_rules_definition: def_ref<ARR>` |
| `production_station_definitions/FD_*_PS.json` | `UProductionStationDefinition` | as above |
| `plantable_definitions/FD_*_PL.json` | `UPlantableDefinition` ⊂ `UProductionStationDefinition` | as above; ARR points at plant recipes |
| `damageable_furniture_definitions/FD_*_DF.json` | `UDamageableFurnitureDefinition` | `loot_dropped_on_death: array<def_ref<LootDefinition>>`, `upgrade_recipe: def_ref<FurnitureUpgradeRecipe>`, `starting_health`, `display_name`, … |
| `loot_definitions/LD_*.json` | `ULootDefinition` | `items_to_drop: array<ItemToDrop{item_to_drop: def_ref, count, chance_to_drop}>`, `weighted_chance`, `world_gen_priority` |
| `enemy_definitions/ED_*.json` | `UEnemyDefinition` | `death_drop_table: array<DeathDropEntry>` (envelope-driven; whatever fields the exporter found, the typed editor renders) |
| `loot_spawn_point_definitions/LSP_*.json` | `ULootSpawnPointDefinition` | `loot_by_difficulty: map<CurrentStoreDifficulty, LootDifficultyTier{loot_items, spawn_chance}>`, `source_type: LootSource{FLOOR\|FURNITURE}` |

The chain a station → recipes follows: station → `available_recipe_rules_definition` → `production_machine_rules.recipes[]` → recipe asset.

## Persistence model

1. **Open folder** — picks a directory; stored in IndexedDB via `handleStore` (already implemented).
2. **Save** — writes every dirty record (existing `saveAllDirty`).
3. **Save as…** — prompts for a new directory, writes the entire working set, replaces the saved handle.
4. **Load bundled defaults** — discards any folder handle and re-fetches `web/public/base-definitions/`. Save then prompts Save As.
5. **Boot order**: try saved handle (auto-load if enabled) → fall back to bundled. The user-visible state is the same either way; only Save behaviour differs.

The bundled tree includes `.property-meta.json` and `.class-hierarchy.json`; the typed editor and class-hierarchy machinery work identically for bundled vs. picked sources.

## Sync script

`web/scripts/sync-base-definitions.mjs`:

- Walks the source tree (configurable env var `TSIC_DEFINITIONS_SRC`, defaulting to the test-output path above).
- Skips directories whose name starts with `^layout` (matches the existing `definitionsStore` skip list).
- Writes files to `web/public/base-definitions/<folder>/<file>.json` plus `.property-meta.json` and `.class-hierarchy.json` at the root.
- Emits `web/public/base-definitions/manifest.json`: `{ folders: string[], files: { folder: string, ids: string[] }[] }`. The store fetches the manifest first and then each file, instead of needing directory-listing in the browser.

`npm run sync-defaults` runs the script. `npm run build` runs sync-defaults then the existing Vite build.

## Tab: Recipes & Loot

A two-row layout: sub-tab strip on top, content below. Sub-tabs: `Stations | Furniture | Tech Tree | Enemies | Biome`.

### Sub-tab: Stations

- Left rail (≈260px): every UFurnitureDefinition with an `available_recipe_rules_definition` property. Grouped by leaf class with section headers: `Crafting`, `Production`, `Plantable`. Each row shows folder emoji + `display_name` + bare id.
- Right pane: header card for the selected station (display_name, level, drag/health stats), then the resolved ARR's recipe array rendered as a stack of recipe cards.
- Recipe card layout adapts by class:
  - **CraftRecipe**: input cells | arrow | output cells | duration | level. Drop palette items into cells.
  - **PlantRecipe**: same plus a `Grow stages` strip — rows for `ratio`, `start_scale`, `end_scale`. `+ Add stage` / `× remove`.
  - **FurnitureUpgradeRecipe**: input cells | upgrade-tier badge | `upgraded_furniture_definition` selector. Output map is suppressed (always empty in the data).
- `+ New recipe` button at the bottom of the recipe stack picks the right class for the station type:
  - `UProductionStationDefinition` parents → `UCraftRecipeDefinition` unless the station is a `UPlantableDefinition`, then `UPlantRecipeDefinition`.
  - The new recipe gets a generated id following the per-class `idTemplates`, the asset is created via `createDefinitionForClass`, and the new ref is appended to the ARR's `production_machine_rules.recipes`.
- Move recipe between stations: drag a recipe card onto a station row in the left rail. Implementation: pop the recipe ref out of source ARR's list, push onto target ARR's list. Recipe asset filename does **not** change.
- DnD glue: each cell wraps a `definition_ref` slot (path = `properties.input.value[i].key` / `value`, etc). The dispatcher writes via `updateValueAtPath`.

### Sub-tab: Furniture (death loot + upgrades)

- Left rail: every `UDamageableFurnitureDefinition`, grouped by `category` if available else flat alpha. Search box reuses the folder-list search.
- Right pane sections, top-to-bottom:
  1. **Identity** — display_name, description, starting_health, constructable_item_to_grant, level, level_recipe (read-only, jumps to recipe via partner button).
  2. **Death loot** — list of `loot_dropped_on_death` entries. Each entry shows the LD_ ref as a SearchableSelect plus an inline expander that renders the LootDefinition's `items_to_drop` array (count, chance, item def_ref). `+ Add` adds a new entry; drop a palette LootDefinition onto the section to append a ref.
  3. **Upgrade** — if `upgrade_recipe` is set, expand the FurnitureUpgradeRecipe inline (input cost cells + upgrade_tier + upgraded_furniture_definition selector). If unset, an empty placeholder with `+ Add upgrade recipe` that creates a new FurnitureUpgradeRecipe asset whose `upgraded_furniture_definition` defaults to the next tier of this furniture if discoverable.
- Drop palette items onto cost cells / loot rows. Drop a furniture from the rail back onto another furniture's upgrade slot to set `upgraded_furniture_definition`.

### Sub-tab: Tech Tree

- Pure TS reimplementation (no WASM). Edges:
  - `recipe → output_item` for each output entry
  - `input_item → recipe` for each input entry
  - `recipe ↔ station` via the ARR mapping
- Layered DAG layout (port the algorithm from the legacy `tree.rs`). The same `panTargetNodeId` / `requestPanToNode` UI moves over.
- Filter chips: by station class, by recipe class, by tier (= recipe `level`).
- Click a node → `Definitions` tab on that record.

### Sub-tab: Enemies

- Left rail: every `UEnemyDefinition`. Right pane: identity header + a typed-envelope editor focused on `death_drop_table`. Adds inline `+ Add row` / `× Remove`. Renders whatever fields the typed envelope has — which today is `count` + `weight`. Items can still be dropped onto a row to set an item ref **if** the envelope schema reveals one (we plug into `lookupContainerType` so that as soon as the exporter populates an item ref on any enemy, every enemy row picks it up).

### Sub-tab: Biome

- Left rail: biomes derived from `loot_spawn_point_definitions/` ids — match `LSP_(?<biome>.+?)_(Floor|Furniture)` and group. Rows show biome name with two badges (`Floor`, `Furniture`).
- Right pane: per-biome page with two columns (Floor / Furniture) corresponding to the two LSP_ assets. Inside each column: editor for `loot_by_difficulty` — one expandable section per `CurrentStoreDifficulty` enum member (EASY / NORMAL / HARD / etc), each containing a `loot_items` list (count, weight) and a `spawn_chance` slider.
- Drop palette items onto a difficulty section's loot list to append a row (item ref filled in once envelope schema reveals one).

## Tab: Furniture Loot

Flat browser/editor over `loot_definitions/`. Two-pane:

- Left: searchable list of every LD_*. Folder emoji + id + count of `items_to_drop`.
- Right: typed-envelope editor for the LootDefinition. Sections: identity, items_to_drop (drag/drop, count, chance), weighted_chance, world_gen_priority, gameplay_tags.

This is the place to bulk-edit standalone loot tables that are referenced from many furniture or biome assets.

## Tab: Definitions (unchanged from polish phases)

Existing typed editor with folder rail, search, table view, pinned properties, etc. Still authoritative for any record whose dedicated sub-tab doesn't expose a property.

## Tab: Validations

Promotes the existing `findOrphanReferences` and `findItemStaticOrphans` to a dedicated tab and adds:

- **Station ARR coverage**: list stations whose `available_recipe_rules_definition` is null or unresolved.
- **Empty ARR**: ARRs whose `production_machine_rules.recipes` is empty.
- **Orphan ARR**: ARRs not pointed at by any station.
- **Empty recipes**: recipes whose `input` or `output` map is empty (with class-aware exceptions: FurnitureUpgradeRecipe is allowed to have empty output).
- **Furniture upgrade target missing**: FurnitureUpgradeRecipe whose `upgraded_furniture_definition` doesn't resolve.
- **Orphan loot**: LD_ assets that no DamageableFurniture or LSP_ references.

Each row has an "Open" button that selects the offending record in the right tab.

## DnD dispatcher

`web/src/dnd/dispatch.ts` exports:

```ts
export type DragSource =
  | { type: 'palette-item'; class: string; value: string }
  | { type: 'recipe-card'; key: string }
  | { type: 'slot'; ownerKey: string; path: (string|number)[] };

export type DropTarget =
  | { type: 'recipe-input' | 'recipe-output' | 'upgrade-cost' | 'loot-entry'; ownerKey: string; path: (string|number)[] }
  | { type: 'arr-recipes'; arrKey: string }
  | { type: 'station-row'; stationKey: string };
```

A single `dispatch(source, target)` function performs the matrix of legal combinations using `definitionsStore.updateValueAtPath` and (for `station-row`) ARR list mutations. Illegal combinations no-op.

The current `App.tsx` `onDragEnd` cascade goes away; sub-tab components register drop zones with the dispatcher's target shape.

## Removal list (precise)

Files deleted:

- `web/src/store/projectStore.ts`
- `web/src/components/{RecipesTab,RecipeCard,SlotCell,StationList,StationUpgradeEditor,UpgradeCard,TechTreeTab,TechTreeStationList,StatsTab,LootTab,BiomeLootTab,FurnitureTab,ValidationsTab,ReimportDialog,ItemPalette,ItemDetailDrawer,ItemPropertiesEditor,CostBreakdown}.tsx`
- `web/src/api.ts`, `web/src/types.ts`, `web/src/costs.ts`, `web/src/csvExport.ts`, `web/src/itemPropertySchema.ts`, `web/src/semantic.ts`, `web/src/itemEmoji.ts` (kept only if a new sub-tab still imports it; default is delete)
- `web/src/wasm/`
- `rust-core/`, `Cargo.toml`, `Cargo.lock`, `target/`
- `web/smoke-test.mjs`, `web/legacy-flow-smoke.mjs`

Reused (still needed): `App.tsx` (rewritten), `Header.tsx` (rewritten), `CommandPalette.tsx`, `DragGhost.tsx`, `dragModifiers.ts`, `animations.ts`, `handleStore.ts`, `definitionsStore.ts`, the typed-editor widgets (`SearchableSelect`, `WideToggle`, `NumberSlider`, `BoolEditor`, `EnumEditor`, `TypedFieldCell`, `TypedValueEditor`, `JsonValueEditor`, `DefinitionRefEditor`, `DefinitionsTab`, `DefinitionsTable`, `RecipeBuilderView` may be reused by Stations sub-tab if shape lines up — otherwise replaced), `folderTheme.ts`, `definitionsNaming.ts`, `HighlightedText.tsx`, `NumberSlider.tsx`, `ReferenceViewer.tsx`.

`README.md` rewritten end to end.

## Test plan

- `web/data-smoke.mjs` (new): node script that loads `web/public/base-definitions/` via fs, runs the same parse/index logic the store uses, asserts every station resolves to an ARR, every ARR's recipes resolve, every furniture's `upgrade_recipe` and `loot_dropped_on_death` refs resolve. Replaces `definitions-smoke.mjs`.
- `web/definitions-ui-smoke.mjs` extended:
  - Recipes & Loot → Stations: select a station, drop a palette item onto the first input cell, assert dirty state.
  - Recipes & Loot → Furniture: select a furniture, expand upgrade, change `upgrade_tier`, save.
  - Recipes & Loot → Tech Tree: assert at least one node, at least one edge.
  - Recipes & Loot → Enemies, Biome: smoke-only — page renders and a row is editable.
  - Furniture Loot: open an LD_, change `weighted_chance`, save.
  - Validations: open the tab, assert a known orphan from the bundled set surfaces.
- TypeScript build passes (`npm run typecheck`, `npm run build`).
- Manual: open the dev server, ensure bundled defaults load on first run, all sub-tabs are reachable, save-as writes a folder back out cleanly.

## Phasing

A. **Demolish** — delete the listed files; reduce `App.tsx` and `Header.tsx` to a stub that mounts only the existing Definitions tab. Builds + types green at this checkpoint.

B. **Bundled defaults** — sync script + manifest + boot path. Definitions tab still works against bundled data.

C. **Recipes & Loot shell + Stations sub-tab** — station rail, ARR resolution, recipe cards for Craft+Plant+FurnitureUpgrade, grow_stages editor, +New recipe, station-row drop, item-into-cell drop.

D. **Furniture sub-tab** — per-furniture death-loot + inline upgrade editor.

E. **Enemies + Biome sub-tabs** — typed-envelope-driven editors with palette drops.

F. **Tech Tree sub-tab** — TS DAG, layered layout, filters, pan-to-node.

G. **Furniture Loot top-level tab** — LD_ browser/editor.

H. **Validations top-level tab** — port existing rules + add the new ARR/furniture/loot rules.

I. **Tests + README** — extend `definitions-ui-smoke.mjs`, write `data-smoke.mjs`, rewrite `README.md`. Final typecheck + build + smoke + UI smoke green.

Each phase ends with the build passing.
