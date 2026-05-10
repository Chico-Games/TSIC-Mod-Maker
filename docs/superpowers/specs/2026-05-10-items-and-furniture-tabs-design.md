# Items + Furniture top-level tabs — design

**Date:** 2026-05-10
**Status:** approved, awaiting implementation plan

## Problem

The Recipes & Loot tab focuses on what items/furniture *do* in the game economy: which station crafts them, what recipes they appear in, what loot tables drop them, what biomes spawn them. Their *intrinsic data* — display name, weight, stackable, gameplay tags, mesh refs, physics, effects, health, armour — is editable today only via the catch-all Definitions tab. That tab works, but it's a flat folder rail with no awareness of the gameplay role of each class, so authoring a new weapon or rebalancing all Tier-2 furniture means trudging through a generic file picker.

## Goal

Two new top-level tabs that browse and edit asset definitions by class, with a workflow tuned for the way the game treats each class:

- **Items** — one sub-tab per item folder (crafting materials, consumables, equippables, etc).
- **Furniture** — one sub-tab per furniture folder (damageable, toggleable, storage, stations, etc).

Both tabs share a single `<ClassBrowserTab>` component driven by a per-folder config. Features added once apply everywhere.

## Non-goals

- Not deleting or reshaping the existing Recipes & Loot tab. The new Furniture tab is a sibling — Recipes & Loot keeps focus on recipes/loot/economies; the new Furniture tab focuses on intrinsic data. Cross-link buttons jump between them.
- Not deleting or replacing the Definitions tab. It stays authoritative for any record class not covered by the new sub-tabs (and remains a fallback escape hatch for everything else).
- Not changing the typed-envelope JSON data model, the typed editor widgets, the drag-and-drop dispatcher, or the persistence layer.
- Not adding asset-mesh previews or 3D viewers (potential follow-up; out of scope here).

## Design

### Information architecture

Top-level tabs after this work: **Recipes & Loot · Items · Furniture · Definitions · Validations** (5 tabs).

`AppTab` union becomes `'recipes-loot' | 'items' | 'furniture' | 'definitions' | 'validations'`.

**Items sub-tabs** (vertical rail, one per folder, in order):

1. Crafting Materials — `crafting_material_definitions`
2. Consumables — `consumable_definitions`
3. Constructables — `constructable_item_definitions`
4. Equippables — `equippable_definitions`
5. Gloves — `glove_definitions`
6. Ammo — `ammo_definitions`
7. Seeds — `seed_item_definitions`
8. Traps — `trap_item_definitions`
9. Static Items — `static_item_definitions` (last; rarely the entry point)

**Furniture sub-tabs** (vertical rail, one per folder, in order):

1. Furniture (base) — `furniture_definitions`
2. Damageable — `damageable_furniture_definitions`
3. Toggleable — `toggleable_furniture_definitions`
4. With Components — `furniture_with_components_definitions`
5. Storage — `storage_definitions`
6. Universal Storage — `universal_storage_definitions`
7. Crafting Stations — `crafting_station_definitions`
8. Production Stations — `production_station_definitions`
9. Plantable — `plantable_definitions`
10. Elevator — `elevator_definitions`
11. Teleporter — `teleporter_definitions`
12. Death Box — `death_box_definitions`
13. Containment Cage — `containment_cage_definitions`
14. Shopping Cart — `shopping_cart_definitions`
15. Spawn Points — `spawn_point_definitions`
16. Enemy Spawn Points — `enemy_spawn_point_definitions`
17. Interactable Text — `interactable_text_definitions`

**Sub-tab persistence:** `tsic.app.itemsSub.v1` and `tsic.app.furnitureSub.v1` in localStorage, defaulting to `crafting-materials` and `furniture` respectively.

**Cross-link to Recipes & Loot:** rows in the new Furniture tab whose class is `UDamageableFurnitureDefinition`, `UCraftingStationDefinition`, `UProductionStationDefinition`, or `UPlantableDefinition` show a `↗ Edit recipes/loot` button in the Detail-mode header. Clicking it sets the active tab to `'recipes-loot'`, sets the appropriate sub-tab (`'furniture'` for damageable, `'stations'` for stations/plantable), and selects the same record. Reciprocal direction: both the Recipes & Loot Furniture sub-tab and the Stations sub-tab gain a `↗ Edit intrinsic` button in their Detail headers that flips to the new Furniture tab and selects the same record. All three buttons reuse the existing tab-switching pattern (the Recipes & Loot Furniture sub-tab already does `setTab('definitions')` for jumps via `useRefAdapter`).

### Shared `ClassBrowserTab` component

Three columns:

```
┌────────────────┬───────────────────────────────────┬──────────────────┐
│  RAIL (left)   │  WORKSPACE (center, mode-driven)  │  PALETTE (right) │
│  - search      │  Mode: Detail | Spreadsheet |     │  - existing      │
│  - virtual     │        Compare                    │    ItemPalette   │
│    list of     │                                   │    component     │
│    records     │  Detail   = TypedPropertiesEditor │                  │
│  - multi-      │             + Where-Used + Static │                  │
│    select      │             Partner sections      │                  │
│  - +New        │  Spread   = sortable table        │                  │
│  - row chips   │  Compare  = 2–3 records aligned   │                  │
│    (warnings)  │                                   │                  │
└────────────────┴───────────────────────────────────┴──────────────────┘
```

**Workspace modes** (toggle in workspace header, persisted per sub-tab via `tsic.classBrowser.<folder>.mode.v1`):

- **Detail** (default) — picks one record from the rail, runs the existing `<TypedPropertiesEditor>` plus the new feature panels (where-used, static partner, equippable smart effects, row warnings).
- **Spreadsheet** — sortable, filterable flat table of all records in the folder, columns from the per-folder config plus the always-included defaults. Click any cell to flip to Detail with that record selected and that property auto-focused.
- **Compare** — when 2 or 3 records are multi-selected on the rail, renders them side-by-side with diffs highlighted.

**Multi-select on rail:** click = single-select, ctrl/cmd-click = toggle, shift-click = range. With ≥2 selected, a floating action bar appears: `Compare · Bulk edit… · Duplicate × N · Clear`. The action bar disappears when selection drops below 2.

**Property-echo on rail:** when the user clicks/focuses a property cell in the Detail editor, every visible row in the rail grows a small inline pill showing that record's value for the same property path (or `—` if absent). Lives in component state, ephemeral, clears on Esc, on switching modes, on switching sub-tabs, or on clicking outside any property cell. Reuses the trailing-chip slot on rail rows.

**Component contract:**

```ts
<ClassBrowserTab
  folder="equippable_definitions"
  config={equippableConfig}
/>
```

The component owns its rail, workspace, palette, action bar, mode toggle, and the property-echo state. It pulls records and editing primitives from `definitionsStore`, references from the new `referencedByIndex`, and warning rules from the config + defaults.

### Per-folder config

Lives in `web/src/components/classBrowser/configs.ts`:

```ts
export interface ClassBrowserConfig {
  /** Heading + emoji + sort weight for the sub-tab rail entry. */
  label: string;
  emoji: string;
  sortWeight?: number;

  /** Spreadsheet columns. Each is a property path inside `properties`,
   *  plus how to render and sort it. */
  columns: Column[];

  /** Inline row-warning rules. Run against each record on every render
   *  (cheap — operate on the in-memory definition), return chips. */
  warnings?: WarningRule[];

  /** Folders the right-side ItemPalette should show in this sub-tab.
   *  Defaults to the folder being browsed + crafting_material +
   *  consumable + ammo. */
  paletteFolders?: string[];

  /** True for folders whose records have an FD_*_SI partner that the
   *  Items tab should auto-create on tab open. Static items themselves
   *  are not partners. */
  hasStaticPartner?: boolean;

  /** Class name used when the +New button mints a record. Resolved via
   *  the existing createDefinitionForClass. */
  newRecordClass: string;

  /** Optional id template, e.g. (n) => `ID_New${n}_CM`. Falls back to
   *  the existing per-class idTemplates. */
  idTemplate?: (n: number) => string;
}

interface Column {
  key: string;                      // "weight" | "stackable" | …
  label: string;
  path: string[];                   // ["properties","weight","value"]
  kind: 'string' | 'number' | 'bool' | 'tag' | 'ref' | 'count';
  width?: number;
}

interface WarningRule {
  id: string;                       // "missing-static-partner"
  severity: 'info' | 'warn' | 'error';
  test: (rec: DefinitionRecord, ctx: WarningCtx) => string | null;
  fix?: (rec: DefinitionRecord, ctx: WarningCtx) => void;
}

interface WarningCtx {
  findKeyById: (id: string) => DefinitionsKey | null;
  records: Map<DefinitionsKey, DefinitionRecord>;
  createDefinitionForClass: (className: string, id: string) => DefinitionsKey | null;
  updateValueAtPath: (k: DefinitionsKey, path: (string|number)[], value: any) => void;
}
```

**Configs ship as a flat object map** keyed by folder name. Adding a new asset class is a new entry — no new component file.

**Defaults baked into `<ClassBrowserTab>`** (so configs stay terse):

- Always-included columns: `id`, `display_name`. `level` is added when at least one record in the folder has a `level` property (per-folder presence check); rows lacking it render `—`.
- Always-included warnings:
  - Missing `display_name` (severity `info`).
  - Missing static-item partner when `hasStaticPartner: true` (severity `warn`, fix mints a blank `FD_<base>_SI`).
  - Unresolved `definition_ref` slots anywhere on the record (severity `error`).
- Default palette folders: the folder itself + `crafting_material_definitions` + `consumable_definitions` + `ammo_definitions`. Configs can override.

**Example — `crafting_material_definitions`:**

```ts
crafting_material_definitions: {
  label: 'Crafting Materials', emoji: '🔧',
  newRecordClass: 'CraftingMaterialDefinition',
  hasStaticPartner: true,
  columns: [
    { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    { key: 'stackable', label: 'Stack', path: ['properties','stackable','value'], kind: 'bool', width: 60 },
    { key: 'category', label: 'Cat', path: ['properties','item_category_tag','value'], kind: 'tag' },
  ],
  warnings: [
    { id: 'zero-weight', severity: 'warn',
      test: (r) => r.json?.properties?.weight?.value === 0 ? 'weight = 0' : null },
  ],
}
```

### New features in detail

**Spreadsheet view.** A virtualised flat table (reuses `<VirtualList>` or a thin row-based wrapper). Columns from config + always-included defaults. Click a header to sort; ctrl-click to add a secondary sort. Click any cell value to flip into Detail mode with that record selected and that property auto-focused (which also triggers property-echo on the rail when you flip back). Filter box at the top filters by id / display_name (reuses `useHybridSearch`). Selection in the table mirrors rail multi-select, so the action bar applies in either mode.

**Where-Used panel** (Detail mode, below the typed editor). Computed from a definitions-store-wide `referencedByIndex` built once on definitions load and incrementally updated on `updateValueAtPath`. Index shape:

```ts
referencedBy: Map<string /* targetId */, Set<{ ownerKey: DefinitionsKey, path: (string|number)[] }>>
```

For an items page it lists: recipes that input or output this item, loot tables that drop it, biomes whose LSPs include it. For furniture: biomes that spawn it, upgrade chains it's part of, what deconstructs into it (via the `constructable_item_to_grant` ref chain). Each row is a click-to-jump that uses the existing `useJumpToDefinition`. The section is collapsed by default; expansion state is per-record-key, ephemeral.

**Inline row warnings.** Per-folder rules from config plus the always-included defaults. Renders as a small chip at the right edge of each rail row (severity colour: gray/yellow/red). Same chip strip at the top of the Detail editor for the selected record. Click → if the warning has a `fix()` thunk, run it; else jump to the offending property using `useJumpToDefinition` semantics.

**Bulk multi-select edit.** Action bar appears with ≥2 selected. `Bulk edit…` opens a dialog:

1. Pick a property — typeahead from the union of property keys across the selection (so you can't accidentally bulk-set a property that doesn't exist on half the records).
2. Pick a value editor — same `<TypedValueEditor>` the Detail mode uses, type-driven by the property's envelope (resolved from the first selected record that has the property).
3. Preview "Apply to N records — A, B, C, …" with a "skip M records (incompatible type)" line if the chosen value's envelope doesn't match every selected record's envelope at that path.
4. Confirm.

Internally just iterates `updateValueAtPath` per record key. Tag drops onto the selection: drag a gameplay tag from anywhere onto the selection bar → adds the tag to every selected record's `gameplay_tags` array (skips records that already have it).

**Compare view.** With 2 or 3 records selected, workspace renders columns side-by-side. Properties union'd across the selection; rows where values differ are highlighted; rows where all values match are dimmed and collapsed under a "matching properties (N)" disclosure. Each cell is read-only in MVP — to edit, click → flip to Detail with that record selected, edit, flip back. Class header above each column makes mixed-class comparisons (e.g., a glove and an equippable) visible.

**Duplicate.** Right-click any rail row → context menu → `Duplicate as new…`. Generates the next-free id from the folder's id pattern (or the config's `idTemplate`), deep-clones the JSON via `structuredClone`, mints via `createDefinitionForClass`, opens it in Detail mode. Multi-select duplicate (`Duplicate × N` from the action bar) does the same per record, sequentially. Fallback id pattern: `${originalId}_Copy`, then `_Copy2`, `_Copy3`.

**Property-echo on rail.** Implementation: when the user clicks a property cell in the Detail editor, the component publishes `{ ownerKey, path }` to local state via a context. Rail rows read it and render the value at that path for their own record (formatted by `kind` from config; falls back to `JSON.stringify(value).slice(0, 12)`). Ephemeral — clears on Esc, on selection change away from this sub-tab, or on clicking outside any property cell.

**Auto-create static partners on tab open.** When the Items tab mounts, walk every config with `hasStaticPartner: true`. For each record in those folders, check if `properties.static_item_definition.value` resolves via `findKeyById`; if not, mint a blank static partner via `createDefinitionForClass('StaticItemDefinition', <derivedId>)` and write the new id back into the source record's slot. Partner-id derivation: take the source record's id, strip the `ID_` prefix and the trailing `_<classSuffix>` (e.g. `_CM`, `_EQ`, `_GL`, `_AM`, `_CO`, `_SD`, `_TR`, `_CN`), and form `FD_<base>_SI`. Example: `ID_Backpack_CM` → `FD_Backpack_SI`; `ID_Crossbow_EQ` → `FD_Crossbow_SI`. If the derived id collides with an existing record (rare; another item already uses the same base), fall back to `FD_<base>_SI_<n>` with the lowest free `n`. All of this happens in a single batched `useEffect` that calls `useDefinitionsStore.getState()` and short-circuits if `definitions.size === 0`. A toast announces `"Created N missing static-item partners"` if any were minted; nothing renders if all were already present. Re-runs when definitions change (e.g., after Open Folder), gated by a `didAutoCreateForVersion` ref keyed on the store's load epoch so it doesn't loop on its own writes.

When the existing partner ref points at an asset that was deleted (no resolution), the auto-create treats it as missing and re-mints with a fresh id; the toast distinguishes `"minted N partners (M replacing broken refs)"`.

### Equippable smart effects view

The single class-specific custom widget. Triggered when the selected record's class is `UEquippableDefinition` or `UGloveDefinition` (gloves share the `effects_to_apply` struct).

The raw `effects_to_apply` struct has ~30 paired fields: `b_apply_X: bool` + `X: float|bool`. Today the typed editor renders all 60 controls flat. The smart view renders only active pairs:

```
┌─── Active effects ────────────────────────────────────┐
│  • +5 flat damage         [edit] [remove]             │
│  • 0.15 life steal        [edit] [remove]             │
│  + Add effect ▾                                       │
└───────────────────────────────────────────────────────┘
[ Show all (60) ]   ← falls back to the standard editor
```

**Active rule:** an effect pair is active if `b_apply_X === true`, regardless of the float's value (matches game semantics — the bool is the gate).

**Add effect picker:** typeahead over inactive pairs. Picking one flips `b_apply_X` to `true` and gives the float a sensible non-zero default (1.0 for floats, true for bools).

**Remove:** flips `b_apply_X` back to `false`. Leaves the float at its current value (so toggling on again preserves the last tuning).

**Edit value:** inline `<NumberSlider>` or `<BoolEditor>` from the existing typed widgets — no custom editor for individual values.

**Show all:** escape hatch that swaps the smart view for the standard `<TypedPropertiesEditor>` rendering of the struct.

**Implementation sketch:** a single `<SmartEffectsView>` component that takes the struct envelope and an `onChange` callback (matching the contract `<TypedValueEditor>` already uses for structs). Pair detection is mechanical: for every key starting with `b_apply_`, the partner key is the same name without the prefix. The component builds the pair list by walking the struct's value object once. Labels come from a small `effectLabels` map keyed by the float key (`flat_damage_increase: '+N flat damage'`); fallback is `humanizePropertyKey`. Unknowns fall back gracefully.

**Where it plugs in:** a single dispatch point in the Detail editor — when about to render `effects_to_apply`, route to `<SmartEffectsView>` instead of the default struct renderer. One conditional, one component.

### Code changes

**New files:**

- `web/src/components/classBrowser/ClassBrowserTab.tsx` — the shared 3-column component (rail, workspace, palette).
- `web/src/components/classBrowser/configs.ts` — per-folder config map (one entry per Items + Furniture sub-tab).
- `web/src/components/classBrowser/SpreadsheetView.tsx` — virtualised sortable table.
- `web/src/components/classBrowser/CompareView.tsx` — side-by-side property diff.
- `web/src/components/classBrowser/WhereUsedPanel.tsx` — collapsible reverse-ref list.
- `web/src/components/classBrowser/BulkEditDialog.tsx` — property picker + value editor + confirm.
- `web/src/components/classBrowser/SmartEffectsView.tsx` — equippable / glove effects custom widget.
- `web/src/components/classBrowser/RowWarnings.ts` — default warning rules + chip rendering helpers.
- `web/src/components/classBrowser/PropertyEchoContext.tsx` — context for the rail's property-echo pill.
- `web/src/components/ItemsTab.tsx` — thin wrapper, vertical sub-tab rail, mounts `<ClassBrowserTab>` per sub-tab.
- `web/src/components/FurnitureTab.tsx` — same shape.
- `web/src/store/referencedByIndex.ts` — reverse-ref index built once on definitions load, incrementally updated on `updateValueAtPath`.

**Modified files:**

- `web/src/store/appStore.ts` — extend `AppTab` union with `'items'` and `'furniture'`; add `ItemsSubTab` and `FurnitureSubTab` types and getters/setters; add localStorage keys `tsic.app.itemsSub.v1`, `tsic.app.furnitureSub.v1`.
- `web/src/App.tsx` — `renderTab` cases for the two new tabs.
- `web/src/components/Header.tsx` — two new tab buttons.
- `web/src/components/folderTheme.ts` — add emoji entries for any folder not already themed.
- `web/src/store/definitionsStore.ts` — wire `referencedByIndex` build/update; expose `referencedBy(id)` selector.
- `web/src/components/FurnitureSubTab.tsx` (Recipes & Loot) — add the reciprocal `↗ Edit intrinsic` cross-link button to the Detail-mode header.
- `web/src/components/StationsSubTab.tsx` (Recipes & Loot) — add the reciprocal `↗ Edit intrinsic` cross-link button to the station header.
- `web/src/styles-new.css` — vertical sub-tab rail styles, spreadsheet table grid, compare grid, action bar, property-echo chip, warning chips.

**No changes to:** `dnd/dispatch.ts`, `TypedValueEditor.tsx`, `DefinitionsTab.tsx`, `RecipesAndLootTab.tsx` (just two child sub-tabs grow a button), `ValidationsTab.tsx`.

### Edge cases

- **Sub-tab list grows in the future.** New folder = new entry in `configs.ts`. The vertical rail scrolls. No code change to `ItemsTab` / `FurnitureTab`.
- **Auto-create runs while user is editing.** Gated by a `didAutoCreateForVersion` ref keyed on the store's load epoch + a `definitions.size > 0` guard. Re-runs only when the user reloads a folder (which clears the working set anyway).
- **Bulk edit hits a record where the chosen property type doesn't match.** Filtered out at preview time — the dialog shows "skip M records (incompatible type)" before confirm.
- **Compare view with mixed classes.** Properties union, missing fields show `—`. Class header above each column makes the mix visible.
- **Property-echo over a property absent on some rows.** Those rows show `—`. Not a warning — many properties are class-specific.
- **Static-partner auto-create on a record whose partner ref points at a deleted asset.** Treat as missing and re-mint with a fresh id; old broken ref is replaced. Toast distinguishes `"minted N partners (M replacing broken refs)"`.
- **Where-used during initial load.** Index builds in a `useEffect` after `definitions` settles; until ready, the panel shows "indexing references…". No spinner blocks editing.
- **Duplicate of a record whose id doesn't fit the folder's id pattern.** Fall back to `${originalId}_Copy`, then `_Copy2`, `_Copy3`.
- **User saves while auto-create is mid-flight.** Auto-create writes go through `updateValueAtPath` like any edit; saved records contain the new partner refs and the new partners themselves are dirty until saved. No special handling.
- **Storage / Universal Storage / Cart sub-tabs may have only 1–17 records each.** The vertical sub-tab rail still shows them; the spreadsheet view degenerates to a tiny table — that's fine.

### Testing

- `npm run typecheck` — must pass.
- `npm run build` — must pass (also re-syncs bundled defaults).
- `npm run data-smoke` — extend to assert: every config folder has at least the always-included columns; every record in `hasStaticPartner: true` folders either resolves its partner or has the slot in its schema (so auto-create can populate it).
- `npm run smoke` — new Playwright cases:
  - Open Items tab → switch to Equippables sub-tab → assert smart effects view renders for `ID_Crossbow_EQ` → toggle an effect on → save → reload from disk → assert persisted.
  - Open Items tab → Crafting Materials → switch workspace to Spreadsheet → sort by `weight` → assert top row has the highest `weight` value.
  - Open Items tab → ctrl-click 3 records → switch to Compare → assert 3-column layout, at least one row with the diff-highlight class.
  - Open Items tab → Crafting Materials → click a property cell on a record → assert rail rows now display that property's value chip.
  - Open Furniture tab → Damageable sub-tab → click a record → click `↗ Edit recipes/loot` → assert active tab is `recipes-loot`, sub-tab is `furniture`, and the same record is selected.
  - Open Items tab on bundled defaults → assert toast about static-partner auto-creation OR no toast if all already present (parameterise on bundled state).
- Manual: open dev server, exercise each sub-tab; confirm the per-folder columns make sense visually; confirm the warning chips fire on intentional bad records (delete a static partner, set a weight to 0).

### Risk

Medium-low. New components and one new store-side index. No demolition of existing components. The reverse-ref index is the one piece with cross-cutting reach into `definitionsStore` — kept behind a single `referencedBy(id)` selector so other call sites can't accidentally couple to its internals.
