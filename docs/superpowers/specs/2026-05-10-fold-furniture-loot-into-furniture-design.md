# Fold the Furniture Loot tab into the Furniture sub-tab — design

**Date:** 2026-05-10
**Status:** approved, awaiting implementation plan

## Problem

Authoring a piece of furniture's death drops requires bouncing between two tabs:

- **Recipes & Loot → Furniture** sub-tab (`FurnitureSubTab.tsx`) authors `DamageableFurnitureDefinition`s. The death-loot section shows refs to `LootDefinition` assets but cannot edit them.
- **Furniture Loot** top-level tab (`FurnitureLootTab.tsx`) authors the `LootDefinition` (`LD_*`) assets themselves — `items_to_drop` and weights.

The split is a holdover from when the two surfaces were built separately. Every real edit traverses both tabs.

## Goal

Single screen, single context: select a furniture, edit its death-loot tables and upgrade recipe in place. Retire the standalone Furniture Loot tab.

## Non-goals

- Not changing how Enemies / Biome reference loot tables. They don't reference `LootDefinition` directly today; out of scope.
- Not adding a second "list of all loot tables" surface. Orphan `LootDefinition`s (not referenced by any furniture) are authored via the Definitions tab, same as any other asset class.
- Not changing the loot-table data model or the `TypedPropertiesEditor`.

## Design

### Information architecture

Header tabs shrink from 4 to 3:

- **Recipes & Loot · Definitions · Validations**

The `'furniture-loot'` discriminant is removed from `AppTab`. Stored `localStorage.tsic.tab` values of `'furniture-loot'` fall back to `'recipes-loot'` via a one-line guard in `parseStoredTab` so existing users don't land on a blank screen.

The Recipes & Loot sub-tab strip is unchanged: Stations · Furniture · Tech Tree · Enemies · Biome.

### Furniture sub-tab — death-loot section

Today each entry in `loot_dropped_on_death` renders as one `<DefRefSlot>` row. After the change, each entry becomes a `<DeathLootRow>` with two parts:

1. **Header** — disclosure caret (`▸ / ▾`) + the existing `<DefRefSlot>` + the existing remove `×`.
2. **Body** (visible only when expanded) — the linked `LootDefinition`'s full editor: the same `TypedPropertiesEditor` the Furniture Loot tab uses today, wired to the same `useRefAdapter` so middle-click navigation keeps working.

Resolution rules:

- The row reads the slot's current `value` (a loot id), looks up the asset key via `findKeyById`, then renders the editor against `definitions.get(key).json.properties`.
- If the slot is empty (no value), the caret is disabled. Nothing to expand.
- If the slot has a value but the asset isn't loaded, `autoCreateMissingRefs` (already wired into `reload()` and `loadBundledDefaults()`) will mint a blank `LootDefinition` on next load. Until then the row treats it as an empty slot — caret disabled.
- Edits flow through `updateValueAtPath(lootKey, ['properties'], next)`, just like the Furniture Loot tab does today.

Interaction details:

- **Multiple rows can be open at once.** Expansion state is a `Set<number>` (entry index) held in `FurnitureSubTab` local state.
- **Expansion state is ephemeral.** It resets when `selectedKey` (the furniture) changes, and is not persisted to `localStorage`.
- **Default state on load: collapsed.** The user opens what they want to edit.

### What stays the same on the Furniture sub-tab

- Three-column layout: rail | center pane | ItemPalette.
- Rail: families with tier pills, +New furniture, +Tier per family. No change.
- Center pane: header + Death loot section (now with inline expand) + Upgrade recipe section + +Add upgrade tier button. No change to the upgrade-recipe block.
- ItemPalette: `loot_definitions`, `damageable_furniture_definitions`, `crafting_material_definitions` folders. No change. The existing `+Add loot_definitions` chip continues to mint blank `LD_*` assets — this is the post-removal path for creating a loot table from scratch.

### Code changes

**`web/src/store/appStore.ts`** — drop `'furniture-loot'` from the `AppTab` union and from the body of `parseStoredTab`. In `parseStoredTab`, when the stored value is the literal string `'furniture-loot'`, return `'recipes-loot'` (legacy fallback).

**`web/src/components/Header.tsx`** — remove the `{ id: 'furniture-loot', label: 'Furniture Loot' }` entry from `tabs`.

**`web/src/App.tsx`** — remove the import of `FurnitureLootTab` and the `case 'furniture-loot': return <FurnitureLootTab />` line.

**`web/src/components/FurnitureSubTab.tsx`** — refactor the death-loot section:

- Add `expanded: Set<number>` to component state. Reset on `selectedKey` change via `useEffect`.
- Extract the per-entry render into a local `DeathLootRow` component (or inline JSX) with: caret button, `<DefRefSlot>`, remove `×`, and a conditionally-rendered body containing `<TypedPropertiesEditor>` against the resolved loot asset.
- Build a `useRefAdapter` instance the same way `FurnitureLootTab` does, so the inline editor's nested `definition_ref` widgets navigate to the Definitions tab on middle-click.

**`web/src/components/FurnitureLootTab.tsx`** — **delete the file.**

**`web/src/styles.css`** — remove `.furniture-loot-table*`, `.furniture-loot-header*`, `.furniture-loot-count`, `.furniture-loot-selected`, `.furniture-loot-empty`, `.furniture-loot-disabled`, `.furniture-loot-list`, `.furniture-loot-row*`, `.furniture-loot-name*` rules. Verify nothing else uses these selectors before deletion.

**`web/src/styles-new.css`** — remove `.furniture-loot-layout` block and any references in shared selectors. Add a small `.death-loot-row` / `.death-loot-row-body` pair (or reuse existing classes) for the disclosure caret + inline-body styling.

**`web/recipes-loot-ui-smoke.mjs`** — replace the Furniture Loot tab assertions:

- Drop: navigation to the `furniture-loot` tab; the `.furniture-loot-layout` selector check.
- Add: navigate to Recipes & Loot → Furniture; pick a fixture furniture that has at least one resolved death-loot ref; click the disclosure caret; assert the inline `TypedPropertiesEditor` renders for the linked `LootDefinition`; mutate `items_to_drop` (e.g., add or remove an entry); navigate away and back to the same furniture; assert the change persisted via the IndexedDB round-trip.

### Edge cases

- **Stored tab is `'furniture-loot'` from a previous session.** `parseStoredTab` returns `'recipes-loot'`. User sees Recipes & Loot. No error.
- **Furniture has no death-loot entries.** Section shows the existing "No loot tables." line and the `＋ loot table` button. No change.
- **Death-loot ref points at a `LootDefinition` that's still loading or missing.** Caret disabled, slot shows the empty state, drop targets still work.
- **Two open rows pointing at the same `LootDefinition`.** Both render the same editor against the same backing record; edits in one reflect immediately in the other (same store).
- **User deletes a furniture with rows expanded.** Selection moves; the new furniture starts with `expanded` reset.

### Testing

- `npm run typecheck` — must pass.
- `npm run build` — must pass (also re-syncs bundled defaults).
- `npm run data-smoke` — must pass (no data shape changes, but kept as a guard).
- `npm run smoke` — both Playwright UI smokes; the Recipes & Loot smoke now covers inline death-loot editing.
- Manual: load bundled defaults, pick a furniture with `loot_dropped_on_death`, expand each entry, edit `items_to_drop` weights, save, reload from disk, verify persistence.

### Risk

Low. The change is largely deletion (`FurnitureLootTab.tsx` plus its CSS and one tab entry) plus a contained UI affordance on `FurnitureSubTab.tsx`. The store layer, drag-and-drop dispatcher, ref-adapter, and `TypedPropertiesEditor` are unchanged.
