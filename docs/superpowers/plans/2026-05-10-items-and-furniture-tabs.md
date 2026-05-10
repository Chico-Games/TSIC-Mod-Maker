# Items + Furniture top-level tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two top-level tabs (Items, Furniture) sharing a single `<ClassBrowserTab>` component driven by per-folder configs, with spreadsheet/compare/detail modes, where-used, inline warnings, bulk edit, duplicate, equippable smart-effects view, property-echo on rail, and on-mount auto-create of missing static-item partners.

**Architecture:** One reusable React component (`ClassBrowserTab`) plus a per-folder config map. Items/Furniture tabs are thin wrappers that mount it with vertical sub-tab rails. State lives in the existing `definitionsStore` and `appStore` (zustand). A new store-side module builds a reverse-reference index incrementally.

**Tech Stack:** React 18, TypeScript, zustand, @dnd-kit, Vite. Tests are typecheck (`tsc -b --noEmit`), data-smoke (Node script over bundled defs), and Playwright UI smoke. There's no unit-test runner — verification is the typecheck + smoke loop after each task.

**Spec:** `docs/superpowers/specs/2026-05-10-items-and-furniture-tabs-design.md`

---

## File map

**New files:**
- `web/src/store/referencedByIndex.ts` — reverse-ref index module
- `web/src/components/classBrowser/types.ts` — `ClassBrowserConfig`, `Column`, `WarningRule`, `WarningCtx`
- `web/src/components/classBrowser/configs.ts` — per-folder configs (one entry per Items + Furniture sub-tab)
- `web/src/components/classBrowser/RowWarnings.ts` — default warning rules + chip renderer helpers
- `web/src/components/classBrowser/PropertyEchoContext.tsx` — context for rail property-echo pill
- `web/src/components/classBrowser/ClassBrowserTab.tsx` — the shared 3-column component
- `web/src/components/classBrowser/SpreadsheetView.tsx` — virtualised sortable table
- `web/src/components/classBrowser/CompareView.tsx` — side-by-side property diff
- `web/src/components/classBrowser/WhereUsedPanel.tsx` — collapsible reverse-ref list
- `web/src/components/classBrowser/BulkEditDialog.tsx` — property picker + value editor + confirm
- `web/src/components/classBrowser/SmartEffectsView.tsx` — equippable / glove effects custom widget
- `web/src/components/ItemsTab.tsx` — vertical sub-tab rail wrapper
- `web/src/components/FurnitureTab.tsx` — vertical sub-tab rail wrapper

**Modified files:**
- `web/src/store/appStore.ts` — extend `AppTab` union; add Items/Furniture sub-tab unions and persistence
- `web/src/store/definitionsStore.ts` — wire `referencedByIndex` build/update; expose `referencedBy(id)` selector
- `web/src/App.tsx` — `renderTab` cases for the two new tabs
- `web/src/components/Header.tsx` — two new tab buttons
- `web/src/components/FurnitureSubTab.tsx` (Recipes & Loot) — add `↗ Edit intrinsic` button
- `web/src/components/StationsSubTab.tsx` (Recipes & Loot) — add `↗ Edit intrinsic` button
- `web/src/styles-new.css` — vertical sub-tab rail, spreadsheet, compare, action bar, chips
- `web/data-smoke.mjs` — assert configs cover folders + partner-resolvable
- `web/recipes-loot-ui-smoke.mjs` — new cases for cross-link buttons (small)
- (new) `web/items-furniture-ui-smoke.mjs` — UI smoke for the new tabs (kept separate to keep file sizes manageable)
- `web/package.json` — add `smoke:itemsfurn` script
- `README.md` — list the two new tabs

---

## Task 1: appStore — extend AppTab + add sub-tab unions and persistence

**Files:**
- Modify: `web/src/store/appStore.ts`

- [ ] **Step 1: Add the union members and storage keys**

In `web/src/store/appStore.ts` change `AppTab` to include `'items' | 'furniture'` and add the new sub-tab types:

```ts
export type AppTab = 'recipes-loot' | 'items' | 'furniture' | 'definitions' | 'validations';
export type RecipesSubTab = 'stations' | 'furniture' | 'tech-tree' | 'enemies' | 'biome';

export type ItemsSubTab =
  | 'crafting-materials' | 'consumables' | 'constructables' | 'equippables'
  | 'gloves' | 'ammo' | 'seeds' | 'traps' | 'static-items';

export type FurnitureSubTab =
  | 'furniture' | 'damageable' | 'toggleable' | 'with-components'
  | 'storage' | 'universal-storage'
  | 'crafting-stations' | 'production-stations' | 'plantable'
  | 'elevator' | 'teleporter' | 'death-box' | 'containment-cage' | 'shopping-cart'
  | 'spawn-points' | 'enemy-spawn-points' | 'interactable-text';
```

- [ ] **Step 2: Map sub-tab ids → folder names**

Add a const map at the bottom of the file, exported, used by tab wrappers and by configs.ts:

```ts
export const ITEMS_SUBTAB_FOLDER: Record<ItemsSubTab, string> = {
  'crafting-materials': 'crafting_material_definitions',
  'consumables': 'consumable_definitions',
  'constructables': 'constructable_item_definitions',
  'equippables': 'equippable_definitions',
  'gloves': 'glove_definitions',
  'ammo': 'ammo_definitions',
  'seeds': 'seed_item_definitions',
  'traps': 'trap_item_definitions',
  'static-items': 'static_item_definitions',
};

export const FURNITURE_SUBTAB_FOLDER: Record<FurnitureSubTab, string> = {
  'furniture': 'furniture_definitions',
  'damageable': 'damageable_furniture_definitions',
  'toggleable': 'toggleable_furniture_definitions',
  'with-components': 'furniture_with_components_definitions',
  'storage': 'storage_definitions',
  'universal-storage': 'universal_storage_definitions',
  'crafting-stations': 'crafting_station_definitions',
  'production-stations': 'production_station_definitions',
  'plantable': 'plantable_definitions',
  'elevator': 'elevator_definitions',
  'teleporter': 'teleporter_definitions',
  'death-box': 'death_box_definitions',
  'containment-cage': 'containment_cage_definitions',
  'shopping-cart': 'shopping_cart_definitions',
  'spawn-points': 'spawn_point_definitions',
  'enemy-spawn-points': 'enemy_spawn_point_definitions',
  'interactable-text': 'interactable_text_definitions',
};
```

- [ ] **Step 3: Extend the AppStore interface and store with sub-tab fields + setters**

Add to the `AppStore` interface (place these next to the existing `recipesSubTab` field):

```ts
  itemsSubTab: ItemsSubTab;
  furnitureSubTab: FurnitureSubTab;
  setItemsSubTab: (t: ItemsSubTab) => void;
  setFurnitureSubTab: (t: FurnitureSubTab) => void;
```

Add the matching localStorage keys + loaders next to `LS_TAB`/`LS_SUB`:

```ts
const LS_ITEMS_SUB = 'tsic.app.itemsSub.v1';
const LS_FURN_SUB = 'tsic.app.furnitureSub.v1';

function loadItemsSub(): ItemsSubTab {
  try {
    const v = localStorage.getItem(LS_ITEMS_SUB);
    if (v && v in ITEMS_SUBTAB_FOLDER) return v as ItemsSubTab;
  } catch { /* noop */ }
  return 'crafting-materials';
}
function loadFurnSub(): FurnitureSubTab {
  try {
    const v = localStorage.getItem(LS_FURN_SUB);
    if (v && v in FURNITURE_SUBTAB_FOLDER) return v as FurnitureSubTab;
  } catch { /* noop */ }
  return 'furniture';
}
```

In the `loadTab` body, extend the `if (v === ...)` chain with `'items'` and `'furniture'`. Update the `useAppStore` create() body to initialise `itemsSubTab: loadItemsSub()` and `furnitureSubTab: loadFurnSub()`, and add the matching setters:

```ts
  setItemsSubTab: (t) => {
    try { localStorage.setItem(LS_ITEMS_SUB, t); } catch { /* noop */ }
    set({ itemsSubTab: t });
  },
  setFurnitureSubTab: (t) => {
    try { localStorage.setItem(LS_FURN_SUB, t); } catch { /* noop */ }
    set({ furnitureSubTab: t });
  },
```

- [ ] **Step 4: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS — note that `App.tsx`'s `renderTab` switch statement may now warn about non-exhaustive cases if its return type is constrained. If a TS error fires for unhandled `'items'` / `'furniture'` cases, add stub `case 'items': return null; case 'furniture': return null;` lines in `App.tsx` for now (real cases land in Task 6).

- [ ] **Step 5: Commit**

```sh
git add web/src/store/appStore.ts web/src/App.tsx
git commit -m "feat(appStore): add items + furniture tabs and sub-tab unions"
```

---

## Task 2: referencedByIndex store module

**Files:**
- Create: `web/src/store/referencedByIndex.ts`

- [ ] **Step 1: Write the index module**

Create `web/src/store/referencedByIndex.ts`:

```ts
import type { DefinitionRecord, DefinitionsKey } from './definitionsStore';

/** One incoming reference into a target asset. */
export interface IncomingRef {
  ownerKey: DefinitionsKey;     // who holds the ref
  path: (string | number)[];    // path within owner.json to the ref envelope
  ownerFolder: string;          // convenience for grouping in the UI
}

/** All incoming references, keyed by target asset id (the bare id, not folder/id). */
export type ReferencedByIndex = Map<string, IncomingRef[]>;

/** Build the full index by walking every record's properties tree. */
export function buildReferencedByIndex(definitions: Map<DefinitionsKey, DefinitionRecord>): ReferencedByIndex {
  const out: ReferencedByIndex = new Map();
  for (const [ownerKey, rec] of definitions) {
    walk(rec.json?.properties, [], (targetId, path) => {
      const list = out.get(targetId) ?? [];
      list.push({ ownerKey, path: ['properties', ...path], ownerFolder: rec.folder });
      out.set(targetId, list);
    });
  }
  return out;
}

/** Apply an in-place delta when a single record's properties change.
 *  Removes every entry whose ownerKey === changedKey, then walks the
 *  record's properties and re-adds. Cheap when most records don't
 *  change at once.
 */
export function reindexRecord(
  index: ReferencedByIndex,
  ownerKey: DefinitionsKey,
  ownerFolder: string,
  newProperties: any,
): void {
  // Remove existing entries for this owner.
  for (const [targetId, list] of index) {
    const filtered = list.filter((r) => r.ownerKey !== ownerKey);
    if (filtered.length === 0) index.delete(targetId);
    else if (filtered.length !== list.length) index.set(targetId, filtered);
  }
  // Add new entries.
  walk(newProperties, [], (targetId, path) => {
    const list = index.get(targetId) ?? [];
    list.push({ ownerKey, path: ['properties', ...path], ownerFolder });
    index.set(targetId, list);
  });
}

/** Recursively walk a typed-envelope value, calling visit(targetId, path)
 *  for every {type:'definition_ref', value:'<id>'} envelope encountered.
 *  Empty refs (no value) are skipped.
 */
function walk(node: any, path: (string | number)[], visit: (targetId: string, path: (string | number)[]) => void): void {
  if (node == null) return;
  if (typeof node !== 'object') return;

  if (node.type === 'definition_ref') {
    const v = node.value;
    if (typeof v === 'string' && v.length > 0) visit(v, path);
    return;
  }
  if (node.type === 'array' && Array.isArray(node.value)) {
    for (let i = 0; i < node.value.length; i++) walk(node.value[i], [...path, i], visit);
    return;
  }
  if (node.type === 'map' && Array.isArray(node.value)) {
    for (let i = 0; i < node.value.length; i++) {
      const entry = node.value[i];
      if (entry?.key) walk(entry.key, [...path, i, 'key'], visit);
      if (entry?.value) walk(entry.value, [...path, i, 'value'], visit);
    }
    return;
  }
  if (node.type === 'struct' && node.value && typeof node.value === 'object') {
    for (const [k, v] of Object.entries(node.value)) walk(v, [...path, k], visit);
    return;
  }
  // Bare property bag (the top-level `properties` object) — recurse over keys.
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'value' || k === 'class' || k === 'element_type' || k === 'key_type' || k === 'value_type' || k === 'struct_name') continue;
    walk(v, [...path, k], visit);
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add web/src/store/referencedByIndex.ts
git commit -m "feat(store): add referencedByIndex module for reverse-ref lookups"
```

---

## Task 3: Wire referencedByIndex into definitionsStore

**Files:**
- Modify: `web/src/store/definitionsStore.ts`

- [ ] **Step 1: Add the index field + selector to the interface**

In `DefinitionsStore` (around the existing index fields, e.g. `dirty`/`folders`), add:

```ts
  /** Reverse-reference index, lazily built once after each loadAll(). */
  referencedByIndex: import('./referencedByIndex').ReferencedByIndex;
```

And the selector method:

```ts
  /** Look up which records reference a given asset id. Returns [] when the
   *  asset isn't referenced or the index hasn't been built yet. */
  referencedBy: (assetId: string) => import('./referencedByIndex').IncomingRef[];
```

- [ ] **Step 2: Initialise the index in the store**

In the `useDefinitionsStore = create(...)` body, add `referencedByIndex: new Map()` to the initial state (near `dirty: new Set()`).

Implement `referencedBy`:

```ts
  referencedBy: (assetId) => get().referencedByIndex.get(assetId) ?? [],
```

- [ ] **Step 3: Build the index after loadAll completes**

Find the end of the `loadAll` action (look for where `set({ definitions: ..., loadedAt: Date.now(), loading: false })` is called). After that `set`, add:

```ts
import { buildReferencedByIndex, reindexRecord } from './referencedByIndex';
```

(at the top of the file) and after the `set({ definitions: …, loading: false })` call:

```ts
const idx = buildReferencedByIndex(get().definitions);
set({ referencedByIndex: idx });
```

Do the same after `loadBundledDefaults`'s final `set` and after `reload`'s final `set`. (Search for `set({ definitions:` in the file; there are typically 3 call sites — bundled, picked, reload.)

- [ ] **Step 4: Update the index on every edit**

Find `updateValueAtPath` (line ~1327). After it mutates `definitions` and calls `set`, add (in the same action body, after the mutation has been written):

```ts
const rec = get().definitions.get(key);
if (rec) {
  const idx = get().referencedByIndex;
  reindexRecord(idx, key, rec.folder, rec.json?.properties);
  set({ referencedByIndex: new Map(idx) });   // new Map ref so subscribers re-render
}
```

Place this AFTER the existing mutation block; copy the surrounding pattern (check for the `set({ definitions: new Map(...) })` style the file uses and follow it). The `new Map(idx)` wrapper is required because zustand's shallow compare won't notice in-place edits.

- [ ] **Step 5: Update the index when a definition is created or deleted**

Find `createDefinitionForClass` (line ~1819). At the end of its body, after the new record is in `definitions`, add:

```ts
const newRec = get().definitions.get(newKey);
if (newRec) {
  const idx = get().referencedByIndex;
  reindexRecord(idx, newKey, newRec.folder, newRec.json?.properties);
  set({ referencedByIndex: new Map(idx) });
}
```

(Replace `newKey` with whatever local variable holds the freshly minted key; the function returns it.)

Find `deleteDefinition` (grep for it in the file). After the deletion, add a pass that removes any incoming entries the deleted record contributed:

```ts
const idx = get().referencedByIndex;
for (const [targetId, list] of idx) {
  const filtered = list.filter((r) => r.ownerKey !== key);
  if (filtered.length === 0) idx.delete(targetId);
  else if (filtered.length !== list.length) idx.set(targetId, filtered);
}
set({ referencedByIndex: new Map(idx) });
```

- [ ] **Step 6: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 7: Verify data-smoke still passes**

Run: `npm --prefix web run data-smoke`
Expected: existing assertions all pass; output ends with the existing OK line.

- [ ] **Step 8: Commit**

```sh
git add web/src/store/definitionsStore.ts
git commit -m "feat(store): build referencedByIndex on load, update on mutate"
```

---

## Task 4: ClassBrowserConfig types + RowWarnings defaults

**Files:**
- Create: `web/src/components/classBrowser/types.ts`
- Create: `web/src/components/classBrowser/RowWarnings.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
import type { DefinitionRecord, DefinitionsKey } from '../../store/definitionsStore';

export type ColumnKind = 'string' | 'number' | 'bool' | 'tag' | 'ref' | 'count';

export interface Column {
  key: string;
  label: string;
  path: string[];                 // path WITHIN record.json (no leading 'json' or 'properties' — relative to root)
  kind: ColumnKind;
  width?: number;
}

export type WarningSeverity = 'info' | 'warn' | 'error';

export interface WarningCtx {
  records: Map<DefinitionsKey, DefinitionRecord>;
  findKeyById: (id: string) => DefinitionsKey | null;
  createDefinitionForClass: (className: string, id: string) => DefinitionsKey | null;
  updateValueAtPath: (k: DefinitionsKey, path: (string | number)[], value: any) => void;
}

export interface WarningRule {
  id: string;
  severity: WarningSeverity;
  test: (rec: DefinitionRecord, ctx: WarningCtx) => string | null;
  fix?: (rec: DefinitionRecord, ctx: WarningCtx) => void;
}

export interface ClassBrowserConfig {
  label: string;
  emoji: string;
  sortWeight?: number;
  columns: Column[];
  warnings?: WarningRule[];
  paletteFolders?: string[];
  hasStaticPartner?: boolean;
  newRecordClass: string;
  idTemplate?: (n: number) => string;
}
```

- [ ] **Step 2: Write `RowWarnings.ts` with the always-included defaults**

```ts
import type { DefinitionRecord } from '../../store/definitionsStore';
import type { WarningRule, WarningCtx } from './types';

/** Helper — read a typed-envelope value at a property path inside record.json.properties.
 *  Returns undefined if any path segment is missing. */
export function readPropertyValue(rec: DefinitionRecord, path: string[]): any {
  let cur: any = rec.json?.properties;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Walk every definition_ref envelope in a typed-envelope tree, calling visit(targetId).
 *  Used by the "unresolved refs" warning. */
export function forEachRef(node: any, visit: (id: string, path: (string|number)[]) => void, path: (string|number)[] = []): void {
  if (node == null || typeof node !== 'object') return;
  if (node.type === 'definition_ref') {
    if (typeof node.value === 'string' && node.value) visit(node.value, path);
    return;
  }
  if (node.type === 'array' && Array.isArray(node.value)) {
    node.value.forEach((v: any, i: number) => forEachRef(v, visit, [...path, i]));
    return;
  }
  if (node.type === 'map' && Array.isArray(node.value)) {
    node.value.forEach((entry: any, i: number) => {
      if (entry?.key) forEachRef(entry.key, visit, [...path, i, 'key']);
      if (entry?.value) forEachRef(entry.value, visit, [...path, i, 'value']);
    });
    return;
  }
  if (node.type === 'struct' && node.value && typeof node.value === 'object') {
    for (const [k, v] of Object.entries(node.value)) forEachRef(v, visit, [...path, k]);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (['type','value','class','element_type','key_type','value_type','struct_name'].includes(k)) continue;
    forEachRef(v, visit, [...path, k]);
  }
}

/** Derive the static-item partner id from a source item id.
 *  ID_Backpack_CM → FD_Backpack_SI; ID_Crossbow_EQ → FD_Crossbow_SI. */
export function deriveStaticPartnerId(sourceId: string): string {
  let base = sourceId;
  if (base.startsWith('ID_')) base = base.slice(3);
  // Strip a trailing _XX where XX is the class suffix (2-letter conventionally).
  base = base.replace(/_[A-Z]{2,3}$/, '');
  return `FD_${base}_SI`;
}

export const DEFAULT_WARNINGS: WarningRule[] = [
  {
    id: 'missing-display-name',
    severity: 'info',
    test: (rec) => {
      const dn = rec.json?.properties?.display_name;
      const v = dn?.value;
      return typeof v === 'string' && v.length > 0 ? null : 'no display_name';
    },
  },
  {
    id: 'missing-static-partner',
    severity: 'warn',
    test: (rec, ctx) => {
      // Only fires for records that have the slot at all; configured per-folder via hasStaticPartner.
      const slot = rec.json?.properties?.static_item_definition;
      if (!slot || slot.type !== 'definition_ref') return null;
      const v = slot.value;
      if (typeof v !== 'string' || !v) return 'no static partner';
      return ctx.findKeyById(v) ? null : `partner ${v} missing`;
    },
    fix: (rec, ctx) => {
      const newId = deriveStaticPartnerId(rec.id);
      // Make sure we don't collide with an existing record.
      let id = newId;
      let n = 2;
      while (ctx.findKeyById(id)) id = `${newId}_${n++}`;
      const newKey = ctx.createDefinitionForClass('StaticItemDefinition', id);
      if (!newKey) return;
      const ownerKey: any = `${rec.folder}/${rec.id}`;
      ctx.updateValueAtPath(ownerKey, ['properties', 'static_item_definition'], {
        type: 'definition_ref', class: 'StaticItemDefinition', value: id,
      });
    },
  },
  {
    id: 'unresolved-ref',
    severity: 'error',
    test: (rec, ctx) => {
      let unresolved = '';
      forEachRef(rec.json?.properties ?? {}, (id) => {
        if (unresolved) return;
        if (!ctx.findKeyById(id)) unresolved = id;
      });
      return unresolved ? `unresolved ref: ${unresolved}` : null;
    },
  },
];
```

- [ ] **Step 3: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add web/src/components/classBrowser/types.ts web/src/components/classBrowser/RowWarnings.ts
git commit -m "feat(classBrowser): add config types and default warning rules"
```

---

## Task 5: Per-folder configs

**Files:**
- Create: `web/src/components/classBrowser/configs.ts`

- [ ] **Step 1: Write the config map**

```ts
import type { ClassBrowserConfig } from './types';
import { getFolderTheme } from '../folderTheme';

const t = (folder: string) => getFolderTheme(folder).emoji;

export const CONFIGS: Record<string, ClassBrowserConfig> = {
  // ---- Items ----
  crafting_material_definitions: {
    label: 'Crafting Materials', emoji: t('crafting_material_definitions'),
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
  },
  consumable_definitions: {
    label: 'Consumables', emoji: t('consumable_definitions'),
    newRecordClass: 'ConsumableDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
      { key: 'stackable', label: 'Stack', path: ['properties','stackable','value'], kind: 'bool', width: 60 },
    ],
  },
  constructable_item_definitions: {
    label: 'Constructables', emoji: t('constructable_item_definitions'),
    newRecordClass: 'ConstructableItemDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
      { key: 'stackable', label: 'Stack', path: ['properties','stackable','value'], kind: 'bool', width: 60 },
    ],
  },
  equippable_definitions: {
    label: 'Equippables', emoji: t('equippable_definitions'),
    newRecordClass: 'EquippableDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'slot', label: 'Slot', path: ['properties','equipment_slot','value'], kind: 'tag' },
      { key: 'has_ammo', label: 'Ammo', path: ['properties','has_ammo','value'], kind: 'bool', width: 60 },
      { key: 'has_durability', label: 'Dur', path: ['properties','has_durability','value'], kind: 'bool', width: 60 },
      { key: 'max_ammo', label: 'Max', path: ['properties','max_ammo','value'], kind: 'number', width: 60 },
    ],
  },
  glove_definitions: {
    label: 'Gloves', emoji: t('glove_definitions'),
    newRecordClass: 'GloveDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  ammo_definitions: {
    label: 'Ammo', emoji: t('ammo_definitions'),
    newRecordClass: 'AmmoDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  seed_item_definitions: {
    label: 'Seeds', emoji: t('seed_item_definitions'),
    newRecordClass: 'SeedItemDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  trap_item_definitions: {
    label: 'Traps', emoji: t('trap_item_definitions'),
    newRecordClass: 'TrapItemDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  static_item_definitions: {
    label: 'Static Items', emoji: t('static_item_definitions'),
    newRecordClass: 'StaticItemDefinition',
    hasStaticPartner: false,
    columns: [],
  },

  // ---- Furniture ----
  furniture_definitions: {
    label: 'Furniture', emoji: t('furniture_definitions'),
    newRecordClass: 'FurnitureDefinition',
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
      { key: 'weight', label: 'Wt', path: ['properties','weighted_chance','value'], kind: 'number', width: 70 },
    ],
  },
  damageable_furniture_definitions: {
    label: 'Damageable', emoji: t('damageable_furniture_definitions'),
    newRecordClass: 'DamageableFurnitureDefinition',
    columns: [
      { key: 'health', label: 'HP', path: ['properties','starting_health','value'], kind: 'number', width: 70 },
      { key: 'armour', label: 'Arm', path: ['properties','furniture_armour','value'], kind: 'number', width: 60 },
      { key: 'draggable', label: 'Drag', path: ['properties','is_draggable','value'], kind: 'bool', width: 60 },
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
      { key: 'loot', label: 'Loot', path: ['properties','loot_dropped_on_death','value'], kind: 'count', width: 60 },
    ],
  },
  toggleable_furniture_definitions: {
    label: 'Toggleable', emoji: t('toggleable_furniture_definitions'),
    newRecordClass: 'ToggleableFurnitureDefinition',
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  furniture_with_components_definitions: {
    label: 'With Components', emoji: t('furniture_with_components_definitions'),
    newRecordClass: 'FurnitureWithComponentsDefinition',
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  storage_definitions: {
    label: 'Storage', emoji: t('storage_definitions'),
    newRecordClass: 'StorageDefinition',
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  universal_storage_definitions: {
    label: 'Universal Storage', emoji: t('universal_storage_definitions'),
    newRecordClass: 'UniversalStorageDefinition',
    columns: [],
  },
  crafting_station_definitions: {
    label: 'Crafting Stations', emoji: t('crafting_station_definitions'),
    newRecordClass: 'CraftingStationDefinition',
    columns: [
      { key: 'arr', label: 'ARR', path: ['properties','available_recipe_rules_definition','value'], kind: 'ref' },
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  production_station_definitions: {
    label: 'Production Stations', emoji: t('production_station_definitions'),
    newRecordClass: 'ProductionStationDefinition',
    columns: [
      { key: 'arr', label: 'ARR', path: ['properties','available_recipe_rules_definition','value'], kind: 'ref' },
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  plantable_definitions: {
    label: 'Plantable', emoji: t('plantable_definitions'),
    newRecordClass: 'PlantableDefinition',
    columns: [
      { key: 'arr', label: 'ARR', path: ['properties','available_recipe_rules_definition','value'], kind: 'ref' },
    ],
  },
  elevator_definitions: {
    label: 'Elevator', emoji: t('elevator_definitions'),
    newRecordClass: 'ElevatorDefinition', columns: [],
  },
  teleporter_definitions: {
    label: 'Teleporter', emoji: t('teleporter_definitions'),
    newRecordClass: 'TeleporterDefinition', columns: [],
  },
  death_box_definitions: {
    label: 'Death Box', emoji: t('death_box_definitions'),
    newRecordClass: 'DeathBoxDefinition', columns: [],
  },
  containment_cage_definitions: {
    label: 'Containment Cage', emoji: t('containment_cage_definitions'),
    newRecordClass: 'ContainmentCageDefinition', columns: [],
  },
  shopping_cart_definitions: {
    label: 'Shopping Cart', emoji: t('shopping_cart_definitions'),
    newRecordClass: 'ShoppingCartDefinition', columns: [],
  },
  spawn_point_definitions: {
    label: 'Spawn Points', emoji: t('spawn_point_definitions'),
    newRecordClass: 'SpawnPointDefinition', columns: [],
  },
  enemy_spawn_point_definitions: {
    label: 'Enemy Spawn Points', emoji: t('enemy_spawn_point_definitions'),
    newRecordClass: 'EnemySpawnPointDefinition', columns: [],
  },
  interactable_text_definitions: {
    label: 'Interactable Text', emoji: t('interactable_text_definitions'),
    newRecordClass: 'InteractableTextDefinition', columns: [],
  },
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add web/src/components/classBrowser/configs.ts
git commit -m "feat(classBrowser): per-folder configs for all items + furniture sub-tabs"
```

---

## Task 6: PropertyEchoContext

**Files:**
- Create: `web/src/components/classBrowser/PropertyEchoContext.tsx`

- [ ] **Step 1: Write the context**

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface PropertyEcho {
  /** Path inside record.json (no leading 'json' segment) — e.g. ['properties','weight','value']. */
  path: string[];
  /** Optional human label to show on rail rows (defaults to last path segment). */
  label?: string;
}

interface Ctx {
  echo: PropertyEcho | null;
  setEcho: (e: PropertyEcho | null) => void;
}

const PropertyEchoCtx = createContext<Ctx>({ echo: null, setEcho: () => {} });

export function PropertyEchoProvider({ children }: { children: ReactNode }) {
  const [echo, setEchoState] = useState<PropertyEcho | null>(null);
  const setEcho = useCallback((e: PropertyEcho | null) => setEchoState(e), []);
  return <PropertyEchoCtx.Provider value={{ echo, setEcho }}>{children}</PropertyEchoCtx.Provider>;
}

export function usePropertyEcho(): Ctx {
  return useContext(PropertyEchoCtx);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add web/src/components/classBrowser/PropertyEchoContext.tsx
git commit -m "feat(classBrowser): add PropertyEchoContext for rail value-echo"
```

---

## Task 7: ClassBrowserTab — shell with Detail mode only

**Files:**
- Create: `web/src/components/classBrowser/ClassBrowserTab.tsx`

This task lands the 3-column layout, the rail with virtualised rows, multi-select state, and Detail mode wired to `<TypedPropertiesEditor>`. Spreadsheet, Compare, action bar, where-used, warnings, smart-effects, bulk-edit, duplicate, and property-echo wiring land in later tasks.

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { useAppStore } from '../../store/appStore';
import { humanizeAssetId } from '../definitionsNaming';
import { getFolderTheme } from '../folderTheme';
import { ItemPalette } from '../ItemPalette';
import { VirtualList } from '../VirtualList';
import { HighlightedText } from '../HighlightedText';
import { type RankedHit } from '../../search/fuzzy';
import { useHybridSearch } from '../../search/hybrid';
import { useJumpToDefinition } from '../useJumpToDefinition';
import { AssetTitle } from '../AssetTitle';
import { SearchBox } from '../SearchBox';
import { TypedPropertiesEditor } from '../TypedValueEditor';
import { useRefAdapter } from '../useRefAdapter';
import { PropertyEchoProvider } from './PropertyEchoContext';
import type { ClassBrowserConfig } from './types';

interface Props {
  folder: string;
  config: ClassBrowserConfig;
}

export function ClassBrowserTab({ folder, config }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const classNodes = useDefinitionsStore((s) => s.classNodes);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);
  const jumpToDef = useJumpToDefinition();

  const refAdapter = useRefAdapter((id) => {
    const k = findKeyById(id);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  });

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);

  type Row = { key: DefinitionsKey; id: string };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const [k, rec] of definitions) {
      if (rec.folder !== folder) continue;
      out.push({ key: k, id: rec.id });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }, [definitions, folder]);

  // Reset selection when folder changes (sub-tab switch).
  useEffect(() => { setSelectedKey(null); }, [folder]);

  const filtered = useHybridSearch(
    rows, filter,
    (r) => [humanizeAssetId(r.id), r.id],
    { semanticKey: (r) => r.key },
  ) as RankedHit<Row>[];

  if (selectedKey == null && rows.length > 0) setSelectedKey(rows[0].key);

  const selected = selectedKey ? definitions.get(selectedKey) : null;
  const theme = getFolderTheme(folder);

  return (
    <PropertyEchoProvider>
      <div className="class-browser">
        <aside className="rail">
          <div className="rail-header">
            <h3>{config.label}</h3>
            <SearchBox value={filter} onChange={setFilter} placeholder="search…" />
            <div className="rail-add-row">
              <button className="add-row" onClick={() => {
                let n = 1;
                const tpl = config.idTemplate ?? ((i: number) => `ID_New${i}`);
                let id = tpl(n);
                while (findKeyById(id)) { n++; id = tpl(n); }
                const k = createDefinitionForClass(config.newRecordClass, id);
                if (k) setSelectedKey(k);
              }}>＋ New {config.label}</button>
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="empty-state-mini">No records.</div>
          ) : (
            <VirtualList
              className="rail-body"
              items={filtered}
              rowHeight={30}
              keyOf={(h) => h.item.key}
              renderItem={(h) => (
                <button
                  className={`rail-row ${selectedKey === h.item.key ? 'selected' : ''}`}
                  onClick={() => setSelectedKey(h.item.key)}
                  style={{ borderLeft: `3px solid ${theme.color}` }}
                  title={`${h.item.id}\nMiddle-click to open in Definitions`}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(h.item.id); } }}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                >
                  <span className="emoji" aria-hidden>{theme.emoji}</span>
                  <span className="label">
                    <HighlightedText text={humanizeAssetId(h.item.id)} ranges={h.ranges} />
                  </span>
                </button>
              )}
            />
          )}
        </aside>

        <section className="class-browser-pane">
          {selected && selectedKey ? (
            <>
              <header className="station-header">
                <div className="station-title">
                  <span aria-hidden>{theme.emoji}</span>
                  <AssetTitle assetKey={selectedKey} onRenamed={(newKey) => setSelectedKey(newKey)} />
                  <span className="cls">{String(selected.json?.class ?? '').replace(/^U/, '')}</span>
                </div>
                <div className="station-sub">
                  <span className="muted">id:</span> <code>{selected.id}</code>
                </div>
              </header>

              <TypedPropertiesEditor
                parentTypeName={String(selected.json?.class ?? '').replace(/^U/, '')}
                properties={selected.json?.properties ?? {}}
                showAllFields={false}
                onChange={(next) => updateValueAtPath(selectedKey, ['properties'], next)}
                refAdapter={refAdapter}
                ownerKey={selectedKey}
              />
            </>
          ) : (
            <div className="empty-state-mini">Pick a record from the rail.</div>
          )}
        </section>

        <ItemPalette
          folders={config.paletteFolders ?? [folder, 'crafting_material_definitions', 'consumable_definitions', 'ammo_definitions']}
          title="Items"
        />
      </div>
    </PropertyEchoProvider>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```sh
git add web/src/components/classBrowser/ClassBrowserTab.tsx
git commit -m "feat(classBrowser): ClassBrowserTab shell with Detail mode"
```

---

## Task 8: ItemsTab and FurnitureTab wrappers

**Files:**
- Create: `web/src/components/ItemsTab.tsx`
- Create: `web/src/components/FurnitureTab.tsx`

- [ ] **Step 1: Write `ItemsTab.tsx`**

```tsx
import { useAppStore, ITEMS_SUBTAB_FOLDER, type ItemsSubTab } from '../store/appStore';
import { ClassBrowserTab } from './classBrowser/ClassBrowserTab';
import { CONFIGS } from './classBrowser/configs';
import { getFolderTheme } from './folderTheme';

const SUB_TABS: Array<{ id: ItemsSubTab; folder: string }> = (Object.keys(ITEMS_SUBTAB_FOLDER) as ItemsSubTab[])
  .map((id) => ({ id, folder: ITEMS_SUBTAB_FOLDER[id] }));

export function ItemsTab() {
  const sub = useAppStore((s) => s.itemsSubTab);
  const setSub = useAppStore((s) => s.setItemsSubTab);
  const folder = ITEMS_SUBTAB_FOLDER[sub];
  const cfg = CONFIGS[folder];

  return (
    <div className="vertical-subtab-layout">
      <nav className="vertical-subtab-rail">
        {SUB_TABS.map((t) => {
          const c = CONFIGS[t.folder];
          const theme = getFolderTheme(t.folder);
          return (
            <button
              key={t.id}
              className={`vertical-subtab ${sub === t.id ? 'active' : ''}`}
              onClick={() => setSub(t.id)}
              style={{ borderLeft: `3px solid ${theme.color}` }}
            >
              <span aria-hidden>{c?.emoji ?? theme.emoji}</span>
              <span className="label">{c?.label ?? t.folder}</span>
            </button>
          );
        })}
      </nav>
      <div className="vertical-subtab-body">
        {cfg ? <ClassBrowserTab folder={folder} config={cfg} /> : <div className="empty-state-mini">Missing config for {folder}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `FurnitureTab.tsx`**

```tsx
import { useAppStore, FURNITURE_SUBTAB_FOLDER, type FurnitureSubTab } from '../store/appStore';
import { ClassBrowserTab } from './classBrowser/ClassBrowserTab';
import { CONFIGS } from './classBrowser/configs';
import { getFolderTheme } from './folderTheme';

const SUB_TABS: Array<{ id: FurnitureSubTab; folder: string }> = (Object.keys(FURNITURE_SUBTAB_FOLDER) as FurnitureSubTab[])
  .map((id) => ({ id, folder: FURNITURE_SUBTAB_FOLDER[id] }));

export function FurnitureTab() {
  const sub = useAppStore((s) => s.furnitureSubTab);
  const setSub = useAppStore((s) => s.setFurnitureSubTab);
  const folder = FURNITURE_SUBTAB_FOLDER[sub];
  const cfg = CONFIGS[folder];

  return (
    <div className="vertical-subtab-layout">
      <nav className="vertical-subtab-rail">
        {SUB_TABS.map((t) => {
          const c = CONFIGS[t.folder];
          const theme = getFolderTheme(t.folder);
          return (
            <button
              key={t.id}
              className={`vertical-subtab ${sub === t.id ? 'active' : ''}`}
              onClick={() => setSub(t.id)}
              style={{ borderLeft: `3px solid ${theme.color}` }}
            >
              <span aria-hidden>{c?.emoji ?? theme.emoji}</span>
              <span className="label">{c?.label ?? t.folder}</span>
            </button>
          );
        })}
      </nav>
      <div className="vertical-subtab-body">
        {cfg ? <ClassBrowserTab folder={folder} config={cfg} /> : <div className="empty-state-mini">Missing config for {folder}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add web/src/components/ItemsTab.tsx web/src/components/FurnitureTab.tsx
git commit -m "feat: ItemsTab and FurnitureTab wrappers with vertical sub-tab rail"
```

---

## Task 9: Wire ItemsTab + FurnitureTab into Header and App

**Files:**
- Modify: `web/src/components/Header.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add the tabs to Header**

In `Header.tsx`, change the `tabs` array to:

```ts
  const tabs: Array<{ id: AppTab; label: string; badge?: number }> = [
    { id: 'recipes-loot', label: 'Recipes & Loot' },
    { id: 'items', label: 'Items' },
    { id: 'furniture', label: 'Furniture' },
    { id: 'definitions', label: 'Definitions' },
    { id: 'validations', label: 'Validations' },
  ];
```

- [ ] **Step 2: Wire renderTab in App.tsx**

In `App.tsx`, add the imports near the existing tab imports:

```ts
import { ItemsTab } from './components/ItemsTab';
import { FurnitureTab } from './components/FurnitureTab';
```

Replace the `renderTab` switch with the full set:

```ts
  const renderTab = (t: AppTab) => {
    switch (t) {
      case 'recipes-loot': return <RecipesAndLootTab />;
      case 'items': return <ItemsTab />;
      case 'furniture': return <FurnitureTab />;
      case 'definitions': return <DefinitionsTab />;
      case 'validations': return <ValidationsTab />;
    }
  };
```

- [ ] **Step 3: Add CSS for the vertical sub-tab rail**

Append to `web/src/styles-new.css`:

```css
/* ==== Vertical sub-tab rail (Items / Furniture) ==== */
.vertical-subtab-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  height: 100%;
  min-height: 0;
}
.vertical-subtab-rail {
  display: flex;
  flex-direction: column;
  background: var(--surface-1, #1d2128);
  border-right: 1px solid var(--divider, #2a2f38);
  overflow-y: auto;
}
.vertical-subtab {
  background: none;
  border: none;
  border-left: 3px solid transparent;
  color: var(--text, #d6d8dc);
  text-align: left;
  padding: 8px 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  cursor: pointer;
}
.vertical-subtab:hover { background: var(--surface-2, #242832); }
.vertical-subtab.active { background: var(--surface-2, #242832); font-weight: 600; }
.vertical-subtab .label { flex: 1; }
.vertical-subtab-body { min-width: 0; min-height: 0; overflow: hidden; }

/* ==== ClassBrowserTab grid ==== */
.class-browser {
  display: grid;
  grid-template-columns: 260px 1fr 280px;
  height: 100%;
  min-height: 0;
}
.class-browser-pane {
  overflow: auto;
  padding: 12px 16px;
  background: var(--surface-0, #16191e);
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm --prefix web run typecheck`
Expected: PASS.

- [ ] **Step 5: Verify build + dev start**

Run: `npm --prefix web run build`
Expected: PASS, no errors.

Manual smoke (don't block on this — just sanity check): `npm --prefix web run dev`, click the Items tab in the header, confirm the Crafting Materials sub-tab loads with the existing typed editor on the right. Stop the server.

- [ ] **Step 6: Commit**

```sh
git add web/src/components/Header.tsx web/src/App.tsx web/src/styles-new.css
git commit -m "feat: wire Items + Furniture tabs into Header and App"
```

---

## Task 10: Inline row warnings

**Files:**
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`
- Modify: `web/src/styles-new.css`

- [ ] **Step 1: Compute warnings per record and render chips on rail rows**

In `ClassBrowserTab.tsx` add imports:

```ts
import { DEFAULT_WARNINGS } from './RowWarnings';
import type { WarningRule, WarningSeverity, WarningCtx } from './types';
```

Inside the component (after the `refAdapter` line), build the warning context and a per-row warning evaluator:

```ts
const warningCtx: WarningCtx = useMemo(() => ({
  records: definitions,
  findKeyById,
  createDefinitionForClass,
  updateValueAtPath,
}), [definitions, findKeyById, createDefinitionForClass, updateValueAtPath]);

const allRules = useMemo<WarningRule[]>(
  () => [...DEFAULT_WARNINGS, ...(config.warnings ?? [])],
  [config.warnings],
);

const warningsForRow = (key: DefinitionsKey): { rule: WarningRule; text: string }[] => {
  const rec = definitions.get(key);
  if (!rec) return [];
  const out: { rule: WarningRule; text: string }[] = [];
  for (const rule of allRules) {
    const text = rule.test(rec, warningCtx);
    if (text) out.push({ rule, text });
  }
  return out;
};
```

In the rail's `renderItem`, append a chip after the `<HighlightedText>` span:

```tsx
{(() => {
  const ws = warningsForRow(h.item.key);
  if (ws.length === 0) return null;
  const top = ws.sort((a, b) => severityOrder(b.rule.severity) - severityOrder(a.rule.severity))[0];
  return (
    <span
      className={`row-warning sev-${top.rule.severity}`}
      title={ws.map(w => `[${w.rule.severity}] ${w.text}`).join('\n')}
      onClick={(e) => {
        e.stopPropagation();
        if (top.rule.fix) {
          const rec = definitions.get(h.item.key);
          if (rec) top.rule.fix(rec, warningCtx);
        }
      }}
    >{ws.length}</span>
  );
})()}
```

Add this helper at file scope (above the component):

```ts
function severityOrder(s: WarningSeverity): number {
  switch (s) { case 'error': return 3; case 'warn': return 2; case 'info': return 1; }
}
```

- [ ] **Step 2: Add warning-chip CSS**

Append to `styles-new.css`:

```css
.row-warning {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.row-warning.sev-info  { background: #2a3545; color: #9bb1c8; }
.row-warning.sev-warn  { background: #4a3a1f; color: #e8c45e; }
.row-warning.sev-error { background: #4a1f1f; color: #ff7e7e; }
```

- [ ] **Step 3: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): inline row-warning chips with click-to-fix"
```

---

## Task 11: Property-echo on rail rows

**Files:**
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`

- [ ] **Step 1: Subscribe to PropertyEcho in the rail**

In `ClassBrowserTab.tsx`, import `usePropertyEcho`:

```ts
import { usePropertyEcho } from './PropertyEchoContext';
```

Move the rail rendering into a child component so it can call `usePropertyEcho` (the rail must be a child of the provider, which is at the root of the tab). Replace the existing `<aside className="rail">` block with a `<RailColumn ... />` component, defined below the main component:

```tsx
function RailColumn({
  filtered, selectedKey, setSelectedKey, theme, config, findKeyById, createDefinitionForClass,
  filter, setFilter, jumpToDef, warningsForRow, definitions,
}: any) {
  const { echo } = usePropertyEcho();

  const valueAtPath = (json: any, path: string[]): any => {
    let cur: any = json;
    for (const seg of path) { if (cur == null) return undefined; cur = cur[seg]; }
    return cur;
  };
  const fmtEcho = (v: any): string => {
    if (v == null) return '—';
    if (typeof v === 'string') return v.length > 14 ? v.slice(0, 12) + '…' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v).slice(0, 14);
  };

  return (
    <aside className="rail">
      <div className="rail-header">
        <h3>{config.label}</h3>
        <SearchBox value={filter} onChange={setFilter} placeholder="search…" />
        <div className="rail-add-row">
          <button className="add-row" onClick={() => {
            let n = 1;
            const tpl = config.idTemplate ?? ((i: number) => `ID_New${i}`);
            let id = tpl(n);
            while (findKeyById(id)) { n++; id = tpl(n); }
            const k = createDefinitionForClass(config.newRecordClass, id);
            if (k) setSelectedKey(k);
          }}>＋ New {config.label}</button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state-mini">No records.</div>
      ) : (
        <VirtualList
          className="rail-body"
          items={filtered}
          rowHeight={30}
          keyOf={(h: any) => h.item.key}
          renderItem={(h: any) => {
            const rec = definitions.get(h.item.key);
            const echoVal = echo && rec ? fmtEcho(valueAtPath(rec.json, echo.path)) : null;
            const ws = warningsForRow(h.item.key);
            const top = ws.length ? ws.sort((a: any, b: any) => severityOrder(b.rule.severity) - severityOrder(a.rule.severity))[0] : null;
            return (
              <button
                className={`rail-row ${selectedKey === h.item.key ? 'selected' : ''}`}
                onClick={() => setSelectedKey(h.item.key)}
                style={{ borderLeft: `3px solid ${theme.color}` }}
                title={`${h.item.id}\nMiddle-click to open in Definitions`}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(h.item.id); } }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              >
                <span className="emoji" aria-hidden>{theme.emoji}</span>
                <span className="label"><HighlightedText text={humanizeAssetId(h.item.id)} ranges={h.ranges} /></span>
                {echoVal != null && <span className="row-echo">{echoVal}</span>}
                {top && (
                  <span
                    className={`row-warning sev-${top.rule.severity}`}
                    title={ws.map((w: any) => `[${w.rule.severity}] ${w.text}`).join('\n')}
                    onClick={(e) => { e.stopPropagation(); if (top.rule.fix) { const rec2 = definitions.get(h.item.key); if (rec2) top.rule.fix(rec2, (window as any).__cbCtx); } }}
                  >{ws.length}</span>
                )}
              </button>
            );
          }}
        />
      )}
    </aside>
  );
}
```

(Then in the main component's JSX, replace the existing `<aside>` with `<RailColumn ... />` passing all the necessary props. Stash `warningCtx` on `(window as any).__cbCtx` immediately before render so the chip's onClick can reach it; this is a deliberate small hack to avoid threading more props — acceptable because there's only ever one tab mounted at a time.)

Update the main component to render:

```tsx
return (
  <PropertyEchoProvider>
    <div className="class-browser">
      <RailColumn
        filtered={filtered} selectedKey={selectedKey} setSelectedKey={setSelectedKey}
        theme={theme} config={config} findKeyById={findKeyById}
        createDefinitionForClass={createDefinitionForClass}
        filter={filter} setFilter={setFilter} jumpToDef={jumpToDef}
        warningsForRow={warningsForRow} definitions={definitions}
      />
      <section className="class-browser-pane">{/* unchanged */}</section>
      <ItemPalette folders={config.paletteFolders ?? [folder, 'crafting_material_definitions', 'consumable_definitions', 'ammo_definitions']} title="Items" />
    </div>
  </PropertyEchoProvider>
);
```

Set `(window as any).__cbCtx = warningCtx;` immediately before the return statement.

- [ ] **Step 2: Hook into editor cell focus to publish echo**

The cleanest plug-in point is the click event on any property row inside `<TypedPropertiesEditor>`. Without modifying that component, we wrap the right pane:

In the `class-browser-pane` `<section>`, replace it with:

```tsx
<EchoPublishingPane>
  {/* existing header + TypedPropertiesEditor */}
</EchoPublishingPane>
```

Define `EchoPublishingPane` in the same file:

```tsx
function EchoPublishingPane({ children }: { children: ReactNode }) {
  const { setEcho } = usePropertyEcho();
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Walk up from the click target looking for a data-prop-path attribute
    // emitted by the typed editor's row wrapper. If absent, do nothing.
    let el: HTMLElement | null = e.target as HTMLElement;
    while (el) {
      const p = el.dataset?.propPath;
      if (p) { try { setEcho({ path: JSON.parse(p) as string[] }); } catch {} return; }
      el = el.parentElement;
    }
  };
  return <section className="class-browser-pane" onClickCapture={onClick}>{children}</section>;
}
```

(Imports: add `import { type ReactNode } from 'react';` and `import { usePropertyEcho } from './PropertyEchoContext';`.)

The typed editor doesn't currently emit `data-prop-path`. Worth landing this hook now anyway; we add the attribute in the next step.

- [ ] **Step 3: Emit data-prop-path from TypedPropertiesEditor row wrappers**

In `web/src/components/TypedValueEditor.tsx`, find where individual property rows are rendered (look for `humanizePropertyKey` calls or the row wrapper inside `TypedPropertiesEditor`). Add `data-prop-path={JSON.stringify(['properties', key])}` to the row wrapper element. If the rows are nested (struct-inside-struct), prefer adding it only at the top-level row inside `TypedPropertiesEditor` so we echo the property name, not the nested sub-field.

If the typed editor's structure makes adding the attribute risky, fall back to mounting a simple click handler on `<EchoPublishingPane>` that reads the nearest `<label>` text and resolves it back to a path key — but the data-attribute approach is preferred.

- [ ] **Step 4: Clear echo on Esc / sub-tab change**

In `RailColumn`, add a `useEffect` that listens for the global `keydown` Escape and calls `setEcho(null)`. Already cleared by re-mount on folder change because `<PropertyEchoProvider>` is keyed by `<ClassBrowserTab>` which re-mounts when its `folder` prop changes.

- [ ] **Step 5: Add row-echo chip CSS**

Append to `styles-new.css`:

```css
.row-echo {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 8px;
  background: #29303a;
  color: #9bb1c8;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.row-echo + .row-warning { margin-left: 6px; }
```

- [ ] **Step 6: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/components/TypedValueEditor.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): property-echo on rail rows when editor cell is clicked"
```

---

## Task 12: Where-Used panel

**Files:**
- Create: `web/src/components/classBrowser/WhereUsedPanel.tsx`
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`

- [ ] **Step 1: Write the panel**

```tsx
import { useState } from 'react';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { useJumpToDefinition } from '../useJumpToDefinition';
import { getFolderTheme } from '../folderTheme';
import { humanizeAssetId } from '../definitionsNaming';

export function WhereUsedPanel({ assetId }: { assetId: string }) {
  const referencedBy = useDefinitionsStore((s) => s.referencedBy);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const jumpToDef = useJumpToDefinition();
  const [open, setOpen] = useState(false);

  const incoming = referencedBy(assetId);
  if (incoming.length === 0) {
    return (
      <details className="where-used">
        <summary>Where used <span className="muted">(0)</span></summary>
        <div className="empty-state-mini">No incoming references.</div>
      </details>
    );
  }
  // Group by owner folder.
  const grouped = new Map<string, typeof incoming>();
  for (const ref of incoming) {
    const list = grouped.get(ref.ownerFolder) ?? [];
    list.push(ref);
    grouped.set(ref.ownerFolder, list);
  }
  return (
    <details className="where-used" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Where used <span className="muted">({incoming.length})</span></summary>
      {[...grouped.entries()].map(([folder, refs]) => {
        const theme = getFolderTheme(folder);
        return (
          <div key={folder} className="where-used-group">
            <div className="where-used-group-h" style={{ borderLeft: `3px solid ${theme.color}` }}>
              <span aria-hidden>{theme.emoji}</span> {folder} <span className="muted">({refs.length})</span>
            </div>
            {refs.map((ref) => {
              const rec = definitions.get(ref.ownerKey);
              if (!rec) return null;
              return (
                <button
                  key={`${ref.ownerKey}-${ref.path.join('/')}`}
                  className="where-used-row"
                  onClick={() => jumpToDef(rec.id)}
                  title={ref.path.join(' / ')}
                >
                  <span className="label">{humanizeAssetId(rec.id)}</span>
                  <code className="muted small">{ref.path.slice(1).join('.')}</code>
                </button>
              );
            })}
          </div>
        );
      })}
    </details>
  );
}
```

- [ ] **Step 2: Mount the panel in the Detail pane**

In `ClassBrowserTab.tsx`, import `WhereUsedPanel`:

```ts
import { WhereUsedPanel } from './WhereUsedPanel';
```

In the `EchoPublishingPane`'s children (immediately after `<TypedPropertiesEditor>`), add:

```tsx
{selected && <WhereUsedPanel assetId={selected.id} />}
```

- [ ] **Step 3: Add CSS**

Append to `styles-new.css`:

```css
.where-used { margin-top: 16px; }
.where-used summary { cursor: pointer; padding: 6px 0; font-weight: 600; }
.where-used-group { margin: 4px 0 8px 8px; }
.where-used-group-h { padding: 4px 8px; background: var(--surface-2, #242832); }
.where-used-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  background: none;
  border: none;
  color: var(--text, #d6d8dc);
  text-align: left;
  padding: 4px 8px;
  cursor: pointer;
}
.where-used-row:hover { background: var(--surface-2, #242832); }
.where-used-row .label { flex: 1; }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add web/src/components/classBrowser/WhereUsedPanel.tsx web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): Where-Used panel using referencedByIndex"
```

---

## Task 13: Equippable smart effects view

**Files:**
- Create: `web/src/components/classBrowser/SmartEffectsView.tsx`
- Modify: `web/src/components/TypedValueEditor.tsx`

- [ ] **Step 1: Write the view**

```tsx
import { useMemo, useState } from 'react';
import { NumberSlider } from '../NumberSlider';

interface Props {
  /** The full effects_to_apply struct envelope. */
  envelope: any;
  /** Called with the next struct envelope (full replacement). */
  onChange: (next: any) => void;
}

interface Pair {
  /** e.g. 'flat_damage_increase' */
  key: string;
  /** e.g. 'b_apply_flat_damage_increase' */
  boolKey: string;
  /** Float | bool */
  valueEnvelope: any;
  /** True when active (b_apply_X === true). */
  active: boolean;
}

const LABELS: Record<string, string> = {
  flat_damage_increase: 'flat damage',
  percentage_damage_increase: 'percent damage',
  life_steal_percentage: 'life steal',
  flat_armour_increase: 'flat armour',
  flat_speed_increase: 'flat speed',
  max_health_increase: 'max health',
  max_stamina_increase: 'max stamina',
  stamina_regen_per_second: 'stamina regen / s',
  stamina_regen_delay_reduction: 'stamina regen delay -',
  carry_capacity_increase: 'carry capacity',
  tool_durability_multiplier: 'tool durability x',
  xp_gain_multiplier: 'xp gain x',
  heal_per_second: 'heal / s',
  instant_heal: 'instant heal',
  flat_satiation: 'satiation',
  satiation_per_second: 'satiation / s',
  radiation_immunity: 'radiation immunity',
  cold_immunity: 'cold immunity',
  heat_immunity: 'heat immunity',
  water_breathing: 'water breathing',
};

function humanise(k: string): string {
  return LABELS[k] ?? k.replace(/_/g, ' ');
}

export function SmartEffectsView({ envelope, onChange }: Props) {
  const [showAll, setShowAll] = useState(false);

  const pairs = useMemo<Pair[]>(() => {
    const v = envelope?.value ?? {};
    const out: Pair[] = [];
    for (const k of Object.keys(v)) {
      if (!k.startsWith('b_apply_')) continue;
      const boolKey = k;
      const valueKey = k.slice('b_apply_'.length);
      const partner = v[valueKey];
      if (!partner) continue;
      out.push({
        key: valueKey,
        boolKey,
        valueEnvelope: partner,
        active: !!v[boolKey]?.value,
      });
    }
    return out;
  }, [envelope]);

  if (showAll) {
    return (
      <div className="smart-effects">
        <button className="smart-toggle" onClick={() => setShowAll(false)}>← Active effects only</button>
        <div className="muted">Standard view rendered by parent. Toggle off to return.</div>
      </div>
    );
  }

  const active = pairs.filter((p) => p.active);
  const inactive = pairs.filter((p) => !p.active);

  const setBool = (boolKey: string, val: boolean) => {
    const next = JSON.parse(JSON.stringify(envelope));
    if (next.value[boolKey]) next.value[boolKey].value = val;
    onChange(next);
  };
  const setValue = (valueKey: string, val: any) => {
    const next = JSON.parse(JSON.stringify(envelope));
    if (next.value[valueKey]) next.value[valueKey].value = val;
    onChange(next);
  };
  const addEffect = (valueKey: string) => {
    const next = JSON.parse(JSON.stringify(envelope));
    const partner = next.value[valueKey];
    if (next.value[`b_apply_${valueKey}`]) next.value[`b_apply_${valueKey}`].value = true;
    if (partner?.type === 'float' && (partner.value === 0 || partner.value == null)) partner.value = 1.0;
    if (partner?.type === 'bool' && !partner.value) partner.value = true;
    onChange(next);
  };

  return (
    <div className="smart-effects">
      <header className="smart-effects-header">
        <strong>Active effects</strong>
        <button className="smart-toggle" onClick={() => setShowAll(true)}>Show all ({pairs.length}) ▾</button>
      </header>
      {active.length === 0 && <div className="muted">No active effects.</div>}
      <ul className="smart-effects-list">
        {active.map((p) => (
          <li key={p.key} className="smart-effect-row">
            <span className="label">{humanise(p.key)}</span>
            {p.valueEnvelope.type === 'float' || p.valueEnvelope.type === 'int' ? (
              <NumberSlider
                value={Number(p.valueEnvelope.value ?? 0)}
                min={undefined as any}
                max={undefined as any}
                onChange={(v) => setValue(p.key, v)}
              />
            ) : (
              <input
                type="checkbox"
                checked={!!p.valueEnvelope.value}
                onChange={(e) => setValue(p.key, e.target.checked)}
              />
            )}
            <button className="smart-effect-remove" onClick={() => setBool(p.boolKey, false)}>×</button>
          </li>
        ))}
      </ul>
      {inactive.length > 0 && (
        <details className="smart-effects-add">
          <summary>+ Add effect</summary>
          <ul>
            {inactive.map((p) => (
              <li key={p.key}>
                <button onClick={() => addEffect(p.key)}>{humanise(p.key)}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Plug into TypedValueEditor**

Open `web/src/components/TypedValueEditor.tsx`. Find the struct rendering branch (search for `'struct'` in the editor's switch on `type`). At the top of the struct branch, before the default field-by-field render, insert a conditional dispatch:

```ts
if (envelope?.struct_name === 'GameplayEffectsToApply') {
  // Use the smart view; falls back to the default render if user toggles "Show all".
  // Defer the actual default render to the existing code path by accepting the smart view's
  // children-render-prop OR by rendering both and hiding via CSS — see SmartEffectsView "Show all" branch.
  return (
    <SmartEffectsView
      envelope={envelope}
      onChange={(next) => onChange(next)}
    />
  );
}
```

Add the import at the top:

```ts
import { SmartEffectsView } from './classBrowser/SmartEffectsView';
```

Note: when the user toggles "Show all", the Smart view stays mounted but renders a placeholder text. This is the simplest path; a richer "show all = re-render the struct flat" can come later if needed (the current behaviour is "you have a smart view, or you have nothing extra"). To make "Show all" actually fall back to the standard struct render, hoist the standard struct render into a separate inner function and call it from `SmartEffectsView`'s `showAll` branch via a render prop. **Implement the simpler placeholder version in this task; the render-prop refactor is optional follow-up.**

- [ ] **Step 3: Add CSS**

Append to `styles-new.css`:

```css
.smart-effects { padding: 8px 0; }
.smart-effects-header { display: flex; gap: 12px; align-items: center; padding: 4px 0 8px; }
.smart-effects-header .smart-toggle { margin-left: auto; background: none; border: 1px solid var(--divider, #2a2f38); color: var(--text, #d6d8dc); padding: 2px 8px; cursor: pointer; }
.smart-effects-list { list-style: none; padding: 0; margin: 0; }
.smart-effect-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; border-bottom: 1px solid var(--divider, #2a2f38); }
.smart-effect-row .label { flex: 1; }
.smart-effect-remove { background: none; border: none; color: #ff7e7e; font-size: 16px; cursor: pointer; }
.smart-effects-add summary { cursor: pointer; padding: 8px 0; }
.smart-effects-add ul { list-style: none; padding: 0; margin: 0; }
.smart-effects-add button { background: none; border: 1px solid var(--divider, #2a2f38); color: var(--text, #d6d8dc); padding: 2px 8px; margin: 2px; cursor: pointer; }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add web/src/components/classBrowser/SmartEffectsView.tsx web/src/components/TypedValueEditor.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): equippable smart effects view"
```

---

## Task 14: Multi-select + action bar (skeleton)

**Files:**
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`
- Modify: `web/src/styles-new.css`

This task lands the multi-select state and the action bar. The actions themselves (Compare, Bulk edit, Duplicate × N) are wired in the next three tasks.

- [ ] **Step 1: Add multi-select state**

In the main `ClassBrowserTab` component:

```ts
const [selectedKeys, setSelectedKeys] = useState<Set<DefinitionsKey>>(() => new Set());
const [lastClickedKey, setLastClickedKey] = useState<DefinitionsKey | null>(null);

// Keep the single "selected" record (Detail mode) in sync with the
// multi-select set: when set has exactly one entry, that's the detail.
const detailKey: DefinitionsKey | null =
  selectedKeys.size === 1 ? Array.from(selectedKeys)[0] :
  selectedKey;
```

Replace existing `selectedKey` references in the editor pane with `detailKey`.

- [ ] **Step 2: Update rail row click handler**

Pass an `onClick` to `RailColumn` that handles ctrl/shift/click. In the main component:

```ts
const handleRailClick = (e: React.MouseEvent, key: DefinitionsKey) => {
  if (e.shiftKey && lastClickedKey) {
    const ids = filtered.map((h: any) => h.item.key as DefinitionsKey);
    const a = ids.indexOf(lastClickedKey);
    const b = ids.indexOf(key);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const next = new Set(selectedKeys);
      for (let i = lo; i <= hi; i++) next.add(ids[i]);
      setSelectedKeys(next);
      return;
    }
  }
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelectedKeys(next);
    setLastClickedKey(key);
    return;
  }
  setSelectedKeys(new Set([key]));
  setLastClickedKey(key);
  setSelectedKey(key);
};
```

In `RailColumn`, change `onClick={() => setSelectedKey(h.item.key)}` to `onClick={(e) => handleRailClick(e, h.item.key)}` and add a `selected-multi` class when `selectedKeys.has(h.item.key)`. Pass `handleRailClick` and `selectedKeys` through props.

- [ ] **Step 3: Render the action bar**

Below the rail, when `selectedKeys.size >= 2`, render:

```tsx
{selectedKeys.size >= 2 && (
  <div className="action-bar">
    <span>{selectedKeys.size} selected</span>
    <button disabled={selectedKeys.size > 3} title={selectedKeys.size > 3 ? 'Compare supports max 3' : 'Compare'} onClick={() => setMode('compare')}>Compare</button>
    <button onClick={() => setBulkOpen(true)}>Bulk edit…</button>
    <button onClick={() => duplicateSelected()}>Duplicate × {selectedKeys.size}</button>
    <button onClick={() => { setSelectedKeys(new Set()); setLastClickedKey(null); }}>Clear</button>
  </div>
)}
```

Add stub state hooks: `const [mode, setMode] = useState<'detail' | 'spreadsheet' | 'compare'>('detail');`, `const [bulkOpen, setBulkOpen] = useState(false);`, and a stub `const duplicateSelected = () => {};` for now. Real implementations land in tasks 16, 18, 17 respectively.

Wrap the `mode === 'compare'` and `mode === 'spreadsheet'` workspace branches with a placeholder for now:

```tsx
{mode === 'detail' && (selected && selectedKey ? (...existing detail JSX) : <div className="empty-state-mini">…</div>)}
{mode === 'spreadsheet' && <div className="empty-state-mini">Spreadsheet view (coming next).</div>}
{mode === 'compare' && <div className="empty-state-mini">Compare view (coming next).</div>}
```

- [ ] **Step 4: Add CSS**

Append to `styles-new.css`:

```css
.action-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  background: var(--surface-2, #242832);
  border-top: 1px solid var(--divider, #2a2f38);
}
.action-bar button { background: none; border: 1px solid var(--divider, #2a2f38); color: var(--text, #d6d8dc); padding: 4px 10px; cursor: pointer; }
.action-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
.rail-row.selected-multi { background: var(--surface-2, #242832); }
```

- [ ] **Step 5: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): multi-select + floating action bar"
```

---

## Task 15: Spreadsheet view mode

**Files:**
- Create: `web/src/components/classBrowser/SpreadsheetView.tsx`
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`

- [ ] **Step 1: Add a mode toggle in the workspace header**

In `ClassBrowserTab.tsx`, above the conditional `{mode === ...}` blocks, render a toggle:

```tsx
<div className="mode-toggle">
  <button className={mode === 'detail' ? 'active' : ''} onClick={() => setMode('detail')}>Detail</button>
  <button className={mode === 'spreadsheet' ? 'active' : ''} onClick={() => setMode('spreadsheet')}>Spreadsheet</button>
  <button className={mode === 'compare' ? 'active' : ''} disabled={selectedKeys.size < 2} onClick={() => setMode('compare')}>Compare</button>
</div>
```

Persist the mode per-folder in localStorage (key `tsic.classBrowser.${folder}.mode.v1`). Add a `useEffect` that writes the mode whenever it changes; initialise from localStorage in `useState` initialiser.

- [ ] **Step 2: Write the spreadsheet view**

```tsx
// web/src/components/classBrowser/SpreadsheetView.tsx
import { useMemo, useState } from 'react';
import type { ClassBrowserConfig, Column } from './types';
import type { DefinitionRecord, DefinitionsKey } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';

interface Props {
  rows: { key: DefinitionsKey; rec: DefinitionRecord }[];
  config: ClassBrowserConfig;
  onPickRow: (key: DefinitionsKey) => void;
}

function readPath(rec: DefinitionRecord, path: string[]): any {
  let cur: any = rec.json;
  for (const seg of path) { if (cur == null) return undefined; cur = cur[seg]; }
  return cur;
}

function fmt(v: any, kind: Column['kind']): string {
  if (v == null) return '—';
  switch (kind) {
    case 'number': return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
    case 'bool': return v ? '✓' : '·';
    case 'tag': return String(v).split('.').slice(-2).join('.');
    case 'ref': return String(v);
    case 'count': return Array.isArray(v) ? String(v.length) : '0';
    case 'string': default: return String(v);
  }
}

export function SpreadsheetView({ rows, config, onPickRow }: Props) {
  const [sortKey, setSortKey] = useState<string>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const allCols: Column[] = useMemo(() => {
    const defaults: Column[] = [
      { key: 'id', label: 'ID', path: ['id'], kind: 'string' },
      { key: 'display_name', label: 'Name', path: ['properties','display_name','value'], kind: 'string' },
    ];
    const hasLevel = rows.some((r) => readPath(r.rec, ['properties','level','value']) != null);
    if (hasLevel) defaults.push({ key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 });
    return [...defaults, ...config.columns];
  }, [rows, config.columns]);

  const sorted = useMemo(() => {
    const col = allCols.find((c) => c.key === sortKey) ?? allCols[0];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = readPath(a.rec, col.path);
      const vb = readPath(b.rec, col.path);
      if (va == null && vb == null) return 0;
      if (va == null) return -1 * dir;
      if (vb == null) return 1 * dir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sortKey, sortDir, allCols]);

  const click = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  return (
    <div className="spreadsheet">
      <div className="spreadsheet-head">
        {allCols.map((c) => (
          <div
            key={c.key}
            className={`spreadsheet-h ${sortKey === c.key ? 'sorted' : ''}`}
            style={{ width: c.width }}
            onClick={() => click(c.key)}
          >{c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : ''}</div>
        ))}
      </div>
      <div className="spreadsheet-body">
        {sorted.map(({ key, rec }) => (
          <div key={key} className="spreadsheet-row" onClick={() => onPickRow(key)}>
            {allCols.map((c) => {
              const raw = readPath(rec, c.path);
              const display = c.key === 'id' ? rec.id : c.key === 'display_name' ? (raw ?? humanizeAssetId(rec.id)) : fmt(raw, c.kind);
              return <div key={c.key} className="spreadsheet-cell" style={{ width: c.width }}>{display as string}</div>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render in ClassBrowserTab**

Replace the `mode === 'spreadsheet'` placeholder:

```tsx
{mode === 'spreadsheet' && (
  <SpreadsheetView
    rows={rows.map((r) => ({ key: r.key, rec: definitions.get(r.key)! })).filter((r) => r.rec)}
    config={config}
    onPickRow={(k) => { setSelectedKey(k); setSelectedKeys(new Set([k])); setMode('detail'); }}
  />
)}
```

Import `SpreadsheetView`.

- [ ] **Step 4: Add CSS**

```css
.mode-toggle { display: flex; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--divider, #2a2f38); }
.mode-toggle button { background: none; border: 1px solid var(--divider, #2a2f38); color: var(--text, #d6d8dc); padding: 2px 10px; cursor: pointer; }
.mode-toggle button.active { background: var(--surface-2, #242832); font-weight: 600; }
.spreadsheet { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.spreadsheet-head { display: flex; gap: 0; background: var(--surface-2, #242832); border-bottom: 1px solid var(--divider, #2a2f38); }
.spreadsheet-h { flex: 1; padding: 6px 10px; font-weight: 600; cursor: pointer; user-select: none; }
.spreadsheet-h.sorted { color: var(--accent, #a4c8ff); }
.spreadsheet-body { overflow-y: auto; }
.spreadsheet-row { display: flex; gap: 0; cursor: pointer; border-bottom: 1px solid var(--divider, #2a2f38); }
.spreadsheet-row:hover { background: var(--surface-2, #242832); }
.spreadsheet-cell { flex: 1; padding: 4px 10px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add web/src/components/classBrowser/SpreadsheetView.tsx web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): spreadsheet view mode"
```

---

## Task 16: Compare view mode

**Files:**
- Create: `web/src/components/classBrowser/CompareView.tsx`
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`

- [ ] **Step 1: Write the view**

```tsx
import { useMemo } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';

interface Props {
  selected: DefinitionsKey[];
}

function flatten(properties: any, prefix: string[] = []): { path: string; value: any }[] {
  const out: { path: string; value: any }[] = [];
  if (!properties || typeof properties !== 'object') return out;
  for (const [k, v] of Object.entries(properties)) {
    const path = [...prefix, k].join('.');
    if (v && typeof v === 'object' && (v as any).type === 'struct' && (v as any).value && typeof (v as any).value === 'object') {
      out.push(...flatten((v as any).value, [...prefix, k]));
    } else {
      out.push({ path, value: v });
    }
  }
  return out;
}

function shortValue(env: any): string {
  if (env == null) return '—';
  if (typeof env !== 'object') return String(env);
  if (env.type === 'array') return `[${(env.value ?? []).length}]`;
  if (env.type === 'map')   return `{${(env.value ?? []).length}}`;
  if (env.type === 'struct') return `struct ${env.struct_name ?? ''}`.trim();
  if ('value' in env) return String(env.value);
  return '?';
}

export function CompareView({ selected }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const recs = selected.map((k) => definitions.get(k)).filter(Boolean);

  const allPaths = useMemo(() => {
    const set = new Set<string>();
    for (const rec of recs) for (const f of flatten(rec!.json?.properties)) set.add(f.path);
    return [...set].sort();
  }, [recs]);

  const rows = useMemo(() => {
    return allPaths.map((p) => {
      const values = recs.map((rec) => {
        const segs = p.split('.');
        let cur: any = rec!.json?.properties;
        for (const s of segs) { if (cur == null) return undefined; cur = cur[s]; }
        return shortValue(cur);
      });
      const allSame = values.every((v) => v === values[0]);
      return { path: p, values, allSame };
    });
  }, [recs, allPaths]);

  const diffs = rows.filter((r) => !r.allSame);
  const same = rows.filter((r) => r.allSame);

  return (
    <div className="compare">
      <div className="compare-head">
        <div className="compare-cell muted">Property</div>
        {recs.map((rec) => (
          <div key={rec!.id} className="compare-cell"><strong>{humanizeAssetId(rec!.id)}</strong><br/><span className="muted small">{String(rec!.json?.class).replace(/^U/, '')}</span></div>
        ))}
      </div>
      {diffs.map((r) => (
        <div key={r.path} className="compare-row diff">
          <div className="compare-cell muted">{r.path}</div>
          {r.values.map((v, i) => <div key={i} className="compare-cell">{v ?? '—'}</div>)}
        </div>
      ))}
      <details className="compare-same">
        <summary>matching properties ({same.length})</summary>
        {same.map((r) => (
          <div key={r.path} className="compare-row">
            <div className="compare-cell muted">{r.path}</div>
            {r.values.map((v, i) => <div key={i} className="compare-cell muted">{v ?? '—'}</div>)}
          </div>
        ))}
      </details>
    </div>
  );
}
```

- [ ] **Step 2: Wire into ClassBrowserTab**

```tsx
{mode === 'compare' && selectedKeys.size >= 2 && (
  <CompareView selected={Array.from(selectedKeys).slice(0, 3)} />
)}
{mode === 'compare' && selectedKeys.size < 2 && <div className="empty-state-mini">Pick 2 or 3 records on the rail to compare.</div>}
```

Import `CompareView`.

- [ ] **Step 3: CSS**

```css
.compare { display: flex; flex-direction: column; padding: 12px; }
.compare-head, .compare-row { display: flex; gap: 0; border-bottom: 1px solid var(--divider, #2a2f38); }
.compare-row.diff { background: rgba(232, 196, 94, 0.06); }
.compare-cell { flex: 1; padding: 6px 10px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.compare-same summary { cursor: pointer; padding: 6px 0; font-weight: 600; }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add web/src/components/classBrowser/CompareView.tsx web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): compare view for 2-3 records"
```

---

## Task 17: Duplicate (single + multi)

**Files:**
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`

- [ ] **Step 1: Add the duplicate helper**

```ts
const duplicateOne = (sourceKey: DefinitionsKey): DefinitionsKey | null => {
  const rec = definitions.get(sourceKey);
  if (!rec) return null;
  const base = rec.id;
  const tryIds = [`${base}_Copy`, ...Array.from({ length: 50 }, (_, i) => `${base}_Copy${i + 2}`)];
  let newId: string | null = null;
  for (const id of tryIds) { if (!findKeyById(id)) { newId = id; break; } }
  if (!newId) return null;
  const newKey = createDefinitionForClass(rec.json?.class?.replace(/^U/, ''), newId);
  if (!newKey) return null;
  // Deep-clone properties from the source.
  const cloned = structuredClone(rec.json?.properties ?? {});
  updateValueAtPath(newKey, ['properties'], cloned);
  return newKey;
};

const duplicateSelected = () => {
  const sources = Array.from(selectedKeys);
  let last: DefinitionsKey | null = null;
  for (const k of sources) {
    const newKey = duplicateOne(k);
    if (newKey) last = newKey;
  }
  if (last) {
    setSelectedKey(last);
    setSelectedKeys(new Set([last]));
  }
};
```

- [ ] **Step 2: Add right-click context menu on rail rows**

For MVP, skip a real context menu and use a long-press / aux button. Simpler: add an inline duplicate button visible on hover. In the rail row JSX:

```tsx
<button
  className="row-dup"
  title="Duplicate"
  onClick={(e) => { e.stopPropagation(); duplicateOne(h.item.key); }}
>⎘</button>
```

Pass `duplicateOne` through to `RailColumn` props.

- [ ] **Step 3: CSS**

```css
.row-dup {
  background: none;
  border: none;
  color: var(--muted, #8b95a3);
  cursor: pointer;
  padding: 0 6px;
  font-size: 14px;
  opacity: 0;
}
.rail-row:hover .row-dup { opacity: 1; }
.rail-row .row-dup:hover { color: var(--text, #d6d8dc); }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): duplicate single record + multi-duplicate"
```

---

## Task 18: BulkEditDialog

**Files:**
- Create: `web/src/components/classBrowser/BulkEditDialog.tsx`
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { TypedValueEditor } from '../TypedValueEditor';

interface Props {
  selectedKeys: DefinitionsKey[];
  onClose: () => void;
}

export function BulkEditDialog({ selectedKeys, onClose }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);

  // Build the set of property keys present on every selected record.
  const propertyKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of selectedKeys) {
      const rec = definitions.get(k);
      const props = rec?.json?.properties;
      if (!props || typeof props !== 'object') continue;
      for (const pk of Object.keys(props)) counts.set(pk, (counts.get(pk) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [selectedKeys, definitions]);

  const [propKey, setPropKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<any>(null);

  // The source envelope used to seed the editor — pick from the first record that has the property.
  const sourceEnvelope = useMemo(() => {
    if (!propKey) return null;
    for (const k of selectedKeys) {
      const env = definitions.get(k)?.json?.properties?.[propKey];
      if (env != null) return env;
    }
    return null;
  }, [propKey, selectedKeys, definitions]);

  const compatibleKeys = useMemo(() => {
    if (!propKey || !sourceEnvelope) return [] as DefinitionsKey[];
    return selectedKeys.filter((k) => {
      const env = definitions.get(k)?.json?.properties?.[propKey];
      return env && env.type === sourceEnvelope.type;
    });
  }, [propKey, sourceEnvelope, selectedKeys, definitions]);

  const apply = () => {
    if (!propKey || draftValue == null) return;
    for (const k of compatibleKeys) {
      updateValueAtPath(k, ['properties', propKey], draftValue);
    }
    onClose();
  };

  return (
    <div className="bulk-overlay" onClick={onClose}>
      <div className="bulk-dialog" onClick={(e) => e.stopPropagation()}>
        <header>Bulk edit {selectedKeys.length} records</header>
        <label>Property:
          <select value={propKey ?? ''} onChange={(e) => { setPropKey(e.target.value || null); setDraftValue(null); }}>
            <option value="">— pick —</option>
            {propertyKeys.map(([k, n]) => (
              <option key={k} value={k}>{k} ({n}/{selectedKeys.length})</option>
            ))}
          </select>
        </label>

        {propKey && sourceEnvelope && (
          <div className="bulk-editor">
            <TypedValueEditor
              parentTypeName={null as any}
              fieldName={propKey}
              envelope={draftValue ?? sourceEnvelope}
              onChange={(next) => setDraftValue(next)}
              refAdapter={undefined as any}
              ownerKey={undefined as any}
              path={['properties', propKey]}
            />
          </div>
        )}

        {propKey && (
          <div className="muted">
            Will apply to {compatibleKeys.length} of {selectedKeys.length} records.
            {compatibleKeys.length < selectedKeys.length && ` (${selectedKeys.length - compatibleKeys.length} skipped — incompatible type)`}
          </div>
        )}

        <footer>
          <button onClick={onClose}>Cancel</button>
          <button disabled={!propKey || draftValue == null || compatibleKeys.length === 0} onClick={apply}>Apply</button>
        </footer>
      </div>
    </div>
  );
}
```

(Note: `<TypedValueEditor>`'s real prop signature lives in `TypedValueEditor.tsx`. Adapt the call to match — drop or rename props as needed; the goal is to get the user a control to type the new value into. If the existing component requires complex setup, fall back to a simple `<input>` for the most common kinds (number/string/bool) and label the dialog "MVP — only scalar properties supported".)

- [ ] **Step 2: Mount in ClassBrowserTab**

```tsx
{bulkOpen && (
  <BulkEditDialog
    selectedKeys={Array.from(selectedKeys)}
    onClose={() => setBulkOpen(false)}
  />
)}
```

Import `BulkEditDialog`.

- [ ] **Step 3: CSS**

```css
.bulk-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100;
  display: flex; align-items: center; justify-content: center;
}
.bulk-dialog {
  background: var(--surface-1, #1d2128);
  border: 1px solid var(--divider, #2a2f38);
  padding: 16px; min-width: 400px; max-width: 600px;
}
.bulk-dialog header { font-weight: 600; margin-bottom: 12px; }
.bulk-dialog footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.bulk-editor { margin: 12px 0; padding: 8px; background: var(--surface-0, #16191e); }
```

- [ ] **Step 4: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS. If `<TypedValueEditor>` props don't match, fall back to scalar inputs as noted above.

- [ ] **Step 5: Commit**

```sh
git add web/src/components/classBrowser/BulkEditDialog.tsx web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): bulk edit dialog (property picker + apply)"
```

---

## Task 19: Auto-create static partners on Items tab mount

**Files:**
- Modify: `web/src/components/ItemsTab.tsx`

- [ ] **Step 1: Add the auto-create effect**

In `ItemsTab.tsx`, after the existing imports add:

```ts
import { useEffect, useRef } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { CONFIGS } from './classBrowser/configs';
import { deriveStaticPartnerId } from './classBrowser/RowWarnings';
```

Inside the component (above the return):

```ts
const definitions = useDefinitionsStore((s) => s.definitions);
const findKeyById = useDefinitionsStore((s) => s.findKeyById);
const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
const setToast = useDefinitionsStore((s) => s.setToast);
const loadedAt = useDefinitionsStore((s) => s.loadedAt);

const didAutoCreateForVersionRef = useRef<number | null>(null);

useEffect(() => {
  if (definitions.size === 0) return;
  if (didAutoCreateForVersionRef.current === loadedAt) return;
  didAutoCreateForVersionRef.current = loadedAt;

  let minted = 0;
  let replacedBroken = 0;

  for (const [folder, cfg] of Object.entries(CONFIGS)) {
    if (!cfg.hasStaticPartner) continue;
    for (const [k, rec] of definitions) {
      if (rec.folder !== folder) continue;
      const slot = rec.json?.properties?.static_item_definition;
      if (!slot || slot.type !== 'definition_ref') continue;
      const cur = slot.value;
      const resolved = typeof cur === 'string' && cur && findKeyById(cur);
      if (resolved) continue;

      // Mint a new partner.
      let baseId = deriveStaticPartnerId(rec.id);
      let id = baseId;
      let n = 2;
      while (findKeyById(id)) id = `${baseId}_${n++}`;
      const newKey = createDefinitionForClass('StaticItemDefinition', id);
      if (!newKey) continue;
      updateValueAtPath(k, ['properties', 'static_item_definition'], {
        type: 'definition_ref', class: 'StaticItemDefinition', value: id,
      });
      minted++;
      if (typeof cur === 'string' && cur.length > 0) replacedBroken++;
    }
  }
  if (minted > 0) {
    const suffix = replacedBroken > 0 ? ` (${replacedBroken} replacing broken refs)` : '';
    setToast({ kind: 'info', text: `Created ${minted} missing static-item partners${suffix}` });
  }
}, [definitions, loadedAt, findKeyById, createDefinitionForClass, updateValueAtPath, setToast]);
```

- [ ] **Step 2: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 3: Verify data-smoke still passes**

Run: `npm --prefix web run data-smoke`
Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add web/src/components/ItemsTab.tsx
git commit -m "feat(items): auto-create missing static-item partners on tab mount"
```

---

## Task 20: Cross-link buttons (Furniture↔Recipes&Loot, Stations→Furniture)

**Files:**
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`
- Modify: `web/src/components/FurnitureSubTab.tsx`
- Modify: `web/src/components/StationsSubTab.tsx`

- [ ] **Step 1: Add `↗ Edit recipes/loot` to ClassBrowserTab Detail header**

In `ClassBrowserTab.tsx`, in the Detail header (next to `<AssetTitle>`), add:

```tsx
{(() => {
  const cls = String(selected.json?.class ?? '');
  const setRSub = useAppStore.getState().setRecipesSubTab;
  const setTab = useAppStore.getState().setTab;
  const setSel = useDefinitionsStore.getState().selectDefinition;
  if (cls === 'UDamageableFurnitureDefinition') {
    return <button className="cross-link" onClick={() => { setTab('recipes-loot'); setRSub('furniture'); setSel(selectedKey); }}>↗ Edit recipes/loot</button>;
  }
  if (cls === 'UCraftingStationDefinition' || cls === 'UProductionStationDefinition' || cls === 'UPlantableDefinition') {
    return <button className="cross-link" onClick={() => { setTab('recipes-loot'); setRSub('stations'); setSel(selectedKey); useAppStore.getState().selectStation(selectedKey); }}>↗ Edit recipes/loot</button>;
  }
  return null;
})()}
```

- [ ] **Step 2: Add `↗ Edit intrinsic` to Recipes & Loot Furniture sub-tab**

Open `web/src/components/FurnitureSubTab.tsx`. In the per-furniture pane header (find where the existing `display_name` / `id` block is — typically inside a header element after a furniture is selected), add:

```tsx
<button
  className="cross-link"
  onClick={() => { setTab('furniture'); useAppStore.getState().setFurnitureSubTab('damageable'); }}
>↗ Edit intrinsic</button>
```

(`setTab` is already in scope; the import for `useAppStore` should already be there.)

- [ ] **Step 3: Add `↗ Edit intrinsic` to Stations sub-tab**

Open `web/src/components/StationsSubTab.tsx`. In the station header (find the per-station header that shows `display_name` after a station is selected), add a button that maps the station class to the right Furniture sub-tab:

```tsx
{(() => {
  const cls = String(selected?.json?.class ?? '');
  const target = cls === 'UCraftingStationDefinition' ? 'crafting-stations'
                : cls === 'UProductionStationDefinition' ? 'production-stations'
                : cls === 'UPlantableDefinition' ? 'plantable'
                : null;
  if (!target) return null;
  return (
    <button className="cross-link" onClick={() => {
      useAppStore.getState().setTab('furniture');
      useAppStore.getState().setFurnitureSubTab(target as any);
    }}>↗ Edit intrinsic</button>
  );
})()}
```

(Adapt the `selected` variable name to whatever the file uses for the active station record.)

- [ ] **Step 4: CSS**

```css
.cross-link {
  background: none;
  border: 1px solid var(--divider, #2a2f38);
  color: var(--accent, #a4c8ff);
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
}
.cross-link:hover { background: var(--surface-2, #242832); }
```

- [ ] **Step 5: Verify typecheck and build**

Run: `npm --prefix web run typecheck && npm --prefix web run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/components/FurnitureSubTab.tsx web/src/components/StationsSubTab.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): cross-link buttons between new tabs and Recipes & Loot"
```

---

## Task 21: data-smoke + UI smoke

**Files:**
- Modify: `web/data-smoke.mjs`
- Create: `web/items-furniture-ui-smoke.mjs`
- Modify: `web/package.json`

- [ ] **Step 1: Extend data-smoke**

Append to `web/data-smoke.mjs` (before the final summary print) a new check block:

```js
// Items + Furniture configs cover their folders.
const HAS_PARTNER = new Set([
  'crafting_material_definitions', 'consumable_definitions', 'constructable_item_definitions',
  'equippable_definitions', 'glove_definitions', 'ammo_definitions',
  'seed_item_definitions', 'trap_item_definitions',
]);
let partnerSlots = 0, partnerMissing = 0;
for (const rec of byId.values()) {
  if (!HAS_PARTNER.has(rec.folder)) continue;
  const slot = rec.json?.properties?.static_item_definition;
  if (!slot || slot.type !== 'definition_ref') continue;
  partnerSlots++;
  const v = slot.value;
  if (typeof v !== 'string' || !v || !byId.has(v)) partnerMissing++;
}
console.log(`[data-smoke] partner-resolvable: ${partnerSlots - partnerMissing}/${partnerSlots} (missing ${partnerMissing} — auto-create will mint these)`);
```

(Don't `fail()` on missing — auto-create handles them. Just log.)

- [ ] **Step 2: Add the UI smoke file**

Create `web/items-furniture-ui-smoke.mjs` modelled on `recipes-loot-ui-smoke.mjs`:

```js
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4236;

function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });
  return proc;
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`server didn't come up in ${timeoutMs}ms`);
}

(async () => {
  const proc = startServer();
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.tabs');

    // ---- Items tab loads ----
    await page.click('.tabs button:has-text("Items")');
    await page.waitForSelector('.vertical-subtab-rail');
    console.log('OK Items tab loaded');

    // ---- Equippables sub-tab + smart effects view ----
    await page.click('.vertical-subtab:has-text("Equippables")');
    await page.waitForSelector('.rail-row');
    // Click the Crossbow row.
    await page.click('.rail-row:has-text("Crossbow")');
    // Smart effects view should be visible.
    await page.waitForSelector('.smart-effects', { timeout: 5000 });
    console.log('OK Smart effects view rendered');

    // ---- Spreadsheet view ----
    await page.click('.vertical-subtab:has-text("Crafting Materials")');
    await page.click('.mode-toggle button:has-text("Spreadsheet")');
    await page.waitForSelector('.spreadsheet');
    // Sort by Wt.
    await page.click('.spreadsheet-h:has-text("Wt")');
    console.log('OK Spreadsheet sort');

    // ---- Furniture tab + Damageable + cross-link ----
    await page.click('.tabs button:has-text("Furniture")');
    await page.waitForSelector('.vertical-subtab-rail');
    await page.click('.vertical-subtab:has-text("Damageable")');
    await page.waitForSelector('.rail-row');
    await page.click('.rail-row >> nth=0');
    await page.waitForSelector('.cross-link:has-text("Edit recipes/loot")');
    await page.click('.cross-link:has-text("Edit recipes/loot")');
    // Active tab should have moved to Recipes & Loot.
    await page.waitForSelector('.tab.active:has-text("Recipes & Loot")');
    console.log('OK Cross-link to Recipes & Loot');

    await browser.close();
    console.log('items-furniture-ui-smoke: ALL OK');
  } finally {
    proc.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Add the npm script**

In `web/package.json`, in the `scripts` block, add:

```json
    "smoke:itemsfurn": "node items-furniture-ui-smoke.mjs",
    "smoke": "node definitions-ui-smoke.mjs && node recipes-loot-ui-smoke.mjs && node items-furniture-ui-smoke.mjs",
```

(Replace the existing `smoke` line.)

- [ ] **Step 4: Run data-smoke and the new UI smoke**

```sh
npm --prefix web run build
npm --prefix web run data-smoke
npm --prefix web run smoke:itemsfurn
```

Expected: data-smoke prints the new partner-resolvable line; UI smoke ends with `items-furniture-ui-smoke: ALL OK`.

If the UI smoke is flaky on selector matches (display labels may differ slightly from this draft), adjust the selectors to match the actual DOM. The intent — load tab, click sub-tab, verify the major widget renders — is what matters.

- [ ] **Step 5: Commit**

```sh
git add web/data-smoke.mjs web/items-furniture-ui-smoke.mjs web/package.json
git commit -m "test: data-smoke partner check + Playwright smoke for Items/Furniture tabs"
```

---

## Task 22: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Tabs section**

In `README.md`, replace the "Tabs" section's existing list with a list that includes the two new tabs. After the `Recipes & Loot` description and before `Definitions`, insert:

```markdown
- **Items** — vertical sub-tab rail per item folder (Crafting Materials, Consumables, Constructables, Equippables, Gloves, Ammo, Seeds, Traps, Static Items). Each sub-tab uses the shared `<ClassBrowserTab>` with Detail / Spreadsheet / Compare modes, inline row-warning chips, a Where-Used panel, multi-select bulk edit, duplicate, and property-echo on the rail. Equippables and Gloves get a smart effects view that hides the inactive `b_apply_X` pairs. Auto-creates missing static-item partners (`FD_*_SI`) on tab open.
- **Furniture** — same component, vertical sub-tab rail per furniture folder (Furniture, Damageable, Toggleable, With Components, Storage, Universal Storage, Crafting Stations, Production Stations, Plantable, Elevator, Teleporter, Death Box, Containment Cage, Shopping Cart, Spawn Points, Enemy Spawn Points, Interactable Text). Cross-links to Recipes & Loot for damageable/station records.
```

Also adjust the file structure block to mention `components/classBrowser/` and `store/referencedByIndex.ts`.

- [ ] **Step 2: Verify**

Manually re-read the section to make sure the prose is consistent.

- [ ] **Step 3: Commit**

```sh
git add README.md
git commit -m "docs(README): document Items and Furniture top-level tabs"
```

---

## Final verification

- [ ] Run the full test loop:

```sh
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run data-smoke
npm --prefix web run smoke
```

All four must pass before declaring the feature done.

- [ ] Manual exercise (5 minutes):

1. `npm --prefix web run dev`
2. Click Items in the header.
3. Switch through 3–4 sub-tabs; confirm rail loads and Detail editor renders.
4. Click a property in the editor; confirm rail rows show the value chip.
5. Toggle Spreadsheet → click a column header; confirm sort.
6. Ctrl-click 3 rows → click Compare in the action bar; confirm side-by-side.
7. Open Equippables → Crossbow → confirm smart effects view; toggle one effect on; reload page; confirm persistence.
8. Open Furniture → Damageable → click a record → click `↗ Edit recipes/loot`; confirm tab + selection.
9. Stop the dev server.
