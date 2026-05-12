# Lossless Export, Asset Catalogs, and Catalog-Backed Pickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-12-lossless-export-and-pickers-design.md`

**Goal:** Stop the JSON exporter from stripping asset refs and engine structs, emit per-class asset catalogs and a populated gameplay-tag list, wire catalog-backed pickers into the editor's typed view, and add tamper-detection drift for asset refs.

**Architecture:** Two cooperating layers. The Python exporter (`Tools/Export/`) — split across an in-editor Lua extractor (`extract.lua`) and an offline normalizer (`export_definitions.py` + `lib/`) — emits lossless JSON plus catalog sidecars. The web editor (`tsic-definition-editor/web/`) gains two zustand stores and three new components consumed by `TypedValueEditor`. All existing tabs benefit because they consume `TypedValueEditor`.

**Tech Stack:** Python 3.11+ with pytest (`Tools/Export/pyproject.toml`); Unreal Python API + Lua MCP (`extract.lua`); TypeScript + React + zustand + Node 22 `node:test` (web).

**Commit policy:** Commit at the end of every Task (the "Commit" step in each). A clean tree at task boundaries lets the user roll back any single phase. The repo was confirmed clean before this plan started.

---

## File Structure

**`Tools/Export/` (Python + Lua, the exporter):**

| File | Status | Responsibility |
|---|---|---|
| `extract.lua` | Modify | Add asset-registry walk per referenced class, emit `intermediate/asset-catalog.json` with paths/names/folders/guids/bounds. |
| `lib/property_normalizer.py` | Modify | Delete strip lists. Emit `soft_asset_ref`, struct round-trips (FTransform, FVector, AudioConfig…) via `_normalize_parsed`. |
| `lib/asset_catalog_dumper.py` | Create | Convert intermediate catalog rows into per-class `.assets/<Class>.json` payloads. |
| `lib/asset_ref_index.py` | Create | Walk normalized definitions, collect every `soft_asset_ref` path, look up its current `package_guid` in the catalog, emit `.asset-refs.json`. |
| `lib/manifest_builder.py` | Modify | Add `asset_catalogs`, `thumbnails_dir`, `has_asset_refs_sidecar` fields to the manifest output. |
| `lib/tag_dumper.py` | Modify (probably none) | Already accepts a list of dotted tag strings. Only changes if the upstream tag enumeration is broken. |
| `export_definitions.py` | Modify | Orchestrate: read intermediate catalog, call new dumpers, write `.assets/<Class>.json`, `.asset-refs.json`. |
| `run_export.py` | Modify | Same orchestration changes for the in-editor path. Verify `GameplayTagsManager` enumeration actually populates `.gameplay-tags.json`. |
| `tests/test_property_normalizer.py` | Modify | Add round-trip cases for asset refs and engine structs. Strip-nothing regression. |
| `tests/test_asset_catalog_dumper.py` | Create | Idempotence + payload shape. |
| `tests/test_asset_ref_index.py` | Create | Builds `expected_guids` from a fixture catalog + fixture definitions. |
| `tests/test_manifest_builder.py` | Modify | Cover new fields. |
| `tests/fixtures/raw-export-sample.json` | Modify | Add fixture entries that exercise asset refs + nested engine structs. |
| `tests/fixtures/asset-catalog-sample.json` | Create | Fixture for catalog dumper + asset-ref index tests. |

**`tsic-definition-editor/web/` (the editor):**

| File | Status | Responsibility |
|---|---|---|
| `scripts/sync-base-definitions.mjs` | Modify | Mirror `.assets/`, `.asset-refs.json`, `.thumbnails/`, and the populated `.gameplay-tags.json` into `public/starter-project/`. |
| `src/persistence/dataSource.ts` | Modify | Add `readCatalog(class)`, `readAssetRefs()`, `readTags()` to the `DataSource` interface. Implement on both `HttpDataSource` and `FsaDataSource`. |
| `src/store/gameplayTagStore.ts` | Create | Eager load on app start. Flat sorted list + a derived nested tree. |
| `src/store/assetCatalogStore.ts` | Create | Lazy per-class cache. `loadCatalog(className)` memoized; `lookupByPath` / `lookupByGuid` accessors. |
| `src/components/pickers/TagPicker.tsx` | Create | Replaces `GameplayTagContainerEditor` (and works for `gameplay_tag` too). Tree-filtered selector backed by `gameplayTagStore`. |
| `src/components/pickers/AssetRefPicker.tsx` | Create | Inline dropdown wrapping `SearchableSelect`, backed by `assetCatalogStore`. Renders thumbnails when present. |
| `src/components/StructRows.tsx` | Create | Recursive struct expansion. Header row + collapsible nested `TypedField`s. Replaces `StructEditor`'s flat fallback. |
| `src/components/TypedValueEditor.tsx` | Modify | Add `soft_asset_ref` case; route `gameplay_tag` / `gameplay_tag_container` to `TagPicker`; route `struct` to `StructRows` (preserving the `GameplayEffectsToApply` smart view). |
| `src/persistence/schemaDriftValidator.ts` | Modify | Extend `DriftIssue` union with `missing-asset-ref` and `asset-ref-guid-mismatch`. New validator pass. |
| `src/components/LoadGate.tsx` | Modify | Render the two new drift kinds in the existing drift overlay. |
| `src/store/definitionsStore.ts` | Modify | On load, read `.asset-refs.json` (if present) into store state for the drift pass. |
| `tests/gameplayTagStore.test.ts` | Create | Tree build, prefix matching. |
| `tests/assetCatalogStore.test.ts` | Create | Lazy load, lookup, guid mismatch. |
| `tests/schemaDriftValidator.test.ts` | Modify | Cover the new drift kinds. |
| `data-smoke.mjs` | Modify | Cross-check: every `soft_asset_ref` resolves in its catalog; every tag is in `.gameplay-tags.json`. |
| `savedload-ui-smoke.mjs` | Modify | Playwright scenario: expand an `AudioConfig`, change a `soft_asset_ref`, save, reload, assert persisted. |

---

## Phase 1: Exporter — property round-trip

The Python normalizer is the offline filter that turns Lua-extracted raw rows into typed envelopes. This phase removes its strip lists and adds new envelope cases.

### Task 1.1: Round-trip tests for soft_asset_ref (TDD)

**Files:**
- Modify: `Tools/Export/tests/test_property_normalizer.py`

- [ ] **Step 1: Add failing tests for soft asset ref encoding**

Add to the bottom of `test_property_normalizer.py`:

```python
def test_soft_asset_ref_static_mesh_set():
    """TObjectPtr<UStaticMesh> with a set path becomes a soft_asset_ref envelope."""
    out = normalize_property(
        name="static_mesh",
        type_str="Object(StaticMesh)",
        cpp_type="TObjectPtr<UStaticMesh>",
        value_str="/Game/Furniture/Meshes/SM_Door.SM_Door",
        definition_class_names={"UFurnitureDefinition"},
    )
    assert out == {
        "kind": "soft_asset_ref",
        "class": "StaticMesh",
        "value": "/Game/Furniture/Meshes/SM_Door.SM_Door",
    }


def test_soft_asset_ref_material_softptr_set():
    """TSoftObjectPtr<UMaterial> with a set path becomes a soft_asset_ref envelope."""
    out = normalize_property(
        name="material",
        type_str="SoftObject(Material)",
        cpp_type="TSoftObjectPtr<UMaterial>",
        value_str="/Game/Materials/M_Wood.M_Wood",
        definition_class_names=set(),
    )
    assert out == {
        "kind": "soft_asset_ref",
        "class": "Material",
        "value": "/Game/Materials/M_Wood.M_Wood",
    }


def test_soft_asset_ref_none_value():
    """A None / empty soft ref becomes value: None (not dropped)."""
    out = normalize_property(
        name="static_mesh",
        type_str="Object(StaticMesh)",
        cpp_type="TObjectPtr<UStaticMesh>",
        value_str="None",
        definition_class_names=set(),
    )
    assert out == {
        "kind": "soft_asset_ref",
        "class": "StaticMesh",
        "value": None,
    }


def test_definition_ref_unchanged():
    """Refs to a Definition class still produce a definition_ref envelope."""
    out = normalize_property(
        name="upgrade_recipe",
        type_str="Object(FurnitureUpgradeRecipe)",
        cpp_type="TObjectPtr<UFurnitureUpgradeRecipe>",
        value_str="/Game/Foo.FURF_Door",
        definition_class_names={"UFurnitureUpgradeRecipe"},
    )
    assert out["kind"] == "definition_ref"
    assert out["asset_name"] == "FURF_Door"
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `Tools/Export/`:

```
pytest tests/test_property_normalizer.py -k "soft_asset_ref or definition_ref_unchanged" -v
```

Expected: FAIL — current code returns `None` for engine-asset cpp types, no `soft_asset_ref` kind exists yet.

- [ ] **Step 3: Commit the failing tests**

```
git add Tools/Export/tests/test_property_normalizer.py
git commit -m "test(exporter): pending soft_asset_ref + definition_ref round-trip cases"
```

### Task 1.2: Implement soft_asset_ref encoding

**Files:**
- Modify: `Tools/Export/lib/property_normalizer.py`
- Modify: `Tools/Export/lib/property_serializer.py` (envelope emission)

- [ ] **Step 1: Read `lib/property_serializer.py` first** to learn how `kind: ...` dicts become final `type: ...` envelopes — the new `soft_asset_ref` kind will need a matching emission branch there.

- [ ] **Step 2: In `property_normalizer.py`, delete the strip lists and their guards.** Remove `_ENGINE_ASSET_CLASSES`, `_ENGINE_CONFIG_STRUCT_CPP_TYPES`, `_ENGINE_CONFIG_CPP_PATTERNS`, plus `_is_filtered_cpp_type` and its call site at the top of `normalize_property`. Replace the soft-ptr early-drop block with:

```python
    # Soft ptr to a non-Definition class → soft_asset_ref envelope.
    soft_class = _engine_class_in_softptr(cpp_type)
    if soft_class is not None:
        if f"U{soft_class}" in definition_class_names:
            # Soft ref to a Definition asset — keep existing definition_ref shape.
            pass  # fall through to parse logic below
        else:
            return {
                "kind": "soft_asset_ref",
                "class": soft_class,
                "value": _parse_soft_path(value_str),
            }
```

Add the helper near the other parsers:

```python
def _parse_soft_path(value_str: str) -> str | None:
    """Soft path strings come through as either ``/Game/...`` or the
    sentinel ``None``. Normalize to ``None`` for the cleared case."""
    v = value_str.strip()
    if not v or v in {"None", "(None,None)"}:
        return None
    # Sometimes wrapped: ``(/Game/Foo.Foo,/Game/Foo.Foo)``
    if v.startswith("(") and v.endswith(")"):
        v = v[1:-1].split(",", 1)[0]
    return v
```

- [ ] **Step 3: Replace the `Object(X)` arm** in `normalize_property` so non-Definition object refs become `soft_asset_ref`:

```python
    obj_class = _object_type_class(type_str)
    if obj_class is not None:
        full = f"U{obj_class}"
        if full in definition_class_names:
            # falls through to parse + _normalize_parsed → definition_ref
            pass
        else:
            return {
                "kind": "soft_asset_ref",
                "class": obj_class,
                "value": _parse_soft_path(value_str),
            }
```

- [ ] **Step 4: Add the matching `kind: "soft_asset_ref"` arm in `property_serializer.serialize`.** It should emit:

```python
        if kind == "soft_asset_ref":
            return {
                "type": "soft_asset_ref",
                "class": entry["class"],
                "value": entry["value"],
            }
```

- [ ] **Step 5: Run the tests from Task 1.1 — verify they pass**

```
pytest tests/test_property_normalizer.py -k "soft_asset_ref or definition_ref_unchanged" -v
```

Expected: PASS.

- [ ] **Step 6: Run the full exporter test suite — verify no regressions**

```
pytest
```

Expected: PASS (some tests may have been depending on the strip behavior — fix them as you go; the spec mandates strip-nothing). If `test_asset_exporter` or `test_export_definitions` fails because a fixture asset no longer drops, update the fixture's expected output to include the now-emitted soft_asset_ref.

- [ ] **Step 7: Commit**

```
git add Tools/Export/lib/property_normalizer.py Tools/Export/lib/property_serializer.py \
        Tools/Export/tests/test_property_normalizer.py Tools/Export/tests/test_asset_exporter.py \
        Tools/Export/tests/test_export_definitions.py
git commit -m "feat(exporter): emit soft_asset_ref for non-Definition object refs"
```

### Task 1.3: Round-trip tests for FTransform + FVector + AudioConfig (TDD)

**Files:**
- Modify: `Tools/Export/tests/test_property_normalizer.py`
- Modify: `Tools/Export/tests/fixtures/raw-export-sample.json`

- [ ] **Step 1: Add a fixture row that contains a struct with a soft ref nested inside.** In `raw-export-sample.json`, add (or replace if a similar row exists):

```json
{
  "asset_name": "FD_FixtureStruct",
  "class_name": "FurnitureDefinition",
  "asset_path": "/Game/Fixtures/FD_FixtureStruct",
  "parent_classes": ["UFurnitureDefinition", "UWorldGenObjectDefinition"],
  "properties": [
    {
      "name": "audio_config",
      "type": "Struct(AudioConfig)",
      "cpp_type": "FAudioConfig",
      "category": "",
      "value": "(open_sound=/Game/Audio/SC_DoorOpen.SC_DoorOpen,volume_multiplier=0.5)",
      "blueprint_visible": true,
      "editable": true
    },
    {
      "name": "static_mesh",
      "type": "Object(StaticMesh)",
      "cpp_type": "TObjectPtr<UStaticMesh>",
      "category": "",
      "value": "/Game/Doors/SM_Door.SM_Door",
      "blueprint_visible": true,
      "editable": true
    },
    {
      "name": "world_transform",
      "type": "Struct(Transform)",
      "cpp_type": "FTransform",
      "category": "",
      "value": "(translation=(x=100.0,y=-50.0,z=0.0),rotation=(pitch=0.0,yaw=90.0,roll=0.0),scale_3d=(x=1.0,y=1.0,z=1.0))",
      "blueprint_visible": true,
      "editable": true
    }
  ]
}
```

- [ ] **Step 2: Add tests covering struct round-trip**

```python
def test_struct_transform_roundtrip():
    out = normalize_property(
        name="world_transform",
        type_str="Struct(Transform)",
        cpp_type="FTransform",
        value_str="(translation=(x=100.0,y=-50.0,z=0.0),rotation=(pitch=0.0,yaw=90.0,roll=0.0),scale_3d=(x=1.0,y=1.0,z=1.0))",
        definition_class_names=set(),
    )
    assert out["kind"] == "struct"
    # The normalizer parses one level; nested vectors stay as raw strings
    # and are re-parsed when the serializer recurses (see Task 1.4).
    assert "translation" in out["value"]


def test_struct_audio_config_with_nested_soft_ref():
    out = normalize_property(
        name="audio_config",
        type_str="Struct(AudioConfig)",
        cpp_type="FAudioConfig",
        value_str="(open_sound=/Game/Audio/SC_DoorOpen.SC_DoorOpen,volume_multiplier=0.5)",
        definition_class_names=set(),
    )
    assert out["kind"] == "struct"
    assert set(out["value"].keys()) == {"open_sound", "volume_multiplier"}


def test_strip_nothing_regression():
    """Every property in the fixture row produces a non-None envelope."""
    with open("tests/fixtures/raw-export-sample.json") as f:
        sample = json.load(f)
    fixture = next(a for a in sample["assets"] if a["asset_name"] == "FD_FixtureStruct")
    for raw in fixture["properties"]:
        out = normalize_property(
            name=raw["name"],
            type_str=raw["type"],
            cpp_type=raw["cpp_type"],
            value_str=raw["value"],
            definition_class_names=set(),
        )
        assert out is not None, f"property {raw['name']} was silently dropped"
```

Add `import json` at the top of the test file if missing.

- [ ] **Step 3: Run tests; verify they fail**

```
pytest tests/test_property_normalizer.py -k "struct_transform or audio_config or strip_nothing" -v
```

Expected: FAIL — current normalizer drops `FTransform` and `FAudioConfig` via the (now-removed) strip list, but the parser still needs structural support for nested fields.

- [ ] **Step 4: Commit the failing tests**

```
git add Tools/Export/tests/test_property_normalizer.py Tools/Export/tests/fixtures/raw-export-sample.json
git commit -m "test(exporter): pending struct + nested-ref round-trip cases"
```

### Task 1.4: Implement struct round-trip (FTransform, FVector, generic USTRUCTs)

**Files:**
- Modify: `Tools/Export/lib/property_normalizer.py`
- Modify: `Tools/Export/lib/import_text_parser.py` (only if necessary — read first)

- [ ] **Step 1: Read `lib/import_text_parser.py`** end-to-end. It parses the Lua-emitted `value_str` blobs like `(x=1.0,y=2.0,z=3.0)`. The existing parser already returns a `dict` for `Struct(*)` values; the normalizer just needs to recurse over the fields with their own typed envelopes.

- [ ] **Step 2: Replace the generic-struct arm in `_normalize_parsed`** with a recursive call. Find the existing block:

```python
    # Generic struct — recurse with sub-values as raw strings.
    if type_str.startswith("Struct("):
        if not isinstance(parsed, dict) or not parsed:
            return None
        struct_value: dict[str, dict] = {}
        for field_name, sub_raw in parsed.items():
            struct_value[field_name] = {"kind": "string", "value": sub_raw}
        return {"kind": "struct", "value": struct_value}
```

Replace with:

```python
    # Generic struct — recurse on each field. The Lua extractor emits each
    # field's value as a raw string; we re-feed it through the parser plus
    # a heuristic type lookup so nested Vectors/Rotators/soft refs round-trip.
    if type_str.startswith("Struct("):
        if not isinstance(parsed, dict):
            return None
        if not parsed:
            # Empty struct: still emit so the editor sees the property exists.
            return {"kind": "struct", "struct_name": _struct_inner_name(type_str), "value": {}}
        struct_value: dict[str, dict] = {}
        for field_name, sub_raw in parsed.items():
            inferred = _infer_field_type(field_name, sub_raw)
            sub = _normalize_parsed(
                type_str=inferred,
                parsed=parse(inferred, sub_raw) if isinstance(sub_raw, str) else sub_raw,
                definition_class_names=definition_class_names,
            )
            if sub is None:
                # Round-trip-or-die: stash as a raw string rather than drop.
                sub = {"kind": "string", "value": sub_raw if isinstance(sub_raw, str) else str(sub_raw)}
            struct_value[field_name] = sub
        return {
            "kind": "struct",
            "struct_name": _struct_inner_name(type_str),
            "value": struct_value,
        }
```

Add the helpers below:

```python
def _struct_inner_name(type_str: str) -> str:
    """Struct(Transform) → "Transform"."""
    m = re.match(r"^Struct\((.+)\)$", type_str.strip())
    return m.group(1) if m else "Struct"


_NUMERIC_FIELDS = frozenset({
    "x", "y", "z", "w",
    "pitch", "yaw", "roll",
    "r", "g", "b", "a",
    "volume_multiplier", "pitch_multiplier",
})
_VECTOR_FIELDS = frozenset({"translation", "scale_3d"})
_ROTATOR_FIELDS = frozenset({"rotation"})

def _infer_field_type(field_name: str, value: Any) -> str:
    """Heuristic-only — used until the schema sidecar can drive this."""
    lower = field_name.lower()
    if lower in _VECTOR_FIELDS:
        return "Struct(Vector)"
    if lower in _ROTATOR_FIELDS:
        return "Struct(Rotator)"
    if lower in _NUMERIC_FIELDS:
        return "Float"
    if isinstance(value, bool):
        return "Bool"
    if isinstance(value, dict):
        return "Struct(Anonymous)"
    if isinstance(value, str):
        s = value.strip()
        if s.startswith("/Game/"):
            # Best guess: a soft asset ref to an unknown class. The catalog
            # walker (Task 2) will determine the actual class via the asset
            # registry; here we emit it as a generic soft path so it survives.
            return "SoftObject(Unknown)"
        if s.startswith("(") and "=" in s:
            return "Struct(Anonymous)"
    return "String"
```

Update `_engine_class_in_softptr` and the soft-ref arm to handle `SoftObject(Unknown)` cleanly (emit a `soft_asset_ref` with `class: "Unknown"` and the path).

- [ ] **Step 3: Add the matching `kind: "struct"` arm in `property_serializer.serialize`** so the new `struct_name` survives:

```python
        if kind == "struct":
            return {
                "type": "struct",
                "struct_name": entry.get("struct_name", "Struct"),
                "value": {
                    field: serialize(sub)
                    for field, sub in entry["value"].items()
                },
            }
```

- [ ] **Step 4: Run Task 1.3's tests**

```
pytest tests/test_property_normalizer.py -k "struct_transform or audio_config or strip_nothing" -v
```

Expected: PASS.

- [ ] **Step 5: Run the full exporter test suite**

```
pytest
```

Expected: PASS. Fixture expectations elsewhere may need updates because previously-dropped fields now round-trip — fix them by regenerating the expected output, e.g. `pytest tests/test_asset_exporter.py -v --tb=long` and updating fixture JSON where the failure says "extra key was emitted" rather than a substantive disagreement.

- [ ] **Step 6: Commit**

```
git add Tools/Export/lib/property_normalizer.py Tools/Export/lib/property_serializer.py \
        Tools/Export/tests/
git commit -m "feat(exporter): recursive struct round-trip (FTransform/FVector/AudioConfig)"
```

### Task 1.5: Live re-export and diff

**Files:** none (verification step).

- [ ] **Step 1: Re-run the offline exporter** against the existing intermediate dump:

```
cd Tools/Export
python export_definitions.py --clean --out-dir test-output/Definitions
```

- [ ] **Step 2: Spot-check a furniture and a layout file**

```
# Compare an FD_ file before/after using your last commit (HEAD~)
git --no-pager diff HEAD~1 -- test-output/Definitions/furniture_definitions/FD_Door.json | head -80
git --no-pager diff HEAD~1 -- test-output/Definitions/layout_definitions/LYD_Bathroom_All.json | head -120
```

Expected: `FD_Door.json` now contains a `static_mesh` envelope and any audio-config/light/VFX struct that the source asset had. `LYD_Bathroom_All.json` now contains a `transform` field inside each `LayoutObject` struct.

- [ ] **Step 3: If the diff looks wrong, fix and iterate.** Diff is the source of truth here — the bullet above describes what should appear; if not, drop into the normalizer with `pytest tests/ -v` and a focused unit test before retrying.

- [ ] **Step 4: Commit the regenerated test-output**

```
git add Tools/Export/test-output/
git commit -m "build(exporter): regenerate test-output with lossless property round-trip"
```

---

## Phase 2: Exporter — asset catalogs

### Task 2.1: Lua side — walk the asset registry per referenced class

**Files:**
- Modify: `Tools/Export/extract.lua`

- [ ] **Step 1: Read `extract.lua` end-to-end first** so the orchestration of the existing `intermediate/*.json` writes is clear. Asset-registry access in Lua MCP is via `unreal.AssetRegistryHelpers.get_asset_registry()` (or local equivalent — check what the existing tag walker uses).

- [ ] **Step 2: After the property walk, collect the set of asset classes referenced by any property.** Cpp types like `TObjectPtr<UStaticMesh>` give you the class name. Build a `referenced_classes` set: every `TObjectPtr<U*>` and `TSoftObjectPtr<U*>` target *that is not* a TSIC Definition class.

- [ ] **Step 3: For each referenced class, query the asset registry** for every asset under `/Game/...` of that class. For each asset record produce a row:

```json
{
  "class": "StaticMesh",
  "path": "/Game/Furniture/Meshes/SM_Door.SM_Door",
  "name": "SM_Door",
  "folder": "/Game/Furniture/Meshes",
  "package_guid": "ABCDEF12-3456-789A-BCDE-F01234567890",
  "bounds": { "min": [-50,-20,0], "max": [50,20,200] }
}
```

`package_guid` comes from the package's `PersistentGuid` (Unreal API: `package:GetPersistentGuid()` or equivalent). `bounds` only for `StaticMesh` — use `static_mesh:GetBoundingBox()` and emit `[min.x, min.y, min.z]` / `[max.x, max.y, max.z]`. For other classes, omit the field.

- [ ] **Step 4: Write rows to `intermediate/asset-catalog.json`**:

```json
{
  "schema_version": 1,
  "generated_at": "<ISO-8601>",
  "rows": [ ... ]
}
```

- [ ] **Step 5: Smoke-test by running the extractor against the project.** Open `intermediate/asset-catalog.json` and confirm:
  - It contains at least one `StaticMesh` row with `bounds` populated.
  - It contains a `Material` (or `MaterialInstance`) row with `package_guid` populated, no bounds.
  - The class set matches the references in `intermediate/raw-export.json` plus refs added by Phase 1 changes.

- [ ] **Step 6: Commit**

```
git add Tools/Export/extract.lua Tools/Export/intermediate/asset-catalog.json
git commit -m "feat(extract.lua): emit intermediate/asset-catalog.json"
```

### Task 2.2: Offline asset catalog dumper

**Files:**
- Create: `Tools/Export/lib/asset_catalog_dumper.py`
- Create: `Tools/Export/tests/fixtures/asset-catalog-sample.json`
- Create: `Tools/Export/tests/test_asset_catalog_dumper.py`

- [ ] **Step 1: Create the fixture** `tests/fixtures/asset-catalog-sample.json`:

```json
{
  "schema_version": 1,
  "generated_at": "2026-05-12T12:00:00+00:00",
  "rows": [
    { "class": "StaticMesh", "path": "/Game/Furniture/SM_Door.SM_Door",  "name": "SM_Door",  "folder": "/Game/Furniture",
      "package_guid": "AAAAAAAA-1111-1111-1111-111111111111",
      "bounds": { "min": [-50,-20,0], "max": [50,20,200] } },
    { "class": "StaticMesh", "path": "/Game/Furniture/SM_Wall.SM_Wall",  "name": "SM_Wall",  "folder": "/Game/Furniture",
      "package_guid": "AAAAAAAA-2222-2222-2222-222222222222",
      "bounds": { "min": [0,0,0], "max": [200,20,300] } },
    { "class": "Material",   "path": "/Game/Materials/M_Wood.M_Wood",    "name": "M_Wood",   "folder": "/Game/Materials",
      "package_guid": "BBBBBBBB-1111-1111-1111-111111111111" }
  ]
}
```

- [ ] **Step 2: Write the test file**

```python
# Tools/Export/tests/test_asset_catalog_dumper.py
import json
from datetime import datetime, timezone
from pathlib import Path

from lib.asset_catalog_dumper import build_catalogs


def _fixture():
    with open(Path(__file__).parent / "fixtures" / "asset-catalog-sample.json") as f:
        return json.load(f)["rows"]


def test_groups_by_class():
    out = build_catalogs(
        _fixture(),
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    assert set(out.keys()) == {"StaticMesh", "Material"}


def test_per_class_payload_shape():
    out = build_catalogs(
        _fixture(),
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    mesh = out["StaticMesh"]
    assert mesh["schema_version"] == 1
    assert mesh["class"] == "StaticMesh"
    assert mesh["generated_at"] == "2026-05-12T12:00:00+00:00"
    assert len(mesh["entries"]) == 2
    e = mesh["entries"][0]
    assert e["path"] == "/Game/Furniture/SM_Door.SM_Door"
    assert e["name"] == "SM_Door"
    assert e["folder"] == "/Game/Furniture"
    assert e["package_guid"] == "AAAAAAAA-1111-1111-1111-111111111111"
    assert e["bounds"]["max"] == [50, 20, 200]


def test_non_mesh_omits_bounds():
    out = build_catalogs(
        _fixture(),
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    e = out["Material"]["entries"][0]
    assert "bounds" not in e


def test_entries_sorted_by_path():
    rows = _fixture()
    rows.append({
        "class": "StaticMesh", "path": "/Game/A/SM_AAA.SM_AAA", "name": "SM_AAA",
        "folder": "/Game/A", "package_guid": "CCCCCCCC-1-1-1-1",
        "bounds": {"min": [0,0,0], "max": [1,1,1]},
    })
    out = build_catalogs(
        rows,
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    paths = [e["path"] for e in out["StaticMesh"]["entries"]]
    assert paths == sorted(paths)


def test_idempotent():
    """Same input → byte-identical output."""
    rows = _fixture()
    a = build_catalogs(rows, generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc), schema_version=1)
    b = build_catalogs(rows, generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc), schema_version=1)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
```

- [ ] **Step 3: Run; verify FAIL ("module not found")**

```
pytest tests/test_asset_catalog_dumper.py -v
```

- [ ] **Step 4: Implement `lib/asset_catalog_dumper.py`**

```python
# Tools/Export/lib/asset_catalog_dumper.py
"""Build per-class asset catalogs from the intermediate/asset-catalog.json rows.

Editor consumes one file per asset class so they can be lazy-loaded.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any


def build_catalogs(
    rows: list[dict[str, Any]],
    *,
    generated_at: datetime,
    schema_version: int,
) -> dict[str, dict[str, Any]]:
    """Group rows by `class`, sort entries by `path`, and return a dict
    mapping class name → catalog payload.

    Each catalog payload is shaped:
        {schema_version, class, generated_at, entries: [...]}

    Entries are the same row dicts minus the `class` key. Optional fields
    (`bounds`, `thumbnail`) are passed through when present and omitted
    otherwise.
    """
    by_class: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        cls = row["class"]
        entry = {k: v for k, v in row.items() if k != "class"}
        by_class.setdefault(cls, []).append(entry)

    out: dict[str, dict[str, Any]] = {}
    for cls, entries in by_class.items():
        entries.sort(key=lambda e: e["path"])
        out[cls] = {
            "schema_version": schema_version,
            "class": cls,
            "generated_at": generated_at.isoformat(),
            "entries": entries,
        }
    return out
```

- [ ] **Step 5: Run tests; verify PASS**

```
pytest tests/test_asset_catalog_dumper.py -v
```

- [ ] **Step 6: Commit**

```
git add Tools/Export/lib/asset_catalog_dumper.py \
        Tools/Export/tests/test_asset_catalog_dumper.py \
        Tools/Export/tests/fixtures/asset-catalog-sample.json
git commit -m "feat(exporter): asset_catalog_dumper groups rows into per-class payloads"
```

### Task 2.3: Wire catalog dumper into `export_definitions.py`

**Files:**
- Modify: `Tools/Export/export_definitions.py`
- Modify: `Tools/Export/run_export.py`

- [ ] **Step 1: In `export_definitions.py`**, after the existing tag/hierarchy dump block:

```python
from lib.asset_catalog_dumper import build_catalogs

# inside main(), after writing existing sidecars
catalog_path = intermediate_dir / "asset-catalog.json"
if catalog_path.exists():
    with catalog_path.open("r", encoding="utf-8") as f:
        catalog_rows = json.load(f)["rows"]
    per_class = build_catalogs(
        catalog_rows,
        generated_at=generated_at,
        schema_version=SCHEMA_VERSION,
    )
    assets_dir = out_dir / ".assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    for cls, payload in per_class.items():
        _write_json(assets_dir / f"{cls}.json", payload)
else:
    # Lua side may not have emitted yet — warn but don't fail
    print(f"[export_definitions] no {catalog_path}, skipping asset catalogs")
```

- [ ] **Step 2: Mirror the same block in `run_export.py`** — its asset registry walk already happens inline; collect the same row shape and call `build_catalogs` with it.

- [ ] **Step 3: Run the offline exporter**

```
cd Tools/Export
python export_definitions.py --clean --out-dir test-output/Definitions
ls test-output/Definitions/.assets
```

Expected: At least `StaticMesh.json` and `Material.json` (others depending on what the project actually references). Each file contains `schema_version`, `class`, `entries`, the entries sorted by `path`, each with `package_guid`.

- [ ] **Step 4: Commit**

```
git add Tools/Export/export_definitions.py Tools/Export/run_export.py Tools/Export/test-output/
git commit -m "build(exporter): write .assets/<Class>.json sidecars"
```

---

## Phase 3: Tags, asset-refs sidecar, manifest extension

### Task 3.1: Verify and fix tag enumeration

**Files:**
- Modify (probably): `Tools/Export/run_export.py` or `extract.lua`
- Modify: `Tools/Export/lib/tag_dumper.py` (only if its API needs to change)

- [ ] **Step 1: Re-run an export and inspect `.gameplay-tags.json`.** If `tags` is empty but tag *values* appear in the per-asset JSONs (as gameplay_tag_container values), the upstream enumeration is broken. Check both code paths:
  - `extract.lua` line ~203: `mgr = unreal.GameplayTagsManager.get()` — does the call succeed inside MCP? If not, fall back to harvesting every distinct tag string seen in the property walk and deduping.
  - `run_export.py` line ~533: `unreal.GameplayTagsManager` — same fallback.

- [ ] **Step 2: Add a backstop in `export_definitions.py`** so even if `gameplay-tags.json` arrives empty, the post-process collects every tag actually referenced and merges them in:

```python
# After loading per-asset normalized output, but before writing sidecars:
referenced_tags: set[str] = set()
for asset in normalized_assets:
    for prop in asset.get("properties", {}).values():
        if prop.get("type") == "gameplay_tag":
            v = prop.get("value")
            if v:
                referenced_tags.add(v)
        elif prop.get("type") == "gameplay_tag_container":
            for v in prop.get("value", []) or []:
                if v:
                    referenced_tags.add(v)
# Walk struct children recursively — pseudo: traverse all subtrees too.

merged = sorted(set(intermediate_tags) | referenced_tags)
tag_dump = build_tag_dump(merged, generated_at=generated_at, schema_version=SCHEMA_VERSION)
```

The recursion over struct subtrees is straightforward — walk `prop["value"]` when `type == "struct"` and recurse. Inline it as a helper, don't fan out unrelated cleanups.

- [ ] **Step 3: Run the exporter, confirm `.gameplay-tags.json` is no longer empty.**

```
python export_definitions.py --clean --out-dir test-output/Definitions
python -c "import json; d=json.load(open('test-output/Definitions/.gameplay-tags.json')); print(len(d['tags']), d['tags'][:5])"
```

Expected: a non-zero count and a sample of strings like `Entity.RandomGeneration.FurnitureType.Door`.

- [ ] **Step 4: Commit**

```
git add Tools/Export/ test-output/Definitions/.gameplay-tags.json
git commit -m "fix(exporter): backfill gameplay tags from referenced values when manager enum is empty"
```

### Task 3.2: Asset-ref index module (TDD)

**Files:**
- Create: `Tools/Export/lib/asset_ref_index.py`
- Create: `Tools/Export/tests/test_asset_ref_index.py`

- [ ] **Step 1: Write the failing test**

```python
# Tools/Export/tests/test_asset_ref_index.py
from datetime import datetime, timezone

from lib.asset_ref_index import build_asset_ref_index


def test_collects_paths_from_soft_asset_refs():
    definitions = [
        {
            "properties": {
                "static_mesh": {"type": "soft_asset_ref", "class": "StaticMesh",
                                "value": "/Game/Foo.SM_Foo"},
                "material": {"type": "soft_asset_ref", "class": "Material",
                             "value": "/Game/Mat.M_Mat"},
            }
        }
    ]
    catalogs = {
        "StaticMesh": {"entries": [{"path": "/Game/Foo.SM_Foo", "package_guid": "AAAA"}]},
        "Material":   {"entries": [{"path": "/Game/Mat.M_Mat",  "package_guid": "BBBB"}]},
    }
    out = build_asset_ref_index(
        definitions, catalogs,
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    assert out["expected_guids"] == {
        "/Game/Foo.SM_Foo": "AAAA",
        "/Game/Mat.M_Mat": "BBBB",
    }


def test_null_value_is_skipped():
    out = build_asset_ref_index(
        [{"properties": {"x": {"type": "soft_asset_ref", "class": "StaticMesh", "value": None}}}],
        {},
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    assert out["expected_guids"] == {}


def test_missing_in_catalog_skipped():
    """A ref to a path not in the catalog is silently skipped — drift detector
    will surface it on the editor side."""
    out = build_asset_ref_index(
        [{"properties": {"x": {"type": "soft_asset_ref", "class": "StaticMesh",
                                "value": "/Game/Missing.SM_Missing"}}}],
        {"StaticMesh": {"entries": []}},
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    assert out["expected_guids"] == {}


def test_recurses_into_structs_and_arrays():
    definitions = [{
        "properties": {
            "audio_config": {
                "type": "struct", "struct_name": "AudioConfig",
                "value": {
                    "open_sound": {"type": "soft_asset_ref", "class": "SoundCue",
                                   "value": "/Game/Audio/SC.SC"}
                }
            },
            "extras": {
                "type": "array", "element_type": None,
                "value": [
                    {"type": "soft_asset_ref", "class": "StaticMesh",
                     "value": "/Game/Foo.SM_Foo"}
                ]
            }
        }
    }]
    catalogs = {
        "SoundCue":   {"entries": [{"path": "/Game/Audio/SC.SC", "package_guid": "CCCC"}]},
        "StaticMesh": {"entries": [{"path": "/Game/Foo.SM_Foo",  "package_guid": "DDDD"}]},
    }
    out = build_asset_ref_index(
        definitions, catalogs,
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    assert out["expected_guids"] == {
        "/Game/Audio/SC.SC": "CCCC",
        "/Game/Foo.SM_Foo":  "DDDD",
    }
```

- [ ] **Step 2: Run; verify FAIL**

```
pytest tests/test_asset_ref_index.py -v
```

- [ ] **Step 3: Implement `lib/asset_ref_index.py`**

```python
# Tools/Export/lib/asset_ref_index.py
"""Builds .asset-refs.json — a path → expected PackagePersistentGuid index.

The editor compares this map against the current catalog at load time and
surfaces drift when an asset has been replaced (path resolves but guid
differs) or removed (path missing from catalog entirely).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable


def _iter_envelopes(value: Any) -> Iterable[dict]:
    """Yield every typed envelope nested anywhere inside ``value``."""
    if isinstance(value, dict):
        if "type" in value:
            yield value
            inner = value.get("value")
            if isinstance(inner, (dict, list)):
                yield from _iter_envelopes(inner)
        else:
            for v in value.values():
                yield from _iter_envelopes(v)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_envelopes(item)


def _build_path_to_guid(catalogs: dict[str, dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for payload in catalogs.values():
        for entry in payload.get("entries", []):
            path = entry.get("path")
            guid = entry.get("package_guid")
            if path and guid:
                out[path] = guid
    return out


def build_asset_ref_index(
    definitions: list[dict],
    catalogs: dict[str, dict],
    *,
    generated_at: datetime,
    schema_version: int,
) -> dict[str, Any]:
    """Walk every definition's properties (recursively), collect every
    ``soft_asset_ref`` path, and record the catalog's current
    ``package_guid`` for that path."""
    path_to_guid = _build_path_to_guid(catalogs)
    expected: dict[str, str] = {}

    for d in definitions:
        for env in _iter_envelopes(d.get("properties", {})):
            if env.get("type") != "soft_asset_ref":
                continue
            path = env.get("value")
            if not path:
                continue
            guid = path_to_guid.get(path)
            if guid is None:
                continue
            expected[path] = guid

    return {
        "schema_version": schema_version,
        "generated_at": generated_at.isoformat(),
        "expected_guids": dict(sorted(expected.items())),
    }
```

- [ ] **Step 4: Run tests; verify PASS**

```
pytest tests/test_asset_ref_index.py -v
```

- [ ] **Step 5: Commit**

```
git add Tools/Export/lib/asset_ref_index.py Tools/Export/tests/test_asset_ref_index.py
git commit -m "feat(exporter): asset_ref_index walks definitions for soft refs + catalog guids"
```

### Task 3.3: Wire the asset-refs sidecar into the orchestrator

**Files:**
- Modify: `Tools/Export/export_definitions.py`
- Modify: `Tools/Export/run_export.py`

- [ ] **Step 1: After catalogs are written, build and write `.asset-refs.json`**

In `export_definitions.py` (and the parallel block in `run_export.py`):

```python
from lib.asset_ref_index import build_asset_ref_index

# `normalized_assets` is the list of final per-asset dicts already in scope
asset_ref_index = build_asset_ref_index(
    normalized_assets,
    per_class,                  # the catalogs dict built in Task 2.3
    generated_at=generated_at,
    schema_version=SCHEMA_VERSION,
)
_write_json(out_dir / ".asset-refs.json", asset_ref_index)
```

- [ ] **Step 2: Re-run export, verify output**

```
python export_definitions.py --clean --out-dir test-output/Definitions
python -c "import json; d=json.load(open('test-output/Definitions/.asset-refs.json')); print(len(d['expected_guids']))"
```

Expected: non-zero (one entry per distinct soft asset ref encountered).

- [ ] **Step 3: Commit**

```
git add Tools/Export/export_definitions.py Tools/Export/run_export.py Tools/Export/test-output/
git commit -m "build(exporter): emit .asset-refs.json drift sidecar"
```

### Task 3.4: Manifest extension

**Files:**
- Modify: `Tools/Export/lib/manifest_builder.py`
- Modify: `Tools/Export/tests/test_manifest_builder.py`
- Modify: `Tools/Export/export_definitions.py` / `run_export.py`

- [ ] **Step 1: Add failing tests in `test_manifest_builder.py`**

```python
def test_manifest_includes_asset_catalog_names():
    out = build_manifest(
        entries=[],
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
        asset_catalogs=["StaticMesh", "Material"],
        has_asset_refs_sidecar=True,
        thumbnails_dir=".thumbnails",
    )
    assert out["asset_catalogs"] == ["Material", "StaticMesh"]
    assert out["has_asset_refs_sidecar"] is True
    assert out["thumbnails_dir"] == ".thumbnails"


def test_manifest_omits_new_fields_when_unset():
    out = build_manifest(
        entries=[],
        generated_at=datetime(2026, 5, 12, 12, 0, 0, tzinfo=timezone.utc),
        schema_version=1,
    )
    assert "asset_catalogs" not in out
    assert "has_asset_refs_sidecar" not in out
    assert "thumbnails_dir" not in out
```

- [ ] **Step 2: Run; verify FAIL** (`build_manifest` doesn't accept those kwargs yet).

```
pytest tests/test_manifest_builder.py -v
```

- [ ] **Step 3: Add the new optional kwargs to `build_manifest`** in `lib/manifest_builder.py`. Sorted, omitted when None / False / empty.

- [ ] **Step 4: Pass them from the orchestrator** (`export_definitions.py` and `run_export.py`) using the set of catalog files just written.

- [ ] **Step 5: Run tests; verify PASS**

```
pytest tests/test_manifest_builder.py -v
```

- [ ] **Step 6: Commit**

```
git add Tools/Export/lib/manifest_builder.py Tools/Export/tests/test_manifest_builder.py \
        Tools/Export/export_definitions.py Tools/Export/run_export.py \
        Tools/Export/test-output/Definitions/.manifest.json
git commit -m "feat(exporter): manifest carries asset_catalogs + has_asset_refs_sidecar + thumbnails_dir"
```

---

## Phase 4: Sync to bundled defaults

### Task 4.1: Mirror new sidecars into `public/starter-project/`

**Files:**
- Modify: `web/scripts/sync-base-definitions.mjs`

- [ ] **Step 1: Read the existing copy loop** to understand the source/destination shape.

- [ ] **Step 2: After the per-folder mirror, copy the new sidecars**

```js
// Copy .gameplay-tags.json (newly populated)
const tagsSrc = join(SRC, '.gameplay-tags.json');
if (existsSync(tagsSrc)) {
  await copyFile(tagsSrc, join(STARTER_DIR, '.gameplay-tags.json'));
}

// Copy .asset-refs.json (new)
const refsSrc = join(SRC, '.asset-refs.json');
if (existsSync(refsSrc)) {
  await copyFile(refsSrc, join(STARTER_DIR, '.asset-refs.json'));
}

// Recursive copy of .assets/ (new)
const assetsSrc = join(SRC, '.assets');
if (existsSync(assetsSrc)) {
  const assetsDst = join(STARTER_DIR, '.assets');
  await ensureDir(assetsDst);
  for (const file of await readdir(assetsSrc)) {
    if (!file.endsWith('.json')) continue;
    await copyFile(join(assetsSrc, file), join(assetsDst, file));
  }
}

// Recursive copy of .thumbnails/ (Task 8 — write the copy now so it's a no-op
// when the dir doesn't exist yet)
const thumbsSrc = join(SRC, '.thumbnails');
if (existsSync(thumbsSrc)) {
  // Two levels: .thumbnails/<Class>/<Name>.png
  const thumbsDst = join(STARTER_DIR, '.thumbnails');
  await ensureDir(thumbsDst);
  for (const cls of await readdir(thumbsSrc)) {
    const classSrc = join(thumbsSrc, cls);
    const classDst = join(thumbsDst, cls);
    await ensureDir(classDst);
    for (const file of await readdir(classSrc)) {
      await copyFile(join(classSrc, file), join(classDst, file));
    }
  }
}
```

- [ ] **Step 3: Run sync; verify**

```
cd web
npm run sync-defaults
ls public/starter-project/.assets
ls public/starter-project/.asset-refs.json
```

Expected: `.assets/*.json` and `.asset-refs.json` mirror the exporter test-output.

- [ ] **Step 4: Commit**

```
git add web/scripts/sync-base-definitions.mjs web/public/starter-project/
git commit -m "build(sync): mirror .assets/ + .asset-refs.json + .thumbnails/ into starter-project"
```

---

## Phase 5: Editor stores

### Task 5.1: Extend `DataSource` interface with catalog / tag / asset-ref reads

**Files:**
- Modify: `web/src/persistence/dataSource.ts`
- Modify: `web/tests/dataSource.test.ts`

- [ ] **Step 1: Add failing tests**

In `tests/dataSource.test.ts`, after the existing tests:

```ts
test('HttpDataSource: readCatalog fetches per-class file', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/.assets/StaticMesh.json': {
      status: 200,
      body: JSON.stringify({
        schema_version: 1, class: 'StaticMesh', entries: [
          { path: '/Game/Foo.SM_Foo', name: 'SM_Foo', folder: '/Game', package_guid: 'ABCD' }
        ]
      }),
    },
  }));
  const cat = await ds.readCatalog('StaticMesh');
  assert.equal(cat?.entries.length, 1);
  assert.equal(cat?.entries[0].package_guid, 'ABCD');
});

test('HttpDataSource: readCatalog returns null on 404', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  const cat = await ds.readCatalog('NotARealClass');
  assert.equal(cat, null);
});

test('HttpDataSource: readTags returns sorted list', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/.gameplay-tags.json': {
      status: 200,
      body: JSON.stringify({ schema_version: 1, tags: ['Z.A', 'A.Z'] }),
    },
  }));
  assert.deepEqual(await ds.readTags(), ['Z.A', 'A.Z']);
});

test('HttpDataSource: readAssetRefs returns the expected_guids map', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/.asset-refs.json': {
      status: 200,
      body: JSON.stringify({
        schema_version: 1,
        expected_guids: { '/Game/Foo.SM_Foo': 'ABCD' },
      }),
    },
  }));
  assert.deepEqual(await ds.readAssetRefs(), { '/Game/Foo.SM_Foo': 'ABCD' });
});
```

- [ ] **Step 2: Run tests; verify FAIL**

```
cd web
npm test
```

- [ ] **Step 3: Extend the `DataSource` interface and both implementations**

In `src/persistence/dataSource.ts`:

```ts
export type AssetCatalogEntry = {
  path: string;
  name: string;
  folder: string;
  package_guid: string;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  thumbnail?: string;
};
export type AssetCatalog = {
  schema_version: number;
  class: string;
  entries: AssetCatalogEntry[];
};

export interface DataSource {
  // ...existing...
  readCatalog(className: string): Promise<AssetCatalog | null>;
  readTags(): Promise<string[]>;
  readAssetRefs(): Promise<Record<string, string>>;
}
```

`HttpDataSource`:

```ts
async readCatalog(className: string): Promise<AssetCatalog | null> {
  const url = `${this.baseUrl}/.assets/${className}.json`;
  const r = await this.fetcher(url);
  if (!r.ok) return null;
  return JSON.parse(await r.text());
}

async readTags(): Promise<string[]> {
  const url = `${this.baseUrl}/.gameplay-tags.json`;
  const r = await this.fetcher(url);
  if (!r.ok) return [];
  return JSON.parse(await r.text()).tags ?? [];
}

async readAssetRefs(): Promise<Record<string, string>> {
  const url = `${this.baseUrl}/.asset-refs.json`;
  const r = await this.fetcher(url);
  if (!r.ok) return {};
  return JSON.parse(await r.text()).expected_guids ?? {};
}
```

`FsaDataSource` (uses the existing private helper pattern to walk hidden dirs):

```ts
async readCatalog(className: string): Promise<AssetCatalog | null> {
  try {
    const assets = await this.rootHandle.getDirectoryHandle('.assets');
    const fh = await assets.getFileHandle(`${className}.json`);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch (e: any) {
    if (e?.name === 'NotFoundError') return null;
    throw e;
  }
}

async readTags(): Promise<string[]> {
  try {
    const fh = await this.rootHandle.getFileHandle('.gameplay-tags.json');
    const file = await fh.getFile();
    return JSON.parse(await file.text()).tags ?? [];
  } catch (e: any) {
    if (e?.name === 'NotFoundError') return [];
    throw e;
  }
}

async readAssetRefs(): Promise<Record<string, string>> {
  try {
    const fh = await this.rootHandle.getFileHandle('.asset-refs.json');
    const file = await fh.getFile();
    return JSON.parse(await file.text()).expected_guids ?? {};
  } catch (e: any) {
    if (e?.name === 'NotFoundError') return {};
    throw e;
  }
}
```

- [ ] **Step 4: Run tests; verify PASS**

```
npm test
```

- [ ] **Step 5: Commit**

```
git add web/src/persistence/dataSource.ts web/tests/dataSource.test.ts
git commit -m "feat(dataSource): readCatalog + readTags + readAssetRefs"
```

### Task 5.2: `gameplayTagStore` (TDD)

**Files:**
- Create: `web/src/store/gameplayTagStore.ts`
- Create: `web/tests/gameplayTagStore.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// web/tests/gameplayTagStore.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTagTree, isTagOrChild } from '../src/store/gameplayTagStore';

test('buildTagTree groups by dot', () => {
  const tree = buildTagTree(['A.B', 'A.C.D', 'A.C.E', 'X']);
  assert.deepEqual(Object.keys(tree).sort(), ['A', 'X']);
  assert.deepEqual(Object.keys(tree.A.children).sort(), ['B', 'C']);
  assert.deepEqual(Object.keys(tree.A.children.C.children).sort(), ['D', 'E']);
});

test('isTagOrChild: exact match', () => {
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Tile.Biome.Bathroom'), true);
});

test('isTagOrChild: child of parent', () => {
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Tile.Biome'), true);
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Tile'), true);
});

test('isTagOrChild: unrelated', () => {
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Entity'), false);
});

test('isTagOrChild: prefix-only-not-tag-child', () => {
  // "Tile.B" is a string prefix of "Tile.Biome" but not its tag parent.
  assert.equal(isTagOrChild('Tile.Biome', 'Tile.B'), false);
});
```

- [ ] **Step 2: Run; verify FAIL**

```
npm test
```

- [ ] **Step 3: Implement `src/store/gameplayTagStore.ts`**

```ts
import { create } from 'zustand';

export type TagNode = {
  name: string;
  fullName: string;
  children: Record<string, TagNode>;
};

export function buildTagTree(tags: string[]): Record<string, TagNode> {
  const root: Record<string, TagNode> = {};
  for (const tag of tags) {
    const parts = tag.split('.');
    let cursor = root;
    let full = '';
    for (const part of parts) {
      full = full ? `${full}.${part}` : part;
      if (!cursor[part]) {
        cursor[part] = { name: part, fullName: full, children: {} };
      }
      cursor = cursor[part].children;
    }
  }
  return root;
}

export function isTagOrChild(candidate: string, parent: string): boolean {
  if (candidate === parent) return true;
  return candidate.startsWith(parent + '.');
}

type State = {
  tags: string[];
  tree: Record<string, TagNode>;
  loaded: boolean;
  load: (tags: string[]) => void;
};

export const useGameplayTagStore = create<State>((set) => ({
  tags: [],
  tree: {},
  loaded: false,
  load: (tags: string[]) => set({
    tags: [...tags].sort(),
    tree: buildTagTree(tags),
    loaded: true,
  }),
}));
```

- [ ] **Step 4: Wire the load into `definitionsStore.ts`** — wherever the bundled defaults / picked-folder load completes, also call:

```ts
import { useGameplayTagStore } from './gameplayTagStore';
const tags = await get().dataSource!.readTags();
useGameplayTagStore.getState().load(tags);
```

Put it next to where `class-hierarchy.json` and `property-meta.json` get loaded.

- [ ] **Step 5: Run tests; verify PASS**

```
npm test
```

- [ ] **Step 6: Commit**

```
git add web/src/store/gameplayTagStore.ts web/tests/gameplayTagStore.test.ts \
        web/src/store/definitionsStore.ts
git commit -m "feat(store): gameplayTagStore loads .gameplay-tags.json eagerly"
```

### Task 5.3: `assetCatalogStore` (TDD)

**Files:**
- Create: `web/src/store/assetCatalogStore.ts`
- Create: `web/tests/assetCatalogStore.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// web/tests/assetCatalogStore.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAssetCatalogStore } from '../src/store/assetCatalogStore';
import type { DataSource, AssetCatalog } from '../src/persistence/dataSource';

function mockDataSource(catalog: AssetCatalog | null): DataSource {
  return {
    kind: 'http', readOnly: true, displayName: 'mock',
    readManifest: async () => ({ folders: [], files: [] }),
    readFile: async () => '',
    readProjectMeta: async () => null,
    readCatalog: async (cls) => (catalog && catalog.class === cls ? catalog : null),
    readTags: async () => [],
    readAssetRefs: async () => ({}),
  };
}

test('loadCatalog memoizes', async () => {
  const cat: AssetCatalog = {
    schema_version: 1, class: 'StaticMesh',
    entries: [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' }],
  };
  let calls = 0;
  const ds: DataSource = { ...mockDataSource(cat), readCatalog: async (cls) => { calls++; return cls === 'StaticMesh' ? cat : null; } };
  const store = useAssetCatalogStore.getState();
  store.setDataSource(ds);
  await store.loadCatalog('StaticMesh');
  await store.loadCatalog('StaticMesh');
  assert.equal(calls, 1);
});

test('lookupByPath returns entry', async () => {
  const cat: AssetCatalog = {
    schema_version: 1, class: 'StaticMesh',
    entries: [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' }],
  };
  const store = useAssetCatalogStore.getState();
  store.setDataSource(mockDataSource(cat));
  await store.loadCatalog('StaticMesh');
  const e = store.lookupByPath('StaticMesh', '/Game/A.A');
  assert.equal(e?.package_guid, 'AAAA');
});

test('missing catalog marked', async () => {
  const store = useAssetCatalogStore.getState();
  store.setDataSource(mockDataSource(null));
  const out = await store.loadCatalog('NoSuchClass');
  assert.deepEqual(out, []);
  assert.equal(store.catalogs.NoSuchClass, 'missing');
});
```

- [ ] **Step 2: Run; verify FAIL**

```
npm test
```

- [ ] **Step 3: Implement `src/store/assetCatalogStore.ts`**

```ts
import { create } from 'zustand';
import type { DataSource, AssetCatalog, AssetCatalogEntry } from '../persistence/dataSource';

type Status = AssetCatalogEntry[] | 'loading' | 'missing';

type State = {
  dataSource: DataSource | null;
  catalogs: Record<string, Status>;
  inflight: Record<string, Promise<AssetCatalogEntry[]>>;
  setDataSource: (ds: DataSource) => void;
  loadCatalog: (className: string) => Promise<AssetCatalogEntry[]>;
  lookupByPath: (className: string, path: string) => AssetCatalogEntry | null;
  lookupByGuid: (className: string, guid: string) => AssetCatalogEntry | null;
};

export const useAssetCatalogStore = create<State>((set, get) => ({
  dataSource: null,
  catalogs: {},
  inflight: {},

  setDataSource: (ds) => set({ dataSource: ds, catalogs: {}, inflight: {} }),

  loadCatalog: async (className) => {
    const cached = get().catalogs[className];
    if (Array.isArray(cached)) return cached;
    if (cached === 'missing') return [];
    const inflight = get().inflight[className];
    if (inflight) return inflight;

    const ds = get().dataSource;
    if (!ds) return [];

    set((s) => ({ catalogs: { ...s.catalogs, [className]: 'loading' } }));
    const promise = (async () => {
      const cat = await ds.readCatalog(className);
      if (!cat) {
        set((s) => ({
          catalogs: { ...s.catalogs, [className]: 'missing' },
          inflight: { ...s.inflight, [className]: undefined as any },
        }));
        return [];
      }
      set((s) => ({
        catalogs: { ...s.catalogs, [className]: cat.entries },
        inflight: { ...s.inflight, [className]: undefined as any },
      }));
      return cat.entries;
    })();
    set((s) => ({ inflight: { ...s.inflight, [className]: promise } }));
    return promise;
  },

  lookupByPath: (className, path) => {
    const cached = get().catalogs[className];
    if (!Array.isArray(cached)) return null;
    return cached.find((e) => e.path === path) ?? null;
  },

  lookupByGuid: (className, guid) => {
    const cached = get().catalogs[className];
    if (!Array.isArray(cached)) return null;
    return cached.find((e) => e.package_guid === guid) ?? null;
  },
}));
```

- [ ] **Step 4: Wire `setDataSource` into definitionsStore** — call `useAssetCatalogStore.getState().setDataSource(ds)` right after the dataSource is assigned in any of the load entrypoints (`openProject`, `pickDirectory`, `loadBundledDefaults`).

- [ ] **Step 5: Run tests; verify PASS**

```
npm test
```

- [ ] **Step 6: Commit**

```
git add web/src/store/assetCatalogStore.ts web/tests/assetCatalogStore.test.ts \
        web/src/store/definitionsStore.ts
git commit -m "feat(store): assetCatalogStore lazy-loads per-class catalogs"
```

---

## Phase 6: Editor pickers

### Task 6.1: `StructRows` recursive expansion

**Files:**
- Create: `web/src/components/StructRows.tsx`
- Modify: `web/src/components/TypedValueEditor.tsx`

- [ ] **Step 1: Find the existing `StructEditor`** in `TypedValueEditor.tsx` (around line 749). Use it as a starting point — the new `StructRows` is the recursive variant for arbitrary nested structs (FTransform, AudioConfig, FurnitureLightConfig…). Note: `SmartEffectsView` keeps its special-case branch above the new dispatch.

- [ ] **Step 2: Create `StructRows.tsx`**

```tsx
import { useState } from 'react';
import { TypedField, type FieldProps } from './TypedValueEditor';

export function StructRows(props: FieldProps) {
  const { typed, onChange, label } = props;
  const [open, setOpen] = useState(true);
  const fields: Record<string, any> = (typed.value && typeof typed.value === 'object') ? typed.value : {};
  const structName = typed.struct_name ?? 'Struct';

  const setField = (key: string, next: any) => {
    onChange({ ...typed, value: { ...fields, [key]: next } });
  };

  return (
    <div className="def-field def-type-color-struct">
      <div className="def-field-head" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <span className="def-chevron">{open ? '▾' : '▸'}</span>
        <span className="def-field-label">{label}</span>
        <span className="def-field-type">struct · {structName}</span>
      </div>
      {open && (
        <div className="def-struct-body">
          {Object.keys(fields).sort().map((key) => (
            <TypedField
              key={key}
              {...props}
              label={key}
              typed={fields[key]}
              onChange={(next) => setField(key, next)}
              propertyName={`${props.propertyName ?? ''}.${key}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: In `TypedField` dispatch**, swap the generic struct branch:

```tsx
    case 'struct':
      if (typed?.struct_name === 'GameplayEffectsToApply') {
        return (
          <SmartEffectsView envelope={typed} onChange={(next) => props.onChange(next)} />
        );
      }
      return <StructRows {...props} />;
```

Delete `StructEditor` if nothing else references it (grep first — there are sub-views that may still call it). If kept, leave it as a fallback for the legacy code path and rename to `LegacyStructEditor` to clarify intent.

- [ ] **Step 4: Run type check and tests**

```
npm run typecheck
npm test
```

- [ ] **Step 5: Sanity-check in the dev server**

```
npm run dev
```

Open a furniture definition that now has an `audio_config` struct (after Phase 1's re-export). Confirm it shows as a collapsible row with nested sub-fields.

- [ ] **Step 6: Commit**

```
git add web/src/components/StructRows.tsx web/src/components/TypedValueEditor.tsx
git commit -m "feat(editor): StructRows recursively expands nested struct envelopes"
```

### Task 6.2: `TagPicker`

**Files:**
- Create: `web/src/components/pickers/TagPicker.tsx`
- Modify: `web/src/components/TypedValueEditor.tsx`

- [ ] **Step 1: Build `TagPicker.tsx`** — input + filtered dropdown of every tag from `gameplayTagStore`, with chip display for selected tags. Single-tag mode and container mode are the same component with a `multi` boolean.

```tsx
import { useMemo, useRef, useState } from 'react';
import { useGameplayTagStore } from '../../store/gameplayTagStore';

type Props = {
  multi: boolean;
  value: string | string[];
  onChange: (next: string | string[]) => void;
};

export function TagPicker({ multi, value, onChange }: Props) {
  const tags = useGameplayTagStore((s) => s.tags);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected: string[] = multi
    ? (Array.isArray(value) ? value : [])
    : (typeof value === 'string' && value ? [value] : []);

  const filtered = useMemo(() => {
    const lc = q.toLowerCase();
    return tags.filter((t) => t.toLowerCase().includes(lc) && !selected.includes(t)).slice(0, 30);
  }, [tags, q, selected]);

  const add = (tag: string) => {
    if (multi) onChange([...selected, tag]);
    else onChange(tag);
    setQ('');
    setOpen(false);
  };

  const remove = (tag: string) => {
    if (multi) onChange(selected.filter((t) => t !== tag));
    else onChange('');
  };

  return (
    <div className="tagpicker">
      <div className="tagpicker-chips">
        {selected.map((t) => (
          <span key={t} className="tagpicker-chip">
            {t}
            <button type="button" onClick={() => remove(t)}>×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={q}
        placeholder={multi ? 'Add tag…' : (selected[0] ? '' : 'Select tag…')}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered[0]) { e.preventDefault(); add(filtered[0]); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="tagpicker-menu">
          {filtered.map((t) => (
            <li key={t} onMouseDown={(e) => { e.preventDefault(); add(t); }}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire dispatch in `TypedField`**

```tsx
    case 'gameplay_tag':
      return (
        <PrimitiveRow {...props}>
          <TagPicker multi={false} value={typed.value ?? ''} onChange={(v) => props.onChange({ ...typed, value: v })} />
        </PrimitiveRow>
      );
    case 'gameplay_tag_container':
      return (
        <div className="def-field def-type-color-tag">
          <FieldHead label={props.label} type={`gameplay_tag_container · ${(typed.value ?? []).length}`} propertyName={props.propertyName} pinAdapter={props.pinAdapter} meta={null}/>
          <TagPicker multi={true} value={typed.value ?? []} onChange={(v) => props.onChange({ ...typed, value: v })} />
        </div>
      );
```

Remove the old `GameplayTagEditor` and `GameplayTagContainerEditor` if no other component imports them; otherwise mark them deprecated.

- [ ] **Step 3: Add minimal CSS** for `.tagpicker*` classes in `web/src/index.css` (or wherever the existing `.def-*` classes live). Match the visual weight of the existing field rows.

- [ ] **Step 4: Run type check + tests**

```
npm run typecheck
npm test
```

- [ ] **Step 5: Sanity-check in dev server.** Open a definition with `gameplay_tags`, edit a tag, save. Confirm round-trip via reload.

- [ ] **Step 6: Commit**

```
git add web/src/components/pickers/TagPicker.tsx \
        web/src/components/TypedValueEditor.tsx \
        web/src/index.css
git commit -m "feat(editor): TagPicker replaces free-text gameplay-tag inputs"
```

### Task 6.3: `AssetRefPicker`

**Files:**
- Create: `web/src/components/pickers/AssetRefPicker.tsx`
- Modify: `web/src/components/TypedValueEditor.tsx`

- [ ] **Step 1: Build the picker**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useAssetCatalogStore } from '../../store/assetCatalogStore';
import { useDefinitionsStore } from '../../store/definitionsStore';

type Props = {
  className: string;
  value: string | null;
  onChange: (next: string | null) => void;
};

export function AssetRefPicker({ className, value, onChange }: Props) {
  const loadCatalog = useAssetCatalogStore((s) => s.loadCatalog);
  const entries = useAssetCatalogStore((s) => {
    const c = s.catalogs[className];
    return Array.isArray(c) ? c : [];
  });
  const dataSourceBase = useDefinitionsStore((s) => s.dataSource?.kind === 'http' ? '/starter-project' : '');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => { loadCatalog(className); }, [className, loadCatalog]);

  const filtered = useMemo(() => {
    const lc = q.toLowerCase();
    return entries.filter((e) => e.path.toLowerCase().includes(lc) || e.name.toLowerCase().includes(lc)).slice(0, 50);
  }, [entries, q]);

  const current = value ? entries.find((e) => e.path === value) : null;

  return (
    <div className="assetrefpicker">
      <button type="button" className="assetrefpicker-trigger" onClick={() => setOpen((o) => !o)}>
        {current?.thumbnail && dataSourceBase
          ? <img className="assetrefpicker-thumb" src={`${dataSourceBase}/${current.thumbnail}`} alt="" />
          : <span className="assetrefpicker-noimg">[{className}]</span>}
        <span className="assetrefpicker-label">{value ? (current?.name ?? value) : '(none)'}</span>
        {value && (
          <button type="button" className="danger assetrefpicker-clear"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}>×</button>
        )}
      </button>
      {open && (
        <div className="assetrefpicker-pop">
          <input
            type="text" autoFocus value={q}
            placeholder={`Search ${className}…`}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="assetrefpicker-list">
            {filtered.map((e) => (
              <li key={e.path} onClick={() => { onChange(e.path); setOpen(false); }}>
                {e.thumbnail && dataSourceBase && <img src={`${dataSourceBase}/${e.thumbnail}`} alt="" />}
                <span>{e.name}</span>
                <code>{e.folder}</code>
              </li>
            ))}
            {filtered.length === 0 && <li className="assetrefpicker-empty">no matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire dispatch** — add the `soft_asset_ref` case in `TypedField`:

```tsx
    case 'soft_asset_ref':
      return (
        <PrimitiveRow {...props}>
          <AssetRefPicker
            className={(typed as any).class}
            value={typed.value ?? null}
            onChange={(v) => props.onChange({ ...typed, value: v })}
          />
        </PrimitiveRow>
      );
```

- [ ] **Step 3: Add CSS** for `.assetrefpicker*` classes mirroring the existing component spacing.

- [ ] **Step 4: Run type check + tests**

```
npm run typecheck
npm test
```

- [ ] **Step 5: Dev-server sanity check.** Open `FD_Door.json` (which now has `static_mesh`). Confirm the picker opens, searches, lists `/Game/Furniture/...` mesh paths, and the dropdown round-trips on save.

- [ ] **Step 6: Commit**

```
git add web/src/components/pickers/AssetRefPicker.tsx \
        web/src/components/TypedValueEditor.tsx \
        web/src/index.css
git commit -m "feat(editor): AssetRefPicker for soft_asset_ref envelopes"
```

---

## Phase 7: Drift detection

### Task 7.1: Extend `DriftIssue` + validator (TDD)

**Files:**
- Modify: `web/src/persistence/schemaDriftValidator.ts`
- Modify: `web/tests/schemaDriftValidator.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
test('drift: missing-asset-ref when path not in catalog', () => {
  const defs = new Map([['FD_X', {
    json: { class: 'UFurnitureDefinition', properties: {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/Missing.SM_Missing' }
    }}, dirty: false,
  }]]);
  const issues = validateAssetRefs(defs, /* catalog */ new Map(), /* expected */ {});
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'missing-asset-ref');
  assert.equal(issues[0].path, '/Game/Missing.SM_Missing');
});

test('drift: asset-ref-guid-mismatch when expected ≠ current', () => {
  const defs = new Map([['FD_X', {
    json: { class: 'UFurnitureDefinition', properties: {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/A.A' }
    }}, dirty: false,
  }]]);
  const catalog = new Map([['StaticMesh',
    [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'BBBB' }]]]);
  const expected = { '/Game/A.A': 'AAAA' };
  const issues = validateAssetRefs(defs, catalog, expected);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'asset-ref-guid-mismatch');
});

test('drift: no issue when guids match', () => {
  const defs = new Map([['FD_X', {
    json: { class: 'UFurnitureDefinition', properties: {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/A.A' }
    }}, dirty: false,
  }]]);
  const catalog = new Map([['StaticMesh',
    [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' }]]]);
  const expected = { '/Game/A.A': 'AAAA' };
  const issues = validateAssetRefs(defs, catalog, expected);
  assert.deepEqual(issues, []);
});
```

- [ ] **Step 2: Run; verify FAIL** (`validateAssetRefs` doesn't exist yet).

- [ ] **Step 3: Extend `DriftIssue` union**

```ts
export type DriftIssue =
  | { recordKey: DefinitionsKey; kind: 'unknown-class'; className: string }
  | { recordKey: DefinitionsKey; kind: 'unknown-property'; parentType: string; propertyName: string }
  | { recordKey: DefinitionsKey; kind: 'missing-asset-ref'; path: string; assetClass: string }
  | { recordKey: DefinitionsKey; kind: 'asset-ref-guid-mismatch'; path: string; assetClass: string; expectedGuid: string; currentGuid: string };
```

- [ ] **Step 4: Add `validateAssetRefs`** in `schemaDriftValidator.ts`:

```ts
function* iterEnvelopes(value: any): Generator<any> {
  if (value && typeof value === 'object') {
    if ('type' in value) {
      yield value;
      const inner = value.value;
      if (inner && (typeof inner === 'object')) yield* iterEnvelopes(inner);
    } else if (Array.isArray(value)) {
      for (const v of value) yield* iterEnvelopes(v);
    } else {
      for (const v of Object.values(value)) yield* iterEnvelopes(v);
    }
  }
}

export function validateAssetRefs(
  defs: Map<DefinitionsKey, DefinitionRecord>,
  catalogs: Map<string, AssetCatalogEntry[]>,
  expectedGuids: Record<string, string>,
): DriftIssue[] {
  const out: DriftIssue[] = [];
  for (const [key, rec] of defs) {
    const props = rec.json?.properties;
    if (!props) continue;
    for (const env of iterEnvelopes(props)) {
      if (env.type !== 'soft_asset_ref') continue;
      const path = env.value;
      if (!path) continue;
      const cls = env.class;
      const entries = catalogs.get(cls);
      const entry = entries?.find((e) => e.path === path);
      if (!entry) {
        out.push({ recordKey: key, kind: 'missing-asset-ref', path, assetClass: cls });
        continue;
      }
      const expected = expectedGuids[path];
      if (expected && expected !== entry.package_guid) {
        out.push({
          recordKey: key, kind: 'asset-ref-guid-mismatch', path, assetClass: cls,
          expectedGuid: expected, currentGuid: entry.package_guid,
        });
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: Run; verify PASS**

```
npm test
```

- [ ] **Step 6: Commit**

```
git add web/src/persistence/schemaDriftValidator.ts web/tests/schemaDriftValidator.test.ts
git commit -m "feat(drift): validateAssetRefs surfaces missing + guid-mismatch refs"
```

### Task 7.2: Run the new validator on load + show in LoadGate

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/src/components/LoadGate.tsx`

- [ ] **Step 1: Export `iterEnvelopes`** from `schemaDriftValidator.ts` (it's currently a private generator added in Task 7.1) so the load path can reuse it.

- [ ] **Step 2: In the load entrypoint of `definitionsStore.ts`**, after the existing drift pass that produces unknown-class / unknown-property issues, add this block before the `set({ loadGate: ... })` call:

```ts
import { useAssetCatalogStore } from './assetCatalogStore';
import { validateAssetRefs, iterEnvelopes } from '../persistence/schemaDriftValidator';
import type { AssetCatalogEntry } from '../persistence/dataSource';

// Collect every soft_asset_ref class name in the loaded definitions.
const refClasses = new Set<string>();
for (const [, rec] of get().definitions) {
  for (const env of iterEnvelopes(rec.json?.properties)) {
    if (env?.type === 'soft_asset_ref' && typeof env.class === 'string') {
      refClasses.add(env.class);
    }
  }
}

// Eagerly load the catalogs for those classes so the validator has them.
const catalogStore = useAssetCatalogStore.getState();
await Promise.all([...refClasses].map((c) => catalogStore.loadCatalog(c)));

const catalogsMap = new Map<string, AssetCatalogEntry[]>(
  [...refClasses].map((c) => {
    const v = catalogStore.catalogs[c];
    return [c, Array.isArray(v) ? v : []];
  }),
);
const expectedGuids = await get().dataSource!.readAssetRefs();
const refIssues = validateAssetRefs(get().definitions, catalogsMap, expectedGuids);

// Merge with the existing drift issues. The existing pass produced
// `issues` (or set `loadGate: null` if none). Combine them:
const combined = [...(get().loadGate?.issues ?? []), ...refIssues];
if (combined.length > 0) {
  set({ loadGate: { mode: 'drift', issues: combined } });
}
```

- [ ] **Step 3: Render the new kinds in `LoadGate.tsx`**

In the existing `gate.mode === 'drift'` JSX, extend the issue map:

In the issue list, add cases (note the new kinds have an `assetClass` and `path`, so cast accordingly — TypeScript narrowing on the discriminated union takes care of this):

```tsx
{i.kind === 'missing-asset-ref' && (
  <>Missing <code>{i.assetClass}</code> at <code>{i.path}</code> referenced by <code>{i.recordKey}</code></>
)}
{i.kind === 'asset-ref-guid-mismatch' && (
  <>
    <code>{i.path}</code> resolves to a different asset than recorded
    (expected <code>{i.expectedGuid.slice(0, 8)}</code>, found <code>{i.currentGuid.slice(0, 8)}</code>)
    — referenced by <code>{i.recordKey}</code>
  </>
)}
```

- [ ] **Step 4: Type check + tests**

```
npm run typecheck
npm test
```

- [ ] **Step 5: Sanity check — manually break a path** in `public/starter-project/.asset-refs.json` (or the picked-folder copy), reload, confirm the LoadGate appears with the new kind.

- [ ] **Step 6: Commit**

```
git add web/src/store/definitionsStore.ts web/src/components/LoadGate.tsx
git commit -m "feat(LoadGate): surface missing-asset-ref + asset-ref-guid-mismatch drift"
```

---

## Phase 8: Thumbnails (best-effort)

Thumbnails are nice-to-have for `AssetRefPicker`. If the Lua thumbnail extraction doesn't work cleanly in your Unreal version, skip this phase and ship without thumbnails — the picker already falls back to a `[ClassName]` label.

### Task 8.1: Extract and write thumbnails

**Files:**
- Modify: `Tools/Export/extract.lua`

- [ ] **Step 1: For each StaticMesh and MaterialInterface row already being emitted, fetch the saved thumbnail.** Approach depends on the available bindings:
  - `UThumbnailManager::Get().GetSharedThumbnailPool()` — C++ only.
  - Python bindings exist in newer UE: `unreal.ToolMenus.get` won't help, but `unreal.AssetThumbnail` may.
  - Most reliable Lua path: spawn a Python subprocess that imports `unreal` and writes PNGs.

  Pick the lowest-friction option and document it inline in `extract.lua`. If none works, write a single placeholder `<OUT>/.thumbnails/UNAVAILABLE.png` and short-circuit — picker handles `thumbnail: null` fine.

- [ ] **Step 2: For each successful extraction, write `intermediate/thumbnails/<Class>/<Name>.png`** plus stamp the hash in the matching row's `thumbnail` and `thumbnail_hash` fields. On rerun, skip when the hash matches and the file exists.

- [ ] **Step 3: Mirror through the existing sync in Phase 4** — `web/scripts/sync-base-definitions.mjs` already has the conditional `.thumbnails/` copy block (added in Task 4.1).

- [ ] **Step 4: Verify in the editor.** Open a furniture with a `static_mesh` ref — the `AssetRefPicker` should render the thumbnail.

- [ ] **Step 5: Commit (if implemented)**

```
git add Tools/Export/extract.lua Tools/Export/test-output/Definitions/.thumbnails \
        web/public/starter-project/.thumbnails
git commit -m "feat(exporter): emit per-asset thumbnails for meshes + materials"
```

---

## Phase 9: Smoke tests

### Task 9.1: Extend `data-smoke.mjs` for refs and tags

**Files:**
- Modify: `web/data-smoke.mjs`

- [ ] **Step 1: After the existing cross-ref walk, add**:

```js
// Asset catalogs + tags cross-check
const catalogDir = join(ROOT, '.assets');
const catalogs = new Map();
if (existsSync(catalogDir)) {
  for (const file of await readdir(catalogDir)) {
    if (!file.endsWith('.json')) continue;
    const cls = file.replace(/\.json$/, '');
    const payload = JSON.parse(await readFile(join(catalogDir, file), 'utf8'));
    catalogs.set(cls, new Set(payload.entries.map((e) => e.path)));
  }
}
const tagFile = join(ROOT, '.gameplay-tags.json');
const tagSet = existsSync(tagFile)
  ? new Set(JSON.parse(await readFile(tagFile, 'utf8')).tags ?? [])
  : new Set();

function* envelopes(v) {
  if (v && typeof v === 'object') {
    if ('type' in v) {
      yield v;
      if (v.value && typeof v.value === 'object') yield* envelopes(v.value);
    } else if (Array.isArray(v)) for (const x of v) yield* envelopes(x);
    else for (const x of Object.values(v)) yield* envelopes(x);
  }
}

let unresolvedRefs = 0, unknownTags = 0;
for (const { folder, id, json } of byId.values()) {
  for (const env of envelopes(json.properties)) {
    if (env.type === 'soft_asset_ref' && env.value) {
      const known = catalogs.get(env.class)?.has(env.value);
      if (!known) { unresolvedRefs++; fail(`${folder}/${id}: unresolved ${env.class} ref ${env.value}`); }
    }
    if (env.type === 'gameplay_tag' && env.value) {
      if (!tagSet.has(env.value)) { unknownTags++; fail(`${folder}/${id}: unknown tag ${env.value}`); }
    }
    if (env.type === 'gameplay_tag_container' && Array.isArray(env.value)) {
      for (const t of env.value) {
        if (!tagSet.has(t)) { unknownTags++; fail(`${folder}/${id}: unknown tag ${t}`); }
      }
    }
  }
}
console.log(`[data-smoke] ${unresolvedRefs} unresolved soft asset refs, ${unknownTags} unknown tags`);
```

- [ ] **Step 2: Run**

```
npm run data-smoke
```

Expected: zero unresolved refs and zero unknown tags (or, if there are some, they reveal real export bugs to fix before declaring done).

- [ ] **Step 3: Commit**

```
git add web/data-smoke.mjs
git commit -m "test(data-smoke): cross-check soft asset refs + tags against catalogs/tag list"
```

### Task 9.2: Playwright round-trip for `AudioConfig`

**Files:**
- Modify: `web/savedload-ui-smoke.mjs`

- [ ] **Step 1: Add a scenario** that opens a furniture definition known to have an `audio_config` struct after the new export, expands it, changes the `open_sound` `soft_asset_ref` to another value via the dropdown, clicks Save (no-op for read-only starter — use the FSA picked-folder path that the existing smoke already exercises), reloads, and asserts the new value persisted.

The existing file `savedload-ui-smoke.mjs` already drives Playwright; copy its scenario shape. Use the bundled-starter project's `FD_Door.json` (now with `audio_config` populated) as the target. Don't bother with a brand-new fixture asset.

- [ ] **Step 2: Run**

```
npm run smoke:savedload
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add web/savedload-ui-smoke.mjs
git commit -m "test(smoke): savedload covers AudioConfig nested soft_asset_ref round-trip"
```

---

## Final verification

- [ ] **Run the full gate**

```
cd Tools/Export && pytest
cd ../../web && npm run typecheck && npm test && npm run data-smoke && npm run build && npm run smoke
```

Expected: all green.

- [ ] **Mark this plan complete** — there is no separate completion commit; the final phase's commits close out the work.

---

## Spec coverage check (self-review)

| Spec section | Plan task |
|---|---|
| Strip-list removal | Task 1.2 |
| Encoding rules — `soft_asset_ref` | Task 1.2 |
| Encoding rules — `FTransform`, `FVector`, generic struct round-trip | Task 1.4 |
| `lib/asset_catalog_dumper.py` (asset catalog dumper) | Tasks 2.1 (Lua walk) + 2.2 (offline dumper) + 2.3 (orchestrator) |
| Catalog payload — path/name/folder/package_guid/bounds | Tasks 2.1 + 2.2 |
| Catalog payload — thumbnail | Phase 8 |
| `.asset-refs.json` drift sidecar | Tasks 3.2 + 3.3 |
| Tag dumper population | Task 3.1 |
| Manifest extension | Task 3.4 |
| `assetCatalogStore` | Task 5.3 |
| `gameplayTagStore` | Task 5.2 |
| `TypedValueEditor` dispatch (`soft_asset_ref`, tag, struct) | Tasks 6.1, 6.2, 6.3 |
| `AssetRefPicker` | Task 6.3 |
| `TagPicker` | Task 6.2 |
| `StructRows` recursive expansion | Task 6.1 |
| Drift / tamper detection — `missing-asset-ref` + `asset-ref-guid-mismatch` | Tasks 7.1 + 7.2 |
| Out of scope items (modal picker, bulk find-and-replace, GUID loader) | not in plan, by design |
