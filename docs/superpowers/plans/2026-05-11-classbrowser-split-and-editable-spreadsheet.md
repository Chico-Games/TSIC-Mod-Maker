# ClassBrowser: editable spreadsheet, split-pin view, resizable/collapsible panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the spreadsheet view of `ClassBrowserTab` editable, replace the Compare mode with a Pin-driven Split view (two live DetailPanes), and make the rail, palette, and split divider resizable + collapsible.

**Architecture:** Extract today's detail JSX into a `DetailPane` component. Add small UI primitives (`ResizeHandle`, `CollapseStrip`) and drive widths via CSS variables wired to React state with localStorage persistence. Reuse `TypedFieldCell` (already used by `DefinitionsTable`) for editable spreadsheet cells. Delete `CompareView` and its mode.

**Tech Stack:** React 18 + Zustand store, CSS variables (no new dep), Playwright for UI smoke. Source under `web/src/components/classBrowser/`. Spec: `docs/superpowers/specs/2026-05-11-classbrowser-split-and-editable-spreadsheet-design.md`.

---

## Task 0: Baseline check

**Files:** none (read-only)

- [ ] **Step 1: Confirm baseline build/tests pass**

Run:
```
cd web
npm run typecheck
npm run build
npm run smoke
```
Expected: all three exit 0. If `smoke` fails on something unrelated to this plan, note it and proceed — but the same tests must keep passing after each task.

---

## Task 1: Remove Compare mode

**Files:**
- Delete: `web/src/components/classBrowser/CompareView.tsx`
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`
- Modify: `web/src/styles-new.css` (lines 1075–1079, the `.compare*` block)

### Step 1: Delete the CompareView file

- [ ] **Step 1**

Run:
```
git rm web/src/components/classBrowser/CompareView.tsx
```

### Step 2: Remove the import and `'compare'` mode from ClassBrowserTab

Edit `web/src/components/classBrowser/ClassBrowserTab.tsx`:

- [ ] **Step 2a:** Remove the import line:

Find: `import { CompareView } from './CompareView';`
Replace: (delete the entire line)

- [ ] **Step 2b:** Narrow the mode type. Replace:

```ts
const [mode, setMode] = useState<'detail' | 'spreadsheet' | 'compare'>(() => {
  try {
    const v = localStorage.getItem(MODE_LS_KEY);
    if (v === 'detail' || v === 'spreadsheet' || v === 'compare') return v;
  } catch { /* noop */ }
  return 'detail';
});
```

With:

```ts
const [mode, setMode] = useState<'detail' | 'spreadsheet'>(() => {
  try {
    const v = localStorage.getItem(MODE_LS_KEY);
    if (v === 'compare') return 'detail'; // legacy migration
    if (v === 'detail' || v === 'spreadsheet') return v;
  } catch { /* noop */ }
  return 'detail';
});
```

- [ ] **Step 2c:** Update the folder-change effect. Replace:

```ts
  useEffect(() => {
    setSelectedKey(null);
    setSelectedKeys(new Set());
    setLastClickedKey(null);
    try {
      const v = localStorage.getItem(`tsic.classBrowser.${folder}.mode.v1`);
      if (v === 'detail' || v === 'spreadsheet' || v === 'compare') setMode(v);
      else setMode('detail');
    } catch { setMode('detail'); }
  }, [folder]);
```

With:

```ts
  useEffect(() => {
    setSelectedKey(null);
    setSelectedKeys(new Set());
    setLastClickedKey(null);
    try {
      const k = `tsic.classBrowser.${folder}.mode.v1`;
      const v = localStorage.getItem(k);
      if (v === 'compare') { localStorage.setItem(k, 'detail'); setMode('detail'); return; }
      if (v === 'detail' || v === 'spreadsheet') setMode(v);
      else setMode('detail');
    } catch { setMode('detail'); }
  }, [folder]);
```

- [ ] **Step 2d:** Remove the Compare button from the mode toggle. Replace:

```tsx
          <div className="mode-toggle">
            <button className={mode === 'detail' ? 'active' : ''} onClick={() => setMode('detail')}>Detail</button>
            <button className={mode === 'spreadsheet' ? 'active' : ''} onClick={() => setMode('spreadsheet')}>Spreadsheet</button>
            <button className={mode === 'compare' ? 'active' : ''} disabled={selectedKeys.size < 2} onClick={() => setMode('compare')}>Compare</button>
          </div>
```

With:

```tsx
          <div className="mode-toggle">
            <button className={mode === 'detail' ? 'active' : ''} onClick={() => setMode('detail')}>Detail</button>
            <button className={mode === 'spreadsheet' ? 'active' : ''} onClick={() => setMode('spreadsheet')}>Spreadsheet</button>
          </div>
```

- [ ] **Step 2e:** Remove the two `mode === 'compare'` render branches:

Delete:
```tsx
          {mode === 'compare' && selectedKeys.size >= 2 && (
            <CompareView selected={Array.from(selectedKeys).slice(0, 3)} />
          )}
          {mode === 'compare' && selectedKeys.size < 2 && <div className="empty-state-mini">Pick 2 or 3 records on the rail to compare.</div>}
```

- [ ] **Step 2f:** Narrow the `RailColumn` prop type. Find:

```ts
  setMode: (m: 'detail' | 'spreadsheet' | 'compare') => void;
```

Replace with:
```ts
  setMode: (m: 'detail' | 'spreadsheet') => void;
```

- [ ] **Step 2g:** Remove the Compare button from the multi-select action-bar. Find:

```tsx
          <button disabled={selectedKeys.size > 3} title={selectedKeys.size > 3 ? 'Compare supports max 3' : 'Compare'} onClick={() => setMode('compare')}>Compare</button>
```

Delete it. The bar should now read:
```tsx
          <span>{selectedKeys.size} selected</span>
          <button onClick={() => setBulkOpen(true)}>Bulk edit…</button>
          <button onClick={() => duplicateSelected()}>Duplicate × {selectedKeys.size}</button>
          <button onClick={() => { setSelectedKeys(new Set()); setLastClickedKey(null); }}>Clear</button>
```

### Step 3: Remove .compare* CSS

Edit `web/src/styles-new.css`:

- [ ] **Step 3**

Find and delete lines 1075–1079 (the `.compare`, `.compare-head`, `.compare-row`, `.compare-row.diff`, `.compare-cell`, `.compare-same` rules). The block looks like:

```css
.compare { display: flex; flex-direction: column; padding: 12px; }
.compare-head, .compare-row { display: flex; gap: 0; border-bottom: 1px solid var(--divider, #2a2f38); }
.compare-row.diff { background: rgba(232, 196, 94, 0.06); }
.compare-cell { flex: 1; padding: 6px 10px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.compare-same summary { cursor: pointer; padding: 6px 0; font-weight: 600; }
```

### Step 4: Verify and commit

- [ ] **Step 4a:** Run typecheck + build

Run:
```
cd web
npm run typecheck
npm run build
```
Expected: both pass. No reference to `CompareView` or `'compare'` remains.

- [ ] **Step 4b:** Run smoke tests

Run:
```
npm run smoke
```
Expected: both UI smokes pass (the existing tests don't reference Compare, so nothing should change).

- [ ] **Step 4c:** Commit

```
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "refactor(classBrowser): remove Compare mode and CompareView

The Compare view is being superseded by the upcoming pin-driven
Split view. The mode key migration silently rewrites legacy
'compare' values to 'detail' on next folder switch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract DetailPane component

**Files:**
- Create: `web/src/components/classBrowser/DetailPane.tsx`
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`

This is a pure refactor — no behaviour change. Existing smoke tests must keep passing.

### Step 1: Create DetailPane

- [ ] **Step 1**

Write `web/src/components/classBrowser/DetailPane.tsx`:

```tsx
import { useAppStore } from '../../store/appStore';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { getFolderTheme } from '../folderTheme';
import { AssetTitle } from '../AssetTitle';
import { TypedPropertiesEditor } from '../TypedValueEditor';
import { useRefAdapter } from '../useRefAdapter';
import { WhereUsedPanel } from './WhereUsedPanel';

interface Props {
  assetKey: DefinitionsKey | null;
  pinned: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onRenamed?: (newKey: DefinitionsKey) => void;
}

export function DetailPane({ assetKey, pinned, onPin, onUnpin, onRenamed }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
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

  const selected = assetKey ? definitions.get(assetKey) : null;
  if (!selected || !assetKey) {
    return <div className="detail-pane empty"><div className="empty-state-mini">Pick a record from the rail.</div></div>;
  }
  const theme = getFolderTheme(selected.folder);

  return (
    <div className={`detail-pane ${pinned ? 'pinned' : ''}`}>
      <header className="station-header">
        <div className="station-title">
          <span aria-hidden>{theme.emoji}</span>
          <AssetTitle assetKey={assetKey} onRenamed={(k) => onRenamed?.(k)} />
          <span className="cls">{String(selected.json?.class ?? '').replace(/^U/, '')}</span>
          {(() => {
            const cls = String(selected.json?.class ?? '');
            const setRSub = useAppStore.getState().setRecipesSubTab;
            const setTabFn = useAppStore.getState().setTab;
            const selectDef = useDefinitionsStore.getState().selectDefinition;
            if (cls === 'UDamageableFurnitureDefinition') {
              return <button className="cross-link" onClick={() => { setTabFn('recipes-loot'); setRSub('furniture'); selectDef(assetKey); }}>↗ Edit recipes/loot</button>;
            }
            if (cls === 'UCraftingStationDefinition' || cls === 'UProductionStationDefinition' || cls === 'UPlantableDefinition') {
              return <button className="cross-link" onClick={() => { setTabFn('recipes-loot'); setRSub('stations'); selectDef(assetKey); useAppStore.getState().selectStation(assetKey); }}>↗ Edit recipes/loot</button>;
            }
            return null;
          })()}
          {!pinned && onPin && (
            <button className="pin-btn" title="Pin this record to the right" onClick={onPin}>📌 Pin</button>
          )}
          {pinned && onUnpin && (
            <button className="pin-btn pinned" title="Unpin" onClick={onUnpin}>📌 Unpin</button>
          )}
        </div>
        <div className="station-sub">
          <span className="muted">id:</span> <code>{selected.id}</code>
        </div>
      </header>

      <TypedPropertiesEditor
        parentTypeName={String(selected.json?.class ?? '').replace(/^U/, '')}
        properties={selected.json?.properties ?? {}}
        showAllFields={false}
        onChange={(next) => updateValueAtPath(assetKey, ['properties'], next)}
        refAdapter={refAdapter}
        ownerKey={assetKey}
      />
      <WhereUsedPanel assetId={selected.id} />
    </div>
  );
}
```

### Step 2: Use DetailPane in ClassBrowserTab

Edit `web/src/components/classBrowser/ClassBrowserTab.tsx`:

- [ ] **Step 2a:** Add the import (just below the existing local-folder imports near the top):

```tsx
import { DetailPane } from './DetailPane';
```

- [ ] **Step 2b:** Replace the entire `mode === 'detail'` branch (the JSX wrapped in `{mode === 'detail' && (selected && selectedKey ? (...) : ...)}`) with:

```tsx
          {mode === 'detail' && (
            <DetailPane
              assetKey={selectedKey}
              pinned={false}
              onRenamed={(k) => setSelectedKey(k)}
            />
          )}
```

(Pin/Unpin wiring lands in Task 6; we omit `onPin` for now.)

- [ ] **Step 2c:** Remove now-unused locals at the top of the function (the ones that DetailPane took over). Specifically, the following are only used in the deleted detail JSX and can be removed if not referenced elsewhere; **scan the file with your editor's find-references before deleting**:
  - `refAdapter` (the inline `useRefAdapter(...)` call in `ClassBrowserTab` is only used by the deleted JSX)
  - `selectFolder`, `selectDefinition`, `setTab` (only used by `refAdapter` construction)
  - `theme` (only used by the station-header in the deleted JSX)
  - The line `const selected = selectedKey ? definitions.get(selectedKey) : null;`

`updateValueAtPath` and `findKeyById` and `definitions` stay — they're still used by warnings logic, duplicate, and the spreadsheet hand-off.

If any of the locals are still referenced by Spreadsheet or warning code, leave them alone — only delete what becomes truly unused.

### Step 3: Add minimal CSS for `.detail-pane`

Edit `web/src/styles-new.css`. Just below the `.class-browser-pane` block (around line 979), add:

- [ ] **Step 3**

```css
.detail-pane {
  overflow: auto;
  min-height: 0;
  padding: 12px 16px;
  background: var(--surface-0, #16191e);
}
.detail-pane.empty { display: flex; align-items: center; justify-content: center; }
.detail-pane.pinned { border-left: 2px solid var(--accent, #a4c8ff); }
.pin-btn {
  margin-left: auto;
  background: none;
  border: 1px solid var(--divider, #2a2f38);
  color: var(--text, #d6d8dc);
  padding: 2px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}
.pin-btn.pinned { background: var(--surface-2, #242832); }
```

### Step 4: Verify and commit

- [ ] **Step 4a:** Run typecheck + build

Run:
```
cd web
npm run typecheck
npm run build
```
Expected: pass.

- [ ] **Step 4b:** Run smoke tests

Run:
```
npm run smoke
```
Expected: pass. (Pure refactor — selecting a record in the rail should still render the same detail view.)

- [ ] **Step 4c:** Commit

```
git add web/src/components/classBrowser/DetailPane.tsx web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css
git commit -m "refactor(classBrowser): extract DetailPane component

Pure refactor. The detail-mode JSX is now its own component so the
upcoming Split view can mount two of them with independent pin state.
No behaviour change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ResizeHandle primitive

**Files:**
- Create: `web/src/components/classBrowser/ResizeHandle.tsx`
- Modify: `web/src/styles-new.css`

The handle is a 4-px draggable bar that emits per-pointer-move pixel deltas. Pointer capture keeps the drag alive when the cursor leaves the bar. Double-click triggers a reset.

### Step 1: Create the component

- [ ] **Step 1**

Write `web/src/components/classBrowser/ResizeHandle.tsx`:

```tsx
import { useRef } from 'react';

interface Props {
  /** 'col' for left-right resize, 'col-rev' when growing the right pane should
   *  subtract from the variable. Use 'col' for the left handle (rail/palette)
   *  and 'col-rev' for the split divider when the right side shrinks. */
  orientation?: 'col' | 'col-rev';
  /** Called with the signed delta in pixels since the last move. */
  onDelta: (deltaPx: number) => void;
  /** Optional reset (double-click). */
  onReset?: () => void;
  /** Optional aria label. */
  label?: string;
}

export function ResizeHandle({ onDelta, onReset, label = 'Resize' }: Props) {
  const lastXRef = useRef<number | null>(null);
  const draggingRef = useRef<boolean>(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    lastXRef.current = e.clientX;
    draggingRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || lastXRef.current == null) return;
    const dx = e.clientX - lastXRef.current;
    if (dx !== 0) {
      lastXRef.current = e.clientX;
      onDelta(dx);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    lastXRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onReset?.()}
    />
  );
}
```

### Step 2: Add styles

Edit `web/src/styles-new.css`. Below the `.detail-pane` rules added in Task 2, add:

- [ ] **Step 2**

```css
.resize-handle {
  background: transparent;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}
.resize-handle:hover { background: var(--divider, #2a2f38); }
```

### Step 3: Verify

- [ ] **Step 3a:** Run typecheck (no usage yet, but the file must compile)

Run:
```
cd web
npm run typecheck
```
Expected: pass.

- [ ] **Step 3b:** Commit

```
git add web/src/components/classBrowser/ResizeHandle.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): add ResizeHandle primitive

Pointer-event-based 4-px drag bar. Emits per-move pixel deltas and
supports double-click reset. Used in the next tasks for the rail
edge, palette edge, and split divider.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CollapseStrip primitive

**Files:**
- Create: `web/src/components/classBrowser/CollapseStrip.tsx`
- Modify: `web/src/styles-new.css`

24-px-wide strip with a single chevron button to re-expand a collapsed panel.

### Step 1: Create the component

- [ ] **Step 1**

Write `web/src/components/classBrowser/CollapseStrip.tsx`:

```tsx
interface Props {
  /** Which edge of the strip the chevron points toward when expanding. */
  side: 'left' | 'right';
  onExpand: () => void;
  /** Optional aria label. */
  label?: string;
}

export function CollapseStrip({ side, onExpand, label = 'Expand panel' }: Props) {
  const chevron = side === 'left' ? '›' : '‹';
  return (
    <button
      type="button"
      className={`collapse-strip ${side}`}
      title={label}
      aria-label={label}
      onClick={onExpand}
    >
      {chevron}
    </button>
  );
}
```

### Step 2: Add styles

Edit `web/src/styles-new.css`. Below the `.resize-handle` rules added in Task 3, add:

- [ ] **Step 2**

```css
.collapse-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2, #242832);
  border: none;
  border-left: 1px solid var(--divider, #2a2f38);
  border-right: 1px solid var(--divider, #2a2f38);
  color: var(--text, #d6d8dc);
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  width: 24px;
  min-width: 24px;
}
.collapse-strip:hover { background: var(--surface-1, #1e222a); }
```

### Step 3: Verify and commit

- [ ] **Step 3a:** Run typecheck

Run:
```
cd web
npm run typecheck
```
Expected: pass.

- [ ] **Step 3b:** Commit

```
git add web/src/components/classBrowser/CollapseStrip.tsx web/src/styles-new.css
git commit -m "feat(classBrowser): add CollapseStrip primitive

24-px strip that replaces a collapsed panel with a chevron to
re-expand it. Used for rail and palette collapses in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire rail + palette resize and collapse

**Files:**
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`
- Modify: `web/src/styles-new.css`
- Modify: `web/items-furniture-ui-smoke.mjs`

State is global (not per-folder) — resizing applies to all folders. Persistence via localStorage.

### Step 1: Add layout state + persistence

Edit `web/src/components/classBrowser/ClassBrowserTab.tsx`. Just above the `MODE_LS_KEY` line (around line 81), add:

- [ ] **Step 1a:** Add the constants

```ts
const RAIL_W_LS = 'tsic.classBrowser.layout.rail.w.v1';
const PALETTE_W_LS = 'tsic.classBrowser.layout.palette.w.v1';
const RAIL_COLLAPSED_LS = 'tsic.classBrowser.layout.rail.collapsed.v1';
const PALETTE_COLLAPSED_LS = 'tsic.classBrowser.layout.palette.collapsed.v1';
const RAIL_DEFAULT_W = 260;
const PALETTE_DEFAULT_W = 280;
const RAIL_MIN_W = 180;
const PALETTE_MIN_W = 200;
```

- [ ] **Step 1b:** Add state initialisers (just below the other `useState` calls, before the `MODE_LS_KEY` block):

```ts
  const [railWidth, setRailWidth] = useState<number>(() => {
    try { const v = localStorage.getItem(RAIL_W_LS); if (v) return clampWidth(Number(v), RAIL_MIN_W, 600); } catch { /* noop */ }
    return RAIL_DEFAULT_W;
  });
  const [paletteWidth, setPaletteWidth] = useState<number>(() => {
    try { const v = localStorage.getItem(PALETTE_W_LS); if (v) return clampWidth(Number(v), PALETTE_MIN_W, 600); } catch { /* noop */ }
    return PALETTE_DEFAULT_W;
  });
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_COLLAPSED_LS) === '1'; } catch { return false; }
  });
  const [paletteCollapsed, setPaletteCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(PALETTE_COLLAPSED_LS) === '1'; } catch { return false; }
  });
```

- [ ] **Step 1c:** Add the `clampWidth` helper near the top of the file (just above `function severityOrder`):

```ts
function clampWidth(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
```

- [ ] **Step 1d:** Add persistence effects (just after the `useEffect` that writes `MODE_LS_KEY`):

```ts
  useEffect(() => { try { localStorage.setItem(RAIL_W_LS, String(railWidth)); } catch { /* noop */ } }, [railWidth]);
  useEffect(() => { try { localStorage.setItem(PALETTE_W_LS, String(paletteWidth)); } catch { /* noop */ } }, [paletteWidth]);
  useEffect(() => { try { localStorage.setItem(RAIL_COLLAPSED_LS, railCollapsed ? '1' : '0'); } catch { /* noop */ } }, [railCollapsed]);
  useEffect(() => { try { localStorage.setItem(PALETTE_COLLAPSED_LS, paletteCollapsed ? '1' : '0'); } catch { /* noop */ } }, [paletteCollapsed]);
```

### Step 2: Rewrite the layout grid

- [ ] **Step 2a:** Import the new primitives (top of file):

```tsx
import { ResizeHandle } from './ResizeHandle';
import { CollapseStrip } from './CollapseStrip';
```

- [ ] **Step 2b:** Replace the existing root JSX wrapper:

Find:
```tsx
    <PropertyEchoProvider>
      <div className="class-browser">
        <RailColumn ... />

        <EchoPublishingPane>
          ...
        </EchoPublishingPane>

        <ItemPalette ... />

        {bulkOpen && ( ... )}
      </div>
    </PropertyEchoProvider>
```

With (note: ItemPalette and EchoPublishingPane render the same as before, the wrapping `<div>` is new):

```tsx
    <PropertyEchoProvider>
      <div
        className={`class-browser ${railCollapsed ? 'rail-collapsed' : ''} ${paletteCollapsed ? 'palette-collapsed' : ''}`}
        style={{
          ['--cb-rail-w' as any]: `${railWidth}px`,
          ['--cb-palette-w' as any]: `${paletteWidth}px`,
        } as React.CSSProperties}
      >
        {railCollapsed ? (
          <CollapseStrip side="left" onExpand={() => setRailCollapsed(false)} label="Expand record list" />
        ) : (
          <RailColumn
            filtered={filtered}
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            selectedKeys={selectedKeys}
            handleRailClick={handleRailClick}
            setSelectedKeys={setSelectedKeys}
            setLastClickedKey={setLastClickedKey}
            setMode={setMode}
            setBulkOpen={setBulkOpen}
            duplicateSelected={duplicateSelected}
            duplicateOne={duplicateOne}
            theme={theme}
            config={config}
            findKeyById={findKeyById}
            createDefinitionForClass={createDefinitionForClass}
            filter={filter}
            setFilter={setFilter}
            jumpToDef={jumpToDef}
            warningsForRow={warningsForRow}
            definitions={definitions}
            onCollapse={() => setRailCollapsed(true)}
          />
        )}

        {!railCollapsed && (
          <ResizeHandle
            label="Resize record list"
            onDelta={(dx) => setRailWidth((w) => clampWidth(w + dx, RAIL_MIN_W, 600))}
            onReset={() => setRailWidth(RAIL_DEFAULT_W)}
          />
        )}

        <EchoPublishingPane>
          {/* mode-toggle and mode bodies unchanged */}
        </EchoPublishingPane>

        {!paletteCollapsed && (
          <ResizeHandle
            label="Resize item palette"
            onDelta={(dx) => setPaletteWidth((w) => clampWidth(w - dx, PALETTE_MIN_W, 600))}
            onReset={() => setPaletteWidth(PALETTE_DEFAULT_W)}
          />
        )}

        {paletteCollapsed ? (
          <CollapseStrip side="right" onExpand={() => setPaletteCollapsed(false)} label="Expand item palette" />
        ) : (
          <ItemPalette
            folders={config.paletteFolders ?? [folder, 'crafting_material_definitions', 'consumable_definitions', 'ammo_definitions']}
            title="Items"
            onCollapse={() => setPaletteCollapsed(true)}
          />
        )}

        {bulkOpen && (
          <BulkEditDialog
            selectedKeys={Array.from(selectedKeys)}
            onClose={() => setBulkOpen(false)}
          />
        )}
      </div>
    </PropertyEchoProvider>
```

Note: the right-handle's `onDelta` uses `w - dx` because dragging the handle to the **right** should **shrink** the palette (which is to the right of the handle).

### Step 3: Pass collapse buttons through to RailColumn / ItemPalette

- [ ] **Step 3a:** Add `onCollapse?: () => void` to `RailColumn`'s prop type and render a `‹` button in the rail header. Find the `<aside className="rail">` ... `<div className="rail-header">` block in `RailColumn` and add the button at the start of the header:

```tsx
      <div className="rail-header">
        {props.onCollapse && (
          <button className="rail-collapse-btn" title="Collapse" aria-label="Collapse record list" onClick={props.onCollapse}>‹</button>
        )}
        <h3>{config.label}</h3>
        ...
```

(Update the destructured props line to include `onCollapse` if you prefer; or use `props.onCollapse` as above. Either works.)

- [ ] **Step 3b:** Pass through to `ItemPalette`. Open `web/src/components/ItemPalette.tsx` and add an optional `onCollapse?: () => void` prop. Render a `›` button next to (or before) the title. Pattern:

```tsx
// Near the top of the palette header
{props.onCollapse && (
  <button className="palette-collapse-btn" title="Collapse" aria-label="Collapse item palette" onClick={props.onCollapse}>›</button>
)}
```

If `ItemPalette` has multiple call sites, leave the prop optional so other callers don't break.

### Step 4: CSS grid update

Edit `web/src/styles-new.css`. Replace the existing `.class-browser` block (around line 969):

- [ ] **Step 4a**

```css
.class-browser {
  display: grid;
  grid-template-columns:
    var(--cb-rail-w, 260px)
    4px
    minmax(0, 1fr)
    4px
    var(--cb-palette-w, 280px);
  height: 100%;
  min-height: 0;
}
.class-browser.rail-collapsed {
  grid-template-columns:
    24px
    0
    minmax(0, 1fr)
    4px
    var(--cb-palette-w, 280px);
}
.class-browser.palette-collapsed {
  grid-template-columns:
    var(--cb-rail-w, 260px)
    4px
    minmax(0, 1fr)
    0
    24px;
}
.class-browser.rail-collapsed.palette-collapsed {
  grid-template-columns: 24px 0 minmax(0, 1fr) 0 24px;
}
```

- [ ] **Step 4b:** Add small button styling. Right below the `.class-browser` rules add:

```css
.rail-collapse-btn, .palette-collapse-btn {
  background: none;
  border: 1px solid var(--divider, #2a2f38);
  color: var(--text, #d6d8dc);
  cursor: pointer;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.4;
}
.rail-collapse-btn:hover, .palette-collapse-btn:hover { background: var(--surface-2, #242832); }
```

### Step 5: Add the Playwright smoke test

Edit `web/items-furniture-ui-smoke.mjs`. Just before `await browser.close()`, append a new block:

- [ ] **Step 5a**

```js
    // ---- Layout: resize and collapse the rail ----
    await page.click('.tabs button:has-text("Furniture")');
    await page.waitForSelector('.class-browser');

    const grid = page.locator('.class-browser');
    const before = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--cb-rail-w').trim());
    // Drag the first resize-handle (rail) by +60px.
    const handle = page.locator('.class-browser > .resize-handle').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('rail resize handle not found');
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 60, y, { steps: 6 });
    await page.mouse.up();
    const after = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--cb-rail-w').trim());
    if (before === after) throw new Error(`rail width did not change after drag: ${before} -> ${after}`);
    console.log(`OK Rail resize ${before} -> ${after}`);

    // Collapse the rail.
    await page.click('.rail-collapse-btn');
    await page.waitForSelector('.class-browser.rail-collapsed .collapse-strip');
    console.log('OK Rail collapse');

    // Expand again.
    await page.click('.class-browser.rail-collapsed .collapse-strip');
    await page.waitForSelector('.class-browser:not(.rail-collapsed)');
    const restored = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--cb-rail-w').trim());
    if (restored !== after) throw new Error(`rail width didn't restore after expand: expected ${after}, got ${restored}`);
    console.log('OK Rail re-expand restored width');
```

### Step 6: Verify and commit

- [ ] **Step 6a:** Build and run smoke

Run:
```
cd web
npm run typecheck
npm run build
npm run smoke
```
Expected: pass, including the new resize/collapse assertions.

- [ ] **Step 6b:** Commit

```
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/components/ItemPalette.tsx web/src/styles-new.css web/items-furniture-ui-smoke.mjs
git commit -m "feat(classBrowser): resizable + collapsible rail and item palette

Three resize handles (rail edge, palette edge — split divider lands
next task) driven by CSS variables wired to React state. Each side
has a chevron to collapse to a 24-px strip. Widths and collapsed
state persist to localStorage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Pin state + Split rendering

**Files:**
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`
- Modify: `web/src/styles-new.css`
- Modify: `web/items-furniture-ui-smoke.mjs`

Adds the pin button to `DetailPane`, pin state in `ClassBrowserTab`, and the split layout that mounts two `DetailPane`s.

### Step 1: Pin state and persistence

Edit `web/src/components/classBrowser/ClassBrowserTab.tsx`.

- [ ] **Step 1a:** Add LS-key constants near the others added in Task 5:

```ts
const SPLIT_RATIO_LS = (folder: string) => `tsic.classBrowser.${folder}.split.ratio.v1`;
const PIN_LS = (folder: string) => `tsic.classBrowser.${folder}.pin.v1`;
const SPLIT_DEFAULT_RATIO = 0.5;
const SPLIT_MIN_RATIO = 0.2;
const SPLIT_MAX_RATIO = 0.8;
```

- [ ] **Step 1b:** Add state initialisers (next to the other layout state):

```ts
  const [pinnedKey, setPinnedKey] = useState<DefinitionsKey | null>(() => {
    try {
      const v = localStorage.getItem(PIN_LS(folder));
      return v && v.length > 0 ? (v as DefinitionsKey) : null;
    } catch { return null; }
  });
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const v = localStorage.getItem(SPLIT_RATIO_LS(folder));
      const n = v ? Number(v) : NaN;
      if (Number.isFinite(n)) return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, n));
    } catch { /* noop */ }
    return SPLIT_DEFAULT_RATIO;
  });
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  // Container width for converting handle deltas (px) to ratio deltas.
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
```

(You need `import { useRef } from 'react';` — add to the import line if not already imported.)

- [ ] **Step 1c:** Add folder-change re-read in the existing `useEffect([folder])` (just below the mode reset block):

```ts
    // Re-load per-folder pin and split ratio.
    try {
      const v = localStorage.getItem(PIN_LS(folder));
      setPinnedKey(v && v.length > 0 ? (v as DefinitionsKey) : null);
    } catch { setPinnedKey(null); }
    try {
      const v = localStorage.getItem(SPLIT_RATIO_LS(folder));
      const n = v ? Number(v) : NaN;
      setSplitRatio(Number.isFinite(n) ? Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, n)) : SPLIT_DEFAULT_RATIO);
    } catch { setSplitRatio(SPLIT_DEFAULT_RATIO); }
    setLeftCollapsed(false);
    setRightCollapsed(false);
```

- [ ] **Step 1d:** Add persistence effects:

```ts
  useEffect(() => {
    try {
      if (pinnedKey) localStorage.setItem(PIN_LS(folder), pinnedKey);
      else localStorage.removeItem(PIN_LS(folder));
    } catch { /* noop */ }
  }, [pinnedKey, folder]);
  useEffect(() => { try { localStorage.setItem(SPLIT_RATIO_LS(folder), String(splitRatio)); } catch { /* noop */ } }, [splitRatio, folder]);
```

- [ ] **Step 1e:** Add a stale-pin guard (drops pin when the record no longer exists):

```ts
  useEffect(() => {
    if (pinnedKey && !definitions.has(pinnedKey)) setPinnedKey(null);
  }, [definitions, pinnedKey]);
```

### Step 2: Replace the detail render branch with a split-aware one

- [ ] **Step 2**

Find the existing:

```tsx
          {mode === 'detail' && (
            <DetailPane
              assetKey={selectedKey}
              pinned={false}
              onRenamed={(k) => setSelectedKey(k)}
            />
          )}
```

Replace with:

```tsx
          {mode === 'detail' && (
            pinnedKey == null ? (
              <DetailPane
                assetKey={selectedKey}
                pinned={false}
                onPin={() => selectedKey && setPinnedKey(selectedKey)}
                onRenamed={(k) => setSelectedKey(k)}
              />
            ) : (
              <div
                ref={splitContainerRef}
                className={`split-pane ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}
                style={{
                  ['--cb-split-left' as any]: `${splitRatio * 100}%`,
                  ['--cb-split-right' as any]: `${(1 - splitRatio) * 100}%`,
                } as React.CSSProperties}
              >
                {leftCollapsed ? (
                  <CollapseStrip side="left" onExpand={() => setLeftCollapsed(false)} label="Expand left pane" />
                ) : (
                  <div className="split-half left">
                    <button
                      className="split-collapse-btn left"
                      title="Collapse left pane"
                      aria-label="Collapse left pane"
                      onClick={() => setLeftCollapsed(true)}
                    >‹</button>
                    <DetailPane
                      assetKey={selectedKey}
                      pinned={false}
                      onPin={() => selectedKey && setPinnedKey(selectedKey)}
                      onRenamed={(k) => setSelectedKey(k)}
                    />
                  </div>
                )}
                {!leftCollapsed && !rightCollapsed && (
                  <ResizeHandle
                    label="Resize split"
                    onDelta={(dx) => {
                      const el = splitContainerRef.current;
                      if (!el) return;
                      const width = el.getBoundingClientRect().width;
                      if (width <= 0) return;
                      setSplitRatio((r) => {
                        const next = r + dx / width;
                        return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, next));
                      });
                    }}
                    onReset={() => setSplitRatio(SPLIT_DEFAULT_RATIO)}
                  />
                )}
                {rightCollapsed ? (
                  <CollapseStrip side="right" onExpand={() => setRightCollapsed(false)} label="Expand right pane" />
                ) : (
                  <div className="split-half right">
                    <button
                      className="split-collapse-btn right"
                      title="Collapse right pane"
                      aria-label="Collapse right pane"
                      onClick={() => setRightCollapsed(true)}
                    >›</button>
                    <DetailPane
                      assetKey={pinnedKey}
                      pinned={true}
                      onUnpin={() => setPinnedKey(null)}
                    />
                  </div>
                )}
              </div>
            )
          )}
```

### Step 3: CSS for split

Edit `web/src/styles-new.css`. Below the layout rules added in Task 5, add:

- [ ] **Step 3**

```css
.split-pane {
  display: grid;
  grid-template-columns: var(--cb-split-left, 1fr) 4px var(--cb-split-right, 1fr);
  height: 100%;
  min-height: 0;
}
.split-pane.left-collapsed  { grid-template-columns: 24px 0 minmax(0, 1fr); }
.split-pane.right-collapsed { grid-template-columns: minmax(0, 1fr) 0 24px; }
.split-pane.left-collapsed.right-collapsed { grid-template-columns: 24px 0 24px; }

.split-half {
  position: relative;
  overflow: auto;
  min-height: 0;
  min-width: 0;
}
.split-collapse-btn {
  position: absolute;
  top: 8px;
  z-index: 2;
  background: var(--surface-2, #242832);
  border: 1px solid var(--divider, #2a2f38);
  color: var(--text, #d6d8dc);
  cursor: pointer;
  width: 20px; height: 20px;
  padding: 0;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1;
}
.split-collapse-btn.left  { left: 4px; }
.split-collapse-btn.right { right: 4px; }
.split-collapse-btn:hover { background: var(--surface-1, #1e222a); }
```

(Note: `.split-half` overflows so each pane scrolls independently. `.detail-pane` already sets `overflow: auto` — applying it on the parent too is fine because the inner pane's content will own its own scroll.)

### Step 4: Smoke test additions

Edit `web/items-furniture-ui-smoke.mjs`. After the resize/collapse block added in Task 5, append:

- [ ] **Step 4a**

```js
    // ---- Pin to right: split view ----
    // Sub-tab with at least two records. Furniture > Damageable was already
    // exercised earlier; reuse it.
    await page.click('.tabs button:has-text("Furniture")');
    await page.click('.vertical-subtab:has-text("Damageable")');
    await page.waitForSelector('.rail-row');

    const railRows = page.locator('.rail-row');
    await railRows.nth(0).click();
    // Capture the first record's id (rendered in the .station-sub > code).
    await page.waitForSelector('.detail-pane .station-sub code');
    const firstId = await page.locator('.detail-pane .station-sub code').first().innerText();

    // Pin it.
    await page.click('.detail-pane .pin-btn:has-text("Pin")');
    await page.waitForSelector('.split-pane');
    // Now there should be exactly two .detail-pane elements: left (not pinned) + right (pinned).
    const paneCount = await page.locator('.detail-pane').count();
    if (paneCount !== 2) throw new Error(`expected 2 detail-panes after pin, got ${paneCount}`);

    // Click a different rail row.
    await railRows.nth(1).click();
    const leftId = await page.locator('.split-pane .split-half.left .station-sub code').innerText();
    const rightId = await page.locator('.split-pane .split-half.right .station-sub code').innerText();
    if (leftId === rightId) throw new Error(`left and right show the same record after switching: ${leftId}`);
    if (rightId !== firstId) throw new Error(`right pane should still show pinned id ${firstId}, got ${rightId}`);
    console.log('OK Pin to right + switch left');

    // Unpin.
    await page.click('.detail-pane.pinned .pin-btn:has-text("Unpin")');
    await page.waitForSelector('.detail-pane:not(.pinned)');
    const splitGone = await page.locator('.split-pane').count();
    if (splitGone !== 0) throw new Error('split-pane should be gone after unpin');
    console.log('OK Unpin');
```

### Step 5: Verify and commit

- [ ] **Step 5a**

Run:
```
cd web
npm run typecheck
npm run build
npm run smoke
```
Expected: pass.

- [ ] **Step 5b:** Commit

```
git add web/src/components/classBrowser/ClassBrowserTab.tsx web/src/styles-new.css web/items-furniture-ui-smoke.mjs
git commit -m "feat(classBrowser): pin-driven Split view replaces Compare workflow

Pin button on the detail header pins the current record to the
right; the left pane keeps tracking rail selection. Unpin collapses
back to single. A drag handle resizes the split ratio (persisted
per folder), and each half can collapse to a 24-px strip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Editable spreadsheet cells

**Files:**
- Modify: `web/src/components/classBrowser/types.ts`
- Modify: `web/src/components/classBrowser/SpreadsheetView.tsx`
- Modify: `web/src/components/classBrowser/ClassBrowserTab.tsx`
- Modify: `web/src/components/TypedFieldCell.tsx`
- Modify: `web/src/styles-new.css`
- Modify: `web/items-furniture-ui-smoke.mjs`

Cells whose path leads to a typed envelope become `TypedFieldCell`s. The rest stay read-only.

### Step 1: Make `pinAdapter` optional in TypedFieldCell

Edit `web/src/components/TypedFieldCell.tsx`. The underlying `TypedField` already treats `pinAdapter` as optional. Mirror that:

- [ ] **Step 1**

Replace:
```ts
interface Props {
  typed: any;
  propertyName: string;
  parentTypeName: string;
  refAdapter: RefAdapter;
  pinAdapter: PinAdapter;
  onChange: (next: any) => void;
  path: (string | number)[];
}
```

With:
```ts
interface Props {
  typed: any;
  propertyName: string;
  parentTypeName: string;
  refAdapter: RefAdapter;
  pinAdapter?: PinAdapter;
  onChange: (next: any) => void;
  path: (string | number)[];
}
```

### Step 2: Extend Column type

Edit `web/src/components/classBrowser/types.ts`:

- [ ] **Step 2**

Replace:
```ts
export interface Column {
  key: string;
  label: string;
  path: string[];                 // path WITHIN record.json (no leading 'json' or 'properties' — relative to root)
  kind: ColumnKind;
  width?: number;
}
```

With:
```ts
export interface Column {
  key: string;
  label: string;
  path: string[];                 // path WITHIN record.json. Read-only fallback uses this verbatim.
  /** Explicit envelope path for the editable cell. If omitted, derived by
   *  dropping a trailing 'value' segment from `path`. If neither yields a
   *  typed envelope at the resolved location, the cell renders read-only. */
  envelopePath?: string[];
  kind: ColumnKind;
  width?: number;
}
```

### Step 3: Rewrite SpreadsheetView for editable cells

Edit `web/src/components/classBrowser/SpreadsheetView.tsx`. Replace the entire file with:

- [ ] **Step 3**

```tsx
import { useMemo, useState } from 'react';
import type { ClassBrowserConfig, Column } from './types';
import type { DefinitionRecord, DefinitionsKey } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';
import { TypedFieldCell } from '../TypedFieldCell';
import type { RefAdapter } from '../TypedValueEditor';

interface Props {
  rows: { key: DefinitionsKey; rec: DefinitionRecord }[];
  config: ClassBrowserConfig;
  refAdapter: RefAdapter;
  onChange: (key: DefinitionsKey, path: (string | number)[], next: any) => void;
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

function envelopePathFor(col: Column): string[] | null {
  if (col.envelopePath) return col.envelopePath;
  if (col.path.length === 0) return null;
  if (col.path[col.path.length - 1] !== 'value') return null;
  return col.path.slice(0, -1);
}

function isTypedEnvelope(v: any): boolean {
  return v != null && typeof v === 'object' && typeof v.type === 'string';
}

function bareClass(rec: DefinitionRecord): string {
  return String(rec.json?.class ?? '').replace(/^U/, '');
}

export function SpreadsheetView({ rows, config, refAdapter, onChange, onPickRow }: Props) {
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

  const clickHeader = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  return (
    <div className="spreadsheet">
      <div className="spreadsheet-head">
        <div className="spreadsheet-h open-col" aria-hidden>{/* open-in-detail column */}</div>
        {allCols.map((c) => (
          <div
            key={c.key}
            className={`spreadsheet-h ${sortKey === c.key ? 'sorted' : ''}`}
            style={{ width: c.width }}
            onClick={() => clickHeader(c.key)}
          >{c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▴' : ' ▾') : ''}</div>
        ))}
      </div>
      <div className="spreadsheet-body">
        {sorted.map(({ key, rec }) => (
          <div key={key} className="spreadsheet-row">
            <button
              className="spreadsheet-open"
              title="Open in Detail"
              onClick={(e) => { e.stopPropagation(); onPickRow(key); }}
            >↗</button>
            {allCols.map((c) => {
              if (c.key === 'id') {
                return (
                  <div key={c.key} className="spreadsheet-cell id" style={{ width: c.width }} onClick={() => onPickRow(key)}>{rec.id}</div>
                );
              }
              const envPath = envelopePathFor(c);
              const env = envPath ? readPath(rec, envPath) : null;
              const editable = isTypedEnvelope(env);
              if (!editable) {
                const raw = readPath(rec, c.path);
                const display = c.key === 'display_name' ? (raw ?? humanizeAssetId(rec.id)) : fmt(raw, c.kind);
                return <div key={c.key} className="spreadsheet-cell" style={{ width: c.width }}>{display as string}</div>;
              }
              return (
                <div key={c.key} className="spreadsheet-cell editable" style={{ width: c.width }}>
                  <TypedFieldCell
                    typed={env}
                    propertyName={envPath![envPath!.length - 1] as string}
                    parentTypeName={bareClass(rec)}
                    refAdapter={refAdapter}
                    onChange={(next) => onChange(key, envPath as (string | number)[], next)}
                    path={envPath as (string | number)[]}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 4: Wire from ClassBrowserTab

Edit `web/src/components/classBrowser/ClassBrowserTab.tsx`.

- [ ] **Step 4a:** Confirm `refAdapter` is still available in this file. After Task 2, the ClassBrowserTab body may have removed the local `refAdapter` since `DetailPane` builds its own. The spreadsheet needs one — rebuild it locally **just for the spreadsheet** to keep DetailPane's adapter encapsulated:

Find a stable spot near the other store hooks at the top of `ClassBrowserTab` and add:

```ts
  const refAdapterForSheet = useRefAdapter((id) => {
    const k = findKeyById(id);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  });
```

You will need to restore the imports if they were removed in Task 2:
```ts
import { useRefAdapter } from '../useRefAdapter';
```
and re-add the store hooks:
```ts
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);
```
(If they were not removed, leave the existing ones alone.)

- [ ] **Step 4b:** Update the SpreadsheetView call site:

Find:
```tsx
          {mode === 'spreadsheet' && (
            <SpreadsheetView
              rows={rows.map((r) => ({ key: r.key, rec: definitions.get(r.key)! })).filter((r) => r.rec)}
              config={config}
              onPickRow={(k) => { setSelectedKey(k); setSelectedKeys(new Set([k])); setMode('detail'); }}
            />
          )}
```

Replace with:

```tsx
          {mode === 'spreadsheet' && (
            <SpreadsheetView
              rows={rows.map((r) => ({ key: r.key, rec: definitions.get(r.key)! })).filter((r) => r.rec)}
              config={config}
              refAdapter={refAdapterForSheet}
              onChange={(k, path, next) => updateValueAtPath(k, path, next)}
              onPickRow={(k) => { setSelectedKey(k); setSelectedKeys(new Set([k])); setMode('detail'); }}
            />
          )}
```

### Step 5: CSS additions

Edit `web/src/styles-new.css`. Update the `.spreadsheet*` block:

- [ ] **Step 5**

Add rules just after the existing `.spreadsheet-cell` rule (around line 1073):

```css
.spreadsheet-h.open-col { width: 28px; flex: 0 0 28px; cursor: default; }
.spreadsheet-open {
  width: 28px; flex: 0 0 28px;
  background: none; border: none; color: var(--muted, #8a92a0);
  cursor: pointer; padding: 0;
}
.spreadsheet-open:hover { color: var(--accent, #a4c8ff); }
.spreadsheet-cell.id { cursor: pointer; }
.spreadsheet-cell.editable { overflow: visible; white-space: normal; padding: 2px 4px; }
.spreadsheet-cell.editable input,
.spreadsheet-cell.editable .ns-num,
.spreadsheet-cell.editable .ss-trigger { max-width: 100%; }
```

And remove the `cursor: pointer;` from the existing `.spreadsheet-row` rule (clicking the row no longer opens detail; only the `↗` button and the id cell do):

Find:
```css
.spreadsheet-row { display: flex; gap: 0; cursor: pointer; border-bottom: 1px solid var(--divider, #2a2f38); }
```
Replace with:
```css
.spreadsheet-row { display: flex; gap: 0; border-bottom: 1px solid var(--divider, #2a2f38); }
```

### Step 6: Smoke test addition

Edit `web/items-furniture-ui-smoke.mjs`. Update or extend the existing Spreadsheet block:

- [ ] **Step 6**

Find the existing block:
```js
    // ---- Spreadsheet view ----
    await page.click('.vertical-subtab:has-text("Crafting Materials")');
    await page.click('.mode-toggle button:has-text("Spreadsheet")');
    await page.waitForSelector('.spreadsheet');
    // Sort by Wt.
    await page.click('.spreadsheet-h:has-text("Wt")');
    console.log('OK Spreadsheet sort');
```

Extend it to:
```js
    // ---- Spreadsheet view (sort + edit) ----
    await page.click('.tabs button:has-text("Items")');
    await page.click('.vertical-subtab:has-text("Crafting Materials")');
    await page.click('.mode-toggle button:has-text("Spreadsheet")');
    await page.waitForSelector('.spreadsheet');
    // Sort by Wt.
    await page.click('.spreadsheet-h:has-text("Wt")');
    console.log('OK Spreadsheet sort');

    // Find the first editable numeric cell (NumberSlider input) and bump it.
    const firstEditable = page.locator('.spreadsheet-cell.editable input[type="number"]').first();
    await firstEditable.waitFor({ state: 'visible', timeout: 5000 });
    const before = await firstEditable.inputValue();
    const beforeNum = Number(before) || 0;
    const next = beforeNum + 1;
    await firstEditable.fill(String(next));
    await firstEditable.blur();
    // Switch back to detail and check the same numeric field reflects the change.
    await page.click('.mode-toggle button:has-text("Detail")');
    // The same record stays selected; look for an input with the new value.
    const detailInputs = page.locator('.detail-pane input[type="number"]');
    const detailFirst = detailInputs.first();
    await detailFirst.waitFor({ state: 'visible', timeout: 5000 });
    // The first numeric field on the asset isn't necessarily the same property
    // we edited — but the edited value should be present somewhere among the
    // detail's number inputs.
    const matched = await page.evaluate((expected) => {
      const inputs = Array.from(document.querySelectorAll('.detail-pane input[type="number"]')) as HTMLInputElement[];
      return inputs.some((i) => Number(i.value) === expected);
    }, next);
    if (!matched) throw new Error(`edited value ${next} not visible in detail-pane number inputs`);
    console.log('OK Spreadsheet edit reflected in Detail');
```

### Step 7: Verify and commit

- [ ] **Step 7a**

Run:
```
cd web
npm run typecheck
npm run build
npm run smoke
```
Expected: pass.

- [ ] **Step 7b:** Commit

```
git add web/src/components/classBrowser/types.ts web/src/components/classBrowser/SpreadsheetView.tsx web/src/components/classBrowser/ClassBrowserTab.tsx web/src/components/TypedFieldCell.tsx web/src/styles-new.css web/items-furniture-ui-smoke.mjs
git commit -m "feat(classBrowser): editable spreadsheet cells via TypedFieldCell

Each spreadsheet cell whose column path resolves to a typed
envelope renders the same TypedFieldCell editor used in
DefinitionsTable, so refs, sliders, toggles, and tags all work
inline. The id column stays read-only; the leading ↗ button (or
clicking id) opens the row in Detail mode. Column type gains an
optional envelopePath for non-trailing-'value' columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full check**

Run:
```
cd web
npm run typecheck
npm run build
npm run data-smoke
npm run smoke
```
Expected: all four exit 0.

- [ ] **Step 2: Manual sanity check**

Run `npm run dev` (or just open the previewed build). With Furniture > Damageable:
- Spreadsheet mode: edit a numeric cell, see the value update; switch to Detail, confirm the field matches.
- Detail mode: click the 📌 Pin button on the header. Confirm the split appears, the pinned record is on the right with the accent border. Click a different rail row; only the left changes.
- Drag the split divider; the ratio adjusts. Double-click the divider; it resets to 50%.
- Collapse the left half via the `‹` button; expand it again via the strip's chevron.
- Collapse the rail; expand it. Collapse the palette; expand it. Reload the page; widths and collapsed state persist.

- [ ] **Step 3: No follow-up commit needed** unless something was missed; in that case fix it and commit with a focused message before declaring done.

---

## Self-Review

**Spec coverage**

- Editable spreadsheet → Task 7 (steps 3–6)
- Pin-driven Split view → Task 6
- Compare removal → Task 1
- Resizable rail / palette → Task 5
- Collapsible rail / palette → Task 5
- Split divider resize + per-half collapse → Task 6 (step 2 + step 3 CSS)
- DetailPane extraction → Task 2
- ResizeHandle + CollapseStrip primitives → Tasks 3 and 4
- Per-folder pin + split ratio persistence → Task 6 (steps 1b–1e)
- Global rail/palette width + collapsed persistence → Task 5 (steps 1a–1d)
- 'compare' mode-key migration → Task 1 (step 2c)
- Stale pin guard → Task 6 (step 1e)
- envelopePath on Column → Task 7 (step 2)
- TypedFieldCell.pinAdapter optional → Task 7 (step 1)
- Smoke tests → Tasks 5, 6, 7 (additions in items-furniture-ui-smoke.mjs)

**Placeholder scan**: no `TBD`/`TODO`/"implement later"; each step has concrete commands or full code blocks.

**Type consistency**: `pinnedKey`, `setPinnedKey`, `splitRatio`, `setSplitRatio`, `railWidth`, `paletteWidth`, `leftCollapsed`, `rightCollapsed`, `splitContainerRef`, `clampWidth`, LS-key constants, `envelopePathFor`, `isTypedEnvelope`, `bareClass`, `refAdapterForSheet` — all consistent across the tasks where they appear.

**Decomposition**: each task ends with a green typecheck + build + smoke and a focused commit. The pinned-split feature is split into "extract DetailPane" (Task 2), "primitives" (Tasks 3–4), and "wire it up" (Task 6) so reviewable diffs are small.
