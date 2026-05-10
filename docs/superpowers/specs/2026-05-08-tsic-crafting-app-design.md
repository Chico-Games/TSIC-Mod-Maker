# TSIC Crafting & Tech Tree Tool — Design

**Date:** 2026-05-08
**Status:** Approved (verbal, brief approval — user requested "just do it")

## Purpose

A local, browser-based tool that helps the user design crafting recipes and visualize the resulting tech tree for TSIC, a Unreal-engine game in development. Source data lives in `Crafting recipes tsic.xlsx` (167 items across multiple sheets — items, loot drops, enemy drops, weapons & armour, production machines, crafting benches, shops, lookups). Most recipes are not yet authored; this tool is the authoring environment.

## Confirmed decisions

| Question | Choice |
|---|---|
| Primary workflow | Recipe authoring first, tech tree as a derived view |
| Data store | JSON project file; auto re-import xlsx on open |
| Reimport semantics | Show diff on each open, user confirms |
| Runtime | Rust → WASM in static page (no server) |
| Recipe editor UI | Bench-centric workspace |
| Tech tree UI | Free-form auto-laid-out node graph |
| Validations | Tier violations, recipe cycles, unreachable items, dead-end loot |
| Architecture | Rust-heavy (option A): xlsx + domain + validation + DAG in Rust |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  TypeScript / React UI (browser DOM)            │
│  - Bench-centric editor screen                  │
│  - Tech tree screen (react-flow)                │
│  - Drag-drop interactions (dnd-kit)             │
│  - File pickers, transient UI state (zustand)   │
└──────────────────┬──────────────────────────────┘
                   │  wasm-bindgen JS shim
                   │  (typed calls, JSON in/out)
┌──────────────────▼──────────────────────────────┐
│  Rust core (compiled to WASM)                   │
│  - xlsx parser (calamine)                       │
│  - WorldState domain                            │
│  - Validation engine (4 rules)                  │
│  - Tech-tree DAG builder                        │
│  - Diff engine for reimport                     │
└─────────────────────────────────────────────────┘
```

**Two artifacts ship:** `dist/index.html` + `dist/assets/*.js` + `dist/assets/*.wasm`. Static, no server.

## Domain model (Rust)

```rust
struct WorldState {
    items: Vec<Item>,
    stations: Vec<Station>,
    loot: Vec<LootDrop>,
    enemy_drops: Vec<EnemyDrop>,
    recipes: Vec<Recipe>,
}

struct Item { name: String, item_type: String, tier: Option<u8>, notes: Option<String> }

struct Station { name: String, kind: StationKind, department: Option<String>, tier: Option<u8>, notes: Option<String> }
enum StationKind { ProductionMachine, CraftingBench, Shop }

struct LootDrop { department: String, tier: u8, category: String, item: String }
struct EnemyDrop { enemy: String, tier: u8, item: String }

struct Recipe {
    id: String,                          // uuid v4
    output: String,                      // item name
    output_qty: u32,
    station: String,                     // station name
    ingredients: Vec<Ingredient>,        // 0..=4
}
struct Ingredient { item: String, qty: u32 }

enum Validation {
    TierViolation { recipe_id: String, message: String },
    Cycle { involved_items: Vec<String> },
    Unreachable { item: String },
    DeadEndLoot { item: String },
}
```

## WASM exports

```rust
parse_xlsx(bytes: &[u8]) -> WorldState        // empty recipes
load_project(json: &str) -> WorldState         // full project file
serialize_project(state: &WorldState) -> String
diff_reimport(current: &WorldState, fresh_xlsx: &WorldState) -> ReimportDiff
apply_reimport(current: WorldState, fresh: WorldState, choices: ApplyChoices) -> WorldState
validate(state: &WorldState) -> Vec<Validation>
build_tech_tree(state: &WorldState) -> TechTree   // nodes + edges + suggested layout positions
```

All exports use serde-wasm-bindgen with JsValue at the boundary.

## Web UI

**Top-level layout:**
- Header with project name, file actions (Open xlsx / Open project / Save / Save As), tab switcher (Recipes | Tech Tree | Validations).
- Recipes tab is the default and primary screen.

**Recipes tab (bench-centric):**
- Left rail: list of stations grouped by kind (Crafting Bench / Production Machine / Shop), each with a count of how many recipes target it.
- Center: recipe cards for the selected station. Each card shows output (with qty), 4 ingredient slots, output-qty input. An "Add recipe" button at the bottom opens an empty card.
- Right rail: searchable item palette filtered to "items not yet a recipe output" and "items reachable as ingredients (loot, enemy, or recipe output)". Drag from palette into output slot or any ingredient slot of a recipe card.
- Per ingredient slot: qty input, remove button, droppable target.

**Tech Tree tab:**
- react-flow canvas. Nodes are items and stations. Edges go ingredient → station → output. Layout: dagre auto-layout (left-to-right by tier).
- Click a node to highlight its dependency chain (BFS upstream + downstream).
- Color-code by tier and by validation status.

**Validations tab:**
- Grouped list: Tier violations, Cycles, Unreachable items, Dead-end loot. Click a finding to jump to the offending recipe in the Recipes tab or the offending node in the Tech Tree.

## Persistence

- **Read xlsx:** File System Access API picker → ArrayBuffer → `parse_xlsx` in WASM.
- **Save project:** `serialize_project` → File System Access API write or fallback `<a download>`.
- **Open project:** picker → text → `load_project`. JSON references the xlsx by display name; user re-picks xlsx on each open (browsers can't store arbitrary file paths; we store the last name and prompt for the file).
- **Reimport flow:** when a project is open and user picks the matching xlsx, run `diff_reimport`, show modal listing added/removed/changed items, user confirms before applying.

## Error handling

- Rust returns `Result<JsValue, JsValue>` from every export. UI shows toast errors.
- Malformed xlsx → user-readable error naming the sheet/row.
- Unknown ingredient or station name in JSON → kept as a soft reference, rendered with red border in the UI; appears as a validation finding.

## Testing

- Rust: unit tests for each validation rule, cycle detection, diff engine. `cargo test` in `rust-core`.
- Web: skip e2e for v1 (this is a personal tool, single user). Type-check via `tsc --noEmit`. Component tests deferred.

## Out of scope (v1)

- Writing back to xlsx (json-only, as confirmed).
- Multi-user / sync / sharing.
- Undo/redo (state shape supports adding it later via JSON snapshots).
- Exporting to Unreal data tables (separate concern; can add an exporter later).
- Mobile / small-screen layouts.

## File structure

```
tsic-crafting-tool/
  Cargo.toml                       # workspace
  rust-core/
    Cargo.toml
    src/
      lib.rs                       # wasm-bindgen exports
      domain.rs                    # types
      xlsx.rs                      # calamine parser
      validation.rs                # 4 rules
      tree.rs                      # DAG builder
      diff.rs                      # reimport diff
  web/
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx
      api.ts                       # WASM wrapper
      types.ts                     # mirrors Rust types
      store/projectStore.ts        # zustand
      components/
        Header.tsx
        RecipesTab.tsx
        StationList.tsx
        RecipeCard.tsx
        ItemPalette.tsx
        TechTreeTab.tsx
        ValidationsTab.tsx
        ReimportDialog.tsx
  README.md
```
