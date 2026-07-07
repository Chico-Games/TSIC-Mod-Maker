# Unify all 3 TSIC projects onto the `tsic-default-mod` git **submodule** (Option A)

**Date:** 2026-07-07
**Status:** Plan — ready to execute
**Audience:** an engineer/AI who has NOT seen this session. Everything needed is below, including repo URLs, exact commands, verification, and rollback.
**Author note:** Written after live investigation of all four repos via `gh api` (2026-07-07). Every "current state" claim below was verified, not assumed.

---

## 0. TL;DR

There is one source-of-truth mod: **`Chico-Games/tsic-default-mod`** (`mod.json.id = com.chicogames.default`, dotted "default-project" convention). Three projects consume it, but each vendors it a **different** way, and two aren't wired to the submodule at all:

| Project | Repo (branch) | How it vendors the mod **today** | Derived artifact it generates | Deploy |
|---|---|---|---|---|
| **Unreal game** | `Chico-Games/TSIC` (private) | ✅ **git submodule** `Mods/com.chicogames.default` @ `beta` | — (UE reads it directly) | n/a |
| **Level editor** | `Chico-Games/TSICLevelEditor` (public, `master`) | ⚠️ **git subtree** (~88 MB committed) at `vendor/default-project` | `config/biomes.json` via `tools/sync-biomes.mjs` | GitHub Pages (Actions), excludes `vendor/` |
| **Mod / definition editor** | `Chico-Games/TSIC-Mod-Maker` (public, `main`) — *this repo* | ❌ **neither** — `web/scripts/refresh-schema.mjs` copies from an external Unreal pack dir on the author's disk | `web/public/starter-project/` + `web/public/schema/` via `refresh-schema.mjs` | GitHub Pages (Actions), serves the committed bundle |

**Goal (Option A):** make **all three** consume the mod as a **git submodule** pinned to **`beta`**, and have each project regenerate its derived artifact **from that submodule** (committed). No project loads the raw mod over HTTP; each keeps its existing generator.

**The single most important non-obvious fact:** you *cannot* serve the raw mod directly to the two web editors. The mod ships the **dotted `default-project` convention** (`.manifest.json` is an incomplete asset *index*, not a file list — it omits data-only folders like `hotkey_/input_behavior_/situation_definitions` and any record with no `asset_path`). The web editors need a **generated** artifact (`manifest.json` for Mod-Maker, `config/biomes.json` for LevelEditor). Hence "submodule = source of truth, regenerate the derived artifact" — never "mount the submodule at the served path."

---

## 1. Decisions (settle before executing; ⚠️ = confirm with the human)

1. **Mechanism: git *submodule* everywhere.** The human explicitly asked for a submodule, and TSIC already uses one. ⚠️ **This reverses a deliberate, documented choice in the level editor**, which uses a *subtree* on purpose (see `TSICLevelEditor/.github/workflows/deploy-pages.yml`: *"vendored … as a git subtree so the sync tool and contributors have the source of truth"*). Subtree's advantages were: contributors/CI don't need `git submodule update --init`, and GitHub-Pages "deploy from branch" works without submodule support. Converting to a submodule is fine (both web deploys **exclude** the vendored mod from the published site and ship only the small generated artifact, which stays committed), but **confirm the human wants to reverse the subtree decision** before doing the level editor. If they'd rather keep subtree there, do only Mod-Maker + verify TSIC, and standardize "source of truth = the mod repo" without forcing the mechanism.
2. **Pin `beta`, not `main`.** Reasons: (a) TSIC already pins `beta`; (b) `beta` ships `.property-meta.json`, which lets `refresh-schema.mjs` regenerate the Mod-Maker's app-schema **fully headerless** (no TSIC C++ project needed). `main` lacks `.property-meta.json`, so on `main` the Mod-Maker's `web/public/schema/property-meta.json` would silently keep its stale copy. `beta` is also ahead (46 tree dirs vs `main`'s 41). ⚠️ Confirm `beta` is the intended live-editor data; if the deployed editors must track *stable* game data, pin `main` and accept the property-meta caveat (document it).
3. **Commit the generated artifacts** (`web/public/starter-project/`, `web/public/schema/`, `config/biomes.json`). This keeps both Pages deploys trivial — they build/serve committed files and never need the submodule at deploy time. (Optional hardening: a CI "drift guard" that re-generates and diffs; see §5.)
4. **Keep the dual-convention loader in Mod-Maker.** The editor's runtime already reads/writes both the editor convention (bundled `starter-project`) and the dotted default-project convention (opened folders) — Phases 1–2 of `docs/2026-06-30-default-project-convention-unification-plan.md`, already shipped. **Do not** change `loadDefaultProjectFromHttp` / `HttpDataSource` to read the dotted convention. The submodule feeds the *generator*, not the runtime loader.

---

## 2. The mod repo (`Chico-Games/tsic-default-mod`) — reference facts

- URL: `https://github.com/Chico-Games/tsic-default-mod.git` (public). Branches: `main`, `beta`.
- Convention: **dotted default-project**. Root files: `.manifest.json`, `.class-hierarchy.json`, `.gameplay-tags.json`, `.asset-refs.json`, `_schema.json`, `mod.json`, `README.md`, `.gitignore`, `.assets/` (per-class asset catalogs), plus one dir per definition category. `beta` additionally ships `.property-meta.json` and more folders (46 tree dirs vs `main`'s 41; includes `maps`, `situation_definitions`, `hotkey_definitions`, `input_behavior_definitions`).
- `mod.json` = `{ "id": "com.chicogames.default", "displayName": "TSIC Base Game", "version": "0.1.0" }` (semver identity — never auto-bump it).
- `.manifest.json` is an **asset index** `{ schema_version, generated_at, assets:{ folder:{ id:asset_path } } }`, NOT a complete file list. Enumerate by directory scan; data-only folders are absent from it by design.

---

## 3. Per-project execution

> All `git submodule add -b beta …` commands record `branch = beta` in `.gitmodules`, so later `git submodule update --remote <path>` advances the pointer to the tip of `beta`. Pin an explicit commit by committing the gitlink after `update --remote`.

### 3A. TSIC (Unreal game) — **verify only, likely no change**

Already correct: `.gitmodules` →
```
[submodule "Mods/com.chicogames.default"]
    path = Mods/com.chicogames.default
    url = https://github.com/Chico-Games/tsic-default-mod.git
    branch = beta
```
Steps:
1. `git submodule status Mods/com.chicogames.default` — confirm it's initialized and points at a `beta` commit.
2. (Optional) advance to latest beta: `git submodule update --remote Mods/com.chicogames.default` → commit the moved pointer.
3. No other changes. Done.

### 3B. TSIC-Mod-Maker (this repo) — add submodule + regenerate bundle

**Path choice:** `vendor/default-mod` at the **repo root** (not under `web/public/`, so Vite never serves it). Repo root already has `web/`, `scripts/`, `saves/`, `docs/`.

1. **Add the submodule** (from repo root):
   ```sh
   git submodule add -b beta https://github.com/Chico-Games/tsic-default-mod.git vendor/default-mod
   git submodule update --init --remote vendor/default-mod
   ```
   This creates `.gitmodules` (new file for this repo) + the gitlink.

2. **Regenerate the bundle + app schema from the submodule.** `refresh-schema.mjs` reads a "pack dir" and writes `web/public/schema/` and `web/public/starter-project/`:
   ```sh
   cd web
   node scripts/refresh-schema.mjs --source ../vendor/default-mod --no-scan
   ```
   - `--source ../vendor/default-mod` overrides `PACK_DIR` (default points at the author's local Unreal project — irrelevant here).
   - `--no-scan` skips the C++ header scan (this repo has no TSIC `Source/`). On `beta`, `refresh-schema` then uses the pack's committed `.property-meta.json` (script line ~109) and `.class-hierarchy.json`, so it is fully headerless. **On `main` it would keep the stale `web/public/schema/property-meta.json`** — another reason to pin `beta`.
   - The script **preserves** `web/public/starter-project/default.json` (the editor's integer publish counter, which is NOT in the mod) across its wipe — leave that behavior intact.
   - It **generates** the undotted `manifest.json` in the HTTP-loader shape (`{folders, files:[{folder,ids}]}`) — this is why the bundle can be served even though the mod ships only `.manifest.json`.
   - Expect the script to end with `CLEAN — no schema drift`. If it reports `STRUCTURAL` for `hotkey_/input_behavior_/situation_definitions` (missing `asset_path`), that's a **known false alarm** — the real editor treats `asset_path` as optional; see `memory/schema-drift-causes-and-overrides.md`. If it reports genuine `DRIFT` (unknown class/property), the pack/schema is stale — stop and report.

3. **Expect the data to change.** The current committed bundle has ~37 folders / 2201 defs (generated from an older pack). `beta` has ~45 def folders. Regeneration will add folders/records — this is the intended sync to source-of-truth. Review the diff before committing.

4. **`_schema.json` gap note.** `beta`'s `_schema.json` may still have `structs.ProductionMachineRules.fields = {}` (the exporter gap fixed at runtime by `web/src/persistence/leanEnvelope.ts` → `applyLeanSchemaOverrides`). That override remains a safety net and is unaffected. The *proper* fix belongs in the mod's exporter/`_schema.json`; flag it upstream but it does **not** block this work.

5. **Commit:** `.gitmodules`, the `vendor/default-mod` gitlink, and the regenerated `web/public/schema/*` + `web/public/starter-project/*`.

6. **Deploy (`web`→`.github/workflows/deploy.yml`): no change required.** The committed bundle is what Pages serves; `actions/checkout@v4` need **not** fetch the submodule (leave `submodules` unset to avoid pulling ~88 MB into every deploy). Contributors run `git submodule update --init` only when they want to **regenerate**.

7. **Verify** (from `web/`): `npm ci && npm run typecheck && npm test`; run the round-trip check (`memory/lean-format-and-game-pack.md`) to confirm lean→envelope→lean is byte-stable over the new bundle; and drive the app to confirm the default project still loads (2201+ defs, no load-gate) — e.g. `npm run smoke:*` per `package.json`. Note the pre-existing `recipes-loot-ui-smoke.mjs` "tier pills" flake documented in `docs/2026-07-07-recipe-loot-render-and-overlay-save-fixes-plan.md`; it is unrelated.

### 3C. TSICLevelEditor — convert subtree → submodule (⚠️ decision 1) + resync

Keep the **same path** `vendor/default-project` so `tools/sync-biomes.mjs` (default `--project vendor/default-project`) and the CI path filters keep working unchanged.

1. **Remove the subtree, add the submodule at the same path** (from repo root, branch `master`):
   ```sh
   git rm -r vendor/default-project
   git commit -m "chore: drop vendored default-project subtree (moving to submodule)"
   git submodule add -b beta https://github.com/Chico-Games/tsic-default-mod.git vendor/default-project
   git submodule update --init --remote vendor/default-project
   ```
   (History still contains the ~88 MB blobs; new clones without `--recursive` skip them. A true size reclaim needs history rewriting — out of scope, note it.)

2. **Regenerate the derived artifact:**
   ```sh
   node tools/sync-biomes.mjs        # reads vendor/default-project/biome_definitions → writes config/biomes.json
   ```
   Then `node tools/sync-biomes.mjs --check` must exit 0.

3. **CI changes:**
   - `.github/workflows/biome-sync-check.yml` — its `check` job runs `sync-biomes.mjs --check`, which **reads** `vendor/default-project`. With a submodule, the checkout no longer includes it automatically → add submodule fetch to that job's checkout:
     ```yaml
     - uses: actions/checkout@v4
       with:
         submodules: recursive
     ```
   - `.github/workflows/deploy-pages.yml` — the build stages `_site` with `rsync … --exclude 'vendor'`, so deploy does **not** need the submodule. Leave its checkout as-is (an empty/absent `vendor/` is fine for the exclude). Confirm the deployed site still contains the committed `config/biomes.json`.

4. **Commit:** `.gitmodules`, the `vendor/default-project` gitlink, updated `config/biomes.json`, and the `biome-sync-check.yml` change.

5. **Verify:** `node tools/sync-biomes.mjs --check` (0), `npx playwright test` (repo's suite), and open `index.html` to confirm the biome palette renders from `config/biomes.json`.

---

## 4. Order of operations & pushing

1. **TSIC** — verify (§3A); push only if you advanced the pointer.
2. **TSIC-Mod-Maker** — §3B on a feature branch; open PR; merging to `main` **auto-deploys to live Pages** (`chico-games.github.io/TSIC-Mod-Maker/`). Confirm the deploy goes green (the last `main` deploy — commit `4c59eb5` — is currently red; investigate before piling on, or expect to fix it).
3. **TSICLevelEditor** — §3C on a feature branch off `master`; open PR; merging auto-deploys its Pages.

Push each repo separately. Nothing here needs a monorepo/coordinated push; the only shared artifact is the mod repo, which none of these steps modify (they only *pin* it).

---

## 5. Optional hardening — drift guards (recommended for Mod-Maker)

The level editor already has `biome-sync-check.yml` (fails if `config/biomes.json` is stale vs the vendored mod). Mod-Maker has **no** equivalent, so its committed bundle can silently drift from the submodule. Optional new workflow `web`-side:
- Job: `checkout` with `submodules: recursive`, `npm ci`, `node scripts/refresh-schema.mjs --source ../vendor/default-mod --no-scan`, then `git diff --exit-code -- web/public/starter-project web/public/schema`. Fail if non-empty.
This is the only place a submodule checkout enters Mod-Maker CI, and it's a *check*, not the deploy.

---

## 6. Risks, gotchas, and things an executor will trip on

- **Don't mount the submodule at a served path.** (`web/public/starter-project` or the level editor site root.) The dotted `.manifest.json` can't drive HTTP enumeration; the generated artifact is mandatory.
- **`beta` vs `main` and `.property-meta.json`:** only `beta` is headerless-regeneratable for Mod-Maker. On `main`, `property-meta.json` silently goes stale.
- **`refresh-schema` header self-heal is a no-op here.** It normally derives missing class parents from TSIC C++ headers (absent in this repo), so it relies entirely on the pack's `.class-hierarchy.json` being complete. `beta`'s is; if a class is missing from it, its parent chain degrades to `[UDataAsset, UObject]`. Watch the script's "self-healed"/"unknown-class" output.
- **Data change is expected**, not a bug: `beta` has more folders than the current bundle. Review the diff; run the round-trip + smoke before merging.
- **Level editor subtree→submodule reverses a deliberate choice** (decision 1). Get sign-off.
- **`.gitmodules` `branch = beta` ≠ auto-updating.** The pointer only moves when someone runs `git submodule update --remote` and commits. Consumers get exactly the pinned commit.
- **Path-name inconsistency:** Mod-Maker uses `vendor/default-mod`; LevelEditor keeps `vendor/default-project` (renaming it means touching `sync-biomes.mjs` defaults + two workflow path filters — not worth the churn). Optional to unify later.
- **Live deploy on `main`:** Mod-Maker's merge publishes immediately; there's no beta/staging Pages channel for it. The last `main` deploy is red — check `deploy.yml` runs before adding another push.
- **Repo naming:** the older unification plan refers to `tsic-default-project`; the repo is now `tsic-default-mod`. Same thing.

---

## 7. Rollback

- **Mod-Maker:** the regenerated bundle + submodule are one commit/PR; revert the PR. To drop the submodule entirely: `git submodule deinit -f vendor/default-mod && git rm -f vendor/default-mod && rm -rf .git/modules/vendor/default-mod`, then restore the previous `web/public/starter-project` + `web/public/schema` from history.
- **LevelEditor:** revert the PR to restore the subtree commit (blobs are still in history), or `git submodule deinit` + re-add the subtree.
- **TSIC:** revert the moved pointer commit.

---

## 8. Acceptance criteria

- **TSIC:** submodule initialized at `Mods/com.chicogames.default` @ `beta`; game builds/loads the mod (unchanged).
- **Mod-Maker:** `.gitmodules` + `vendor/default-mod` gitlink present @ `beta`; `web/public/starter-project` + `web/public/schema` regenerated from it; `refresh-schema` reports CLEAN (or only the known `asset_path` false alarm); `npm run typecheck` + `npm test` green; app loads the default project; Pages deploy green on `main`.
- **LevelEditor:** `vendor/default-project` is a submodule @ `beta`; `config/biomes.json` regenerated; `sync-biomes --check` exits 0; `biome-sync-check.yml` checks out submodules; Pages deploy green on `master` and still ships `config/biomes.json`.
- **All three** consume exactly one source of truth (`tsic-default-mod@beta`) via a git submodule; each derived artifact is generated from it and committed.

---

## 9. Execution log — Mod-Maker §3B (2026-07-07)

Done on branch `feat/default-mod-submodule`. Submodule `vendor/default-mod` added, pinned `beta` @ `077bf85`; bundle regenerated (37→45 def folders → **43 packed**, 2367 defs). Verified: `typecheck` clean, `npm test` 232 pass / 0 fail, round-trip **2367/2367 byte-identical** (`TSIC_PACK_DIR=../vendor/default-mod`).

**Generator fix (committed):** `refresh-schema.mjs` now packs **only genuine definition records** (JSON with string `id` + `class`). `beta` added a `maps/` folder whose file (`Durham Furniture.json`: `{metadata,layers,color_mappings,format_info}`) is a tilemap, not a `UDataAsset` — it has no `id`/`class` and previously slipped into the bundle, tripping a **structural** load-gate. Now excluded (folders excluded: `maps`).

**Three upstream data gaps in `tsic-default-mod@beta` found during the sync** (the mod's exporter, not this repo — flag upstream; §3B.4 philosophy):

1. **property-meta: new `WorldRulesDefinition` aggregation DataAsset** — its 13 props (day/night lighting, respawn, random-event, loot) are real C++ UPROPERTYs but `property-meta.json` files them under their *declaring* classes (`GameWorldTimeManager`, `DayNightLightingComponent`, `RespawnSubsystem`, `RandomEventSubsystem`, `WorldGenerationSettings`), not the aggregating DataAsset → 13 unknown-property drifts. Plus `ScpGameData.default_customer_recipe_rules` (new, absent everywhere). **Resolved in-repo** via `property-meta.overrides.json`: the 13 use metadata copied **verbatim** from the pack's own declaring-class entries (accurate, not guessed); the 1 unmapped uses a best-effort `TObjectPtr<UAvailableRecipeRulesDefinition>`. Proper fix: exporter should file these under `WorldRulesDefinition`.
2. **class-hierarchy: 6 classes missing from `.class-hierarchy.json`** (`UEnemySpawnParameters`, `UHotkeyDefinition`, `UInputBehaviorDefinition`, `URandomEventDefinition`, `USituationDefinition`, `UWorldRulesDefinition`) → `refresh-schema` self-heals them to `[UDataAsset, UObject]` (degraded, but drift-check confirms their props resolve). Proper fix: exporter should emit them.
3. **asset catalog: 2 dangling `StaticMesh` refs** — new weapon defs `ID_ArmClub_EQ`, `ID_PotMace_EQ`, `FD_ArmClub_SI`, `FD_PotMace_SI` reference `SM_ArmClub`/`SM_PotMace`, which are **absent from `.assets/StaticMesh.json`** (exporter's asset-registry walk; also absent from the old bundle's catalog). → **4 `missing-asset-ref` issues** produced a dismissible drift load-gate on the pristine default project. **Resolved in-repo** via a new `web/public/schema/asset-catalog.overrides.json` (parallel to `property-meta.overrides.json`): `refresh-schema.mjs` merges its entries into the packed `.assets/<Class>.json` after copying the pack's catalogs (existing entries win, case-insensitive path match). The 2 mesh paths are taken **verbatim from the referencing defs' own asset refs** (real UE object paths); `package_guid` is left `""` exactly like the many real catalog entries whose guid the exporter didn't capture (the validator skips guid checks when either side is empty) — so this registers a known-real asset, it does not fabricate one. After this, the default project **loads with no gate** (verified headless: no `.loadgate-modal`, 0 pageerrors). Proper long-term fix still belongs in `tsic-default-mod@beta` (catalog the 2 meshes, or drop the dangling refs); the override is the safety-net until then.

**`smoke:def` note (pre-existing, unrelated):** `web/definitions-ui-smoke.mjs:417` waits for `.def-empty-state h2:has-text("Pick a Definitions root")` — a string that **does not exist anywhere in `src`** (verified at HEAD and in the working tree; `DefinitionsTab.tsx` is untouched by this work). The smoke asserts removed UI copy, so it fails regardless of the bundle — a stale test, not a regression from this sync. Clean-load was instead verified with the memory's prescribed method (headless load, assert no `.loadgate-modal` + zero console/pageerror). Fixing the stale smoke is out of scope here.

**Merge caution (§4.2):** merging to `main` auto-deploys live. The bundle now loads cleanly, so merging is safe on that axis; still worth landing the upstream catalog fix in `tsic-default-mod@beta` eventually so the override can be retired. Committing to the feature branch does not deploy.
