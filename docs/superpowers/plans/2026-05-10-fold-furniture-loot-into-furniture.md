# Fold Furniture Loot into Furniture sub-tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the standalone "Furniture Loot" top-level tab and absorb its `LootDefinition` editor inline into Recipes & Loot → Furniture, where each `loot_dropped_on_death` row gets a disclosure caret that expands the linked loot table's editor in place.

**Architecture:** One UI change in `FurnitureSubTab.tsx`: each death-loot entry becomes a header (caret + `DefRefSlot` + remove `×`) plus an optional body that renders `TypedPropertiesEditor` against the linked `LootDefinition`. Three deletions: the `'furniture-loot'` `AppTab` discriminant, the header tab entry, the `FurnitureLootTab.tsx` file (and its dead CSS). The smoke test gains inline-expand assertions and loses the standalone-tab assertions.

**Tech Stack:** React + TypeScript + Zustand + Vite. Playwright drives the UI smoke against a chromium instance running the in-memory fixture.

**Spec:** `docs/superpowers/specs/2026-05-10-fold-furniture-loot-into-furniture-design.md`

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `web/src/store/appStore.ts` | modify | Drop `'furniture-loot'` from `AppTab` union; legacy fallback in `loadTab` so a stored `'furniture-loot'` resolves to `'recipes-loot'`. |
| `web/src/components/Header.tsx` | modify | Drop the `Furniture Loot` entry from the `tabs` array. |
| `web/src/App.tsx` | modify | Drop `FurnitureLootTab` import + `case 'furniture-loot'`. |
| `web/src/components/FurnitureSubTab.tsx` | modify | Add `expanded: Set<number>` state + `useEffect` reset; restructure each loot entry to header + optional inline body; build `useRefAdapter` once and pass it to inline editors. |
| `web/src/components/FurnitureLootTab.tsx` | delete | Replaced by inline editing. |
| `web/src/styles.css` | modify | Remove the dead `.furniture-loot-*` block (lines ~1034–1101). |
| `web/src/styles-new.css` | modify | Remove `.furniture-loot-layout` from the three-column grid selectors and the `@media (max-width: 1100px)` block. Add `.death-loot-row`, `.death-loot-row-head`, `.death-loot-row-body`, `.death-loot-caret` rules. |
| `web/recipes-loot-ui-smoke.mjs` | modify | Replace the Furniture Loot tab section (lines ~631–638) with disclosure-caret assertions on the Aircon loot entry; verify inline editor renders, mutate `items_to_drop`, navigate away and back, verify persistence. |

---

## Task 1: Update the smoke test to expect inline-expand (red)

**Files:**
- Modify: `web/recipes-loot-ui-smoke.mjs:613-638`

We update the existing Furniture sub-tab section to also assert the disclosure caret + inline `TypedPropertiesEditor`, and remove the standalone Furniture Loot tab navigation. Running the smoke now should fail at the new selectors — that's the red.

- [ ] **Step 1: Replace the Aircon assertions and remove the Furniture Loot tab section**

Open `web/recipes-loot-ui-smoke.mjs`. Find the block starting with the comment `// ── Furniture sub-tab: select FD_Aircon_DF and confirm the death`. Replace from that comment through the end of the block ending with `console.log('OK: Furniture Loot rail shows items_to_drop count = 2');` (i.e., from ~line 613 through ~line 638) with:

```javascript
    // ── Furniture sub-tab: select FD_Aircon_DF and confirm the death
    //    loot list + upgrade recipe inline section render. The Furniture
    //    sub-tab is now the only authoring surface for LootDefinition
    //    contents — each loot entry has a disclosure caret that expands
    //    the linked LootDefinition's TypedPropertiesEditor inline.
    await page.locator('.subtab', { hasText: 'Furniture' }).click();
    await page.waitForSelector('.furniture-layout');
    await page.locator('.rail-family-head', { hasText: 'Aircon' }).first().click();
    await page.waitForTimeout(150);
    const lootEntries = await page.locator('.loot-entry').count();
    if (lootEntries < 1) throw new Error('expected ≥1 loot entry for Aircon');
    const upgradeBadge = await page.locator('.upgrade-recipe-badge', { hasText: 'Upgrade' }).count();
    if (upgradeBadge < 1) throw new Error('expected the Upgrade badge to render on Aircon');
    const upgradeCard = await page.locator('.upgrade-recipe-section .recipe-card').count();
    if (upgradeCard < 1) throw new Error('expected the Aircon upgrade recipe card to render');
    console.log('OK: Furniture sub-tab renders loot + badged upgrade recipe card');

    // ── Disclosure caret on the Aircon's first loot entry expands the
    //    linked LootDefinition's TypedPropertiesEditor inline. Verify
    //    items_to_drop renders, mutate it (add an entry), navigate to a
    //    different furniture and back, confirm the change persisted.
    const aircon = page.locator('.furniture-pane');
    const firstLoot = aircon.locator('.loot-entry').first();
    const caret = firstLoot.locator('.death-loot-caret');
    if ((await caret.count()) !== 1) throw new Error('expected one disclosure caret per loot entry');
    if (await caret.getAttribute('disabled') !== null) throw new Error('caret should be enabled when ref resolves');
    await caret.click();
    await page.waitForTimeout(120);
    const inlineEditor = firstLoot.locator('.death-loot-row-body .def-properties');
    if ((await inlineEditor.count()) !== 1) throw new Error('expected inline TypedPropertiesEditor (.def-properties) after expand');
    // The LootDefinition's only regular-array property is items_to_drop —
    // gameplay_tags renders as .def-array-strings (color-tag), not as
    // .def-array-items (color-array). Scope to .def-type-color-array so
    // we don't pick up the tag editor.
    const itemsField = inlineEditor.locator('.def-field.def-type-color-array').first();
    if ((await itemsField.count()) !== 1) throw new Error('expected one items_to_drop array field in inline editor');
    const itemsBefore = await itemsField.locator('.def-array-item').count();
    // FieldHead's "+ Add" button (literal label "+ Add" with one space)
    // appends a fresh ItemToDrop struct to the array.
    await itemsField.locator('button', { hasText: '+ Add' }).first().click();
    await page.waitForTimeout(120);
    const itemsAfterAdd = await itemsField.locator('.def-array-item').count();
    if (itemsAfterAdd !== itemsBefore + 1) {
      throw new Error(`expected items_to_drop to grow by 1; before=${itemsBefore} after=${itemsAfterAdd}`);
    }
    // Switch to a different furniture, then back to Aircon. Expansion
    // state is ephemeral by design (resets on selection change), so we
    // re-expand and confirm the underlying LootDefinition still has the
    // added entry.
    await page.locator('.rail-family-head').nth(1).click();
    await page.waitForTimeout(120);
    await page.locator('.rail-family-head', { hasText: 'Aircon' }).first().click();
    await page.waitForTimeout(120);
    await page.locator('.furniture-pane .loot-entry').first().locator('.death-loot-caret').click();
    await page.waitForTimeout(120);
    const itemsAfterReturn = await page.locator('.furniture-pane .loot-entry').first()
      .locator('.death-loot-row-body .def-properties .def-field.def-type-color-array')
      .first().locator('.def-array-item').count();
    if (itemsAfterReturn !== itemsAfterAdd) {
      throw new Error(`expected loot edit to persist across selection; expected=${itemsAfterAdd} got=${itemsAfterReturn}`);
    }
    console.log('OK: inline LootDefinition editor expands, edits persist, expansion state is ephemeral');
```

Save the file.

- [ ] **Step 2: Run the smoke; it must fail at the new selectors**

```powershell
cd web
npm run smoke:loot
```

Expected: smoke run fails inside the new block — most likely "expected one disclosure caret per loot entry" because `.death-loot-caret` does not exist yet. (If the harness errors earlier on something unrelated, fix that first before continuing.)

- [ ] **Step 3: Commit**

```powershell
git add web/recipes-loot-ui-smoke.mjs
git commit -m "test: smoke now asserts inline LootDefinition editor on Furniture sub-tab"
```

---

## Task 2: Add disclosure caret + inline LootDefinition editor to FurnitureSubTab

**Files:**
- Modify: `web/src/components/FurnitureSubTab.tsx`
- Modify: `web/src/styles-new.css` (add `.death-loot-*` rules)

This is the only behavioral change. We import the same editor + ref-adapter used by the soon-to-be-deleted `FurnitureLootTab`, hold an `expanded` set in component state, and render the inline body conditionally.

- [ ] **Step 1: Add new imports and a `useEffect` import**

Open `web/src/components/FurnitureSubTab.tsx`. Replace the `useMemo, useState` import on line 1 with:

```typescript
import { useEffect, useMemo, useState } from 'react';
```

Add these imports after the existing `import { inferAcceptedFolders } from '../inferFolders';` line:

```typescript
import { TypedPropertiesEditor } from './TypedValueEditor';
import { useRefAdapter } from './useRefAdapter';
import { useAppStore } from '../store/appStore';
```

- [ ] **Step 2: Wire up a `useRefAdapter` instance**

Inside the `FurnitureSubTab` component body, just below the existing `const jumpToDef = useJumpToDefinition();` line, add:

```typescript
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);

  const refAdapter = useRefAdapter((id) => {
    const k = findKeyById(id);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  });
```

This mirrors how `FurnitureLootTab.tsx` builds its ref adapter today (see `FurnitureLootTab.tsx:31-39`) so the inline editor's nested `definition_ref` widgets navigate to the Definitions tab on middle-click.

- [ ] **Step 3: Add `expanded` state and reset effect**

Just below the existing `const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);` line, add:

```typescript
  /** Indices of death-loot entries whose inline LootDefinition editor
   *  is currently open. Ephemeral — resets when the user picks a
   *  different furniture, and not persisted across reloads. */
  const [expandedLoot, setExpandedLoot] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    setExpandedLoot(new Set());
  }, [selectedKey]);
```

- [ ] **Step 4: Replace the death-loot section's `{lootEntries.map(...)}` block**

Find this block (currently around line 237):

```jsx
              {lootEntries.map((_e, i) => (
                <div key={i} className="loot-entry">
                  <DefRefSlot
                    ownerKey={selectedKey}
                    path={['properties', 'loot_dropped_on_death', 'value', i]}
                    accept="loot-entry"
                    defaultClass="LootDefinition"
                    onRemove={() => removeLoot(i)}
                  />
                </div>
              ))}
```

Replace with:

```jsx
              {lootEntries.map((entry, i) => {
                const refValue = entry?.type === 'definition_ref' && typeof entry.value === 'string' ? entry.value : '';
                const lootKey = refValue ? findKeyById(refValue) : null;
                const lootRec = lootKey ? definitions.get(lootKey) : null;
                const canExpand = !!lootRec;
                const isExpanded = canExpand && expandedLoot.has(i);
                const toggleExpand = () => {
                  setExpandedLoot((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    return next;
                  });
                };
                return (
                  <div key={i} className={`loot-entry death-loot-row ${isExpanded ? 'expanded' : ''}`}>
                    <div className="death-loot-row-head">
                      <button
                        className="death-loot-caret"
                        onClick={toggleExpand}
                        disabled={!canExpand}
                        title={canExpand ? (isExpanded ? 'Collapse loot table' : 'Expand loot table') : 'Empty slot — drop a LootDefinition here to edit it'}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                      <DefRefSlot
                        ownerKey={selectedKey}
                        path={['properties', 'loot_dropped_on_death', 'value', i]}
                        accept="loot-entry"
                        defaultClass="LootDefinition"
                        onRemove={() => removeLoot(i)}
                      />
                    </div>
                    {isExpanded && lootKey && lootRec && (
                      <div className="death-loot-row-body">
                        <TypedPropertiesEditor
                          parentTypeName={String(lootRec.json?.class ?? '').replace(/^U/, '')}
                          properties={lootRec.json?.properties ?? {}}
                          showAllFields={false}
                          onChange={(next) => updateValueAtPath(lootKey, ['properties'], next)}
                          refAdapter={refAdapter}
                          ownerKey={lootKey}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
```

- [ ] **Step 5: Add CSS for the new row pieces**

Open `web/src/styles-new.css`. Append at end of file:

```css
/* ============================================================
   Death loot row — disclosure caret + inline LootDefinition editor
   ============================================================ */
.death-loot-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.death-loot-row-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.death-loot-caret {
  flex: 0 0 auto;
  width: 20px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.death-loot-caret:hover:not([disabled]) {
  color: var(--text);
  background: var(--panel-2);
}
.death-loot-caret[disabled] {
  cursor: not-allowed;
  opacity: 0.5;
}
.death-loot-row.expanded .death-loot-caret {
  color: var(--accent-2);
  border-color: var(--accent-2);
}
.death-loot-row-body {
  margin-left: 26px;
  padding: 8px 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
}
```

- [ ] **Step 6: Typecheck and run the targeted smoke**

```powershell
cd web
npm run typecheck
npm run smoke:loot
```

Expected: typecheck passes; smoke `OK: inline LootDefinition editor expands, edits persist, expansion state is ephemeral` line prints. The standalone "Furniture Loot" tab is still in the header at this point — that comes off in Task 3 — but the new inline behavior is now in place.

If the smoke still fails on a selector inside the inline editor (e.g. `.array-row` doesn't exist for `items_to_drop`), inspect the rendered DOM (open `web/index.html` against the bundled fixture in a real browser) and adjust the smoke's selectors *or* this task's editor wiring so they line up.

- [ ] **Step 7: Commit**

```powershell
git add web/src/components/FurnitureSubTab.tsx web/src/styles-new.css
git commit -m "feat: inline LootDefinition editor on Furniture sub-tab via disclosure caret"
```

---

## Task 3: Remove the standalone Furniture Loot tab

**Files:**
- Modify: `web/src/store/appStore.ts:3, 55`
- Modify: `web/src/components/Header.tsx:23-28`
- Modify: `web/src/App.tsx:21, 164`
- Delete: `web/src/components/FurnitureLootTab.tsx`

The inline path now covers everything the standalone tab did. We drop the discriminant, the header entry, the route, and the file.

- [ ] **Step 1: Drop `'furniture-loot'` from `AppTab` and migrate stored values**

In `web/src/store/appStore.ts`, replace the `AppTab` line (line 3):

```typescript
export type AppTab = 'recipes-loot' | 'furniture-loot' | 'definitions' | 'validations';
```

with:

```typescript
export type AppTab = 'recipes-loot' | 'definitions' | 'validations';
```

Then replace the body of `loadTab` (lines 52–58):

```typescript
function loadTab(): AppTab {
  try {
    const v = localStorage.getItem(LS_TAB);
    if (v === 'recipes-loot' || v === 'furniture-loot' || v === 'definitions' || v === 'validations') return v;
  } catch { /* noop */ }
  return 'recipes-loot';
}
```

with:

```typescript
function loadTab(): AppTab {
  try {
    const v = localStorage.getItem(LS_TAB);
    if (v === 'recipes-loot' || v === 'definitions' || v === 'validations') return v;
    // Legacy: a previous build had a 'furniture-loot' top-level tab.
    // Map it onto Recipes & Loot so old localStorage doesn't strand
    // users on a blank tab.
    if (v === 'furniture-loot') return 'recipes-loot';
  } catch { /* noop */ }
  return 'recipes-loot';
}
```

- [ ] **Step 2: Drop the Header tab entry**

In `web/src/components/Header.tsx`, replace the `tabs` array (lines 23–28):

```typescript
  const tabs: Array<{ id: AppTab; label: string; badge?: number }> = [
    { id: 'recipes-loot', label: 'Recipes & Loot' },
    { id: 'furniture-loot', label: 'Furniture Loot' },
    { id: 'definitions', label: 'Definitions' },
    { id: 'validations', label: 'Validations' },
  ];
```

with:

```typescript
  const tabs: Array<{ id: AppTab; label: string; badge?: number }> = [
    { id: 'recipes-loot', label: 'Recipes & Loot' },
    { id: 'definitions', label: 'Definitions' },
    { id: 'validations', label: 'Validations' },
  ];
```

- [ ] **Step 3: Drop the App route and import**

In `web/src/App.tsx`:

Remove line 21:

```typescript
import { FurnitureLootTab } from './components/FurnitureLootTab';
```

Remove line 164 (inside `renderTab`):

```typescript
      case 'furniture-loot': return <FurnitureLootTab />;
```

The `switch` exhausts the union; with `AppTab` narrowed in Task 3 Step 1, TypeScript is satisfied without any `default`.

- [ ] **Step 4: Delete the file**

```powershell
git rm web/src/components/FurnitureLootTab.tsx
```

- [ ] **Step 5: Typecheck and run the full smoke**

```powershell
cd web
npm run typecheck
npm run smoke
```

Expected: typecheck passes; both Playwright smokes pass. The Recipes & Loot smoke prints `OK: inline LootDefinition editor expands…`. There is no Furniture Loot tab any more.

- [ ] **Step 6: Commit**

```powershell
git add web/src/store/appStore.ts web/src/components/Header.tsx web/src/App.tsx
git commit -m "refactor: drop standalone Furniture Loot tab; folded into Furniture sub-tab"
```

---

## Task 4: Remove dead `.furniture-loot-*` CSS

**Files:**
- Modify: `web/src/styles.css:1034-1101`
- Modify: `web/src/styles-new.css:24, 74, 94`

The legacy block in `styles.css` (`.furniture-loot-table` etc.) is unreferenced — nothing in `web/src/components` uses these class names. The grid declarations in `styles-new.css` reference `.furniture-loot-layout`, which is now also unreferenced.

- [ ] **Step 1: Confirm the legacy block is dead**

```powershell
cd web
git grep -nE 'furniture-loot-(table|header|count|selected|empty|disabled|list|row|name)' src
```

Expected: only matches in `src/styles.css` itself. If anything else matches, stop and investigate.

- [ ] **Step 2: Remove the legacy block from `styles.css`**

In `web/src/styles.css`, delete lines 1034 through 1101 (inclusive) — from `.furniture-loot-table {` through the end of `.furniture-loot-name:hover { text-decoration: underline; }`. Leave the surrounding rules (`.furniture-properties` above, `.furniture-notes` below) intact.

- [ ] **Step 3: Drop `.furniture-loot-layout` from `styles-new.css`**

In `web/src/styles-new.css`, find the selector list at line 23–25:

```css
.recipes-loot-layout,
.furniture-loot-layout,
.validations-layout {
```

Replace with:

```css
.recipes-loot-layout,
.validations-layout {
```

Then find the grid selectors at lines 70–74:

```css
.stations-layout,
.furniture-layout,
.enemies-layout,
.biome-layout,
.furniture-loot-layout {
```

Replace with:

```css
.stations-layout,
.furniture-layout,
.enemies-layout,
.biome-layout {
```

Then find the matching block inside `@media (max-width: 1100px)` at lines 90–94:

```css
  .stations-layout,
  .furniture-layout,
  .enemies-layout,
  .biome-layout,
  .furniture-loot-layout {
```

Replace with:

```css
  .stations-layout,
  .furniture-layout,
  .enemies-layout,
  .biome-layout {
```

- [ ] **Step 4: Confirm no other references**

```powershell
cd web
git grep -nE 'furniture-loot' src
```

Expected: zero matches. The string is gone from the codebase.

- [ ] **Step 5: Build and run both smokes**

```powershell
cd web
npm run build
npm run smoke
```

Expected: build succeeds (the build also runs `sync-base-definitions`); both Playwright smokes pass.

- [ ] **Step 6: Commit**

```powershell
git add web/src/styles.css web/src/styles-new.css
git commit -m "style: drop dead .furniture-loot-* rules and layout selector"
```

---

## Task 5: Final verification

**Files:** none modified. We just confirm everything still passes end-to-end.

- [ ] **Step 1: Run the full verification suite**

```powershell
cd web
npm run typecheck
npm run build
npm run data-smoke
npm run smoke
```

Expected: all four pass without warnings or errors.

- [ ] **Step 2: Spot-check the UI manually**

```powershell
cd web
npm run dev
```

Open the dev URL in a browser and walk through:

1. Header shows three tabs: **Recipes & Loot · Definitions · Validations**. No "Furniture Loot".
2. Recipes & Loot → Furniture sub-tab → pick **Aircon**. Death loot section shows entries. Each row has a `▸` caret on the left.
3. Click a caret. The linked `LootDefinition`'s editor expands inline below the row. Edit `items_to_drop` (add/remove entries, change weights). Confirm the count badge in the rail (if present) updates after a save.
4. Click the caret again. Body collapses.
5. Switch furniture in the rail. Expansion state resets.
6. Open a furniture whose death-loot ref is empty. Caret is disabled (greyed). Drop a `LootDefinition` from the right palette into the slot — the caret enables, click expands.
7. Open `localStorage` in DevTools and set `tsic.app.tab.v1` to `'furniture-loot'`. Reload. App should land on Recipes & Loot, not on a blank screen.

- [ ] **Step 3: Final commit if anything stylistic moved (optional)**

If steps 1–7 all pass, no further commits needed. If anything cosmetic snuck in during manual QA (e.g. a CSS tweak), commit it under `style:` and re-run `npm run smoke`.

---

## Self-Review Notes

- **Spec coverage:** removal of standalone tab (Task 3), inline editor (Task 2), legacy localStorage migration (Task 3 Step 1), smoke updates (Task 1), CSS cleanup (Task 4), edge case where caret is disabled on empty slot (Task 2 Step 4). All spec sections covered.
- **No placeholders.** Every code step shows the full block being inserted or removed.
- **Type/name consistency:** `expandedLoot` set, `.death-loot-caret` / `.death-loot-row` / `.death-loot-row-head` / `.death-loot-row-body` (new), and `.def-properties` / `.def-field.def-type-color-array` / `.def-array-item` / `+ Add` (existing, from `TypedPropertiesEditor` and `ContainerEditor` in `TypedValueEditor.tsx`) are used consistently in plan steps and the smoke test.
- **TDD shape:** Task 1 (red smoke) → Task 2 (green smoke) → Task 3 (refactor + delete with smoke as the safety net) → Task 4 (style cleanup, build-verified) → Task 5 (full verification + manual QA).
