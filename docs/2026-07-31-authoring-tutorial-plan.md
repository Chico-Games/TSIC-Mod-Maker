# Authoring Tutorial — Plan

**Date:** 2026-07-31
**Status:** Plan — awaiting go-ahead
**Audience of the tutorial:** modders / content authors using the editor. No code, no TypeScript, no engine.
**Audience of this document:** whoever writes the tutorial.

---

## 0. Goal and shape

One chaptered guide under `docs/guide/`, indexed from `README.md`. Fourteen files, each standalone
enough to link someone to, ordered so a first-time reader can go top to bottom and end up with a
published mod.

Why chaptered markdown and not one `GUIDE.md`: the material is ~15–20k words. A single file is
unnavigable at that length, and the world-layout chapter alone is the size of a normal README.
Chapters also let us ship in batches and let readers land directly on "Recipes" from a forum answer.

**House style for every chapter:**

- Opens with **What you'll be able to do** — 2–4 bullets, concrete.
- Body is task-first: numbered steps the reader performs in the app, not a feature inventory.
- **Why it works** callout after each major task — the data model behind the click, one paragraph.
- **Gotchas** at the end — the failure modes, each with the exact symptom the app shows.
- 800–1500 words per chapter; ch. 10 gets ~3000.
- Every UI element named exactly as it appears on screen (`⌘K Search`, `+ Add…`, `Save ●`).
- Screenshots: placeholder markers `<!-- SHOT: … -->` in the first pass. See §4.

---

## 1. Chapter outline

### 00 — `README.md` (index)
Table of chapters with one-line hooks. A "I just want to…" quick-links table (change a recipe's cost
→ ch. 7; add loot to an enemy → ch. 8; build a room → ch. 10; get it in-game → ch. 12). Prerequisites
box: Chromium-based browser (File System Access API — Chrome/Edge/Brave; other browsers can read the
bundled defaults but cannot save).

### 01 — What you're editing
The mental model, before any UI. TSIC's game content is a tree of **definition** files — one JSON per
thing (an item, a recipe, a piece of furniture, a room layout). The game ships a base mod
(`com.chicogames.default`, "TSIC Base Game"); **your project is an overlay on top of it** — you save
only the records you changed, and the game merges. That single fact explains the whole Save/Export
menu, so it goes early. Diagram: base mod + your overlay → merged game data.

### 02 — Setup and your first project
Open the app → it loads the bundled base project read-only. Then:
1. `⚙ Settings` → set a **Projects folder** (where your mods live) and confirm the **Default project**.
2. `✨ New project` → name it, "Seed from default project?" explained (what you get either way).
3. Make one trivial edit, `Save`, find the file on disk, see that only that file exists in the folder.
4. `⟳ Reload`, the recents/pinned-folder menu, and the draft-restore prompt after a crash.
Ends with: read-only sources, why `Save` greys out, and `Save as…`.

### 03 — Anatomy of a definition
The on-disk file, using a real example (`craft_recipe_definitions/RD_AnomalousArmorChestplate_CR.json`).
Fields: `id`, `asset_path`, `class`, `schema_version`, `properties`. Folder ≙ class
(`craft_recipe_definitions` → `UCraftRecipeDefinition`) with the full table deferred to appendix A.
Naming conventions decoded — prefixes `ID_ FD_ RD_ LD_ LSP_ ESP_ LYD_ ARR_`, suffixes
`_CM _EQ _SI _CR`. Why you should follow them (search, partner auto-creation, everyone else's muscle
memory). Closes on **references**: a `definition_ref` is just an id string, which is why renaming by
hand breaks things and why you rename in the app instead.

### 04 — Getting around
The header bar button by button. The six tabs and what each is *for* (one sentence each, links out).
`⌘K` search. The item palette and drag-and-drop as a general mechanic. Property tooltips, clamps and
enum dropdowns coming from the engine schema. The Where-Used panel — pitched as *the* habit to build:
check what points at a record before you change it.

### 05 — Items
The shared browser used by Items and Furniture, taught once here: **Detail / Spreadsheet / Compare**
modes, the sub-tab rail, multi-select + bulk edit, duplicate, row-warning chips. The nine item folders
and what belongs in each. Static-item partners (`FD_*_SI`) and the auto-create on tab open — what it
is, why it exists, what happens if you delete one. Smart effects view on equippables/gloves (hidden
inactive `b_apply_X` pairs). Worked task: clone an existing consumable into a new one, end to end.

### 06 — Furniture
The seventeen furniture sub-folders and the decision tree for which one a new piece belongs in
(damageable? storage? station? plantable?). Components and what each unlocks. Death loot on the
furniture page and inline expansion of the linked `LootDefinition`. Upgrade recipes edited in place.
Cross-links into Recipes & Loot for stations. Worked task: make a new damageable storage crate that
drops its contents.

### 07 — Recipes, stations and progression
Stations sub-tab: how a station exposes recipes through its `available_recipe_rules_definition` (ARR),
and that dropping a recipe card on another station **moves the reference, not the file**. The three
recipe classes and how their cards differ (`UCraftRecipeDefinition`, `UPlantRecipeDefinition`,
`UFurnitureUpgradeRecipe`). Inputs/outputs/duration/level. `recipe_tags` and `crafting_bench_tags` —
the tag handshake between recipe and bench. Grow stages for plantables. Then the Tech Tree sub-tab as
a progression *review* tool: graph, ladder, cost, chokepoint and audit views — how to read each one
when balancing. Worked task: add a new recipe and put it on the right bench at the right tier.

### 08 — Loot and drops
`LootDefinition` structure and weighting. The four places loot is authored: furniture death loot,
enemy `death_drop_table`, biome `LSP_<biome>_Floor` / `LSP_<biome>_Furniture` pairs, and orphan
`LD_*` records in the Definitions tab. When to make a new table vs reuse one (reuse is usually right
— show the Where-Used panel proving how many things share a table). Worked task: give a new enemy a
drop table and put its material into the world's floor loot.

### 09 — Gameplay tags
Short but load-bearing, and it must come before ch. 10. The tag tree is hierarchical and dotted;
`Furniture.Seating.Chair` is a child of `Furniture.Seating`. The TagPicker. Where tags actually do
work: recipe/bench matching, layout search queries, tile requirements, biome gating. **Tag hygiene as
a design activity** — you tag furniture so that layouts can ask for it later; untagged furniture is
invisible to every query you'll write in the next chapter.

### 10 — Laying out the world  ← the big one
See §2 for the full breakdown.

### 11 — Validations and keeping a project healthy
The Validations tab rule by rule — orphan refs, missing Item↔StaticItem partners, stations with
no/missing ARRs, empty/orphan ARRs, recipes with no inputs/outputs, upgrade recipes with an unset or
missing target, orphan loot tables, dangling `definition_ref`s. For each: what causes it, whether it's
fatal or cosmetic, and the fix. The issue dots that surface the same data inline on rails and pickers.
Recommended cadence: validate before every save-and-test, not before publish.

### 12 — Shipping it
`Save` vs `Export` (overlay ZIP) vs `Export flattened` (base + overlay merged — and why you almost
never want it). Then the mod.io wizard, all four steps: Bind (new mod or bind to existing), Metadata
(name ≤80, summary ≤250, description, logo ≥512×288, tags, visibility), Modfile (version, changelog),
Done. Sign-in, the sync chip, and what "clean" means. Finally: installing locally to test before you
publish. **Open question — see §5.1.**

### 13 — Appendices
A. Folder → class table (all ~50 folders, generated from `manifest.json` + `_schema.json`, not typed
by hand).
B. Naming glossary — every prefix/suffix in the base data.
C. Keyboard shortcuts — `⌘K`, W/E/R gizmos, Numpad 1/3/7, `Ctrl+D`, `Delete`, `Esc`.
D. Troubleshooting — "Save is greyed out", "my folder won't open", "changes vanished after reload",
"the game doesn't see my mod".

---

## 2. Chapter 10 — Laying out the world (detailed)

The chapter has to teach a system the UI only half-shows, so it's structured as **model → controls →
debugging → craft tips → worked example**.

### 10.1 The model
A layout (`LYD_*`, 435 in the base data) is an ordered list of **LayoutObjects**. Each LayoutObject is
one of five actor types:

| Type | Resolves to | Use it for |
|---|---|---|
| `ProxyActor` | a `UFurnitureDefinition` | actual physical props |
| `Layout` | another `LYD_*`, inlined at this transform | reusable sub-arrangements |
| `EnemySpawnPoint` | `UEnemySpawnPointDefinition` | where enemies come from |
| `LootSpawnPoint` | `ULootSpawnPointDefinition` | where loot appears |
| `VisualHelper` | nothing — authoring-only marker | alignment, notes |

Layouts compose: a layout referenced from another layout is flattened inline, so you build a chair
cluster once and drop it into six rooms.

### 10.2 Direct refs vs search queries — the core idea
Every LayoutObject either names a definition outright, **or** describes one with tag queries and lets
the game pick. That is the whole variation system, and it's the concept most worth spending words on.

- Direct ref → this exact object, every time. Use for anything structural or authored.
- Search queries → "any chair tagged X" → different chair per seed. Use for dressing.

Query semantics, stated plainly and completely (this is undocumented anywhere else):
- Each query holds a tag list, a match mode, and a `b_not` flip.
- Modes: `HasAnyExact`, `HasAnyInclParents`, `HasAllExact`, `HasAllInclParents`, `None` (matches
  everything). "InclParents" means a target tag counts if it's the query tag *or a dotted descendant*
  — so `Furniture.Seating` matches `Furniture.Seating.Chair`.
- **Multiple queries are ANDed**; the any/all choice only varies *within* one query. Table of
  worked combinations, since this is where authors get it wrong.
- Candidates are every definition of the right class *including subclasses*, filtered by their
  `gameplay_tags` — which is the payoff of ch. 9.

### 10.3 Tile requirements
`tile_requirements` uses the same query language but is evaluated against **the tile's** tags, not a
candidate's. Match fails → the object is skipped entirely. This is how one layout serves several
biomes or difficulty tiers: author the union, gate the differences. Explain the tile-tag override
control in the toolbar as the way to preview each context.

### 10.4 Seeds, chance and determinism
- `spawn_chance_over` / `spawn_chance_under` form a `[0,1)` window; a roll outside it skips the object.
  Defaults `0`/`1` = always spawn.
- `seed_offset` of `-1` means "use my index in the list" — so objects in a layout decorrelate by
  default; setting equal offsets on two objects makes them roll *together*, which is the trick for
  "these two props appear as a pair".
- The toolbar seed drives everything; the reroll button steps it.
- **Stated honestly:** the editor's RNG is a deterministic stand-in, not byte-identical to the
  engine's. Same seed in the editor always gives the same preview; the in-game roll for that seed may
  differ. The preview is for judging *distribution and density*, not for predicting one exact playthrough.

### 10.5 The editor controls
Toolbar: layout picker (with issue counts), `Save ●`, `+ Add…` (the five types), seed + reroll,
tile-tag override. Outliner: naming scheme (`Proxy: FD_Door`, `Proxy: SearchQuery (3 tags)`,
`Layout: LYD_TileBase`, …), selection, shift/ctrl multi-select, Esc. Viewport: boxes are **bounding
boxes from the mesh catalog**, not real meshes — set expectations early; type tints; W/E/R gizmos;
Numpad 1/3/7; double-click to frame; `Ctrl+D` duplicate, `Delete`. Details panel: full property editor,
multi-select showing `(multiple values)` and editing all at once. Units: Unreal centimetres, Z up,
rotation in degrees.

### 10.6 Reading the status overlays (the debugging section)
Each status, what it means, and the fix:

| Overlay | Means | Usually fix by |
|---|---|---|
| No definition or search queries | object is blank | pick a ref or add a query |
| Filtered by tile requirements | working as designed for *this* tile | check with the tag override before "fixing" |
| Spawn chance N% | rolled out this seed | reroll to confirm it ever appears |
| No matching definitions found | query too strict, or nothing is tagged | loosen mode / fix tags (ch. 9) |
| Missing mesh | furniture has no `static_mesh` or it's not in the catalog | usually a data problem, not a layout one |
| Recursive layout cycle | A → B → A | break the nesting |

Framed as a workflow: reroll through several seeds and watch the overlays, because a layout that
looks fine on seed 0 can be empty on seed 7.

### 10.7 Craft tips — laying out a world that plays well
The part that isn't in any source file. Written as opinionated guidance, marked as such:

- **Build a kit, not a level.** Small reusable layouts (a desk unit, a shelf run, a barricade) then
  compose. The base data does this — cite examples.
- **Tag before you build.** Every hour spent tagging furniture pays back as query reuse.
- **Anchor, then dress.** Direct-ref the objects that carry gameplay meaning (the door, the station,
  the loot container); query-and-chance everything that's texture.
- **Density and negative space.** Rooms need traversable lanes; suggest a rough occupied-floor budget
  and reading sightlines from each entrance.
- **Pace loot and threat together.** Where LootSpawnPoints and EnemySpawnPoints sit relative to
  entrances is the encounter design; don't stack them on top of each other.
- **Vary with chance, theme with tile requirements.** Two different tools, commonly confused.
- **Keep nesting shallow** (2–3 deep) — deep nests are hard to debug and easy to cycle.
- **Seed-sweep before you call it done.** Five to ten rerolls, eyes on the overlays.
- **Name layouts for composition** (`LYD_<Theme>_<Role>`), so the picker sorts usefully.

### 10.8 Worked example
Build `LYD_Office_Corner` from an empty layout to a saved, seed-swept, validated file — every click,
including one deliberate mistake (an over-strict query) so the reader sees `No matching definitions
found` and fixes it.

### 10.9 Where the world itself is assembled
Layouts are tiles' worth of content; assembling tiles into a map happens outside this editor.
Short section pointing at the level editor, scoped to "here's the boundary". **Open question — §5.2.**

---

## 3. Sourcing and accuracy

Everything factual gets traced to code or data before it's written, not recalled:

| Chapter | Ground truth |
|---|---|
| 01, 03, 12 | `persistence/leanEnvelope.ts`, `persistence/dataSource.ts`, `Header.tsx` export menu, `docs/2026-07-07-default-mod-submodule-unification-plan.md` |
| 02 | `SettingsModal.tsx`, `Header.tsx` (new project / recents / pinned), `LoadGate.tsx`, `RestoreDraftPrompt.tsx` |
| 04–06 | `classBrowser/*`, `configs.ts`, `ItemsTab.tsx`, `FurnitureTab.tsx`, `WhereUsedPanel.tsx` |
| 07 | `StationsSubTab.tsx`, `RecipeCard.tsx`, `GrowStagesEditor.tsx`, `dnd/dispatch.ts`, `techtree/*` |
| 08 | `FurnitureSubTab.tsx`, `EnemiesSubTab.tsx`, `BiomeSubTab.tsx` |
| 09 | `gameplayTagStore.ts`, `pickers/TagPicker.tsx` |
| 10 | `layouts/resolver/{resolver,proxySearchQuery,searchTree,randomStream}.ts`, `layouts/Toolbar.tsx`, `Viewport/*`, `Outliner/*` |
| 11 | `validationStore.ts`, `ValidationsTab.tsx`, `classBrowser/RowWarnings.ts` |
| 13A | generated from `web/public/starter-project/manifest.json` + `_schema.json` |

Rule: if a claim can't be traced, it's either cut or explicitly marked as advice/opinion (the craft
tips in 10.7 are the only sanctioned opinion section).

---

## 4. Screenshots

Three options, decreasing cost:

1. **Real captures** — run `npm run dev` and drive Chrome to capture ~25 shots at fixed viewport.
   Best result; adds a maintenance burden every time the UI moves.
2. **A handful of captures for the hard parts only** — the Layouts viewport, the tech tree, the
   publish wizard (~8 shots). Everything else described in words. *Recommended.*
3. **None** — `<!-- SHOT: … -->` markers left for someone else.

First pass writes markers regardless; capture is a separate, resumable step.

---

## 5. Open questions

**5.1 — Local install path.** Ch. 12 needs "how do I test my mod in the game before publishing" —
where the mod folder goes on disk for the shipped game to pick it up. Not derivable from this repo.
Needs an answer, or the chapter stops at "publish to mod.io and subscribe".

**5.2 — World assembly boundary.** How tiles/layouts become an actual map lives in `TSICLevelEditor`.
Should ch. 10.9 be a one-paragraph pointer, or a real handoff section explaining the tile→world model?
The former is safe; the latter is more useful and needs facts from that repo.

**5.3 — Biome definitions.** Biomes appear in two places (loot spawn pairs in Recipes & Loot; tile
tags in layouts). Worth confirming whether biome authoring has more to it than these two surfaces
before ch. 8/10 split the topic.

**5.4 — Audience floor.** Assume zero Unreal knowledge, or assume the reader has modded a UE game
before? Affects how much of ch. 3 and 10.5 (transforms, units, tags) is explained from scratch.
Default assumption unless told otherwise: **zero Unreal knowledge, some gaming-mod literacy.**

---

## 6. Sequencing

Written and reviewed in four batches so feedback on tone lands before the bulk is drafted.

| Batch | Chapters | Notes |
|---|---|---|
| 1 | 00–04 | Establishes voice and structure. Review gate before continuing. |
| 2 | 05–09 | The content-authoring tabs. |
| 3 | 10 | World layout, incl. the worked example. |
| 4 | 11–13 | Ship + appendices (13A generated). |

Final pass across all chapters: link check, terminology consistency against the actual UI strings,
and a cold read-through following every worked example in a scratch project.

---

## 7. Maintenance

- Guide lives in `docs/guide/`, linked from `README.md`.
- Appendix A is generated — add a script rather than hand-editing when folders change.
- The README's existing tab/feature tables overlap the guide. Proposal: trim the README to quick-start
  + architecture, and point authoring content at the guide, so the two don't drift.
