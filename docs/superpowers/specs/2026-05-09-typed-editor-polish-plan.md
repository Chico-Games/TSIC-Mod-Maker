# Typed Editor Polish Plan (2026-05-09)

This is the next major batch of work on the Definitions editor, queued by the user
after the typed-editor + reference viewer + naming-cleanup phases were verified.
The user explicitly said "do everything without my input" and to lay out the plan
*before* compacting the conversation. This file exists so the plan survives
context compaction — agents resuming work after `/compact` should read this top
to bottom and then work the TaskList in order.

## Scope

The user listed many items in one message. Grouped into four phases.

### Phase A — UPROPERTY metadata pipeline (foundation)
Without this most of the UI improvements are guesses.

1. **`Tools/Export/scan_property_meta.py`** — standalone Python script (no UE
   dependency). Walks every `.h` under `Source/TSIC/Public`, extracts:
   - the class or struct name a property lives in
   - the property's C++ type (parsed enough to recognize `TArray<TObjectPtr<UFoo>>`,
     `TArray<TObjectPtr<const UFoo>>`, `TSubclassOf<UFoo>`, etc.)
   - the leading `/** ... */` doc comment (used as tooltip)
   - meta tags: `Category`, `ClampMin`, `ClampMax`, `UIMin`, `UIMax`,
     `EditCondition`, `Categories` (gameplay-tag root), `DisplayName`
   - the edit-spec (`EditAnywhere` / `EditDefaultsOnly` etc — defines whether
     editor should let users change it at all)
   - struct fields too (USTRUCT bodies)
   - bool stripping: a UPROPERTY whose C++ name starts with `b` followed by an
     uppercase letter is stripped to match the snake_case the exporter uses
     (`bStackable` → `stackable`)
   - exported as snake_case property name to match the exporter's convention
   - written to `Tools/Export/test-output/Definitions/.property-meta.json`

   Schema:
   ```json
   {
     "schema_version": 1,
     "properties": {
       "ItemDefinition.stackable": {
         "tooltip": "Whether multiple instances stack in a single inventory slot.",
         "category": "Item",
         "cpp_type": "bool",
         "element_class": null,
         "clamp_min": null, "clamp_max": null,
         "ui_min": null, "ui_max": null,
         "edit_condition": null
       },
       "InventoryRules.whitelisted_items": {
         "tooltip": null,
         "category": null,
         "cpp_type": "TArray<TObjectPtr<const UItemDefinition>>",
         "element_class": "ItemDefinition",
         ...
       }
     }
   }
   ```

   Run it once now (during implementation). It's a build artifact — fine to
   regenerate later by hand.

### Phase B — Store extensions

2. **Load `.property-meta.json` sidecar** in `definitionsStore.readAllJson` and
   cache as `propertyMeta: Map<key, PropertyMeta>`. Lookup helper
   `getPropertyMeta(className, propertyName)` returns the entry.
3. **Skip layout folders** entirely. Filter `layout_definitions` and
   `layout_object_definitions` (anything matching `^layout`) from `folders`
   on load. Do not write them. Existing files stay on disk untouched.
4. **Class-change support**:
   - `changeClass(key, newClass)` action that updates `json.class` and
     `json.parent_classes` from the class hierarchy.
   - `saveOne` / `saveAllDirty` — when the record's class implies a different
     folder than `rec.folder`, write the new file in the target folder, then
     remove the old file. Update `rec.folder` after the write succeeds.
5. **`lookupArrayElementClass(path)`** action that consults `.property-meta.json`
   to fill in element classes for empty arrays where schema-sniff also turned
   up nothing (e.g. `inventory_rules.whitelisted_items` — no asset in the
   project has populated values, so the only source is the .h scan).

### Phase C — Reusable widgets

6. **`SearchableSelect.tsx`** — combobox with text-filtered options.
   Props: `value`, `options: Array<{value, label, hint?, color?}>`,
   `placeholder?`, `onChange`, `onCreateNew?`, `allowEmpty?`.
   Renders: trigger button (showing label of selected option) → on click,
   opens a popover with text input + filtered list. Keyboard nav (↑↓ Enter Esc).
   Used by:
   - definition_ref dropdowns (replaces native `<select>`)
   - the new class dropdown
   - gameplay_tag input (when `.gameplay-tags.json` sidecar is present, autocomplete from it)
7. **`WideToggle.tsx`** — full-width pill button replacing checkboxes for bool
   envelopes. Two variants: `Yes/No` for plain bools, `On/Off` for `b_apply_*`
   gating bools.
8. **`NumberSlider.tsx`** — when a property has both `clamp_min` and `clamp_max`
   (or `ui_min`/`ui_max`) from `.property-meta.json`, render a slider + linked
   number input. Step = (max - min) / 100 for floats, 1 for ints.
9. **`PropertyHoverTooltip.tsx`** — small `<abbr>` style component that wraps a
   field label and shows the tooltip from .property-meta on hover.

### Phase D — Editor restructure

10. **Class field becomes a `SearchableSelect`** with hover hierarchy.
    - Options: every entry in `classNodes` (filterable by family root)
    - On select: call `changeClass`. Show a confirmation toast: "Changed class
      to X — will move to <folder> on save".
    - Hover: full parent chain `UConsumableDefinition → UEquippableDefinition → UItemDefinition → UDataAsset → UObject`.
11. **Per-asset property search bar** at the top of `DefinitionEditor`:
    - case-insensitive substring match against `humanizeProperty(name)` AND raw `name`.
    - Filters which properties render. Updates the "(N hidden)" footer.
12. **Folder list search bar** (left pane).
    - Same pattern as the existing file-list filter input.
    - Add an emoji + color tint per folder using the new `folderTheme` map.
13. **Property grouping**:
    - Toolbar select with options: Default (current sort), By Type, By Category.
    - "By Type" groups properties by typed-envelope `type` tag (definition_ref,
      gameplay_tag, struct, primitive, …).
    - "By Category" uses the UPROPERTY Category from `.property-meta.json`,
      falling back to "Uncategorized" when missing.
14. **Color-coded property fields**:
    - Each typed envelope renders with a left-border stripe colored by type
      (definition_ref blue, gameplay_tag green, struct purple, bool amber, etc.).
    - Reuse the `--type-color-*` CSS variables added for the folder theme.
15. **Folder theme map** (`folderTheme.ts`):
    - emoji + color per folder. Examples:
      - `consumable_definitions` → 🥗 warm green
      - `equippable_definitions` → ⚔️ steel blue
      - `craft_recipe_definitions` → 📋 amber
      - `loot_definitions` → 💰 gold
      - `furniture_definitions` → 🛋️ taupe
      - `crafting_station_definitions` → 🛠️ orange
      - `enemy_definitions` → 👹 red
      - … see `folderTheme.ts` for the full list
    - Surfaces: folder list rows, editor header stripe.
16. **Per-property tooltip** wired through `getPropertyMeta` everywhere a label
    is rendered (TypedField labels + struct field labels). Falls back to no
    tooltip when meta is missing.
17. **Slider widget** wired in the number primitive editors when
    `getPropertyMeta` returns clamp/UI bounds.

### Phase E — Tests

18. Extend `definitions-ui-smoke.mjs`:
    - **Class change** — set the class via dropdown, save, verify new file in
      new folder + old file removed; verify `parent_classes` was updated.
    - **Searchable dropdown** — open class dropdown, type "consum", verify
      filtered options.
    - **Hierarchy hover** — verify the class field's title attribute contains
      the parent chain.
    - **Property search** — type into the per-asset property search, verify
      non-matching props hidden.
    - **Folder search** — type into the folder search, verify filtering.
    - **Wide toggle** — click a bool's wide button, verify state flips and dirty
      mark appears.
    - **Slider** — fixture a float property with clamp_min/max in
      `.property-meta.json`; assert a slider input renders alongside the
      number input.
    - **Whitelisted items** — fixture an `InventoryRulesDefinition` with empty
      `whitelisted_items`; with `.property-meta.json` saying
      `element_class=ItemDefinition`, assert clicking +Add seeds a working
      `definition_ref` dropdown listing `ItemDefinition` subclasses.
    - **Layouts excluded** — fixture a `layout_definitions` folder; assert it
      doesn't appear in the folder list and isn't written on save.
    - **Folder theme** — assert folder rows have the emoji + class hook.
    - **Color-coded fields** — assert distinct CSS color hooks per typed envelope.
    - **Grouping** — switch grouping mode, verify ordering changes.
19. Re-run `definitions-smoke.mjs` (data smoke) against the real export to
    catch regressions in the orphan / search / class-index logic.

## Non-goals (explicit)

- **No code-side changes to the UE C++ project.** The .h scan only reads.
- **Don't delete layout files from disk.** They're skipped by the editor; the
  user can decide whether to remove them at the source.
- **Don't try to derive every UE meta tag.** Tooltip + Category + clamp + element
  class is enough for now. If `.property-meta.json` lacks an entry, fall back to
  the existing typed-editor behavior — the editor must still work end-to-end
  without the sidecar.

## Definition of done

All Phase E tests pass; `definitions-smoke.mjs` against the real 2172-file
export still reports OK; manual spot-check of a `ConsumableDefinition` shows
emoji on its folder, slider for `weight` (if scan finds clamp meta), tooltip on
`stackable`, dropdown that filters by "consum"; Class field on the consumable
shows the full parent chain on hover and lets the user change to
`UCraftingMaterialDefinition` (file moves to `crafting_material_definitions/`
on save).

## Implementation order

Strict dependency: A → B → C → D → E. Within Phase D, item 15 (folder theme
map) blocks 12, 14, 16. Item 1 (.h scan) blocks 2, 5, 8, 9, 16, 17.
