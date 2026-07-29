# Fix plan: recipe/loot rendering + overlay-save regressions

**Date:** 2026-07-07
**Status:** ready to implement
**Audience:** an engineer/AI who has NOT seen the QA session. Everything needed is below.

## TL;DR

Three confirmed bugs, all downstream of the lean⇆envelope boundary. The on-disk data
is **lean**; the in-memory working set is **typed envelopes**; the translation happens in
`web/src/persistence/dataSource.ts` (`leanTextToEnvelope` / `envelopeTextToLean`) driven by
the pack's `_schema.json`. Each bug is a place where a consumer assumed one representation
but got the other (or got a schema-gap fallback shape).

| # | Severity | Symptom | Root cause |
|---|----------|---------|------------|
| 1 | High | Every station's recipe list shows "No recipes in this ARR yet." even though the rail badge shows a non-zero count (Oven 14, Microwave 8). | `_schema.json` struct `ProductionMachineRules` has empty `fields:{}`, so the inner `recipes` array converts to `{type:'string'}` elements instead of `{type:'definition_ref'}`. |
| 2 | High | Recipe ingredient/output slots, upgrade-cost slots, and furniture death-loot slots all render an empty "pick ItemDefinition" while quantities show correctly. | `DefRefSlot.tsx` only recognizes `type:'definition_ref'`; those refs are `type:'soft_asset_ref'`. |
| 3 | Critical | "Save As" (and first-save overlay migration) writes the **entire** 2201-file tree instead of only changed files, for a project based on the Default Project. | `computeOverlay()` compares the default's canonical **lean** text against the working set's canonical **envelope** text — they never match, so every record is flagged as an override. |

None of these corrupt data on disk today (Default Project is read-only HTTP). Bug 3 corrupts
the *shape* of any project you Save-As (writes a full copy where an overlay was intended).

## How to run and verify

```sh
cd web && npm run dev      # http://localhost:5173  (loads the bundled Default Project; ~20s, 2201 defs)
```

### Live-state probe (how the bugs were confirmed — reuse to confirm fixes)

Temporarily expose the stores, then inspect from the browser console / an automation tool.
Add near the existing `window.__forceDirty` hook in `web/src/store/definitionsStore.ts`
(remove after):

```ts
(window as any).__tsicProbe = { defStore: useDefinitionsStore, assetStore: useAssetCatalogStore };
```

Reload the page (a full reload, not HMR — HMR wipes the working `definitions` map). Then:

```js
const s = window.__tsicProbe.defStore.getState();
const canon = j => JSON.stringify(j, null, 2) + "\n";
const byId = id => { for (const [,r] of s.definitions) if (r.json?.id===id) return r; };

// BUG 3 — overlay diff on an UNCHANGED working set (s.dirty.size === 0):
let overrides=0, matches=0;
for (const [k,rec] of s.definitions) { if(!rec.json) continue;
  const d=s.defaultProject.texts.get(k), r=canon(rec.json);
  if(d===undefined) continue; if(d!==r) overrides++; else matches++; }
console.log({dirty:s.dirty.size, overrides, matches}); // OBSERVED: {dirty:0, overrides:2201, matches:0}

// BUG 1 — station recipe element types:
const arr = byId('ARR_OvenRecipes').json.properties.production_machine_rules.value.recipes;
console.log(arr.value.length, arr.value.map(e=>e?.type)); // OBSERVED: 14, all "string"

// BUG 2 — recipe input key + death-loot element types:
console.log(byId('RD_BakedPotato_CR').json.properties.input.value[0].key.type);          // "soft_asset_ref"
console.log(byId('FD_Aircon_Constructed_DF').json.properties.loot_dropped_on_death.value[0].type); // "soft_asset_ref"
```

A correct fix must flip these observed values (Bug 3: overrides→0, matches→2201 with no
edits; Bug 1: pane resolves 14 refs; Bug 2: slots resolve).

### Node harness (representation math, no browser)

```sh
cd web
# writes a temp file, runs it with the project's tsx, deletes it
cat > _probe.mjs <<'EOF'
import { readFileSync } from 'fs';
import { leanPropsToEnvelope } from './src/persistence/leanEnvelope.ts';
const schema = JSON.parse(readFileSync('public/starter-project/_schema.json','utf8'));
const f = 'public/starter-project/craft_recipe_definitions/RD_BakedPotato_CR.json';
const j = JSON.parse(readFileSync(f,'utf8'));
const defText = JSON.stringify(j, null, 2) + '\n';                 // default side (lean)
const env = { ...j, properties: leanPropsToEnvelope(j.properties, j.class, schema) };
const recText = JSON.stringify(env, null, 2) + '\n';               // working side (envelope)
console.log('unchanged record equal?', defText === recText);      // false  (548 vs 1713 bytes)
EOF
npx tsx _probe.mjs; rm _probe.mjs
```

---

## Bug 1 — station recipe lists render empty

### Evidence
- Live: `ARR_OvenRecipes.production_machine_rules.value.recipes` has 14 elements, **all `type:"string"`**.
- Rail badge counts raw array length (`StationsSubTab.tsx:126-127`), so it shows 14.
- The recipe pane builds `recipeRefs` by filtering `e.type === 'definition_ref'`
  (`StationsSubTab.tsx:250-257`) → 0 → "No recipes in this ARR yet." (`:502`).

### Root cause
`web/public/starter-project/_schema.json` → `structs.ProductionMachineRules` is `{"fields":{}}`.
`leanPropsToEnvelope` (`web/src/persistence/leanEnvelope.ts`) therefore has no field metadata
for the inner `recipes` array and generic-fallbacks its string elements to `{type:'string'}`
instead of `{type:'definition_ref', class:'CraftRecipeDefinition'}`.

This is one of **10 empty-field structs** in the schema (the schema is produced by a separate
Unreal exporter — see `memory/catalogue-generation.md`): `ColorArr`, `DirectionColorArr`,
`EnemyDifficultyTier`, `GameplayTagArray`, `HeightDirectionColorArr`, `ItemPickupSounds`,
`LootRarityMaps`, `MaterialOverridePool`, `ProductionMachineRules`,
`RotationHeightDirectionColorArr`. Several likely cause sibling display gaps (e.g. the Enemy
`DeathDropEntry` and Biome loot structs render Count/Weight but no item ref — probably the same
class of gap; audit them).

### Fix (recommended: do both)
1. **Schema (real cause).** Give `ProductionMachineRules.fields.recipes` its real type — an
   array whose `element_type` is a `definition_ref` (recipe class). Prefer fixing the Unreal
   exporter and re-exporting `_schema.json`; if that's out of scope, add a local schema override
   (see how existing overrides are applied — `memory/schema-drift-causes-and-overrides.md`).
   After the fix, re-run `npm run refresh-schema` if applicable and re-verify the probe shows
   `definition_ref` elements. Audit the other 9 empty structs the same way.
2. **UI resilience (defensive).** In `StationsSubTab.tsx` `recipeRefs` (~:250-257), also accept
   bare-string / `type:'string'` elements: resolve them as recipe ids via `findKeyById`. This
   makes the pane robust to schema gaps and to older data. Keep it — it's cheap insurance.

### Regression test
Add to `web/recipes-loot-ui-smoke.mjs`: select a production station with a known ARR (Oven) and
assert the pane renders N recipe cards where N === rail badge count.

---

## Bug 2 — recipe/upgrade/loot item slots render blank

### Evidence
- Live: `RD_BakedPotato_CR.input.value[0].key.type === 'soft_asset_ref'`;
  `FD_Aircon_Constructed_DF.loot_dropped_on_death.value[0].type === 'soft_asset_ref'`.
- `web/src/components/DefRefSlot.tsx:40`:
  `const isRef = cur && typeof cur === 'object' && cur.type === 'definition_ref';`
  → `false` for a `soft_asset_ref` cell → `refValue = ''` → renders the empty placeholder.
- `soft_asset_ref` IS handled elsewhere (`TypedValueEditor.tsx` via `pickers/AssetRefPicker.tsx`,
  and `BiomeSubTab.tsx`) — only `DefRefSlot` (shared by recipe-input / recipe-output /
  upgrade-cost / loot-entry) was never updated.

### Root cause
`DefRefSlot` predates the lean-envelope migration and only understands `definition_ref`. Recipe
ingredient/output keys and loot refs are `soft_asset_ref` (soft object pointers in UE).

### Fix
In `DefRefSlot.tsx`:
- Recognize **both** types when reading the cell: treat `cur.type === 'definition_ref' ||
  cur.type === 'soft_asset_ref'` as a ref; read `class`/`value` from either.
- **Preserve the original type on write.** `setRef` (`:116-122`) hardcodes
  `type:'definition_ref'`. It must write back the SAME type the cell already had (or the field's
  schema type when empty), or it silently converts `soft_asset_ref` → `definition_ref` and
  breaks the envelope→lean round-trip. Mirror what `AssetRefPicker` does.
- The options list (`assetsOfClass(refClass)`, `:101-114`) is fine as-is: ItemDefinition /
  LootDefinition are real definitions in the store, so the dropdown already populates.

### Regression test
Assert a recipe card's first input slot shows the resolved item name (not the placeholder), and
that editing it then reading back preserves `type:'soft_asset_ref'`.

---

## Bug 3 — Save As / overlay writes the whole tree (CRITICAL — the user's chief concern)

### Evidence
- Live, with **zero** user edits (`s.dirty.size === 0`): the `computeOverlay` comparison flags
  **2201/2201** records as overrides and **0** as unchanged.
- Unchanged record `RD_BakedPotato_CR`: default text 548 bytes (lean) vs working text 1713 bytes
  (envelope) → never equal.

### Root cause
`web/src/persistence/overlay.ts:87-108` `computeOverlay(def, working)` decides changed-ness with:
```ts
const defText = def.texts.get(k);                 // canonical LEAN  (see below)
const recText = JSON.stringify(rec.json,null,2)+'\n'; // canonical ENVELOPE
... if (defText !== recText) overrides.set(k, rec.json);
```
- `def.texts` is built from raw on-disk **lean** bytes: `loadDefaultProjectFromHttp`
  (`web/src/persistence/defaultProject.ts:112-116`) does `canonical(rawLeanText)` — no envelope
  conversion. Set into state at `definitionsStore.ts:1751-1754`.
- `rec.json` is the **envelope** form: the working-set loader converts every file via
  `ds.toEnvelopeText(leanText)` (`definitionsStore.ts:1017`).

So the two sides are in different representations and can never be equal for any record with
properties. Callers affected:
- `saveAs` overlay write (`definitionsStore.ts:1848-1937`) → writes all `overrides` = whole tree.
  (Full-tree write is meant to be a defensive fallback only when `defaultProject` is null.)
- First-save v1→v2 migration "delete files identical to default"
  (`definitionsStore.ts:2491-2524`, esp. the inline compare at `:2499-2502`) → identical files
  are never detected, so nothing is pruned.

NOTE the plain **Save** button (`saveAllDirty`, `:2421`) is correct — it iterates the `dirty`
set (`:2436`) and writes only edited files. Do **not** change that loop. Also note the FSA-**load**
overlay compose path (`:1206-1234`) is correct — it keys off `rec.originalText` and
`def.records.has(k)`, not a cross-representation text compare. Leave it alone (but re-verify after
the fix).

### Fix (recommended: compare in LEAN — the bytes that actually hit disk)
The overlay's real question is "will the file written for this record differ from what the
default ships?" Disk is lean, so compare **lean vs lean**:
- Produce each working record's lean text the same way the writer does:
  `envelopeTextToLean(serializeDefinition(rec), schema)` (this is exactly what
  `FsaDataSource.writeFile` already applies). Compare that to `def.texts` (already lean).
- `envelopeTextToLean` needs the pack schema (async `getSchema()`), while `computeOverlay` is
  sync. Two clean ways:
  - (a) Add `toLeanText(envelopeText): Promise<string>` to the `DataSource` interface (mirror of
    the existing `toEnvelopeText`), precompute a `Map<key, leanText>` for the working set, and
    pass it into `computeOverlay`; or
  - (b) Make `computeOverlay` async and hand it a `toLean` fn.
- Apply the identical comparison at the migration-delete site (`:2499-2502`).

**Alternative (envelope vs envelope):** convert `defaultProject.texts`/`.records` to envelope at
load (run each through `ds.toEnvelopeText` right after `loadDefaultProjectFromHttp/Fsa`), then
compare envelope-to-envelope. Simpler to reason about and it aligns every consumer of
`def.*` (composeWorkingSet's `originalText`, FSA-compose, computeOverlay). Downside: it's a
representation choice that must be applied consistently and assumes envelope→…→envelope is stable.
Lean-vs-lean is preferred because it directly models "bytes on disk" and is robust to
many-envelopes-map-to-one-lean.

Whichever is chosen, the invariant to enforce and test: **both operands of every overlay
comparison are in the same representation.**

### Regression test (critical)
`web/savedload-ui-smoke.mjs` (or a new unit test on `computeOverlay`): load the Default Project,
make **zero** edits, run the overlay computation, assert `overrides.size === 0` and
`additions.size === 0`. Then edit exactly one record and assert `overrides.size === 1` naming
that record. This single test would have caught the regression.

---

## Suggested order & shared guidance

1. **Bug 3 first** — highest impact, self-contained, and its regression test is the cheapest
   guard. Fix `computeOverlay` + the migration-delete compare; add the zero-edit overlay test.
2. **Bug 2** — small, localized to `DefRefSlot.tsx`; remember write-type preservation.
3. **Bug 1** — schema fix (+ the empty-struct audit) plus the UI-resilience fallback.

Cross-cutting:
- After any change touching the lean⇆envelope boundary, run the round-trip check
  (`memory/lean-format-and-game-pack.md` describes the validate-roundtrip + refresh-schema
  workflow) to ensure `lean → envelope → lean` is byte-stable for the whole Default Project.
- The empty-struct list under Bug 1 is a latent-bug reservoir; auditing all 10 is worthwhile
  (candidates already suspected: `LootRarityMaps`, `EnemyDifficultyTier`, `ItemPickupSounds`).

## Out of scope (data quality, not code — report separately to data owner)
- 85 of 122 crafting materials have `display_name === "Cardboard"` in the bundled starter data
  (description "Cardboard sheets…"). The rail/Detail views hide it via `humanizeAssetId`; the
  Spreadsheet view correctly surfaces it. Not an app bug.
- Orphan ARRs: `ARR_ArmorBenchTier1Recipes` / `…Tier2Recipes` are referenced by no station, so the
  Armor Bench stations show `ARR: none` (flagged by the Validations tab; 263 issues total).

## Minor/optional (not blocking)
- Startup runs project bootstrap 2–3× (`modIoStore.bootstrap` + `definitionsStore.bootstrap` +
  `loadBundledDefaults`) and fetches ~2200 files individually (~20–25s). De-dupe the bootstrap.
- `HttpDataSource.readCatalog` (`dataSource.ts:142-147`) JSON.parses Vite's SPA `index.html`
  fallback (200 for missing `.assets/<DefinitionClass>.json`) and logs a noisy warning per class.
  Guard on `content-type`/leading `<` and return null. Benign but noisy.
- Readability: the Recipes&Loot→Biome 3-column nested editor is very cramped; split-view panes
  scroll values off-screen at normal width; the Spreadsheet ID column is truncated unreadably.
  Consider collapsing nested sections by default and widening/removing the ID column. The
  README still lists a "Compare" mode that has been removed (now migrates to "detail").
