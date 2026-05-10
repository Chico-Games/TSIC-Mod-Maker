# Property Hover Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native HTML `title` attribute on field labels in the typed editor with a custom hover popover that surfaces UPROPERTY doc-comments, C++ type, and Categories meta.

**Architecture:** Add a self-contained `PropertyTooltip.tsx` component (no new deps; uses pointer events, a 150 ms show timer, and a `position: fixed` portal). Refactor the existing `FieldHead` and `PrimitiveRow` helpers in `TypedValueEditor.tsx` to take the full `PropertyMeta` object, wrap their label-span in `<PropertyTooltip>`, and update all 10 callsites accordingly. Update the existing Playwright smoke assertion that currently checks the native `title` attribute.

**Tech Stack:** React 18, TypeScript, Vite, Playwright. Editor is in `C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web`.

**Spec:** `docs/superpowers/specs/2026-05-10-property-tooltip-design.md`

---

## File Structure

| File | Disposition | Purpose |
|---|---|---|
| `web/src/components/PropertyTooltip.tsx` | **Create** | Hover popover component. Self-contained — no new deps. |
| `web/src/styles.css` | **Modify** | Append `.def-property-tooltip*` rules near the existing `.def-field-label` block. |
| `web/src/components/TypedValueEditor.tsx` | **Modify** | Change `FieldHead` + `PrimitiveRow` props from `tooltip?: string \| null` to `meta?: PropertyMeta \| null`; wrap label-span; update 10 callsites. |
| `web/definitions-ui-smoke.mjs` | **Modify** | Replace `getAttribute('title')` check (line 481-487) with hover-and-find-popover check. |

---

### Task 1: Add `PropertyTooltip` component

**Files:**
- Create: `C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web\src\components\PropertyTooltip.tsx`

The component renders nothing until the user hovers a wrapped label. On `pointerenter`, a 150 ms show timer starts; on `pointerleave`, the timer is cancelled. When the timer fires, the popover mounts via a portal into `document.body` and is positioned with `position: fixed` based on the trigger's `getBoundingClientRect()`. It stays open while the pointer is inside *either* the trigger or the popover, so prose can be selected. If `meta` is null/undefined or has no tooltip/cpp_type/categories, the wrapper renders the children unchanged and never opens a popover (matches today's no-comment behavior).

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PropertyMeta } from '../store/definitionsStore';

interface PropertyTooltipProps {
  meta: PropertyMeta | null | undefined;
  children: React.ReactNode;
}

const SHOW_DELAY_MS = 150;
const MAX_HEIGHT_PX = 280;

function hasContent(meta: PropertyMeta | null | undefined): boolean {
  if (!meta) return false;
  return Boolean(meta.tooltip || meta.cpp_type || meta.categories);
}

export function PropertyTooltip({ meta, children }: PropertyTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'below' | 'above' }>({
    top: 0, left: 0, placement: 'below',
  });

  const enabled = hasContent(meta);

  useEffect(() => () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
  }, []);

  const computePos = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: 'below' | 'above' = spaceBelow >= MAX_HEIGHT_PX + 12 ? 'below' : 'above';
    const top = placement === 'below' ? rect.bottom + 6 : rect.top - 6;
    const left = rect.left;
    setPos({ top, left, placement });
  };

  const onEnter = () => {
    if (!enabled) return;
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => {
      computePos();
      setOpen(true);
    }, SHOW_DELAY_MS);
  };

  const onLeave = (e: React.PointerEvent) => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    // Keep open if pointer moved into the tooltip itself.
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && tooltipRef.current?.contains(relatedTarget)) return;
    setOpen(false);
  };

  const onTooltipLeave = (e: React.PointerEvent) => {
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && triggerRef.current?.contains(relatedTarget)) return;
    setOpen(false);
  };

  return (
    <>
      <span
        ref={triggerRef}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        style={{ display: 'contents' }}
      >
        {children}
      </span>
      {open && enabled && createPortal(
        <div
          ref={tooltipRef}
          className={`def-property-tooltip def-property-tooltip-${pos.placement}`}
          style={{
            top: pos.placement === 'below' ? pos.top : undefined,
            bottom: pos.placement === 'above' ? window.innerHeight - pos.top : undefined,
            left: pos.left,
          }}
          onPointerLeave={onTooltipLeave}
          role="tooltip"
        >
          {meta!.tooltip && (
            <div className="def-property-tooltip-prose">{meta!.tooltip}</div>
          )}
          {meta!.cpp_type && (
            <div className="def-property-tooltip-meta">{meta!.cpp_type}</div>
          )}
          {meta!.categories && (
            <div className="def-property-tooltip-meta">Categories: {meta!.categories}</div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run typecheck
```

Expected: PASS. The new file is unused so far but must compile cleanly.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool"
git add web/src/components/PropertyTooltip.tsx
git commit -m "$(cat <<'EOF'
feat: PropertyTooltip component for UPROPERTY doc-comment hover

Renders a custom hover popover (150ms delay, fixed-position portal,
top/bottom flip) showing the UPROPERTY tooltip prose, C++ type, and
Categories meta filter. Replaces the unreliable native HTML title
attribute. Self-contained — no new dependencies.

Not yet wired into TypedValueEditor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add CSS rules for the popover

**Files:**
- Modify: `C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web\src\styles.css`

The repo's existing `.def-field-label` block ends around line 2055. Append the popover rules immediately after it.

- [ ] **Step 1: Append the CSS block**

Open `web/src/styles.css` and after the `.def-field-row .def-field-label { ... }` line (line 2055), insert:

```css
.def-property-tooltip {
  position: fixed;
  z-index: 1000;
  max-width: 360px;
  padding: 8px 10px;
  background: var(--panel, #1f2230);
  color: var(--text, #e8e8ee);
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  pointer-events: auto;
}
.def-property-tooltip-prose {
  white-space: pre-wrap;
  max-height: 280px;
  overflow-y: auto;
  margin-bottom: 6px;
}
.def-property-tooltip-prose:last-child {
  margin-bottom: 0;
}
.def-property-tooltip-meta {
  font-size: 11px;
  color: var(--muted, #9095a6);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-top: 2px;
}
.def-property-tooltip-meta:first-child {
  margin-top: 0;
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool"
git add web/src/styles.css
git commit -m "$(cat <<'EOF'
style: rules for .def-property-tooltip popover

Dark panel with elevation, monospace prose at 12px, muted small-caps meta
rows for cpp_type and Categories. Sits above the field grid (z-index
1000). Prose scrolls vertically inside the popover when long.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Refactor `FieldHead` and `PrimitiveRow` to take `meta` and render `PropertyTooltip`

**Files:**
- Modify: `C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web\src\components\TypedValueEditor.tsx`

The current signatures take `tooltip?: string | null`. Switch to `meta?: PropertyMeta | null`. The `<span className="def-field-label">` becomes the trigger element, wrapped in `<PropertyTooltip>`. This is a breaking change to both helpers' props — the next task updates the 10 callsites.

- [ ] **Step 1: Add the import**

At the top of `web/src/components/TypedValueEditor.tsx`, add `PropertyTooltip` to the existing component imports. The existing import line (line 9) already brings in `PropertyMeta`:

```tsx
import type { EnumMember, PropertyMeta } from '../store/definitionsStore';
```

Add a new line after the other component imports:

```tsx
import { PropertyTooltip } from './PropertyTooltip';
```

- [ ] **Step 2: Replace `FieldHead` (lines 222–247)**

Current:

```tsx
function FieldHead({
  label,
  type,
  controls,
  tooltip,
  propertyName,
  pinAdapter,
}: {
  label?: string;
  type: string;
  controls?: React.ReactNode;
  tooltip?: string | null;
  propertyName?: string;
  pinAdapter?: PinAdapter;
}) {
  return (
    <div className="def-field-head">
      <span className="def-field-label" title={tooltip ?? undefined}>
        <PinToggle propertyName={propertyName} pinAdapter={pinAdapter} />
        {label !== undefined && <>{label} </>}
        <span className="def-type">{type}</span>
      </span>
      {controls && <div className="def-field-controls">{controls}</div>}
    </div>
  );
}
```

Replace with:

```tsx
function FieldHead({
  label,
  type,
  controls,
  meta,
  propertyName,
  pinAdapter,
}: {
  label?: string;
  type: string;
  controls?: React.ReactNode;
  meta?: PropertyMeta | null;
  propertyName?: string;
  pinAdapter?: PinAdapter;
}) {
  return (
    <div className="def-field-head">
      <PropertyTooltip meta={meta}>
        <span className="def-field-label">
          <PinToggle propertyName={propertyName} pinAdapter={pinAdapter} />
          {label !== undefined && <>{label} </>}
          <span className="def-type">{type}</span>
        </span>
      </PropertyTooltip>
      {controls && <div className="def-field-controls">{controls}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Replace `PrimitiveRow` (lines 249–284)**

Current:

```tsx
function PrimitiveRow({
  label,
  type,
  children,
  onDelete,
  tooltip,
  className,
  propertyName,
  pinAdapter,
}: {
  label?: string;
  type: string;
  children: React.ReactNode;
  onDelete?: () => void;
  tooltip?: string | null;
  className?: string;
  propertyName?: string;
  pinAdapter?: PinAdapter;
}) {
  return (
    <div className={`def-field def-field-row ${className ?? ''}`.trim()}>
      {label !== undefined && (
        <span className="def-field-label" title={tooltip ?? undefined}>
          <PinToggle propertyName={propertyName} pinAdapter={pinAdapter} />
          {label} <span className="def-type">{type}</span>
        </span>
      )}
      {children}
      {onDelete && (
        <button type="button" className="danger" onClick={onDelete} title="Remove">
          ×
        </button>
      )}
    </div>
  );
}
```

Replace with:

```tsx
function PrimitiveRow({
  label,
  type,
  children,
  onDelete,
  meta,
  className,
  propertyName,
  pinAdapter,
}: {
  label?: string;
  type: string;
  children: React.ReactNode;
  onDelete?: () => void;
  meta?: PropertyMeta | null;
  className?: string;
  propertyName?: string;
  pinAdapter?: PinAdapter;
}) {
  return (
    <div className={`def-field def-field-row ${className ?? ''}`.trim()}>
      {label !== undefined && (
        <PropertyTooltip meta={meta}>
          <span className="def-field-label">
            <PinToggle propertyName={propertyName} pinAdapter={pinAdapter} />
            {label} <span className="def-type">{type}</span>
          </span>
        </PropertyTooltip>
      )}
      {children}
      {onDelete && (
        <button type="button" className="danger" onClick={onDelete} title="Remove">
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck — expect failures at the 10 callsites**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run typecheck
```

Expected: FAIL. TypeScript will report `tooltip` as an unknown prop on `FieldHead` / `PrimitiveRow` at every callsite. That's expected — Task 4 fixes them.

---

### Task 4: Update all 10 callsites to pass `meta` instead of `tooltip`

**Files:**
- Modify: `C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web\src\components\TypedValueEditor.tsx`

Each callsite already has `meta` in scope (line `const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;` near the top of every editor function). The change is mechanical: `tooltip={meta?.tooltip}` → `meta={meta}`.

**Callsites to update** (line numbers from the original file before Task 3 edits; locate by surrounding context):

1. `BoolEditor` — `<PrimitiveRow ... tooltip={meta?.tooltip} ...>` (was line 305)
2. `NumberEditor` — `<PrimitiveRow ... tooltip={meta?.tooltip} ...>` (was line 340)
3. `StringLikeEditor` — `<PrimitiveRow ... tooltip={meta?.tooltip} ...>` (was line 399)
4. `EnumEditor` — `<PrimitiveRow ... tooltip={meta?.tooltip} ...>` (was line 484)
5. `GameplayTagEditor` — `<PrimitiveRow ... tooltip={meta?.tooltip} ...>` (was line 525)
6. `GameplayTagContainerEditor` — `<FieldHead ... tooltip={meta?.tooltip} ...>` (was line 559)
7. `DefinitionRefEditor` — `<FieldHead ... tooltip={meta?.tooltip} ...>` (was line 699)
8. `StructEditor` — `<FieldHead ... tooltip={meta?.tooltip} ...>` (was line 767)
9. `ContainerEditor` — `<FieldHead ... tooltip={meta?.tooltip} ...>` (was line 861)
10. `MapEditor` — `<FieldHead ... tooltip={meta?.tooltip} ...>` (was line 973)

**Leave alone** (these are control widget hints, not field doc):
- `<WideToggle ... title={meta?.tooltip ?? undefined}>` in `BoolEditor`
- `<NumberSlider ... title={meta?.tooltip ?? undefined}>` in `NumberEditor`
- All `title="Remove"`, `title="Move up"`, etc. on buttons.

- [ ] **Step 1: Find every `tooltip={meta?.tooltip}` and replace with `meta={meta}`**

The replacement is one-to-one and unambiguous within `TypedValueEditor.tsx`. Use a targeted `replace_all` on the exact string, scoped to this file.

- [ ] **Step 2: Run typecheck — expect pass**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run build
```

Expected: PASS. Build emits to `dist/`. No TS errors.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool"
git add web/src/components/TypedValueEditor.tsx
git commit -m "$(cat <<'EOF'
feat: wire PropertyTooltip into typed editor field labels

Replace native HTML title attribute on FieldHead and PrimitiveRow with
custom PropertyTooltip popover. Switches both helpers' API from
tooltip?: string to meta?: PropertyMeta and updates all 10 callsites in
TypedValueEditor (BoolEditor, NumberEditor, StringLikeEditor, EnumEditor,
GameplayTagEditor, GameplayTagContainerEditor, DefinitionRefEditor,
StructEditor, ContainerEditor, MapEditor). Hover any property label and
the doc-comment, C++ type, and Categories meta now render in a styled
popover after a 150ms delay.

WideToggle and NumberSlider inline-widget titles are intentionally
unchanged — those are control hints, not property doc.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update Playwright smoke test

**Files:**
- Modify: `C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web\definitions-ui-smoke.mjs:481-487`

The current assertion checks `getAttribute('title')` on the duration field label. The native `title` is gone — replace with a hover-and-find-popover assertion.

- [ ] **Step 1: Replace lines 481–487**

Current code at `web/definitions-ui-smoke.mjs:481-487`:

```js
    // Property tooltip — Duration should show the .h doc comment on hover.
    const durationLabel = page.locator('.def-properties .def-field-label', { hasText: 'Duration' }).first();
    const durationTooltip = await durationLabel.getAttribute('title');
    if (!durationTooltip || !durationTooltip.includes('Duration in seconds')) {
      throw new Error(`duration tooltip missing; got "${durationTooltip}"`);
    }
    console.log(`OK: property tooltip from .property-meta sidecar`);
```

Replace with:

```js
    // Property tooltip — hovering the Duration label should pop the
    // PropertyTooltip popover with the .h doc-comment prose and cpp_type.
    const durationLabel = page.locator('.def-properties .def-field-label', { hasText: 'Duration' }).first();
    await durationLabel.hover();
    await page.waitForSelector('.def-property-tooltip', { state: 'visible', timeout: 1000 });
    const tooltipText = await page.locator('.def-property-tooltip').first().innerText();
    if (!tooltipText.includes('Duration in seconds')) {
      throw new Error(`duration tooltip prose missing; got "${tooltipText}"`);
    }
    if (!tooltipText.includes('float')) {
      throw new Error(`duration tooltip cpp_type missing; got "${tooltipText}"`);
    }
    console.log(`OK: property tooltip popover from .property-meta sidecar`);
    // Move pointer somewhere neutral so the popover unmounts before the
    // next assertion. The .def-prop-search input is a safe target that
    // exists at this point in the test.
    await page.locator('.def-prop-search').hover();
    await page.waitForSelector('.def-property-tooltip', { state: 'detached', timeout: 1000 });
```

- [ ] **Step 2: Build first (smoke runs against `vite preview`, which serves `dist/`)**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run the smoke test**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run smoke:def
```

Expected: PASS. Look for the line `OK: property tooltip popover from .property-meta sidecar` in the output.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool"
git add web/definitions-ui-smoke.mjs
git commit -m "$(cat <<'EOF'
test: smoke now asserts PropertyTooltip popover, not native title

Hover the Duration label, wait for .def-property-tooltip to appear,
verify it contains both the prose ("Duration in seconds") and the
cpp_type ("float"). Then move the pointer away and verify the popover
detaches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Final verification — full smoke suite + manual check

- [ ] **Step 1: Run the full smoke suite (definitions + recipes-loot)**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run smoke
```

Expected: PASS for both `smoke:def` and `smoke:loot`.

- [ ] **Step 2: Manual check (optional but recommended)**

```bash
cd "C:\Users\Administrator\Documents\Projects\tsic-crafting-tool\web"
npm run dev
```

Open `http://localhost:5173`, click `📂 Open folder`, point at `C:\Users\Administrator\Documents\Unreal Projects\TSIC\Tools\Export\test-output\Definitions`. Navigate to `loot_definitions` → `LD_AbandonedCampLoot`. Hover the `Gameplay Tags` label. Confirm the popover appears within ~150 ms with:
- Prose: `Tags used to categorise the entity.`
- cpp_type: `FGameplayTagContainer`
- Categories row: `Categories: Entity`

Confirm hovering a property without a `/** */` comment (e.g. `Items To Drop`) shows nothing — same as today.

Stop the dev server.
