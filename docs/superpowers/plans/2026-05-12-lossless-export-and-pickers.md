# Lossless Export, Asset Catalogs, and Catalog-Backed Pickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-12-lossless-export-and-pickers-design.md`

**Goal:** Stop the JSON exporter from stripping asset refs and engine structs, emit per-class asset catalogs and a populated gameplay-tag list, wire catalog-backed pickers into the editor's typed view, and add tamper-detection drift for asset refs.

**Architecture:** Two cooperating layers. The Python exporter (`Tools/Export/run_export.py`, runs inside Unreal) emits lossless typed-envelope JSON plus catalog sidecars. The web editor (`tsic-definition-editor/web/`) gains two zustand stores and three new components consumed by `TypedValueEditor`. All existing tabs benefit because they consume `TypedValueEditor`. The dormant offline pipeline (`extract.lua` + `export_definitions.py` + `lib/property_normalizer.py`) is explicitly out of scope (Phase 0).

**Tech Stack:** Python 3.11+ with pytest (`Tools/Export/pyproject.toml`); Unreal Python API + Lua MCP (`extract.lua`); TypeScript + React + zustand + Node 22 `node:test` (web).

**Commit policy:** Commit at the end of every Task (the "Commit" step in each). A clean tree at task boundaries lets the user roll back any single phase. The repo was confirmed clean before this plan started.

---

## Background — two exporters, only one is active

`Tools/Export/` contains two implementations:

| Pipeline | Files | Output | Status |
|---|---|---|---|
| **In-editor Python** | `run_export.py` (one file, ~600 lines) | Typed envelopes (`{"type":"definition_ref","class":"...","value":"..."}`) | **Active** — produced the current `test-output/Definitions/` and the bundled defaults |
| **Lua + offline** | `extract.lua` → `intermediate/raw-export.json` → `export_definitions.py` + `lib/property_normalizer.py` + `lib/property_serializer.py` | Flat values (the serializer returns `"IRD_X"` strings, no envelope) | Dormant — the offline serializer's output shape doesn't match what the editor consumes |

**This plan modifies `run_export.py` only.** The offline pipeline is explicitly out of scope (Task 0). Any work to bring it back into alignment is a separate ticket.

## File Structure

**`Tools/Export/` (the active in-editor exporter):**

| File | Status | Responsibility |
|---|---|---|
| `run_export.py` | Modify | Delete `_ENGINE_ASSET_CLASS_NAMES` / `_ENGINE_STRUCT_NAMES`. Emit `soft_asset_ref` envelopes in the `unreal.Object` branch of `_normalize_value`. Drop the engine-struct early-return in the struct branch. Add the asset-registry walk + catalog write. Add the `.asset-refs.json` writer. Verify `GameplayTagsManager` tag enumeration. |
| `lib/asset_catalog_dumper.py` | Create | Pure helper: group catalog rows by class, sort by path, return per-class payloads. Imported by `run_export.py`. |
| `lib/asset_ref_index.py` | Create | Pure helper: walk emitted typed-envelope definitions, collect every `soft_asset_ref` path, look up its `package_guid` in the catalogs, return the `expected_guids` map. Imported by `run_export.py`. |
| `lib/manifest_builder.py` | Modify | Add `asset_catalogs`, `thumbnails_dir`, `has_asset_refs_sidecar` fields. |
| `tests/test_run_export.py` | Create | Unit tests for the new helpers extracted from `run_export.py` (any logic worth testing standalone — `_normalize_value` branches, `_strip_value` skeleton emission for `soft_asset_ref`, etc.). |
| `tests/test_asset_catalog_dumper.py` | Create | Idempotence + payload shape. |
| `tests/test_asset_ref_index.py` | Create | Builds `expected_guids` from a fixture catalog + fixture definitions. |
| `tests/test_manifest_builder.py` | Modify | Cover the new fields. |
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
| `src/components/TypedValueEditor.tsx` | Modify | Add `soft_asset_ref` case; route `gameplay_tag` / `gameplay_tag_container` to `TagPicker`; route `struct` to `StructRows` (preserving the `GameplayEffectsToApply` smart view); teach `ContainerEditor` how to mint a default `soft_asset_ref` envelope when "add element" is clicked on an array/set whose element type is `soft_asset_ref`. |
| `src/components/definitionsNaming.ts` | Modify | Revise `isNoisyProperty` so `static_mesh` / `audio_config` aren't hidden behind "Show all fields" by default. |
| `src/persistence/schemaDriftValidator.ts` | Modify | Extend `DriftIssue` union with `missing-asset-ref` and `asset-ref-guid-mismatch`. New validator pass. |
| `src/components/LoadGate.tsx` | Modify | Render the two new drift kinds in the existing drift overlay. |
| `src/store/definitionsStore.ts` | Modify | On load, read `.asset-refs.json` (if present) into store state for the drift pass. |
| `tests/gameplayTagStore.test.ts` | Create | Tree build, prefix matching. |
| `tests/assetCatalogStore.test.ts` | Create | Lazy load, lookup, guid mismatch. |
| `tests/schemaDriftValidator.test.ts` | Modify | Cover the new drift kinds. |
| `data-smoke.mjs` | Modify | Cross-check: every `soft_asset_ref` resolves in its catalog; every tag is in `.gameplay-tags.json`. |
| `savedload-ui-smoke.mjs` | Modify | Playwright scenario: expand an `AudioConfig`, change a `soft_asset_ref`, save, reload, assert persisted. |

---

## Phase 0: Mark the offline pipeline out of scope

The dormant offline pipeline (`export_definitions.py` + `lib/property_normalizer.py` + `lib/property_serializer.py`) emits flat values, not typed envelopes — its tests already enforce that. We don't bring it into alignment in this work; we just make sure nobody mistakes it for the active path.

### Task 0.1: README pointer and module deprecation note

**Files:**
- Modify: `Tools/Export/README.md` (top of file)
- Modify: `Tools/Export/HOW_TO_RUN.md` (top of file)
- Modify: `Tools/Export/export_definitions.py` (module docstring)
- Modify: `Tools/Export/lib/property_normalizer.py` (module docstring)
- Modify: `Tools/Export/lib/property_serializer.py` (module docstring)

- [ ] **Step 1: Add an at-the-top note in `README.md` and `HOW_TO_RUN.md`:**

```
> **Two exporter paths exist.** `run_export.py` (in-editor Python) is the
> active path — it produces the typed-envelope JSON the web editor consumes.
> The `extract.lua` + `export_definitions.py` offline pipeline emits a
> different (flat-value) shape and is currently dormant. Until it's
> realigned, run `run_export.py` from inside Unreal.
```

- [ ] **Step 2: Add a one-line deprecation note** to the module docstrings of `export_definitions.py`, `lib/property_normalizer.py`, and `lib/property_serializer.py`:

```python
"""...existing docstring...

DEPRECATED: This module is part of the offline pipeline, which is dormant
and emits a different JSON shape (flat values) than what the web editor
consumes. The active path is `run_export.py` (in-editor). Do not edit
this module as part of feature work targeting the editor.
"""
```

- [ ] **Step 3: Commit**

```
git add Tools/Export/README.md Tools/Export/HOW_TO_RUN.md \
        Tools/Export/export_definitions.py \
        Tools/Export/lib/property_normalizer.py \
        Tools/Export/lib/property_serializer.py
git commit -m "docs(exporter): flag offline pipeline as dormant; canonical path is run_export.py"
```

---

## Phase 1: Exporter — lossless property round-trip in `run_export.py`

`run_export.py:_normalize_value` (line ~172) already emits typed envelopes for primitives, tags, definition refs, enums, containers, and structs — it just has two strip rules that need to go and two new envelope branches to add.

The two strip rules:

- `_ENGINE_ASSET_CLASS_NAMES` / `_ENGINE_STRUCT_NAMES` (top of file) — referenced inside `_normalize_value`'s struct branch (line ~300) and `unreal.Object` branch (line ~287). Together they cause meshes / materials / `FTransform` / `FAudioConfig` etc. to be dropped.
- `_strip_value` (line ~320) — already-correct skeleton emission for container `element_type`; should "just work" for the new `soft_asset_ref` envelope once it carries `type` + `class`.

The two new branches:

- In the `unreal.Object` branch: when the target class is NOT a TSIC Definition class, emit a `soft_asset_ref` envelope instead of returning `None`.
- In the struct branch: remove the `_ENGINE_STRUCT_NAMES` early-return; let recursion handle every USTRUCT.

### Task 1.1: Round-trip tests for soft_asset_ref + struct (TDD)

**Files:**
- Modify: `Tools/Export/run_export.py` (remove bare `main()` call at bottom)
- Create: `Tools/Export/tests/test_run_export.py`

`run_export.py` currently has no dedicated test file because the legacy plan was to test via the offline pipeline. We're adding one that tests `_normalize_value`'s output shape directly using small UE mocks.

#### Prerequisite — remove the import-time `main()` call

The bottom of `run_export.py` currently has:

```python
if __name__ == "__main__":
    raise SystemExit(main())

# Allow running via ``execute_python(<this script>, mode='file')`` — the trailing
# call below executes when imported via exec/script invocation, not when imported
# as a module from the orchestrator.
main()
```

The trailing bare `main()` (line 574) fires on every `import run_export`, triggering the entire AssetRegistry walk. The comment above it is wrong — Python doesn't distinguish "exec/script invocation" from "module import"; both execute top-level statements. When the Lua MCP runs the file via `execute_python(code, mode='file')`, Python compiles it with `__name__ == "__main__"`, so the existing `if` block handles that case. The bare `main()` is vestigial and harmful for unit tests.

**Delete lines 571–574** (the comment block + the bare `main()` line). Keep the `if __name__ == "__main__":` guard.

Verify by running an export afterward (Task 1.3 covers this) — it should still produce identical output.

- [ ] **Step 1: Write the failing tests**

```python
# Tools/Export/tests/test_run_export.py
"""Unit tests for run_export._normalize_value.

We mock just enough of the `unreal` module surface that the function under
test can run. This lets us assert envelope shape without booting the editor.
"""
import sys
import types
import pytest


@pytest.fixture
def fake_unreal(monkeypatch):
    """Inject a minimal stand-in for the `unreal` module."""
    fake = types.ModuleType("unreal")

    class _UNameLike(str): pass
    class _UTextLike(str): pass
    class _UObject:
        def __init__(self, name, class_name, class_path="/Script/TSIC.Stub"):
            self._name = name
            self._cls = types.SimpleNamespace(
                get_name=lambda: class_name,
                get_path_name=lambda: class_path,
            )
        def get_name(self): return self._name
        def get_class(self): return self._cls

    class _EnumBase: pass

    fake.Name = _UNameLike
    fake.Text = _UTextLike
    fake.Object = _UObject
    fake.EnumBase = _EnumBase
    fake.GameplayTag = type("GameplayTag", (), {})
    fake.GameplayTagContainer = type("GameplayTagContainer", (), {})
    fake.log = lambda *a, **kw: None
    fake.log_warning = lambda *a, **kw: None

    monkeypatch.setitem(sys.modules, "unreal", fake)
    return fake


def _import_normalize(fake_unreal):
    """Re-import run_export with the mocked unreal in place."""
    sys.modules.pop("run_export", None)
    import run_export
    return run_export._normalize_value


def test_soft_asset_ref_unknown_class(fake_unreal):
    """Object ref whose class is not a Definition class should NOT be
    dropped — emit a soft_asset_ref envelope."""
    _normalize = _import_normalize(fake_unreal)
    obj = fake_unreal.Object(name="SM_Door", class_name="StaticMesh",
                              class_path="/Script/Engine.StaticMesh")
    out = _normalize(obj, definition_names_no_u={"FurnitureDefinition"})
    assert out["type"] == "soft_asset_ref"
    assert out["class"] == "StaticMesh"


def test_definition_ref_unchanged(fake_unreal):
    """Object ref to a Definition class still emits definition_ref."""
    _normalize = _import_normalize(fake_unreal)
    obj = fake_unreal.Object(name="FD_Door", class_name="FurnitureDefinition")
    out = _normalize(obj, definition_names_no_u={"FurnitureDefinition"})
    assert out == {
        "type": "definition_ref",
        "class": "FurnitureDefinition",
        "value": "FD_Door",
    }


def test_struct_engine_type_no_longer_dropped(fake_unreal):
    """An FTransform (or any USTRUCT previously in _ENGINE_STRUCT_NAMES) is
    no longer short-circuited to None."""
    _normalize = _import_normalize(fake_unreal)
    class _Transform:
        static_struct = lambda self: None
    t = _Transform()
    out = _normalize(t, definition_names_no_u=set())
    assert out is not None
    assert out["type"] == "struct"
    assert out["value"] == {}


def test_strip_value_passes_soft_asset_ref_metadata(fake_unreal):
    """_strip_value should preserve `class` on a soft_asset_ref skeleton."""
    sys.modules.pop("run_export", None)
    import run_export
    skel = run_export._strip_value({
        "type": "soft_asset_ref", "class": "StaticMesh",
        "value": "/Game/SM_Foo.SM_Foo",
    })
    assert skel == {"type": "soft_asset_ref", "class": "StaticMesh"}
```

- [ ] **Step 2: Run; verify FAIL**

```
cd Tools/Export
pytest tests/test_run_export.py -v
```

Expected: FAIL — `unreal.Object` branch currently returns `None` for non-Definition classes; the struct branch currently `return None`s when the class is in `_ENGINE_STRUCT_NAMES` or the field walker comes back empty.

- [ ] **Step 3: Commit the failing tests**

```
git add Tools/Export/tests/test_run_export.py
git commit -m "test(run_export): pending soft_asset_ref + struct round-trip cases"
```

### Task 1.2: Implement `soft_asset_ref` + drop engine-struct short-circuit

**Files:**
- Modify: `Tools/Export/run_export.py`

- [ ] **Step 1: Remove `_ENGINE_ASSET_CLASS_NAMES` and `_ENGINE_STRUCT_NAMES`** — the two frozensets at top of `run_export.py` (around line 55 and 74). Their only consumers are `_normalize_value` (the engine-struct early return) and the `unreal.Object` branch.

- [ ] **Step 2: Rewrite the `unreal.Object` branch** in `_normalize_value` (currently around line 273):

```python
    # Object reference: definition_ref for TSIC Definition classes,
    # soft_asset_ref for everything else.
    if isinstance(value, unreal.Object):
        cls = value.get_class()
        cls_path = cls.get_path_name()
        cls_name = cls.get_name()

        # Inside TSIC: definition_ref when the leaf class (or an ancestor)
        # is a known Definition class.
        if cls_path.startswith("/Script/TSIC."):
            if cls_name in definition_names_no_u:
                return {"type": "definition_ref", "class": cls_name, "value": value.get_name()}
            py = getattr(unreal, cls_name, None)
            if py is not None:
                for base in py.__mro__:
                    if base.__name__ in definition_names_no_u and base.__name__ not in {
                        "Object", "_ObjectBase", "_WrapperBase", "object", "DataAsset",
                    }:
                        return {"type": "definition_ref", "class": cls_name, "value": value.get_name()}

        # Everything else: soft_asset_ref. Path comes from the asset's
        # path name; the editor consumes this verbatim.
        try:
            path = value.get_path_name()
        except Exception:
            path = None
        return {
            "type": "soft_asset_ref",
            "class": cls_name,
            "value": path,
        }
```

- [ ] **Step 3: Rewrite the struct branch** (currently around line 297). Remove the `_ENGINE_STRUCT_NAMES` early return; recurse unconditionally:

```python
    # Struct - recurse into every UPROPERTY field. No class blocklist;
    # FTransform, FAudioConfig, FFurnitureLightConfig etc. all survive.
    if hasattr(value, "static_struct"):
        struct_cls_name = type(value).__name__
        field_names = _struct_field_names(value)
        out: dict[str, Any] = {}
        for field_name in field_names:
            try:
                field_val = value.get_editor_property(field_name)
            except Exception:
                continue
            sub = _normalize_value(field_val, definition_names_no_u, depth + 1)
            if sub is None:
                continue
            out[pascal_to_snake(field_name)] = sub
        return {"type": "struct", "struct_name": struct_cls_name, "value": out}
```

Second behavioral change: an empty struct no longer returns `None` — it returns `{"type": "struct", "struct_name": "X", "value": {}}`. The editor benefits because empty structs are still editable surfaces.

- [ ] **Step 4: Verify `_strip_value`** (around line 320) — it preserves `class`, `struct_name`, `enum_name`; the test from Task 1.1 covers `soft_asset_ref`. No code change expected.

- [ ] **Step 5: Run; verify PASS**

```
pytest tests/test_run_export.py -v
```

- [ ] **Step 6: Full exporter suite — no regressions**

```
pytest
```

Expected: PASS. The offline pipeline's tests should not be affected by `run_export.py` edits.

- [ ] **Step 7: Commit**

```
git add Tools/Export/run_export.py Tools/Export/tests/test_run_export.py
git commit -m "feat(run_export): emit soft_asset_ref + keep all USTRUCTs lossless"
```

### Task 1.3: Live re-export and diff

**Files:** none (verification).

`run_export.py` runs inside Unreal. Trigger via the editor's Python console:

```python
exec(open(r"C:/Users/Administrator/Documents/Unreal Projects/TSIC/Tools/Export/run_export.py").read())
```

- [ ] **Step 1: Run `run_export.py` from inside Unreal.** Output lands in `Tools/Export/test-output/Definitions/`.

- [ ] **Step 2: Spot-check the diffs**

```
cd "C:/Users/Administrator/Documents/Unreal Projects/TSIC"
git -C Tools/Export status
git -C Tools/Export diff test-output/Definitions/furniture_definitions/FD_Door.json | head -80
git -C Tools/Export diff test-output/Definitions/layout_definitions/LYD_Bathroom_All.json | head -120
```

Expected: `FD_Door.json` gains a `static_mesh` envelope and any `audio_config`/`light_config`/`vfx_config` struct from the source asset. `LYD_Bathroom_All.json` gains a `transform` field inside each `LayoutObject`.

- [ ] **Step 3: If the diff looks wrong, add a focused unit test in `tests/test_run_export.py` before retrying.** The diff is the source of truth.

- [ ] **Step 4: Commit the regenerated test-output**

```
git -C Tools/Export add test-output/
git -C Tools/Export commit -m "build(exporter): regenerate test-output with lossless property round-trip"
```

---

## Phase 2: Exporter — asset catalogs

### Task 2.1: In-editor catalog walk inside `run_export.py`

`run_export.py` already runs in the Unreal editor and has access to `unreal.AssetRegistryHelpers`. The asset-registry walk lives here — no `extract.lua` changes are needed.

**Files:**
- Modify: `Tools/Export/run_export.py`

- [ ] **Step 1: Collect referenced classes during the existing property walk.** As `_normalize_value` emits `soft_asset_ref` envelopes (Phase 1), record each `value["class"]` into a module-level set. The simplest path is a small `record_referenced_class(cls_name)` helper, called once from the new `soft_asset_ref` branch; the main `main()` reads the set after the walk completes.

- [ ] **Step 2: Build the catalog rows.** Add a helper near the bottom of `run_export.py`:

```python
def _collect_asset_catalog_rows(referenced_classes: set[str]) -> list[dict]:
    """For every referenced asset class, dump every asset of that class
    in /Game/. Returns the flat rows list consumed by
    lib.asset_catalog_dumper.build_catalogs."""
    rows: list[dict] = []
    if not referenced_classes:
        return rows

    asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()
    asset_registry.search_all_assets(True)

    for class_name in sorted(referenced_classes):
        # Build the class path. Engine classes are under /Script/Engine.
        # We rely on AssetRegistry's class filter rather than path-prefixing.
        ar_filter = unreal.ARFilter(
            class_names=[class_name],
            package_paths=["/Game"],
            recursive_paths=True,
        )
        try:
            assets = asset_registry.get_assets(ar_filter)
        except Exception as exc:
            unreal.log_warning(f"[catalog] AssetRegistry query failed for {class_name}: {exc}")
            continue

        for ad in assets:
            try:
                obj_path = str(ad.object_path)
                package_path = str(ad.package_path)
                asset_name = str(ad.asset_name)
                package_guid = ""
                pkg = ad.package_name
                try:
                    package = unreal.load_package(str(pkg)) if pkg else None
                    if package is not None:
                        # PackagePersistentGuid is exposed via the asset's
                        # `persistent_guid` editor property on newer UE versions;
                        # fall back to package_guid if not.
                        for attr in ("persistent_guid", "package_guid", "guid"):
                            if hasattr(package, attr):
                                package_guid = str(getattr(package, attr))
                                break
                except Exception:
                    pass

                row: dict[str, Any] = {
                    "class": class_name,
                    "path": obj_path,
                    "name": asset_name,
                    "folder": package_path,
                    "package_guid": package_guid,
                }

                # Mesh-only: include axis-aligned bounds.
                if class_name == "StaticMesh":
                    try:
                        mesh = ad.get_asset()
                        bbox = mesh.get_bounding_box()  # FBox
                        row["bounds"] = {
                            "min": [bbox.min.x, bbox.min.y, bbox.min.z],
                            "max": [bbox.max.x, bbox.max.y, bbox.max.z],
                        }
                    except Exception as exc:
                        unreal.log_warning(f"[catalog] bounds failed for {obj_path}: {exc}")

                rows.append(row)
            except Exception as exc:
                unreal.log_warning(f"[catalog] row build failed: {exc}")

    return rows
```

- [ ] **Step 3: Spot-check the AssetRegistry binding names.** Unreal's Python binding for `ARFilter` uses snake_case (`class_names`, `package_paths`, `recursive_paths`) in 5.x. If your version differs, the call signature in Step 2 needs adjusting. The two TSIC scripts that already use AssetRegistry are `extract.lua` (Lua-side) and `run_export.py:main` (around line 510 — search for `AssetRegistry`); copy their pattern.

- [ ] **Step 4: Write the rows.** In `main()`, after the per-asset walk but before the existing sidecar writes, call the helper and stash the rows for Phase 2.3 to consume:

```python
catalog_rows = _collect_asset_catalog_rows(REFERENCED_ASSET_CLASSES)
```

- [ ] **Step 5: Commit (Steps 1-4 together; nothing visible yet — Phase 2.3 wires the writer).**

```
git add Tools/Export/run_export.py
git commit -m "feat(run_export): collect referenced asset classes + walk registry"
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

### Task 2.3: Wire catalog dumper into `run_export.py`

**Files:**
- Modify: `Tools/Export/run_export.py`

- [ ] **Step 1: Import and call the dumper.** Near the top of `run_export.py`:

```python
from lib.asset_catalog_dumper import build_catalogs
```

- [ ] **Step 2: In `main()`, after the per-asset walk** (right after Step 4 from Task 2.1 produced `catalog_rows`):

```python
per_class = build_catalogs(
    catalog_rows,
    generated_at=generated_at,
    schema_version=SCHEMA_VERSION,
)
assets_dir = out_dir / ".assets"
assets_dir.mkdir(parents=True, exist_ok=True)
for cls, payload in per_class.items():
    _write_json(assets_dir / f"{cls}.json", payload)
```

- [ ] **Step 3: Re-run the in-editor exporter.** Trigger from Unreal's Python console:

```python
exec(open(r"C:/Users/Administrator/Documents/Unreal Projects/TSIC/Tools/Export/run_export.py").read())
```

Then verify:

```
ls "C:/Users/Administrator/Documents/Unreal Projects/TSIC/Tools/Export/test-output/Definitions/.assets"
```

Expected: at least `StaticMesh.json` and `Material.json` (others depending on what the project actually references). Each file contains `schema_version`, `class`, `entries`, the entries sorted by `path`, each with `package_guid`.

- [ ] **Step 4: Commit**

```
git -C Tools/Export add run_export.py test-output/
git -C Tools/Export commit -m "build(exporter): write .assets/<Class>.json sidecars"
```

---

## Phase 3: Tags, asset-refs sidecar, manifest extension

### Task 3.1: Verify and fix tag enumeration in `run_export.py`

**Files:**
- Modify: `Tools/Export/run_export.py`

- [ ] **Step 1: Re-run an export and inspect `.gameplay-tags.json`.** If `tags` is empty but tag *values* appear in the per-asset JSONs (as `gameplay_tag_container` values), the upstream enumeration via `unreal.GameplayTagsManager` came up empty. Check `run_export.py` around line ~533 (search for `GameplayTagsManager`).

- [ ] **Step 2: Add a backstop in `run_export.py`** so even if `GameplayTagsManager.request_all_gameplay_tags()` returns empty, the post-process collects every tag actually referenced by any emitted property and merges them in:

```python
def _walk_envelopes_for_tags(value: Any, out: set[str]) -> None:
    """Walk a typed-envelope value tree, collecting every tag string."""
    if not isinstance(value, dict):
        if isinstance(value, list):
            for item in value:
                _walk_envelopes_for_tags(item, out)
        return
    t = value.get("type")
    if t == "gameplay_tag":
        v = value.get("value")
        if isinstance(v, str) and v:
            out.add(v)
    elif t == "gameplay_tag_container":
        for v in value.get("value", []) or []:
            if isinstance(v, str) and v:
                out.add(v)
    # Recurse into struct/array/map/set/element_type payloads.
    inner = value.get("value")
    if inner is not None:
        _walk_envelopes_for_tags(inner, out)
    for child_key in ("element_type", "key_type", "value_type"):
        if child_key in value:
            _walk_envelopes_for_tags(value[child_key], out)


# In main(), right after the per-asset walk produces `emitted_assets`
# (the list of JSON dicts about to be written):
referenced_tags: set[str] = set()
for asset in emitted_assets:
    _walk_envelopes_for_tags(asset.get("properties"), referenced_tags)

merged_tags = sorted(set(all_tags) | referenced_tags)
tag_dump = build_tag_dump(merged_tags, generated_at=generated_at, schema_version=SCHEMA_VERSION)
```

- [ ] **Step 3: Re-run `run_export.py` from Unreal, confirm `.gameplay-tags.json` is no longer empty.**

```
python -c "import json; d=json.load(open('C:/Users/Administrator/Documents/Unreal Projects/TSIC/Tools/Export/test-output/Definitions/.gameplay-tags.json')); print(len(d['tags']), d['tags'][:5])"
```

Expected: a non-zero count and a sample of strings like `Entity.RandomGeneration.FurnitureType.Door`.

- [ ] **Step 4: Commit**

```
git -C Tools/Export add run_export.py test-output/Definitions/.gameplay-tags.json
git -C Tools/Export commit -m "fix(run_export): backfill gameplay tags from referenced values"
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

### Task 3.3: Wire the asset-refs sidecar into `run_export.py`

**Files:**
- Modify: `Tools/Export/run_export.py`

- [ ] **Step 1: After catalogs are written, build and write `.asset-refs.json`**

```python
from lib.asset_ref_index import build_asset_ref_index

# `emitted_assets` is the list of final per-asset dicts already in scope.
# `per_class` is the catalogs dict built in Task 2.3.
asset_ref_index = build_asset_ref_index(
    emitted_assets,
    per_class,
    generated_at=generated_at,
    schema_version=SCHEMA_VERSION,
)
_write_json(out_dir / ".asset-refs.json", asset_ref_index)
```

- [ ] **Step 2: Re-run `run_export.py` from Unreal, verify output**

```
python -c "import json; d=json.load(open('C:/Users/Administrator/Documents/Unreal Projects/TSIC/Tools/Export/test-output/Definitions/.asset-refs.json')); print(len(d['expected_guids']))"
```

Expected: non-zero (one entry per distinct soft asset ref encountered).

- [ ] **Step 3: Commit**

```
git -C Tools/Export add run_export.py test-output/
git -C Tools/Export commit -m "build(run_export): emit .asset-refs.json drift sidecar"
```

### Task 3.4: Manifest extension

**Files:**
- Modify: `Tools/Export/lib/manifest_builder.py`
- Modify: `Tools/Export/tests/test_manifest_builder.py`
- Modify: `Tools/Export/run_export.py`

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

- [ ] **Step 4: Pass them from `run_export.py:main()`** using the set of catalog files just written.

- [ ] **Step 5: Run tests; verify PASS**

```
pytest tests/test_manifest_builder.py -v
```

- [ ] **Step 6: Commit**

```
git add Tools/Export/lib/manifest_builder.py Tools/Export/tests/test_manifest_builder.py \
        Tools/Export/run_export.py \
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

### Task 6.4: Revise `isNoisyProperty` so new pickers aren't hidden by default

The existing hide rules drop any property whose name contains `audio`, `vfx`, `sound`, `mesh`, or `widget` (`web/src/components/definitionsNaming.ts:100`). With strip-nothing, `static_mesh` and `audio_config` get exported again — but the editor would hide them behind "Show all fields" until this rule is revised.

**Files:**
- Modify: `web/src/components/definitionsNaming.ts`

- [ ] **Step 1: Remove `mesh`, `audio`, `sound`, `vfx` from the `HIDDEN_SUBSTRINGS` list.** Keep `widget` (it covers UI plumbing that's still noise).

```ts
const HIDDEN_SUBSTRINGS = ['widget'];
```

- [ ] **Step 2: Run typecheck + dev server, open a furniture definition.** Confirm `static_mesh` and `audio_config` now appear in the default view (not hidden behind "Show all fields").

```
npm run typecheck
npm run dev
```

- [ ] **Step 3: Commit**

```
git add web/src/components/definitionsNaming.ts
git commit -m "fix(editor): surface mesh/audio/sound/vfx properties by default"
```

### Task 6.5: Default-value spawner for `soft_asset_ref` in `ContainerEditor`

Arrays/sets of `soft_asset_ref` (e.g., `TArray<TObjectPtr<UStaticMesh>>`) need a default element shape when the user clicks "add". Right now `ContainerEditor` only knows how to spawn primitives, definition refs, etc.

**Files:**
- Modify: `web/src/components/TypedValueEditor.tsx`

- [ ] **Step 1: Find `ContainerEditor` and its "add" handler.** It dispatches on the array's `element_type.type` to build the new element envelope.

- [ ] **Step 2: Add the `soft_asset_ref` arm:**

```ts
    case 'soft_asset_ref':
      return {
        type: 'soft_asset_ref',
        class: typed.element_type?.class ?? 'Object',
        value: null,
      };
```

Mirror the same logic in `MapEditor`'s key/value spawner if its key or value type can be `soft_asset_ref` (it usually isn't — Definition refs dominate as keys — but check the dispatch and add the case for symmetry).

- [ ] **Step 3: Typecheck + dev sanity.** Open a definition that has an array of soft asset refs, click "add", confirm a new entry appears with a working `AssetRefPicker`.

```
npm run typecheck
```

- [ ] **Step 4: Commit**

```
git add web/src/components/TypedValueEditor.tsx
git commit -m "feat(editor): ContainerEditor mints soft_asset_ref defaults on add"
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
| Mark offline pipeline out of scope | Task 0.1 |
| Strip-list removal | Task 1.2 |
| Encoding rules — `soft_asset_ref` | Task 1.2 |
| Encoding rules — `FTransform`, `FVector`, generic struct round-trip | Task 1.2 (recursion already in `_normalize_value`'s struct branch; strip removal is what unlocks it) |
| `lib/asset_catalog_dumper.py` (asset catalog dumper) | Tasks 2.1 (in-editor walk) + 2.2 (helper) + 2.3 (orchestrator) |
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
| Revise `isNoisyProperty` hide list | Task 6.4 |
| `ContainerEditor` default for soft_asset_ref | Task 6.5 |
| Drift / tamper detection — `missing-asset-ref` + `asset-ref-guid-mismatch` | Tasks 7.1 + 7.2 |

## Deliberately out of scope (callouts for future readers)

- **Modal "content browser"-style picker, bulk find-and-replace of asset refs, in-game GUID-based loading** — per the spec.
- **`referencedByIndex`** in `web/src/store/referencedByIndex.ts` deliberately stays scoped to `definition_ref`. Soft-asset-ref reverse lookups ("which definitions use SM_Door?") would be useful but are separate work; if you add them, they belong in a new index module rather than expanding the existing one (different lifetime — catalogs come and go independently of definitions).
- **Offline pipeline alignment** — `extract.lua` + `export_definitions.py` + `lib/property_normalizer.py` + `lib/property_serializer.py` emit flat values rather than typed envelopes. Bringing them into alignment with `run_export.py` is a separate ticket. Until then, Phase 0 deprecation notes are the only mark we leave on those files.
- **`scan_property_meta.py`** already walks every UPROPERTY in C++ headers regardless of what the exporter emits, so the per-property tooltips / clamp bounds / enum members will populate naturally for the now-surviving fields when a real project is loaded. No changes needed there.
