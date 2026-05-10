# ClassBrowser: editable spreadsheet, split-pin view, resizable/collapsible panels

## Summary

Three related changes to the ClassBrowser surface (the per-folder definitions browser used in the Definitions tab and class-aware sub-tabs):

1. **Editable spreadsheet** — cells in `SpreadsheetView` become typed editors (reusing `TypedFieldCell`) instead of read-only text.
2. **Pin-driven Split view** — the existing `Detail` mode gains a pin button. Pinning the current record moves it to a fixed right pane; the left pane keeps tracking the rail selection. Unpin collapses back to single.
3. **Compare mode removed** — the third mode toggle and `CompareView` are deleted.
4. **Resizable + collapsible panels** — the left rail, the right ItemPalette, and the Split divider all support drag-to-resize and a collapse-to-edge chevron.

Net effect: a faster way to bulk-tweak values without leaving Spreadsheet mode, and a focused side-by-side authoring workflow for "edit this while keeping that visible."

## Goals

- Edit typed properties directly in the spreadsheet without round-tripping through Detail mode.
- See and edit two records of the same class side-by-side, with one stable (pinned) while the other follows the rail selection.
- Adjust the workspace shape (rail width, palette width, split ratio) and reclaim screen space (collapse rail/palette) without changing tabs.
- Maintain all existing behaviour: typed editing, ref pickers, pin echoes, click-to-author flow, drag-and-drop class compatibility.

## Non-goals

- Column reorder, freeze, or user-defined columns in the spreadsheet (columns stay driven by `ClassBrowserConfig.columns`).
- Pinning multiple records (only one pin slot per folder).
- Pinning across folders (pin is scoped to its folder; switching folders shows that folder's pin).
- Inline `id` renaming in the spreadsheet (use Detail's existing `AssetTitle` rename flow).
- Diff-mode comparison (Compare view is removed entirely; the split view shows two full editors, not a property diff).
- Touch / pinch gestures on the resize handles.

## UX

### Mode toggle

Before:
```
[Detail] [Spreadsheet] [Compare]
```
After:
```
[Detail] [Spreadsheet]
```

### Detail mode

- **No pin (Single)**: identical to today. Header shows `📌 Pin to right`. Clicking sets `pinnedKey = selectedKey`.
- **Pin set (Split)**: two `DetailPane`s side-by-side. Left tracks `selectedKey` (rail-driven). Right shows `pinnedKey` with a `📌 Unpin` button. A 4-px drag handle between them resizes the ratio. Each half has a "collapse to edge" button that hides itself behind a 24-px strip with a re-open chevron.
- Edits in either pane write through `updateValueAtPath`; the store updates both panes. If `selectedKey === pinnedKey`, both panes show the same record and reflect edits instantly.

### Spreadsheet mode

- Each cell that resolves to a typed envelope renders a `TypedFieldCell` (the same editor used in the per-asset form, minus the property-name label).
- Cells whose path doesn't resolve to a typed envelope (e.g., `id`, derived `count` columns) render as read-only text.
- Row open-in-Detail moves from "click anywhere on the row" to a leading `↗` button + clicking the `id` cell — the rest of the row is editable.
- Pin state is preserved when switching to Spreadsheet and back.

### Layout

Three resize handles and two collapse chevrons:

| Panel        | Resize          | Collapse                       | Default | Min  |
|--------------|-----------------|--------------------------------|---------|------|
| Rail (left)  | drag right edge | chevron at outer edge          | 260 px  | 180 px |
| Palette (right) | drag left edge | chevron at inner edge       | 280 px  | 200 px |
| Split halves | drag center divider (only in Split) | per-half collapse-to-edge | 50% / 50% | 280 px per half |

Double-click any handle resets that handle to its default. Collapsed panels render as a 24-px strip with a single chevron to re-open.

## Architecture

### Files

**New**

- `web/src/components/classBrowser/DetailPane.tsx` — the existing Detail JSX (`station-header` + `TypedPropertiesEditor` + `WhereUsedPanel`) extracted into one component:
  ```ts
  interface DetailPaneProps {
    assetKey: DefinitionsKey | null;
    pinned: boolean;
    onPin?: () => void;
    onUnpin?: () => void;
    onRenamed?: (newKey: DefinitionsKey) => void;
  }
  ```
- `web/src/components/classBrowser/ResizeHandle.tsx` — 4-px draggable bar. Pointer-event based; `onDelta(dx: number)`; calls a parent setter wrapped in `requestAnimationFrame`. Double-click emits `onReset`.
- `web/src/components/classBrowser/CollapseStrip.tsx` — 24-px collapsed-panel placeholder with a single chevron button.

**Modified**

- `web/src/components/classBrowser/ClassBrowserTab.tsx` — new state, removed Compare mode, layout grid rewritten with CSS variables, new components mounted.
- `web/src/components/classBrowser/SpreadsheetView.tsx` — cell render switched to `TypedFieldCell` when the envelope path resolves; `↗` open-in-detail control.
- `web/src/components/classBrowser/types.ts` — add optional `envelopePath?: string[]` to `Column`.
- `web/src/styles-new.css` — `.class-browser` grid → CSS variables; new rules for `.detail-pane`, `.split-pane`, `.resize-handle`, `.collapse-strip`; remove `.compare*` rules.

**Removed**

- `web/src/components/classBrowser/CompareView.tsx`
- `import` of `CompareView` from `ClassBrowserTab.tsx`
- The `'compare'` branch from the mode type and `useState` initialiser
- The `Compare` button in the rail's multi-select action-bar
- All `.compare*` CSS rules

### State (in `ClassBrowserTab`)

```ts
const [mode, setMode] = useState<'detail' | 'spreadsheet'>(...);
const [pinnedKey, setPinnedKey] = useState<DefinitionsKey | null>(...);

// Layout state (global, not per-folder)
const [railWidth, setRailWidth] = useState<number>(260);
const [paletteWidth, setPaletteWidth] = useState<number>(280);
const [railCollapsed, setRailCollapsed] = useState<boolean>(false);
const [paletteCollapsed, setPaletteCollapsed] = useState<boolean>(false);

// Split state (per-folder; only meaningful when pinnedKey != null)
const [splitRatio, setSplitRatio] = useState<number>(0.5); // 0..1, left's share
```

### CSS grid

```css
.class-browser {
  display: grid;
  grid-template-columns:
    var(--cb-rail-w, 260px)
    var(--cb-handle-w, 4px)
    minmax(0, 1fr)
    var(--cb-handle-w, 4px)
    var(--cb-palette-w, 280px);
  height: 100%;
  min-height: 0;
}
.class-browser.rail-collapsed   { grid-template-columns: 24px 0 minmax(0, 1fr) 4px var(--cb-palette-w, 280px); }
.class-browser.palette-collapsed { grid-template-columns: var(--cb-rail-w, 260px) 4px minmax(0, 1fr) 0 24px; }
.class-browser.rail-collapsed.palette-collapsed {
  grid-template-columns: 24px 0 minmax(0, 1fr) 0 24px;
}

.split-pane {
  display: grid;
  grid-template-columns: var(--cb-split-left, 1fr) var(--cb-handle-w, 4px) var(--cb-split-right, 1fr);
  height: 100%;
  min-height: 0;
}
.split-pane.left-collapsed  { grid-template-columns: 24px 0 minmax(0, 1fr); }
.split-pane.right-collapsed { grid-template-columns: minmax(0, 1fr) 0 24px; }

.detail-pane { overflow: auto; min-height: 0; padding: 12px 16px; }
.detail-pane.pinned { border-left: 2px solid var(--accent, #a4c8ff); }

.resize-handle { background: transparent; cursor: col-resize; }
.resize-handle:hover { background: var(--divider, #2a2f38); }

.collapse-strip {
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-2, #242832);
  border-right: 1px solid var(--divider, #2a2f38);
  cursor: pointer;
}
```

`--cb-rail-w`, `--cb-palette-w`, `--cb-split-left`, `--cb-split-right` are written to the parent's `style` attribute from React state.

### Mode toggle

```tsx
<div className="mode-toggle">
  <button className={mode === 'detail' ? 'active' : ''} onClick={() => setMode('detail')}>Detail</button>
  <button className={mode === 'spreadsheet' ? 'active' : ''} onClick={() => setMode('spreadsheet')}>Spreadsheet</button>
</div>
```

### Detail render branch

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
      className={`split-pane ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}
      style={{
        '--cb-split-left':  `${splitRatio * 100}%`,
        '--cb-split-right': `${(1 - splitRatio) * 100}%`,
      } as React.CSSProperties}
    >
      {leftCollapsed
        ? <CollapseStrip side="left" onExpand={() => setLeftCollapsed(false)} />
        : <DetailPane assetKey={selectedKey} pinned={false} onPin={() => setPinnedKey(selectedKey!)} onRenamed={(k) => setSelectedKey(k)} />}
      <ResizeHandle
        onDelta={(dx) => updateSplitRatio(dx)}
        onReset={() => setSplitRatio(0.5)}
      />
      {rightCollapsed
        ? <CollapseStrip side="right" onExpand={() => setRightCollapsed(false)} />
        : <DetailPane assetKey={pinnedKey} pinned={true} onUnpin={() => setPinnedKey(null)} />}
    </div>
  )
)}
```

(`leftCollapsed` / `rightCollapsed` are short-lived component-local state — they don't persist.)

### SpreadsheetView changes

Add to props:
```ts
interface Props {
  rows: { key: DefinitionsKey; rec: DefinitionRecord }[];
  config: ClassBrowserConfig;
  refAdapter: RefAdapter;
  onChange: (key: DefinitionsKey, path: (string | number)[], next: any) => void;
  onPickRow: (key: DefinitionsKey) => void;
}
```

Cell render:
```tsx
function Cell({ rec, col }: { rec: DefinitionRecord; col: Column }) {
  const envelopePath = col.envelopePath ?? stripTrailingValue(col.path);
  const env = envelopePath ? readPath(rec, envelopePath) : null;
  const editable = env && typeof env === 'object' && typeof env.type === 'string';

  if (col.key === 'id') return <span className="spreadsheet-cell id">{rec.id}</span>;
  if (!editable) {
    const raw = readPath(rec, col.path);
    return <span className="spreadsheet-cell">{fmt(raw, col.kind)}</span>;
  }
  return (
    <div className="spreadsheet-cell editable">
      <TypedFieldCell
        typed={env}
        propertyName={envelopePath[envelopePath.length - 1] as string}
        parentTypeName={bareClass(rec)}
        refAdapter={refAdapter}
        pinAdapter={NOOP_PIN_ADAPTER}
        onChange={(next) => onChange(rec.key, envelopePath, next)}
        path={envelopePath}
      />
    </div>
  );
}

function stripTrailingValue(path: string[]): string[] | null {
  if (path.length === 0 || path[path.length - 1] !== 'value') return null;
  return path.slice(0, -1);
}
```

Row layout:
```tsx
<div className="spreadsheet-row">
  <button className="spreadsheet-open" title="Open in Detail" onClick={() => onPickRow(key)}>↗</button>
  {allCols.map((c) => <Cell key={c.key} rec={rec} col={c} />)}
</div>
```

`NOOP_PIN_ADAPTER` is `{ isPinned: () => false, toggle: () => {} }` — defined once in `SpreadsheetView.tsx`. Spreadsheet columns are config-driven so per-property pinning has no role here.

### Persistence

| Key                                                     | Type            | Notes                                      |
|---------------------------------------------------------|-----------------|--------------------------------------------|
| `tsic.classBrowser.${folder}.mode.v1`                   | `'detail' \| 'spreadsheet'` | existing; `'compare'` migrated to `'detail'` |
| `tsic.classBrowser.${folder}.pin.v1`                    | `DefinitionsKey \| null` | new                                  |
| `tsic.classBrowser.${folder}.split.ratio.v1`            | `number` (0..1) | new                                        |
| `tsic.classBrowser.layout.rail.w.v1`                    | `number` (px)   | new; global                                |
| `tsic.classBrowser.layout.palette.w.v1`                 | `number` (px)   | new; global                                |
| `tsic.classBrowser.layout.rail.collapsed.v1`            | `'0' \| '1'`    | new; global                                |
| `tsic.classBrowser.layout.palette.collapsed.v1`         | `'0' \| '1'`    | new; global                                |

Reads happen lazily inside `useState` initialisers (same pattern as the existing `MODE_LS_KEY` read). Writes happen via `useEffect`. Layout keys are global so resizing while in one folder applies to all folders.

### Migration

In `ClassBrowserTab` `useEffect([folder])`, before reading `mode`:

```ts
const raw = localStorage.getItem(MODE_LS_KEY);
if (raw === 'compare') localStorage.setItem(MODE_LS_KEY, 'detail');
```

No data migration is needed; Compare only persisted its own mode label.

### Pin lifecycle details

- `useEffect([folder])` re-reads the per-folder pin key. If the stored key no longer exists in `definitions`, `setPinnedKey(null)`.
- `useEffect([definitions, pinnedKey])` clears `pinnedKey` if the record disappears between sessions (e.g., bundled defaults reload).
- Same-record case (`selectedKey === pinnedKey`) is allowed and renders both panes pointing at the same record. Edits propagate through the Zustand store.

### `EchoPublishingPane` and split

The existing `EchoPublishingPane` wraps the center pane and captures click events to publish a property path. Split mode keeps a single `EchoPublishingPane` wrapping the entire split, so clicks in either pane drive the rail's echo column. No behavioural change.

## Data flow

```
Rail click ───────────────► setSelectedKey(k)
                                 │
Pin button on left pane ────────► setPinnedKey(selectedKey)
Unpin button on right pane ─────► setPinnedKey(null)

DetailPane edit ──────────────► updateValueAtPath(assetKey, path, value)
SpreadsheetView Cell edit ────► onChange(key, envelopePath, value)
                                       │
                                       └─► updateValueAtPath(key, envelopePath, value)

ResizeHandle drag ──────────► setRailWidth / setPaletteWidth / setSplitRatio
CollapseStrip click ─────────► setRailCollapsed / setPaletteCollapsed (toggle)
```

All edits flow through the existing `updateValueAtPath` store action; we add no new mutation paths.

## Testing

Add to `web/definitions-ui-smoke.mjs` (existing Playwright file covering ClassBrowser):

1. **Editable spreadsheet**
   - Open a known class-browser sub-tab, switch mode to Spreadsheet.
   - Locate a numeric cell (e.g., a `level` column on a known asset), focus its input, type a new value, blur.
   - Switch to Detail mode for that row; assert the form field shows the new value.
   - Trigger Save; reload; assert the value persisted.

2. **Pin to right (split)**
   - Detail mode; click Pin on record A. Assert `.split-pane` is mounted and two `.detail-pane` elements exist.
   - Click record B in the rail. Assert the *left* `.detail-pane` title shows B; the *right* `.detail-pane.pinned` title shows A.
   - Click Unpin on the right. Assert `.split-pane` is gone; the remaining `.detail-pane` shows B.

3. **Same-record both sides**
   - Pin A; click A in the rail. Both `.detail-pane`s show A.
   - Edit a numeric field in the left pane. On next frame, assert the right pane's same input has the new value.

4. **Resize and collapse**
   - Drag the rail's resize handle by +60px (pointer down/move/up). Assert the inline style on `.class-browser` reflects an updated `--cb-rail-w`.
   - Click the rail collapse chevron. Assert `.class-browser.rail-collapsed` and a `.collapse-strip` are present.
   - Click the collapse strip's chevron. Assert the rail returns and the width is the same as before collapsing.

Remove any existing Compare assertions from the same file. `npm run smoke` continues to run both UI smokes.

## Verification gate

Before claiming done:

```
cd web
npm run typecheck
npm run build
npm run smoke
```

All three must pass.

## Risks & open questions

- **DetailPane scroll**: each pane in Split mode needs its own scroll container with `overflow:auto; min-height:0`. The current `.class-browser-pane` already does this — `DetailPane` will reuse the same pattern.
- **Pointer capture during resize**: `setPointerCapture` ensures drag continues if the cursor leaves the 4-px handle. Without it the user has to track the bar exactly.
- **Same-record edits causing double-renders**: both panes subscribe to the same store slice, but React batches; this is the same pattern as the existing detail editor mirroring its partner editor in `DefinitionsTab`, so no new perf concern.
- **Spreadsheet column path edge case**: a config column whose `path` does not end in `'value'` and has no explicit `envelopePath` renders read-only. None of today's configs hit this; documenting for future authors.
- **Test-environment localStorage**: Playwright already clears `localStorage` via `localStorage.tsic.def.skipBundled.v1` test hatch wiring; the new keys are seeded fresh per run.
