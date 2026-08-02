← [Previous](10-gameplay-tags.md) | [Index](README.md) | Next: [Validations →](12-validations.md)

# 11. Laying out the world

**What you'll be able to do**

- Explain how a TSIC world is assembled, from map down to a single chair.
- Author a tile layout that composes cleanly with everything else.
- Write tag search queries that find the right furniture and nothing else.
- Use seeds, spawn chance and tile requirements deliberately.
- Debug a layout that isn't producing what you expected.
- Build rooms that actually play well.

This is the longest chapter in the guide, because it's the least documented system and the one with
the most leverage. Read [chapter 10](10-gameplay-tags.md) first — none of this works without tags.

---

## 11.1 Three scales

TSIC worlds are built at three scales, and it's worth holding all three in your head:

```
MAP        a grid of tiles           painted in the level editor, shipped as maps/*.json
 └─ TILE   1500 × 1500 uu of world   one biome, one maze-opening shape
     └─ LAYOUT  a list of objects    what you author in the Layouts tab
         └─ LAYOUT OBJECT  one thing furniture / nested layout / spawn point
```

You author the bottom two in the Definition Editor. The map is a separate tool. All three ship inside
the same mod folder.

## 11.2 The map

A map is a JSON file with run-length-encoded layers:

```json
{
  "metadata": { "name": "TestModWorld", "world_size": 256, "maze_generation_seed": 20260716 },
  "layers": [
    { "layer_type": "Height",     "palette": ["#1a1a2e"], "color_data": [[0, 65536]] },
    { "layer_type": "Difficulty", "palette": ["#90ee90"], "color_data": [[0, 65536]] },
    { "layer_type": "Hazard",     "palette": ["#1a1a1a"], "color_data": [[0, 65536]] },
    { "layer_type": "Sky",        "…": "…" }
  ],
  "color_mappings": { "biomes": { "#ff6b6b": { "name": "Tile.Biome.ShowFloor" }, … } }
}
```

Each layer is a grid of colours; the palette maps colours to meanings. The **biome layer** says which
biome each cell is, via a colour→`Tile.Biome.*` mapping. Other layers carry height, difficulty and
hazards. `color_data` is `[[paletteIndex, runLength], …]`.

You don't paint this by hand — it's produced by the separate **level editor** tool. But you should
know:

- **Maps live in a mod**, at `maps/*.json`. Drop one in your mod folder and it appears in the map list.
- **Later load order wins**, exactly like definitions — so a mod can replace a base map by using the
  same filename.
- **The difficulty layer feeds loot tiering** ([ch. 8](08-loot-and-drops.md)): a tile's difficulty
  selects which bucket of an LSP fires.
- **`maze_generation_seed`** makes generation reproducible for a given map.

## 11.3 Biomes

A biome is the bridge between the map and your layouts. `BD_ShowFloor.json`:

| Property | What it does |
|---|---|
| `biome_tag` | `Tile.Biome.ShowFloor` — the identity the map's colour maps to |
| `display_name` | Shown to players |
| `role` | `Environmental` / `Structural` / `POI` / `Sky` / `Spawn` |
| `map_color` | How it renders on the in-game map |
| `maze_openness` | 0–1. How open the maze is here — higher means fewer walls, more crossroads |
| `is_maze_border` | Whether this biome acts as a maze boundary |
| `floor_lsp` / `furniture_lsp` / `container_loot_table` | Its loot ([ch. 8](08-loot-and-drops.md)) |
| `loot_multiplier` | Blanket generosity dial |
| `layouts` | The ids of layouts belonging to this biome |
| `ambient_audio` | Sound bed, with fade in/out |
| `direction_tags` / `vertical_direction_tags` | Neighbour-offset tags this biome contributes |

`maze_openness` is the underrated one: it changes how the space *feels* to move through more than any
individual prop does.

## 11.4 What a tile is

| Fact | Value |
|---|---|
| Size | **1500 × 1500 uu**, centred on origin |
| Perimeter walls | at **±750** |
| Author content within | roughly `x, y ∈ [−750, +750]` |
| Wall segment length | 300 uu |
| Axis convention | **Up = +X, Down = −X, Left = −Y, Right = +Y** |
| Units | Unreal centimetres, Z up. Rotations in degrees. |

A tile's identity is its tag set:

| Tag | Meaning |
|---|---|
| `Layout.Type.Tile` | This layout is a top-level tile |
| `Tile.Biome.<Name>` | Which biome |
| `Tile.MazeDirection.<Up\|UpDown\|UpRight\|UpRightDown\|All>` | **Opening signature** |
| `Tile.Layer.<Floor\|Sky\|Underground>` | Vertical band. Omit for "any layer" |
| `Tile.HandlesHeight.Decrease` | The "floor drops away here" variant |

### Maze directions are canonical, not absolute

This trips up everyone once.

| Direction tag | Openings (canonical) | Shape |
|---|---|---|
| `Up` | +X | dead end |
| `UpDown` | +X, −X | straight corridor |
| `UpRight` | +X, +Y | corner |
| `UpRightDown` | +X, +Y, −X | T-junction |
| `All` | all four | crossroads |

**The generator rotates your tile to fit.** You author once in the canonical orientation and it's
reused for all four rotations. Never build "the version that faces east" — build the canonical one.

A layout can carry several direction tags, making it eligible for all of them. That's how
direction-agnostic tiles work.

## 11.5 Anatomy of a layout

A layout is an ordered list of **layout objects**, plus layout-level properties:

| Layout property | Meaning |
|---|---|
| `gameplay_tags` | What this layout is (see above) |
| `weighted_chance` | Selection weight among matching layouts. Base default **1000** |
| `world_gen_priority` | Ordering when objects are placed. Base default **1000** |

Each layout object has:

| Field | Meaning |
|---|---|
| `layout_actor_type` | One of five types (below) |
| `furniture_definition` / `layout_definition` / `enemy_spawn_point_definition` / `loot_spawn_point_definition` | A **fixed** reference. Only the field matching the actor type is read |
| `definition_filter.search_queries` | If no fixed ref: pick by tag query |
| `definition_filter.tile_requirements` | Gate: only spawn if the **tile's** tags match |
| `definition_filter.spawn_chance_over` / `_under` | Random gate |
| `definition_filter.seed_offset` | Which random stream to use |
| `transform` | Translation / rotation / scale, **relative to the parent layout** |

The five actor types:

| Type | Resolves to | Use for |
|---|---|---|
| `ProxyActor` | a furniture definition | Actual physical props |
| `Layout` | another layout, inlined at this transform | Reusable sub-arrangements |
| `EnemySpawnPoint` | an `ESP_` definition | Where enemies come from |
| `LootSpawnPoint` | an `LSP_` definition | Where loot appears |
| `VisualHelper` | nothing — authoring marker only | Alignment, notes |

There's also a `b_visual_helper` boolean on every object, independent of the type. Setting it true
makes the object authoring-only regardless of what it points at, which is a quick way to mute
something without deleting it.

> **Gotcha, and it's a nasty one:** many base-game objects carry a *stale* second reference field —
> a `Layout` object that still has a leftover `furniture_definition` next to its real
> `layout_definition`. Only the field matching `layout_actor_type` is read. If you're reading JSON by
> hand, read the right field.

## 11.6 Direct references vs. search queries

Every object either **names** a definition or **describes** one. This is the core idea of the whole
system.

| | Direct reference | Search query |
|---|---|---|
| Result | Exactly this, every time | One of a matching set, chosen by seed |
| Use for | Structure, gameplay-critical objects, anything authored | Dressing, clutter, variety |
| Survives new content | No — stays exactly as authored | Yes — new matching furniture joins the pool automatically |

The base game leans heavily on queries. That's *why* adding a well-tagged chair enriches dozens of
existing rooms ([ch. 10](10-gameplay-tags.md)).

### Query semantics — the complete rules

Each query has: a **tag list**, a **match mode**, and a **not** flip.

| Mode | Matches when the candidate… |
|---|---|
| `HasAnyExact` | has **at least one** of the query tags, matched exactly |
| `HasAnyInclParents` | has at least one of the query tags **or a descendant of one** |
| `HasAllExact` | has **every** query tag, exactly |
| `HasAllInclParents` | has every query tag, descendants counting |
| `None` | always matches (no filtering) |

**`b_not` inverts the whole query's result.**

**Multiple queries on one object are ANDed.** The any/all choice only varies *within* a single query.

Worked combinations:

| You want | How to write it |
|---|---|
| Any chair | one query: `[FurnitureType.Chair]`, `HasAnyInclParents` |
| Any chair or sofa | one query: `[FurnitureType.Chair, FurnitureType.Sofa]`, `HasAnyInclParents` |
| An office chair | two queries: `[FurnitureType.Chair]` and `[FurnitureCategory.Office]`, both `HasAnyInclParents` |
| An office chair (one query) | one query: `[FurnitureType.Chair, FurnitureCategory.Office]`, `HasAllInclParents` |
| Anything except lights | one query: `[FurnitureType.Light]`, `HasAnyInclParents`, `b_not` on |
| Small nooks only | add a query: `[Size.Small]`, `HasAnyInclParents` |

Candidates are every definition of the type's class **including subclasses**, filtered by their
`gameplay_tags`. So a `ProxyActor` query searches all furniture definitions — plain, damageable,
toggleable, storage, stations, the lot, since they all list `UFurnitureDefinition` in their
`parent_classes`. A `Layout` query searches all layouts.

### The order things are decided in

An object goes through four gates, and knowing the order tells you which one to look at when
something doesn't appear:

1. **Configured?** No reference and no queries → nothing, permanently.
2. **Tile requirements** matched against the tile's tags → skipped for this tile if not.
3. **Spawn chance** rolled → skipped for this seed if outside the window.
4. **Resolve** — take the direct reference, or draw from the query matches.

Tile requirements are checked before the dice, so a poster gated to the Kids biome doesn't consume a
roll in the Warehouse.

## 11.7 Tile requirements

Same query language, evaluated against **the tile's** tags rather than a candidate's. Fail → the
object is skipped entirely.

This is how one layout serves several contexts. Author the union of everything that could be there,
then gate the differences:

- A poster that only appears in `Tile.Biome.Kids`.
- Wall segments that suppress themselves when the neighbouring tile is empty.
- A decoration only on `Tile.Layer.Underground`.

Use the toolbar's **tile tags override** to preview each context. Leave it empty and the resolver
falls back to the layout's own `gameplay_tags`, which is why an unedited tile mostly looks right
without touching it.

The override picker is scoped to `Tile.*` — that's the vocabulary a tile context has. For a faithful
preview of a real tile, set:

```
Tile.Biome.<Biome>
Tile.MazeDirection.<Dir>
Tile.Layer.<Floor|Sky|Underground>
Tile.Rotation.0
Tile.Offset.MazeOpening.<Up|Down|Left|Right>   (one per open side)
```

Without the rotation and maze-opening tags, wall layers won't behave the way they will in game.

One consequence of the fallback: as soon as you put *anything* in the override, the layout's own tags
stop applying. If a requirement checks `Layout.Type.Tile` — which the override can't supply — that
object will read as filtered until you clear the override again.

## 11.8 Seeds and spawn chance

| Field | Behaviour |
|---|---|
| `spawn_chance_over` / `spawn_chance_under` | A window in `[0,1)`. The roll must land inside it. Defaults `0`/`1` = always spawn |
| `seed_offset` | `-1` = roll independently (derived from the object's index). Any other number = use that stream |

Two techniques follow:

**Correlate objects.** Give two objects the **same** `seed_offset` and they roll together — both
appear or neither does, and query-driven ones pick the *same* definition. That's how you make a
matching pair of chairs, or a table with its chairs.

**Partition a slot.** Give several mutually-exclusive options the same `seed_offset` and
non-overlapping chance windows (`0–0.33`, `0.33–0.66`, `0.66–1.0`). Exactly one fires. The base game
uses this for bench groups: one slot yields exactly one station.

The toolbar seed drives the whole preview; `Reroll` steps it.

Two details that bite:

- The offset is *added* to the seed, so `seed_offset: 4` and an object sitting at index 4 with `-1`
  land on the same stream and correlate by accident.
- The chance roll and the query draw come from the same stream, which is why two objects sharing an
  offset also pick the same definition — the feature above, seen from the other side.

> **Honest limitation**
>
> The editor's random number generator is a deterministic stand-in, not a byte-identical
> reimplementation of the engine's. The same seed always gives you the same preview here, but the
> engine may pick differently for that seed. The preview is for judging **density, distribution and
> whether your queries resolve** — not for predicting one exact playthrough.
>
> The same caveat covers a quirk you'll notice: in the preview, two instances of the same nested
> layout resolve to identical contents, because each inner object's stream comes from the seed and
> its index *inside* that sub-layout, not from where the parent placed it. Judge a sub-layout on its
> own; don't read "both nooks got the same lamp" as a data problem.

## 11.9 The tile spine — what you must NOT build

Every standard gameplay tile places one object that brings the entire structure with it:

```
LAYOUT  LYD_TileBase  @ (0,0,0)
```

which expands to:

```
LYD_TileBase
├── LYD_Floor_MixedBiome_Scaled   floor slab (Z-scaled ×1 Sky / ×10 Floor / ×100 Underground)
├── LYD_MazePathFiltered          maze rails (only for certain biomes, tile-requirement gated)
├── LYD_Wall_AllSide_MixedBiome   perimeter walls, one per side
│   └── LYD_Wall_OneSide_…        5 segments spaced 300 uu
│       └── LYD_Wall_Single_…     picks the right wall furniture by biome tag
└── LYD_Ceiling_MixedBiome        ceiling, by biome
```

**The wall layer is neighbour-aware.** Each side suppresses itself when the neighbour is empty, at a
different height, or when that side has a maze opening.

> ### Never place perimeter walls by hand.
>
> They come from `LYD_TileBase`. Adding your own duplicates them, breaks doorways, and makes the tile
> impossible to re-skin. Interior dividers are fine — perimeter walls are not.

Exceptions exist in the base data and are deliberate: the `_Decrease` height-drop tiles use
`LYD_Floor_Decrease` instead; entrance tiles use `LYD_ShowFloor_Base`; `LYD_Empty` / `LYD_Blocked` /
`LYD_SkyEmpty` / `LYD_SkyCeiling` have no base at all.

A handful of `All` (crossroads) tiles *do* hand-build walls — because an all-open tile has every side
suppressed, so they construct a room with doorways instead. Note the trade-off: those tiles can't be
re-skinned by changing the shared wall layer.

## 11.10 The standard tile skeleton

Every well-formed gameplay tile has this spine plus its content:

```
LAYOUT            LYD_TileBase          @ (0,0,0)
ENEMY_SPAWN_POINT ESP_<Biome>           @ (51,0,0)          — exactly one
LOOT_SPAWN_POINT  LSP_<Biome>_Floor     × 3, seed_offset 19, 20, 21
LOOT_SPAWN_POINT  LSP_<Biome>_Furniture × 0–3, seed_offset 22, 23, 24 (optional)
LAYOUT            LYD_Benches_ByBiome   @ (0,0,0), spawn_chance_under 0.35  — last object
```

The LSP names come from the biome definition's `floor_lsp` / `furniture_lsp`. The fixed seed offsets
(19–24) are a convention, not a rule — they keep the rolls independent and stable across variants.

Copy this skeleton for any new gameplay tile. It's the difference between a room that participates in
the game's systems and a room that's just scenery.

## 11.11 The reusable sub-layout library

Tiles compose most of their content from **query-driven nested layouts**, so a tile improves as the
content pool grows:

| `Layout.Type.*` | What it is | Typical placement |
|---|---|---|
| `Tile` | Top-level tile | What the generator picks |
| `Quarter` | A room or quadrant fill | Quadrant centres |
| `Nook` | A wall recess. Tagged `Size.Small` or `Size.Medium` | Backed against a wall, ±575…±750 |
| `Display` | Free-standing product display or counter | Open floor, quadrants |
| `Rack` → `Rack.Shelf` → `Rack.Shelf.Item` | Warehouse shelving, three levels of nesting | Rows |
| `BenchGroup` | Crafting/production stations | See below |

Generic props are `ProxyActor`s selected by `Entity.RandomGeneration.FurnitureType.*` narrowed by
`FurnitureCategory.*`.

### Nook facing convention

A nook's yaw is the **compass direction of the wall it backs onto**:

| Wall | Position | Yaw |
|---|---|---|
| +X | `(575, t)` | `0` |
| +Y | `(t, 575)` | `90` |
| −X | `(−575, t)` | `180` |
| −Y | `(t, −575)` | `−90` |

Follow it. Mixed conventions in one tile are extremely hard to debug visually.

### Bench groups

`LYD_Benches_ByBiome` is a single dispatcher included by tiles at `spawn_chance_under 0.35` (≈35% of
tiles). It fans out by tile requirements to a per-biome group:

| Biome | Stations |
|---|---|
| ShowFloor | CraftingTableTierOne, SewingMachine, RubbishCompactor, CheckoutCounter |
| Restaurant | Oven, Microwave, RubbishCompactor, PlasticExtruder, PizzaOven, CoffeeMachine, Dishwasher |
| Gardening | SawBench, CraftingTableTierOne, WeaponBench, Kiln, PlantPot |
| Warehouse | SawBench, ArmorBenchTier1, CraftingTableTierOne, Furnace, WeaponBench |
| Kids | PlushMachine, CraftingTableTierOne, ArmorBenchTier1 |
| SCPBase | Printer, Cage_Basic, ResearchVat |
| Bathroom | FirstAidStation |
| CarPark | WeldingStation |

If you add a biome, it needs a bench group **and** the `LYD_Benches_ByBiome` roll in its tiles —
missing either means that biome never gets a workbench.

## 11.12 The editor

Three panes under a toolbar: outliner, viewport, details.

**Toolbar**

| Control | What it does |
|---|---|
| Layout picker | Every `LYD_*` in the project, with issue counts |
| `Save ●` | Saves **this layout only**, not the whole project. The dot means unsaved |
| `+ Add…` | Adds an object: Proxy, Layout, EnemySpawn, LootSpawn or VisualHelper |
| `Seed` + `Reroll` | The preview seed |
| `Move (W)` / `Rotate (E)` / `Scale (R)` | Gizmo mode |
| Tile tags override | Preview as a different tile context (`Tile.*` only) |

**Outliner** — the layout's objects in order, named by what each resolves to:

| Shape | Display |
|---|---|
| Direct furniture ref | `Proxy: FD_Door` |
| Query only | `Proxy: SearchQuery (3 tags)` |
| Layout ref | `Layout: LYD_TileBase` |
| Enemy spawn | `EnemySpawn: ESP_BoneHead` |
| Loot spawn | `LootSpawn: LSP_CarPark_Furniture` |
| Visual helper | `Visual Helper` |

The number in `SearchQuery (3 tags)` is the count of *queries*, not tags — three queries ANDed
together, however many tags each holds.

Shift-click extends a selection, Ctrl-click toggles, `Esc` clears. A red pip on a row means that
object failed to resolve; a banner at the top counts validation issues on the layout itself.

Only top-level objects are listed. The contents of a nested layout are drawn in the viewport but
aren't individually selectable — clicking one selects the parent `Layout` object. To edit what's
inside, pick that layout in the picker and edit it there.

**Viewport** — the boxes are **bounding boxes from the mesh catalogue, not real meshes**. Colour
tells you the state:

| Colour | Means |
|---|---|
| Neutral grey box | A proxy that resolved, at its real bounds |
| Translucent blue | A nested layout |
| Small wireframe sphere | A spawn point or visual helper — these have no mesh, so they get a fixed 40 uu marker |
| **Orange box** | Resolved, and the mesh path is set, but the mesh isn't in the catalogue — so the box is a 100 uu placeholder, not its real size |
| **Solid red** | Failed to resolve. The billboard says why |
| Yellow wireframe cage | Your current selection |

Red/green/blue axes are drawn at every object's pivot, which is the quickest way to see how a
rotation actually composes. The floor grid is 100 uu cells inside 1000 uu sections — usable as a
ruler.

Navigation is Unreal-editor style, not orbit:

| Action | Input |
|---|---|
| Look around | Right-drag (left-drag also works) |
| Fly | `W` `A` `S` `D` while dragging, `Q`/`E` for down/up |
| Speed | `Shift` 4×, `Ctrl` ¼× |
| Pan | Middle-drag |
| Dolly | Mouse wheel |
| Point back at the tile origin | `F` |
| Clear selection | Click empty space |

There are no numpad orthographic views and no double-click-to-frame. Note that `W`, `E` and `R` also
switch gizmo mode, so flying with `W` retargets the gizmo to Move as a side effect.

| Editing | Key |
|---|---|
| Duplicate selection (offset +50 uu on X) | `Ctrl+D` |
| Delete selection | `Delete` or `Backspace` |

**Details panel** — the full property editor for the selected object.

Two limits worth knowing before you plan a bulk change here:

- **The transform gizmo only appears when exactly one object is selected.** Select two and it
  disappears.
- **The details panel edits the first object in the selection.** There's no "(multiple values)" state.
  Multi-select is for delete and duplicate; everything else is one at a time.

## 11.13 Reading the status overlays

Objects that don't resolve tell you why. This table is your debugging loop:

| Overlay | Means | Fix |
|---|---|---|
| **No definition or queries** | The object is blank | Give it a reference or a query |
| **Filtered by tile requirements** | Working as designed *for this tile* | Check with the tag override before "fixing" it |
| **Spawn chance (0.00 - 0.35)** | Rolled outside that window this seed | Reroll to confirm it appears sometimes. The numbers are the window, not the odds it failed by |
| **No matching definitions** | Query too strict, or nothing carries the tags | Loosen the mode (`Exact` → `InclParents`), or fix the tagging |
| **Missing mesh: FD_Thing** | The furniture resolved but its `static_mesh` is empty | A furniture data problem, not a layout one ([ch. 6](06-furniture.md)) |
| **Layout cycle: A -> B -> A** | A nested layout references its way back to itself | Break the nesting. The message names the path |

An orange box with **no** billboard is a fifth state: the furniture resolved and names a mesh, but
that mesh isn't in the catalogue, so the editor has no bounds for it and draws a 100 uu placeholder.
The object is fine; its size on screen is a lie. Don't lay out clearances against an orange box.

**Seed-sweep before calling anything done.** A layout that looks perfect on seed 0 can be empty on
seed 7. Step through five to ten seeds watching the overlays. This one habit catches more layout bugs
than everything else combined.

## 11.14 Tips for laying out a world that plays well

The rest of this chapter is craft advice rather than mechanics — opinionated, drawn from how the base
game is built and where it has known rough edges.

**Build a kit, not a level.** Make small reusable sub-layouts — a desk unit, a shelf run, a barricade
— and compose tiles from them. That's how one improvement propagates everywhere. A tile that's 30
hand-placed props is a dead end.

**Tag before you build.** Every hour spent tagging furniture properly pays back as query reuse. You
cannot write a good query against a badly tagged content pool.

**Anchor, then dress.** Direct-reference the objects carrying gameplay meaning — the door, the
station, the container. Query-and-chance everything that's texture. A room where *everything* is
random has no identity; a room where nothing is random has no replay value.

**Keep corridor mouths clear.** Any tile with an opening has traffic through it. The base game's rule
of thumb: skip slots within about 260 uu perpendicular of an opening, within 300 uu of that side.
Blocking a doorway with a randomly-placed sofa is the most common layout bug there is.

**Respect the nook convention and stay off open walls.** Well-authored tiles put nooks only on walls
without maze openings, or keep them clear of the opening span (|y| ≥ 450 on a +X opening, for example).

**Watch the tile centre.** The centre of a 1500 × 1500 tile is the corridor crossing. Objects at
`(0,0)` sit in the middle of the junction. The base game moved every tile-scale bench slot out to
quadrants at `(±430, ±430)` for exactly this reason — clear of the corridor cross (half-width ≈ 200)
and clear of the walls.

**Measure pivots before rotating.** There is **no single forward axis** across the furniture set.
Some meshes pivot at their centre, some at a back face, some at a corner. `SM_CraftingTableTierOne`
has its body along +Y from a back-face pivot; `SM_SewingMachine` sits mostly on −Y. A yaw that's right
for one is wrong for another, and the hand-authored base fixtures are inconsistent too. Check the
bounding box in the viewport rather than copying a yaw from a neighbouring object. When in doubt,
place free-standing rather than flush to a wall — a reverse-pivot mesh then faces the wrong way but
never clips through geometry.

**Pace loot and threat together.** Where the LSPs and the ESP sit relative to the entrances *is* the
encounter design. Loot at the far end of a room from the entrance creates a decision; loot stacked on
the enemy spawn creates a mess.

**Vary with chance, theme with tile requirements.** Two different tools, constantly confused. Spawn
chance = "sometimes there's a bin here". Tile requirements = "in the Kids biome this is a toy box".

**Keep nesting shallow.** Two or three levels. Deep nests are hard to debug, easy to cycle, and the
viewport becomes unreadable.

**Use composition templates when you're stuck.** The base game's variant pass used four, and they're
a decent starting vocabulary:

| Template | Shape |
|---|---|
| **Gallery** | Content lines the walls, open centre |
| **Aisle** | A row down the closed axis |
| **Corners** | Content pushed to the four corners |
| **Islands** | Quadrant clusters with gaps between |

**Mirror carefully.** Reflecting a tile to make a variant only works if the reflection maps the
opening set onto itself: `Up` reflects across the X axis; `UpDown` and `UpRightDown` across Y;
`UpRight` across `y = x`; `All` across X. Any other reflection changes which sides are open and
desyncs the tile from its maze slot.

**Give each biome × direction more than one variant.** Players notice repetition fast. The base game
targets three or more per combination. And check your variants are actually different — the base data
had three "different" LostAndFound tiles that were byte-identical arrangements under three names.

## 11.15 Worked example: a new office-corner tile

1. **Layouts tab** → `+ Add…` isn't how you start; first create the layout record. In the
   **Definitions** tab, create a new `ULayoutDefinition` in `layout_definitions` named
   `LYD_Office_Corner`. Set `gameplay_tags` to:
   `Layout.Type.Tile`, `Tile.Biome.ShowFloor`, `Tile.MazeDirection.UpRight`, `Tile.Layer.Floor`.
2. Back in **Layouts**, pick it in the layout picker. Empty scene.
3. Set the **tile tags override** to the faithful preview set (§11.7) including `Tile.Rotation.0` and
   the two maze-opening tags for `UpRight` (+X and +Y).
4. `+ Add… → Layout`, set its reference to `LYD_TileBase` at `(0,0,0)`. Walls, floor and ceiling
   appear. **Do not add walls yourself.**
5. `+ Add… → EnemySpawn` → `ESP_ShowFloor` at `(51,0,0)`.
6. `+ Add… → LootSpawn` three times → `LSP_ShowFloor_Floor`, seed offsets 19, 20, 21. Place them away
   from the two open sides (+X and +Y) — put them toward the −X/−Y corner.
7. Now the content. `+ Add… → Proxy`, and instead of a direct reference give it a search query:
   `[Entity.RandomGeneration.FurnitureType.Desk]`, `HasAnyInclParents`.
   **You'll probably get "No matching definitions"** — there may be no `Desk` type tag. This is the
   normal way to discover the vocabulary: loosen to `FurnitureType.Table` plus
   `FurnitureCategory.Office` and it resolves.
8. Position it in a quadrant at roughly `(−430, −430)`, clear of both corridor mouths.
9. Add a chair with the **same `seed_offset`** as the desk so they appear together, offset a little
   in front of it.
10. Add two nooks against the −X and −Y walls at ±575, with the correct yaw (180 and −90).
11. `+ Add… → Layout` → `LYD_Benches_ByBiome` at `(0,0,0)`, `spawn_chance_under 0.35`, as the last
    object.
12. **Seed-sweep.** Step the seed ten times. Watch for: anything landing in a corridor mouth, the
    room ever being completely empty, the same furniture every time (a sign your query only matches
    one thing).
13. `Save`. Then register it — §11.16.
14. **Validations** for dangling refs.

## 11.16 Registering a new layout

1. The file is `layout_definitions/LYD_<Name>.json`; `id` must equal the filename stem. Set
   `asset_path` to something plausible like
   `/Game/WorldGeneration/Layouts/<Biome>/<Direction>/<Id>`.
2. **Tags are what make it selectable.** A tile layout needs `Layout.Type.Tile`, its
   `Tile.Biome.<Name>`, and at least one `Tile.MazeDirection.*`. Without these the generator will
   never consider it.
3. **Also add the id to the owning biome's `layouts` array** in `biome_definitions/BD_<Biome>.json`
   (Definitions tab). Runtime selection is tag-driven and does *not* read this list, so a missing
   entry won't stop your tile appearing — but the base data keeps it in sync with the tags and
   tooling reads it, so an unlisted layout is inconsistent with everything around it.
4. No manifest edit is needed. Layouts are discovered by scanning the folder.
5. Set `weighted_chance` if you want it more or less common than its siblings (base default 1000).

---

## Gotchas

- **Placing perimeter walls by hand.** They come from `LYD_TileBase`. Yours will duplicate, block
  doorways, and defeat re-skinning.
- **Authoring for a specific rotation.** The generator rotates tiles. Author canonical
  (Up = +X, Right = +Y) and let it place them.
- **Objects at `(0,0)`.** That's the corridor junction on a 1500 uu tile.
- **Stale second reference fields.** Only the field matching `layout_actor_type` is read; base files
  often carry a leftover other one.
- **Assuming the preview's random picks match the game's.** Same seed, same preview — but the engine
  rolls its own way. Judge distribution, not specific outcomes.
- **Expecting multi-select to edit properties.** It deletes and duplicates; the details panel edits
  the first selected object, and the gizmo hides entirely above one selection.
- **Measuring against an orange box.** That's a 100 uu placeholder for a mesh missing from the
  catalogue, not the object's real size.
- **Deep nesting and cycles.** A cycle renders as a solid red error; keep nesting to 2–3 levels.
- **Forgetting the tile skeleton.** No ESP and no LSPs means a room with no enemies and no loot. It
  will look fine in the viewport and be pointless in game.
- **Adding a biome without a bench group.** The 35% bench roll then always yields nothing.

---

Next: [Validations →](12-validations.md)
