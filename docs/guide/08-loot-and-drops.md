← [Previous](07-recipes-and-progression.md) | [Index](README.md) | Next: [Enemies and AI →](09-enemies-and-ai.md)

# 8. Loot and drops

**What you'll be able to do**

- Tell the three kinds of loot apart and know which one to reach for.
- Author difficulty-tiered world loot.
- Set up enemy drops and furniture debris.
- Change what a whole biome spawns on its floors.

---

## The Loot tab

**Recipes & Loot → Loot** is where all of it is edited. The rail on the left switches between the
three kinds of loot; the list on the right is every item you can add.

- **Click an item on the right to add it** to whatever is open in the middle. There is nothing to
  drag and no reference field to fill in.
- Each row shows the item's icon and name, with its id underneath — click the id to open the item.
- The editor does the arithmetic the raw numbers hide: a drop table shows the average yield per break,
  a weighted list shows each row's share of picks as a bar and a percentage.
- **Dropped by / Used by** under the title lists everything that points at the table. A table nothing
  uses is tagged `unused` in the rail; an empty one is tagged `empty`.
- **Duplicate** copies a table under a new name — the safe way to change loot for one thing when the
  original is shared.

You can also arrive here from the things that use loot: a furniture's **Death loot** row and a biome's
loot cards both have an **Edit loot** button that opens the right table.

## There are three kinds of loot

They look similar and do different jobs. Getting this right saves a lot of confusion.

| | Drop tables | World loot | Enemy drops |
|---|---|---|---|
| **Definition** | `LootDefinition` (`LD_`) | `LootSpawnPointDefinition` (`LSP_`) | `death_drop_table` on the enemy (`ED_`) |
| **Used by** | Furniture death loot | World generation — loot placed into tiles | The enemy itself |
| **Names** | Item definitions (`ID_`) | Static item definitions (`FD_…_SI`) | Static item definitions (`FD_…_SI`) |
| **Structure** | Flat list of entries | Buckets keyed by store difficulty | Flat weighted list |
| **Roll** | Every entry rolls its own chance | One chance roll, then one item by weight | Always exactly one item, by weight |

Short version: **a drop table is "what this furniture leaves behind", world loot is "what the world
puts here", and an enemy's drops are "what you get for killing it".**

You don't have to remember which kind names which class of item: the list on the right only offers
items that are valid for the table you have open, and shows world items under their inventory name.

## Drop tables — furniture debris

A flat list. Each entry:

| Field | Meaning |
|---|---|
| Item to drop | An item definition |
| Count | How many |
| Chance to drop | 0–1 |

Entries roll independently, so three 50% entries can give you nothing, one, two or all three. If you
want "exactly one of these", that's not this structure — use several tables or accept the variance.

**Where they're used:**

- **Furniture death loot** — `loot_dropped_on_death` on damageable furniture ([ch. 6](06-furniture.md)).
  A piece of furniture can list several tables; all of them roll.
- **Orphan tables** — `LD_` records nothing references yet. Valid, and flagged by validations as
  `orphan loot` so you don't forget about them.

To make one from scratch: **＋ New drop table**, click the title to name it, click items on the right,
set each row's count and chance. Then point a furniture at it from **Recipes & Loot → Furniture →
Death loot**.

## Enemy drops

Each enemy carries its own short list — it is a property of the enemy, not a separate definition.
When the enemy dies **exactly one** row is picked by weight and dropped as a stack of `count`. There is
no chance of nothing: to make a drop rare, give it a low weight against a common filler row.

An enemy's difficulty variants can each carry their own table, which **replaces** this one rather than
adding to it. The Loot tab edits the base table and tells you when variants override it; edit those
from the enemy's full property list.

## World loot

This is the system that fills the world, and it's tiered by difficulty. In the Loot tab each tier is a
tab of its own — **Easy**, **Normal**, **Hard** — with its spawn chance and its rows. With *Harder
stores keep the easier tiers' items* switched on, a harder tier also lists the rows it inherits from
the easier ones, dimmed and labelled with where they come from, so the percentages you see are the
real ones. A tier that hasn't been set up says which tier the game falls back to, and offers to give
it one of its own.

```
LSP_ShowFloor_Floor
├── EASY   → spawn_chance 0.35, loot_items [{FD_DurhamWater_SI, count 1, weight 1}, …]
├── NORMAL → spawn_chance …,    loot_items […]
└── HARD   → spawn_chance …,    loot_items […]
```

The difficulty keys come from a five-member enum: `EASY`, `NORMAL`, `HARD`, `NIGHTMARE`,
`APOCALYPSE`. The base game only authors the first three; the top two exist and fall back.

How a roll works — the order matters and is not the obvious one:

1. The tile has a difficulty. The LSP picks the bucket with the **largest difficulty key ≤ the tile's
   difficulty** (a floor lookup). No key qualifies → nothing spawns.
2. **One item is drawn first**, weighted, from the candidate pool. With **accumulate previous tiers**
   on (the default) the pool is every tier at or below the matched one; with it off, just the matched
   tier's own list.
3. **Then** the chance is rolled — the matched tier's `spawn_chance`, scaled by the loot multipliers
   for this biome and this LSP's source type, clamped to `[0,1]`. Fail → nothing spawns.

So the item is chosen before the coin flip, and the biome's `loot_multiplier` scales *how often
anything appears*, not how much. A multiplier of 2 on a tier with `spawn_chance 0.35` gives 0.7.

Weights are plain integers, relative within the pool. The base game uses **1, 2 and 3** — small
numbers, so adding one item at weight 3 to a pool of ten weight-1 items is a large change. (Don't
confuse this with the `weighted_chance: 1000` on the LSP itself, which is a different dial: how often
this spawn point is picked during generation.)

Two more properties matter:

- **Accumulate previous tiers** (default on) — a Hard tile can also draw from the Easy and Normal
  pools, so higher difficulty *adds* possibilities rather than replacing them. Turn it off when a
  tier should be exclusive. Note the asymmetry: it widens the item pool, but the spawn chance still
  comes from the matched tier alone.
- **Source type** — `FLOOR`, `FURNITURE`, `CONTAINER` or `ENEMY_DROP`. Feeds the per-source
  multiplier, so the game can tune "loot found on the floor" separately from "loot found in
  containers". Set it to match how the LSP is actually used.

## Biome loot

**Recipes & Loot → Biome** shows a biome's loot as three cards — on the floor, on furniture, in
containers — each previewing the table it points at, with **Edit loot** to open it, a picker to point
the biome at a different table, and **＋ New table** where there is none. Each biome definition names
them:

| Field | Typically | What it fills |
|---|---|---|
| `floor_lsp` | `LSP_<Biome>_Floor` | Loose loot on the ground |
| `furniture_lsp` | `LSP_<Biome>_Furniture` | Loot placed on/in furniture |
| `container_loot_table` | `LSP_<Biome>_Container` | Starting contents of world containers, rolled the first time a player opens one. |
| `loot_multiplier` | `1.0` | Blanket dial on spawn chance for the biome. Useful for making a late-game area richer without touching any table. |
| `loot_rarity` | | Per-rarity weighting maps. Unset in the base data. |

Changing a biome's floor LSP is the highest-leverage loot edit there is: it changes what players find
everywhere in that biome.

> **Check this one in game before you rely on it.** The engine's own note in `BiomeDefinition.h` says
> `floor_lsp` and `furniture_lsp` don't currently load: the definition reader derives a JSON key by
> inserting an underscore before every capital, so the C++ `FloorLSP` matches `floor_l_s_p`, not the
> `floor_lsp` the data actually ships. Editing these fields is still the right thing to author; just
> verify the change lands in a real session rather than assuming it.

## How loot reaches a tile

Loot doesn't appear by magic — a layout places **LootSpawnPoint objects**, which reference an LSP.
The base game's standard tile skeleton includes three floor spawn points and up to three furniture
ones. [Chapter 11](11-laying-out-the-world.md) covers placing them.

So there are three levers, and they compose:

1. **The table** (`LSP_`) — what can spawn.
2. **The biome** — which tables its tiles use, and the multiplier.
3. **The layout** — how many spawn points there are and where they sit.

Doubling loot in an area can mean editing any one of the three. Prefer the table or the multiplier;
adding spawn points changes the *feel* of a room, not just its yield.

## Reuse vs. duplicate

The base data shares tables aggressively — one debris table across dozens of chairs. Before creating
a new table:

1. Search for an existing one that fits.
2. Open it and check **Where-Used**.
3. If it's used by things that should stay as they are, duplicate. If it's used by exactly the family
   you're changing, edit in place and improve them all at once.

## Worked example: a new enemy drop that feeds a recipe

1. Create the material item and its `FD_…_SI` partner ([ch. 5](05-items.md)).
2. **Recipes & Loot → Loot → Enemy drops**, pick the enemy.
3. Click your item's world form in the list on the right, then set its count and weight. The share
   column shows what that weight means against the rows already there — start conservative, 20–30%
   for something meant to feel like a reward.
4. Add a recipe that consumes it ([ch. 7](07-recipes-and-progression.md)) so it has a purpose.
5. If it should also be findable in the world, open the biome's floor table (**Biome → On the floor →
   Edit loot**) and add it at weight 1 — against a pool of weight-1 items that's already a fair share, so don't go higher
   without meaning it.
6. `Save`, check **Validations**, then check **Tech Tree → Chokepoints** — a rare drop that gates an
   important recipe is a chokepoint, and worth being deliberate about.

---

## Gotchas

- **LSPs name static items (`FD_…_SI`), loot definitions name items (`ID_`).** Putting the wrong class
  in either produces silence, not an error.
- **A tier with no qualifying difficulty key spawns nothing.** If your lowest tier key is `HARD` and
  the tile is `EASY`, that LSP never fires there. Always define an `EASY` tier.
- **Weights are relative, not percentages.** With the base game's weights of 1–3, one new item at
  weight 3 in a ten-item pool takes roughly a quarter of the draws. Adding anything changes
  everyone else's effective rate.
- **Spawn chance gates the whole spawn point, not the item.** A tier at 0.1 is empty 90% of the time
  no matter how rich its item list is — enriching the list changes *what* you find, never *how
  often*. For that, raise the tier's chance or the biome's multiplier.
- **Editing a shared table hits everything using it.** Where-Used first, every time.
- **Orphan `LD_` records are not errors.** They're tables you haven't wired up yet. Validations lists
  them so they don't rot.

---

Next: [Enemies and AI →](09-enemies-and-ai.md)
