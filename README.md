# TSIC Crafting Tool

A drag-and-drop authoring tool for the TSIC `Definitions/` data tree. Static web app — TypeScript + React, no Rust core. Reads and writes the same folder of typed-envelope JSON exports that the game ships with.

## Quick start

```sh
cd web
npm install
npm run dev
# open http://localhost:5173
```

The first run loads the **bundled defaults** baked into the build at `web/public/base-definitions/`. To edit your real export, click `📂 Open folder` in the header and point at e.g. `C:\Users\Administrator\Documents\Unreal Projects\TSIC\Tools\Export\test-output\Definitions`. The directory handle persists in IndexedDB; subsequent reloads reconnect automatically.

## Header buttons

| Button | What it does |
|---|---|
| 📂 Open folder | Pick a Definitions folder to read/write. |
| 💾 Save | Save every dirty record back to the picked folder. |
| Save as… | Pick a fresh folder; write the entire working set there. |
| ↺ Bundled defaults | Drop the folder handle and reload the bundled tree. |
| ⟳ Reload | Re-read the picked folder from disk (discards in-memory edits). |
| ⌘K Search | Fuzzy search every loaded asset. |

## Tabs

- **Recipes & Loot** — five sub-tabs:
  - **Stations**: pick a crafting / production / plantable station; the right pane shows recipes pulled from its `available_recipe_rules_definition` (ARR). Each recipe renders as a card whose layout adapts to its class (`UCraftRecipeDefinition`, `UPlantRecipeDefinition`, `UFurnitureUpgradeRecipe`). Plantable stations include the `grow_stages` editor.
  - **Furniture**: per-furniture page; edits death loot tables (`loot_dropped_on_death`) and the upgrade recipe inline.
  - **Tech Tree**: dagre-layered DAG of items / recipes / stations driven by the loaded definitions.
  - **Enemies**: per-enemy `death_drop_table` editor, envelope-driven.
  - **Biome**: per-biome editor of the `LSP_<biome>_Floor` / `LSP_<biome>_Furniture` LootSpawnPoint pair.
- **Furniture Loot** — flat browser/editor over `loot_definitions/`. The same LD_ assets that biomes and furniture reference.
- **Definitions** — schema-aware editor for any record. Three-pane layout (folder rail, file list, typed-envelope editor). The new sub-tabs cover the common authoring flows; this tab is authoritative for everything else.
- **Validations** — orphan refs, missing Item↔StaticItem partners, stations with no/missing ARRs, empty/orphan ARRs, recipes with no inputs/outputs, FurnitureUpgradeRecipe whose target is unset/missing, orphan loot tables.

## Drag-and-drop

A single `<DndContext>` at app root with a unified dispatcher in `web/src/dnd/dispatch.ts`. Sources: palette items (any definition), recipe cards, slot values. Targets: recipe input/output cells, upgrade cost cells, loot entries, ARR recipe lists, station rows. Dropping a recipe card on a station row pops the ref out of its current ARR and pushes it onto the target ARR — the recipe asset itself doesn't move on disk.

## Bundled defaults

`web/scripts/sync-base-definitions.mjs` mirrors the live export into `web/public/base-definitions/` and emits a `manifest.json`. `npm run dev` and `npm run build` both run the sync first. Override the source with `TSIC_DEFINITIONS_SRC`:

```sh
TSIC_DEFINITIONS_SRC="D:\\Game\\Definitions" npm run sync-defaults
```

The bundled tree includes the `.class-hierarchy.json` and `.property-meta.json` sidecars, so the typed editor's UPROPERTY tooltips, clamp bounds, and enum dropdowns work the same regardless of source.

## Tests

```sh
# Type check
npm run typecheck

# Production build
npm run build

# Data smoke (loads bundled defaults, asserts cross-references resolve)
npm run data-smoke

# UI smoke (Playwright; spawns vite preview, exercises the Definitions tab)
npm run smoke
```

## File structure

```
web/
  scripts/sync-base-definitions.mjs    # mirrors Definitions/ → public/base-definitions/
  public/base-definitions/             # bundled tree (generated; gitignored is fine)
  src/
    App.tsx                            # DndContext + tab shell
    dnd/dispatch.ts                    # unified drag-drop dispatcher
    store/
      definitionsStore.ts              # zustand: load/save, indexes, validations
      appStore.ts                      # zustand: tab + sub-tab + search-open
    components/
      Header.tsx
      RecipesAndLootTab.tsx            # sub-tab strip
      StationsSubTab.tsx
      FurnitureSubTab.tsx
      TechTreeSubTab.tsx
      EnemiesSubTab.tsx
      BiomeSubTab.tsx
      FurnitureLootTab.tsx
      DefinitionsTab.tsx               # typed-envelope editor (large)
      ValidationsTab.tsx
      RecipeCard.tsx
      DefRefSlot.tsx                   # one editable definition_ref + qty
      ItemPalette.tsx                  # draggable definition browser
      GrowStagesEditor.tsx             # plant grow_stages array editor
      ...
docs/superpowers/specs/                # design docs
```

## Browser support

Requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker) — Chromium-based browsers (Chrome / Edge / Brave). Other browsers can still read the bundled defaults but cannot Save / Save As.
