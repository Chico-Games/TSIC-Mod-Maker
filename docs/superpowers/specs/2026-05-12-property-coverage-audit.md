# Property Coverage Audit: lossless-export vs C++ UPROPERTY

**Date:** 2026-05-12
**Audited:** `Tools/Export/run_export.py` output in `Tools/Export/test-output/Definitions/` against `Source/TSIC/Public/DataAssets/**/*.h` UPROPERTY declarations.
**Method:** scripted regex scan of every `.h` file, joined with inheritance chain, diffed against the union of `properties` keys across every asset's JSON per leaf class. Uncertain cases probed live via the editor's `/eval` endpoint.

## Headline numbers

| Metric | Value |
|---|---|
| Header files scanned | 68 |
| UPROPERTY declarations across all `.h` files | 410 |
| Definition leaf classes audited | 36 |
| Expected unique properties across audited classes (with inheritance) | 1,229 |
| Surfaced in JSON | 740 (60%) |
| Missing | 489 (40%) |
| Leaf classes with full coverage | 9 |
| Leaf classes with at least one missing property | 27 |

The 40% miss rate is **dominated by one root cause** (next section) — most rows are not independent.

## Root cause: `dir(asset)` blind spot for non-BlueprintRead UPROPERTYs

`run_export.py::_normalize_asset` walks `dir(asset)` to find every UPROPERTY. UE's Python binding only includes a UPROPERTY in `dir()` when the property carries `BlueprintReadOnly` or `BlueprintReadWrite`. UPROPERTYs that are merely `EditAnywhere`/`EditDefaultsOnly` are invisible to `dir()` even though `get_editor_property("snake_case_name")` can still read them.

Of the 108 unique `(class, cpp_name)` missing pairs across the 36 leaf classes, **85 lack any `BlueprintReadOnly`/`BlueprintReadWrite` tag**. These are silent drops, not empty defaults.

### Live verification

Probed `FD_Windowframe_Constructed_DF` (`UDamageableFurnitureDefinition`) via `/eval`:

- `collision_box_data`: populated (`CBD_Windowframe_Constructed`) on the asset, **missing from JSON**
- `destructible_collection`: populated (`GCS_glass_window1`) on the asset, **missing from JSON**
- `building_base` (FTransform): populated on all 448 damageable furniture assets, **missing from every one of their JSONs**

Across the 448 damageable-furniture assets:
- `collision_box_data` populated on **437/448** → all silently dropped
- `destructible_collection` populated on **440/448** → all silently dropped
- `building_base` populated on **448/448** → all silently dropped

On the single elevator asset (`FD_Elevator_EV`): `cab_mesh`, `door_mesh`, `floor_offset`, `call_sound`, `door_open_sound`, `*_volume_transform`, `*_door_*_transform` — all populated, all dropped.

## Top widespread silent drops

| UPROPERTY | C++ source | Affected leaf classes | Cause |
|---|---|---|---|
| `RandomMaterialOverrides` | FurnitureDefinition.h | 17 | No BP tag (genuinely empty everywhere — low impact) |
| `LootPositions` | FurnitureDefinition.h | 17 | No BP tag (genuinely empty everywhere — low impact) |
| `CollisionBoxData` | DamageableFurnitureDefinition.h | 15 | No BP tag — **97.5% populated, all dropped** |
| `DestructibleCollection` | DamageableFurnitureDefinition.h | 15 | No BP tag — **98.2% populated, all dropped** |
| `BuildingBase` (FTransform) | DamageableFurnitureDefinition.h | 15 | No BP tag — **100% populated, all dropped** |
| `FurnitureShakeData`, `DeathSound`, `DeathEffect`, `DragSound`, `ImpactSound` | DamageableFurnitureDefinition.h | 15 each | No BP tag (empty on all sampled assets — low impact) |
| `StaticAudio`/`ToggledOn*`/`ToggledOff*` (Audio/Light/VFX) | FurnitureWithComponentsDefinition.h | 14 each | No BP tag — needs per-asset verification, likely populated on some |
| All `UElevatorDefinition`-local props (transforms, sounds, meshes) | ElevatorDefinition.h | 1 | No BP tag — **all populated on the single elevator, all dropped** |
| `Thumbnail`, `ItemCategoryTag` | ItemDefinition.h | 6 / 3 | No BP tag (Thumbnail = 0 populated; ItemCategoryTag = 0 populated on sample) |

## Per-class missing UPROPERTY breakdown

Full details in `scripts/audit_results.json`. Highlights:

- **Fully covered (9/36 classes):** `UAvailableRecipeRulesDefinition`, `UCraftRecipeDefinition`, `UEnemySpawnPointDefinition`, `UFurnitureUpgradeRecipe`, `UInventoryRulesDefinition`, `ULayoutDefinition`, `ULootDefinition`, `ULootSpawnPointDefinition`, `UPlantRecipeDefinition`. All have UPROPERTYs that uniformly carry `BlueprintReadOnly`/`BlueprintReadWrite`.
- **Worst by raw count of missing fields:** `UElevatorDefinition` (48 missing of 87 expected on its single asset — entire class essentially invisible); the 14 furniture subclasses inheriting from `UFurnitureWithComponentsDefinition` (20–32 missing each, dominated by inherited audio/light/VFX struct fields).
- **Worst by impact (assets × missing populated fields):** `UDamageableFurnitureDefinition` (448 assets × 3 always-populated lost fields = ~1,300 lost values) and `UConstructableItemDefinition` (270 assets, 3 fields missing — though sample populated rate not verified at scale).

The 9 fully-covered classes are exactly the ones whose UPROPERTYs all carry `BlueprintReadOnly`/`BlueprintReadWrite` — strong evidence the missing-BP-tag is the dominant root cause.

## Empty-default false positives

Some missing entries are genuinely empty across every asset — not a bug:

- `Thumbnail` (`TSoftObjectPtr<UTexture2D>` on `UItemDefinition`): 0/496 static items have it set. Probably unused by gameplay; UI uses `LoadSoftObjectFromPath` or a separate texture lookup.
- `ItemCategoryTag` on items: 0/496 set on the sample. The C++ header carries `BlueprintReadOnly` but the live class binary errors with "Failed to find property 'item_category_tag'" — likely a stale-build artifact, not an exporter bug.
- All `DamageableFurnitureDefinition`'s `*Sound`/`*Effect` props were unpopulated on all 448 sampled assets — same shape, no data loss.

## Top 3 fixes worth prioritizing

All three are C++ changes — the exporter itself is correct; it's hamstrung by what UE's Python binding exposes.

1. **Add `BlueprintReadOnly` to every UPROPERTY in `DataAssets/` that lacks it.** This single change would surface every silent drop. Priorities by data loss:
   - `UDamageableFurnitureDefinition::CollisionBoxData`, `DestructibleCollection`, `BuildingBase` (437–448 populated assets each, 100% currently lost)
   - `UElevatorDefinition::*` (transforms, sounds, meshes — entire class is invisible to the exporter)
   - `UFurnitureWithComponentsDefinition::StaticAudio/Light/VFX` and toggled variants (populated count not yet verified for all, but template structures that likely carry data)

2. **Force a full editor recompile + re-export** after the BP tags land. The audit found at least one prop (`ItemCategoryTag`) where the header tag is correct but the running binary lacks the property — a binary-vs-source skew that masks any fix.

3. **Consider a fallback enumeration path in the exporter for known-by-name UPROPERTYs.** Since `get_editor_property("random_material_overrides")` works even when `dir()` hides the prop, the exporter could read `scan_property_meta.py`'s output (the regex scan of `.h` files) at runtime and call `get_editor_property` for every name it found. This would make the JSON robust to future "forgot BP tag" mistakes.
