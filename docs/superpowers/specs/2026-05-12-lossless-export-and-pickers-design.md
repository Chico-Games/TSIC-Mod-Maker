# Lossless Export, Asset Catalogs, and Catalog-Backed Pickers — Design

**Date:** 2026-05-12
**Status:** Approved (Workstream A of the layout-editor effort)
**Workstream B (layout editor itself):** separate brainstorm, depends on this.

## Goal

Make the JSON export from `Tools/Export/` round-trip *every* property of every TSIC Definition asset, and give the web editor catalog-backed dropdowns for asset references (mesh / material / texture / sound / etc.) and gameplay tags. This is the foundation a future JSON-driven layout editor needs — but it independently lifts every existing tab in the definition editor.

## Why now

The current exporter (`Tools/Export/run_export.py`, `lib/property_normalizer.py`) strips two categories of data wholesale:

- **Engine asset refs** — `TObjectPtr<UStaticMesh>`, `TObjectPtr<UMaterial>`, sounds, anims, blueprints, etc. (the `_ENGINE_ASSET_CLASS_NAMES` set).
- **Engine structs** — `FTransform`, `AudioConfig`, `FurnitureLightConfig`, `VFXConfig`, `MaterialOverrideNanite`, `SoftObjectPath`, `Guid`, etc. (the `_ENGINE_STRUCT_NAMES` / `_ENGINE_CONFIG_STRUCT_CPP_TYPES` sets).

That means JSON layouts have no positions, JSON furniture has no mesh references, and the editor's typed view can't offer dropdowns for those fields because the values aren't in the JSON in the first place. A JSON-driven layout editor is impossible until that's fixed.

## Decisions

- **Strip nothing.** Both strip lists are deleted. Asset refs and engine structs round-trip. Truly transient/runtime-only properties are already filtered out earlier in the introspection pass (`CPF_Transient`, properties not exposed via `get_editor_property`) — that filter stays.
- **Asset identity = soft path, with `PackagePersistentGuid` as a tamper-check.** The JSON stores the path (Unreal-native, works in-game). Catalogs *also* record each asset's `PackagePersistentGuid`; the editor flags mismatches on load via a sidecar (`.asset-refs.json`).
- **Catalog scope = every asset class referenced by any definition property.** Walked dynamically; self-maintaining as new properties are added in Unreal.
- **Catalog payload = path + name + folder + `package_guid` + bounds (StaticMesh only) + thumbnail PNG path** (StaticMesh / Material* only — niche classes get no thumbnail).
- **Catalog packaging = per-class sidecar files in `.assets/`, lazy-loaded by the editor.** Manifest enumerates which catalogs exist.
- **Gameplay tags = flat sorted list of dotted strings** in the existing `.gameplay-tags.json` sidecar; tree built client-side.
- **Pickers live in `TypedValueEditor` only.** `JsonValueEditor` (the raw fallback) stays a plain text input.
- **Nested struct types auto-expand recursively** in the typed editor. `FTransform` becomes `translation` / `rotation` / `scale_3d` rows, each XYZ; `AudioConfig` expands into its named fields.
- **Out of scope:** modal content-browser-style pickers, bulk find-and-replace of asset refs, thumbnails for non-mesh/material classes, custom in-game GUID-based loading, and the layout editor itself.

## Architecture

```
TSIC project
  └─ Tools/Export/
      run_export.py + lib/property_normalizer.py     [exporter]
              │
              ▼  writes
  Definitions/
      <class>/<ID>.json                              # definitions, now lossless
      .class-hierarchy.json                          # existing
      .gameplay-tags.json                            # existing, populated for real
      .assets/<AssetClass>.json                      # NEW per-class catalogs
      .asset-refs.json                               # NEW path→expected guid index
      .thumbnails/<AssetClass>/<Name>.png            # NEW (mesh/material only)
      .manifest.json                                 # existing, extended

tsic-definition-editor (web)
  └─ src/store/
      definitionsStore.ts                            # existing, owns Definitions
      assetCatalogStore.ts                           # NEW lazy catalog loader
      gameplayTagStore.ts                            # NEW eager tag list
  └─ src/components/
      TypedValueEditor.tsx                           # extended: struct expand, picker dispatch
      pickers/AssetRefPicker.tsx                     # NEW
      pickers/TagPicker.tsx                          # NEW
      LoadGate.tsx                                   # existing, gains tamper drift mode
```

The exporter side stops stripping data and gains a catalog dumper + a tag dumper population. The editor side gains two new stores (asset catalog, tag list), two new picker components, recursive struct rendering in `TypedValueEditor`, and a third drift pass in `LoadGate`. All existing tabs benefit automatically because they consume `TypedValueEditor`.

## Exporter changes

### Strip-list removal

Delete the following sets (and their guards):

- `Tools/Export/run_export.py` — `_ENGINE_ASSET_CLASS_NAMES`, `_ENGINE_STRUCT_NAMES`.
- `Tools/Export/lib/property_normalizer.py` — `_ENGINE_CONFIG_STRUCT_CPP_TYPES`, `_ENGINE_CONFIG_CPP_PATTERNS`.

The existing `_emit_struct` path recurses cleanly once the strip list is gone — arbitrary nesting (e.g., `AudioConfig` containing a soft `SoundCue` ref containing struct settings) just works.

### Encoding rules

Encoded value envelopes added to the normalizer:

| Source | Emitted envelope |
|---|---|
| `TObjectPtr<U*>` / `TSoftObjectPtr<U*>` to a **non-Definition** class | `{ "type": "soft_asset_ref", "class": "<Name>", "value": "<soft path or null>" }` |
| `TObjectPtr<U*>` to a Definition class | unchanged — existing `definition_ref` with `value: "<ID>"` |
| `FTransform` | nested struct envelope with `translation` / `rotation` / `scale_3d` |
| `FVector` / `FRotator` / `FVector2D` / `FQuat` / `FIntPoint` / `FColor` / `FLinearColor` / `FGuid` | nested struct envelope with their component fields |
| Other USTRUCTs (`AudioConfig`, `FurnitureLightConfig`, …) | recursed via existing `_emit_struct` |
| `FSoftObjectPath` standalone | `{ "type": "soft_object_path", "value": "<path>" }` |

`value: null` for `soft_asset_ref` is the cleared/None state.

### Asset catalog dumper

New module `Tools/Export/lib/asset_catalog_dumper.py`:

1. Walk every property of every definition class. For each ref/soft-ref to a non-Definition class, collect the target class name into a set.
2. For each collected class, query `AssetRegistry` for all assets of that class in `/Game/...`.
3. For each asset, emit a catalog entry:

   ```json
   {
     "path": "/Game/Furniture/Meshes/SM_Door.SM_Door",
     "name": "SM_Door",
     "folder": "/Game/Furniture/Meshes",
     "package_guid": "ABCDEF12-3456-789A-BCDE-F01234567890",
     "bounds": { "min": [-50,-20,0], "max": [50,20,200] },
     "thumbnail": ".thumbnails/StaticMesh/SM_Door.png"
   }
   ```

   - `bounds`: StaticMesh only, via `UStaticMesh::GetBoundingBox`.
   - `thumbnail`: StaticMesh and any `MaterialInterface` subclass only. Extract via `UThumbnailManager::Get().GetSharedThumbnailPool()` or equivalent. Write PNG to `<OUT_DIR>/.thumbnails/<ClassName>/<AssetName>.png`. Skip when unchanged (hash the bytes; record hash in the catalog entry to make idempotence cheap).

4. Write `<OUT_DIR>/.assets/<ClassName>.json`:

   ```json
   {
     "schema_version": 1,
     "class": "StaticMesh",
     "generated_at": "<iso-8601>",
     "entries": [ ... ]
   }
   ```

### Asset-ref drift sidecar

New file `<OUT_DIR>/.asset-refs.json`:

```json
{
  "schema_version": 1,
  "expected_guids": {
    "/Game/Furniture/Doors/Meshes/SM_Door.SM_Door": "ABCDEF12-...",
    "/Game/Audio/SC_DoorOpen.SC_DoorOpen": "12345678-..."
  }
}
```

Captures the `PackagePersistentGuid` for every soft path actually referenced by any exported definition at export time. The editor reads this on load and compares against each asset catalog's `package_guid`; mismatches surface in `LoadGate`.

### Tag dumper population

`lib/tag_dumper.py` already exists but emits an empty list. Wire it to `unreal.GameplayTagsManager.get().request_all_gameplay_tags()` (or the equivalent Python binding), emit sorted dotted strings to `.gameplay-tags.json`.

### Manifest extension

`.manifest.json` (existing) gains:

```json
"asset_catalogs": ["StaticMesh", "Material", "MaterialInstance", "SoundCue", "NiagaraSystem", ...],
"thumbnails_dir": ".thumbnails",
"has_asset_refs_sidecar": true
```

## Editor changes

### `assetCatalogStore.ts` (new)

Lazy per-class cache.

```ts
type CatalogEntry = {
  path: string;
  name: string;
  folder: string;
  packageGuid: string;
  bounds?: { min: [number,number,number]; max: [number,number,number] };
  thumbnail?: string;
};

useAssetCatalogStore: {
  catalogs: Record<string, CatalogEntry[] | 'loading' | 'missing'>;
  loadCatalog: (className: string) => Promise<CatalogEntry[]>;
  lookupByPath: (className: string, path: string) => CatalogEntry | null;
  lookupByGuid: (className: string, guid: string) => CatalogEntry | null;
}
```

- `loadCatalog(c)` fetches from the current data source (bundled `/.assets/<c>.json` via fetch, or picked folder via FSA), memoized per class.
- Mirrors how `definitionsStore` reads from `dataSource`.

### `gameplayTagStore.ts` (new)

Eager, single load alongside `class-hierarchy.json`.

```ts
useGameplayTagStore: {
  tags: string[];                  // sorted dotted strings
  tree: TagNode;                   // derived: nested for tree pickers
  isTagOrChild: (candidate: string, parent: string) => boolean;
}
```

### `TypedValueEditor` dispatch

`TypedValueEditor` already routes by `value.type`. Three new cases:

```ts
switch (value.type) {
  case 'soft_asset_ref':
    return <AssetRefPicker className={value.class} value={value.value} onChange={...} />;
  case 'gameplay_tag_container':
    return <TagPicker value={value.value} onChange={...} />;
  case 'struct':
    return <StructRows
      structName={value.struct_name}
      fieldSchema={value.fields}
      values={value.value}
      onChange={onChange}
    />;
  // existing cases unchanged
}
```

`StructRows` renders one row per declared field, each row recursing into `TypedValueEditor`. Header row shows `<Struct Name>` with a collapse chevron (default open). No new state machine — just composition.

### `AssetRefPicker` (new)

Inline dropdown wrapping `SearchableSelect`:

- Header: class name (e.g. "StaticMesh") + chevron + clear (×) when value set.
- Filter input.
- Thumbnail grid for classes with thumbnails; flat list for others.
- Current value displayed below.

Calls `assetCatalogStore.loadCatalog(className)` on first open. Stores the path as the value; the guid lives only in catalog data, used for read-time drift checks.

### `TagPicker` (new)

Filtered tree of dotted tag strings. Click a leaf = add to container. Click a parent = expand. Container shows selected tags as removable chips. Emits/accepts `string[]` so it can be reused by Workstream B for `FProxySearchTreeQuery` editing without modification.

### Drift / tamper detection

`LoadGate` already runs drift detection for unknown classes/properties. Add a third pass that emits two new drift kinds, `missing-asset-ref` and `asset-ref-guid-mismatch`:

1. Walk loaded definitions, collect every `soft_asset_ref` value with a non-null path.
2. `assetCatalogStore.lookupByPath(class, path)` → catalog entry (or null).
3. Null → emit `missing-asset-ref` drift row (path no longer in project).
4. Non-null → read `.asset-refs.json` `expected_guids[path]` → recorded guid at last export.
5. Recorded guid present and ≠ catalog entry's `packageGuid` → emit `asset-ref-guid-mismatch` drift row.
6. Recorded guid absent (catalog has the path but the export didn't record it as referenced) → no drift; harmless, just means the ref was added since the export ran.

## Build sequence

1. Exporter strip removal + struct round-trip (`run_export.py`, `lib/property_normalizer.py`). Verify by re-exporting test-output and diffing.
2. Catalog dumper + manifest extension (`lib/asset_catalog_dumper.py`).
3. Tag dumper population.
4. `.asset-refs.json` drift sidecar emission.
5. Sync new test-output into `web/public/base-definitions/` via the existing `sync-base-definitions.mjs` (no editor changes yet; bundled defaults just get bigger).
6. Editor: `assetCatalogStore`, `gameplayTagStore`, `TypedValueEditor` struct expansion. Visible regressions: definitions that previously rendered cleanly now show nested struct rows — that's the point, but worth a UI pass.
7. `AssetRefPicker` + `TagPicker` wired into `TypedValueEditor`.
8. `LoadGate` tamper-detection row.

Each numbered step is a separate change, reviewable independently, with the editor remaining usable throughout (steps 1–5 are exporter-only; steps 6–8 only add UI). Commit at each step.

## Testing

### Exporter (Python, `Tools/Export/tests/`)

- Extend `test_property_normalizer.py`:
  - Soft asset refs round-trip: `TObjectPtr<UStaticMesh>` set / null / cleared / pointing at deleted asset.
  - `FTransform` round-trip: identity, non-identity translation + rotation + scale.
  - Nested struct round-trip: `AudioConfig` containing a soft `SoundCue` ref containing struct settings.
  - "Strip nothing" regression: fixture definition with one of every type; assert nothing silently dropped.
- New `test_asset_catalog_dumper.py`:
  - Fixture project with a handful of meshes/materials in known locations.
  - Asserts catalog contains expected paths, `package_guid` populated, mesh `bounds` populated, thumbnails written only for declared classes.
  - Idempotence: rerun produces byte-identical output (modulo a sortable timestamp).

### Editor (TypeScript, `web/`)

- Extend `npm run data-smoke`:
  - Every `soft_asset_ref` in any loaded definition resolves in its class catalog.
  - Every `gameplay_tag_container` value is a known tag.
- Unit tests for `assetCatalogStore` (lazy load, lookup, guid mismatch) and `gameplayTagStore` (tree build, prefix matching).
- Extend `npm run smoke` (Playwright): open a furniture definition, expand `AudioConfig`, change a `soft_asset_ref`, save, reload, assert persisted.
- `npm run typecheck` and `npm run build` continue to gate.

## Out of scope (explicit)

- Modal "content browser"-style picker — `AssetRefPicker` ships as inline dropdown only.
- Bulk find-and-replace of asset references — single-asset edits only.
- Thumbnails for non-mesh/material classes — catalog entries exist; thumbnail field stays empty.
- Custom in-game GUID-based loading.
- The layout editor itself — Workstream B, separate brainstorm.

## Risks and mitigations

- **JSON size growth.** Bundled defaults will grow significantly when meshes, materials, and engine structs round-trip. Mitigation: lazy catalog loading; manifest extension lets the editor request only what it needs.
- **Picker UI regression.** Definitions that previously rendered as a small flat form now expand into nested struct rows. Mitigation: collapse-by-default on classes with many nested structs (TypedValueEditor heuristic), and a UI pass after step 6.
- **Thumbnail extraction cost.** Re-extracting every thumbnail on every export is slow. Mitigation: hash-based skip stamped into the catalog entry.
- **Tag tree size.** `request_all_gameplay_tags()` may return thousands of entries. Mitigation: flat list is small (one string per tag); the tree is built client-side once and cached.
