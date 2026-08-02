# TSIC Definition Editor

A browser authoring tool for the TSIC definition tree. Static web app — TypeScript + React, no
backend. Reads and writes the same folder of JSON the game loads.

> **📖 Authoring content? Start with the [Modding Guide](docs/guide/README.md)** — 14 chapters
> covering every tab, world layout, and publishing. This README is the developer view of the app.

## Quick start

```sh
cd web
npm install
npm run dev
# open http://localhost:5173
```

The first run loads the **default project** bundled at `web/public/starter-project/`, read-only.
`📂 Open project` in the header points the editor at a folder of your own. Directory handles persist
in IndexedDB and reconnect on reload.

Requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)
— Chromium only (Chrome / Edge / Brave). Other browsers can read the bundled defaults but can't save.

## Header

| Control | What it does |
|---|---|
| `⌘K Search` | Fuzzy id + substring value + semantic concept search across every loaded record. |
| `📌 Pin folder…` | One pinned folder for one-click reopen. |
| `📂 Open project ▾` | Pick a folder; the chevron lists projects in the configured Projects folder, then recents. Rows have a delete-from-disk action. |
| `✨ New project` | Create a folder, optionally seeded from the default project. |
| `💾 Save (n) ▾` | Click saves dirty records. Hover for `Save as…`, `Export` (overlay ZIP), `Export flattened`, and the mod.io actions. |
| `⚙` | Working directory + auto-load, Projects folder, Default project source, developer actions. |
| `⟳ Reload` | Re-read from disk, discarding in-memory edits. |

The info line carries project name, record and folder counts, dirty count, the mod.io sync chip and
the 🧠 semantic-index chip.

## Tabs

- **Recipes & Loot** — five sub-tabs:
  - **Stations**: pick a crafting / production / plantable station; the right pane shows recipes from
    its `available_recipe_rules_definition` (ARR). Cards adapt to the recipe class
    (`UCraftRecipeDefinition`, `UPlantRecipeDefinition`, `UFurnitureUpgradeRecipe`). Plantables get
    the `grow_stages` editor.
  - **Furniture**: per-furniture page for death loot (`loot_dropped_on_death`) and the upgrade recipe.
    Each death-loot ref expands in place to the linked `LootDefinition`'s editor.
  - **Tech Tree**: five read-only views over a graph built from the loaded definitions — Chain,
    Ladder, Cost, Chokepoints, Audit.
  - **Enemies**: per-enemy `death_drop_table` editor.
  - **Biome**: per-biome `LSP_<biome>_Floor` / `_Furniture` pair.
- **Items** — nine sub-tabs (Crafting Materials, Consumables, Constructables, Equippables, Gloves,
  Ammo, Seeds, Traps, Static Items) over the shared `<ClassBrowserTab>`: Detail / Spreadsheet modes,
  row-warning chips, Where-Used, multi-select bulk edit, duplicate, property echo. Equippables and
  Gloves get a smart effects view that hides inactive `b_apply_X` pairs. Mounting the tab mints
  missing `FD_*_SI` partners.
- **Furniture** — same component, eighteen sub-tabs, plus tier-chain grouping in the rail (`＋` mints
  the next tier and its linking upgrade recipe). Cross-links to Recipes & Loot for damageable and
  station records.
- **Definitions** — schema-aware editor for any record. Three panes: folder rail, file list, typed
  editor. Authoritative for anything the specialised tabs don't cover, including orphan `LD_*`.
- **Layouts** — three-pane 3D editor (outliner / viewport / details) over `ULayoutDefinition`, with a
  port of the engine's layout resolver: search queries, tile requirements, spawn chance, seeded
  selection, nested layouts, cycle detection. Bounding boxes come from the exported mesh catalogue.
- **AI** — five views of one live AI2 simulation: Sandbox, Scenarios, Behaviour, Perception, Attacks.
  See [docs/ai-tab.md](docs/ai-tab.md).
- **Validations** — orphan refs, item↔static partners, station/ARR problems, recipes with no
  inputs/outputs, upgrade targets, orphan loot.

## How data is stored

Files on disk are **lean** JSON (`"duration": 16.0`). The store holds **typed envelopes**
(`{type: "float", value: 16}`), converted on read/write via the pack's `_schema.json`
(`persistence/leanEnvelope.ts`). Writes are `JSON.stringify(json, null, 2) + "\n"`.

A project layers over the default project; `persistence/overlay.ts` diffs the two in lean form so
only genuinely changed records count as dirty.

Loading self-heals: every dangling `definition_ref` whose class the schema knows gets a stub minted
(`autoCreateMissingRefs`), marked dirty like any other new record.

## Drag-and-drop

One `<DndContext>` at app root, one dispatcher in `web/src/dnd/dispatch.ts`. Sources: palette items,
recipe cards, slot values. Targets: recipe input/output cells, upgrade cost cells, loot entries, ARR
recipe lists, station rows. Dropping a recipe card on a station row moves the ref between ARRs; the
asset doesn't move on disk.

## Undo, clipboard, search

- Undo/redo is snapshot-based over `definitions`/`dirty`/`tombstones`, 100 frames, coalescing
  same-target edits within 600 ms. Cleared on load.
- `Ctrl+C`/`Ctrl+V` route through `clipboard.ts` on the current path selection — array, map, slot or
  recipe.
- Search is fuzzy over ids, substring over string values, plus a semantic pass from a MiniLM
  embedding model loaded in a worker and warmed in the background after load.

## Scripts

```sh
npm run typecheck          # tsc -b --noEmit
npm run build              # tsc -b && vite build
npm run refresh-schema     # regenerate public/schema from the game export

npm run data-smoke         # load bundled defaults headlessly, assert cross-refs resolve
npm run smoke              # every Playwright UI smoke + AI smoke + AI scenario suite
npm run smoke:def          # one of: def, loot, itemsfurn, savedload, layouts, modio-ui
npm run smoke:ai           # every v2 enemy, 20 sim-seconds, headless
npm run test:ai            # the AI scenario suite (also :seeds, :determinism)
npm run test               # unit tests
```

## Layout

```
web/
  public/schema/                       # class-hierarchy.json, property-meta.json
  public/starter-project/              # bundled default project + _schema.json
  src/
    App.tsx                            # DndContext, tab shell, global keybindings
    clipboard.ts                       # copy/paste over the current selection
    dnd/dispatch.ts                    # unified drag-drop dispatcher
    persistence/
      dataSource.ts                    # HTTP + FSA sources, lean⇆envelope on read/write
      leanEnvelope.ts                  # the conversion itself
      overlay.ts                       # default-vs-working diff
      draftStore.ts, recentProjects.ts, pinnedProject.ts, projectsRoot.ts
    search/                            # fuzzy.ts, semantic.ts, semantic-worker.ts, hybrid.ts
    store/
      definitionsStore.ts              # load/save, indexes, undo history, auto-heal
      appStore.ts                      # tab/sub-tab/selection/clipboard
      validationStore.ts               # per-record drift + dangling-ref issues (the dots)
      layoutEditorStore.ts, layoutResolverStore.ts, gameplayTagStore.ts
      assetCatalogStore.ts, modIoStore.ts, referencedByIndex.ts
    components/
      classBrowser/                    # shared Detail/Spreadsheet browser + per-folder configs
      layouts/                         # Toolbar, Outliner, Viewport, Details, resolver/
      techtree/                        # Chain, Ladder, Cost, Chokepoints, Audit
      ai/                              # Sandbox, Scenarios, Behaviour, Perception, Attacks
      modio/                           # publish wizard, browse, sign-in, sync chip
      pickers/                         # TagPicker and friends
    ai/                                # the simulation itself (see docs/ai-tab.md)
docs/
  guide/                               # the modding guide
  ai-tab.md                            # AI tab internals
```
