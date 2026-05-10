# Property Hover Tooltip — design

Date: 2026-05-10. Authoring scope: editor-only UX change to surface UPROPERTY doc-comments on field hover in the Definitions tab.

## Goal

When the user hovers a property label in the typed editor, a custom popover appears showing the C++ `/** ... */` doc-comment that was authored on the corresponding `UPROPERTY` in `Source/TSIC/Public/**/*.h`. The popover also lists the C++ type and any `meta=(Categories="...")` filter when present.

## Background

The data pipeline already exists:

- `Tools/Export/scan_property_meta.py` walks every `.h` under `Source/TSIC/Public/`, extracts each `UPROPERTY` block plus the optional `/** ... */` doc-comment immediately above it, and writes `Tools/Export/test-output/Definitions/.property-meta.json` with one entry per property keyed `"<BareClassName>.<snake_property_name>"`. The scanner records `tooltip` (prose), `cpp_type`, `category`, `categories`, clamp/UI bounds, `edit_spec`, and `display_name`.
- The bundled defaults at `web/public/base-definitions/.property-meta.json` are kept in sync by `web/scripts/sync-base-definitions.mjs`, which runs on `npm run dev` and `npm run build`.
- `definitionsStore.getPropertyMeta(parentTypeName, propertyName)` looks up by class first, then walks the parent class chain so a property declared on `UWorldGenObjectDefinition` resolves when the asset is a `ULootDefinition`. It also tries the bool `b_`-stripped form so `bStackable` ↔ `stackable` matches.
- `web/src/components/TypedValueEditor.tsx` already calls `refAdapter.getPropertyMeta(...)` in every field renderer and passes the resulting `meta?.tooltip` into `FieldHead` / `PrimitiveRow`, which bind it to the native HTML `title` attribute on `<span className="def-field-label">`.

The problem is purely UX: the native `title` attribute has a ~500 ms delay, renders in browser-default styling, and only fires when hovering precisely on the label text. Easy to miss entirely — and was missed.

## Non-goals

- No changes to `scan_property_meta.py`, `.property-meta.json`, or the bundled-defaults sync. The data is correct.
- No (?) help-icon variant. The user picked custom popover only.
- No clamp-bounds or `display_name` rendering in the tooltip. The user picked doc-prose + C++ type + Categories.
- No tooltips on `JsonValueEditor.tsx` — that's the raw-JSON fallback view, doesn't render `meta`, and is left alone.
- No change to the pin (📍) button's existing `title` (it's a control hint, not a property doc).

## Components

### New: `web/src/components/PropertyTooltip.tsx`

A small self-contained hover-popover. No new dependencies — the editor doesn't already use Floating UI or Radix, and the requirements are simple enough that pulling either in is unjustified.

Behavior:

- Wraps an arbitrary child (the field label) and listens for `pointerenter` / `pointerleave` on the wrapper.
- 150 ms show timer started on `pointerenter`; cancelled if `pointerleave` fires before it expires.
- Renders the popover into `document.body` via a portal, positioned with `position: fixed` from the trigger's `getBoundingClientRect()`. Default placement is below the trigger; if there isn't ~280 px of room below, flip above. Horizontal flip is not implemented — the editor's typical width gives enough room.
- Stays open while the pointer is inside *either* the trigger or the popover, so prose can be selected and copied.
- If the resolved content has nothing to show (no tooltip, no cpp_type, no categories), the wrapper renders the children as-is and never opens a popover.

Props:

```ts
interface PropertyTooltipProps {
  meta: PropertyMeta | null | undefined;
  children: React.ReactNode;
}
```

`PropertyMeta` is the existing type exported from `definitionsStore`. Passing the whole object (rather than three separate props) keeps callsites tidy and makes future additions a single edit.

Layout when open:

- Doc-comment prose (the `tooltip` field) at the top, wrapping at ~360 px max-width, max-height ~280 px with vertical scroll.
- C++ type rendered in a muted small-caps row below the prose (e.g. `FGameplayTagContainer`).
- `Categories: <value>` row only if `meta.categories` is non-null (e.g. `Entity` for `LootDefinition.gameplay_tags`).

### Modified: `web/src/components/TypedValueEditor.tsx`

`FieldHead` and `PrimitiveRow` currently take `tooltip?: string | null` and bind it via `title`. Change both to take `meta?: PropertyMeta | null` and wrap the existing `<span className="def-field-label">` in `<PropertyTooltip meta={meta}>`. Remove the `title={tooltip ?? undefined}` binding.

Every existing callsite of `FieldHead` / `PrimitiveRow` already has the resolved `meta` object in scope (from `refAdapter.getPropertyMeta(parentTypeName, propertyName)` near the top of each editor function). Update those callsites to pass `meta={meta}` instead of `tooltip={meta?.tooltip}`.

The `WideToggle` `title={meta?.tooltip ?? undefined}` prop on `BoolEditor` (line 314) is left alone — that's an inline tooltip on the toggle widget itself, not the field label, and isn't the user's pain point. If we revisit it later, fine.

### CSS

Add a small block to `web/src/styles.css` for `.def-property-tooltip`:

- Dark background (matches existing `.def-` palette), white-ish text, 8 px padding, 6 px border radius, 1 px subtle border.
- `box-shadow: 0 4px 16px rgba(0,0,0,0.3)` for elevation.
- `font-size: 12px`, `line-height: 1.45` for the prose.
- `.def-property-tooltip-meta` row: `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.4px`, muted color.
- `.def-property-tooltip-prose`: `white-space: pre-wrap` so multi-sentence comments are readable; `max-width: 360px`; `max-height: 280px`; `overflow-y: auto`.
- `z-index: 1000` (above the field grid; the editor uses values up to ~100 for popovers today).

## Edge cases

- **No data**: properties with no `/** */` comment, no `cpp_type`, and no `categories` get no popover. The label looks identical to today.
- **Long prose**: wraps at 360 px; if it overflows 280 px tall, scroll. The pointer-stays-open rule lets users scroll inside.
- **Viewport edge**: simple top/bottom flip. No left/right flip.
- **Rapid hover sweep**: the 150 ms show delay is cancelled on `pointerleave`. Hovering ten labels in a row produces no flicker.
- **Inherited properties**: already handled by `getPropertyMeta`'s parent-chain walk. No change needed here.
- **Snake-case mismatches**: scanner registers both `b_foo` and `foo` forms; lookup tries both. No change.

## Testing

Extend `web/definitions-ui-smoke.mjs` (Playwright):

1. Open the Definitions tab and select a known `ULootDefinition` instance (e.g. `LD_AbandonedCampLoot`).
2. Locate the `gameplay_tags` field label.
3. Move pointer onto the label, wait ≥200 ms.
4. Assert that `.def-property-tooltip` is visible and contains the strings `Tags used to categorise the entity.` and `FGameplayTagContainer`.
5. Move pointer away, wait, assert the popover unmounts.

Type-check (`npm run typecheck`) and production build (`npm run build`) must pass.

## Risk

Low. The change is additive — a new component plus a prop-shape swap on two helpers. No data-pipeline change. Worst case: tooltip positioning is off near an edge; users still see *something* on hover, which is strictly better than today's invisible native `title`.
