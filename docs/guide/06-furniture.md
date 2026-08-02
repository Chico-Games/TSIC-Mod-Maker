← [Previous](05-items.md) | [Index](README.md) | Next: [Recipes and progression →](07-recipes-and-progression.md)

# 6. Furniture

**What you'll be able to do**

- Choose the right furniture folder for a new piece.
- Edit what a piece of furniture drops when destroyed.
- Wire up upgrade recipes.
- Understand how furniture connects to layouts, loot and crafting.

---

## Furniture is the world

Everything physically placed in a TSIC world is a furniture definition: walls, floors, chairs,
shelves, crafting benches, vending machines, doors, elevators. When [chapter 11](11-laying-out-the-world.md)
talks about placing objects in a room, it's placing furniture definitions.

The Furniture tab uses the same browser as Items, with a rail of eighteen sub-tabs.

## Choosing a folder

| Sub-tab | Folder | Use when the piece… |
|---|---|---|
| Furniture | `furniture_definitions` | …is plain scenery with no special behaviour |
| Damageable | `damageable_furniture_definitions` | …can be destroyed (has health, drops loot) — **the largest folder by far**, 436 records |
| Toggleable | `toggleable_furniture_definitions` | …switches between states (doors, lights) |
| With Components | `furniture_with_components_definitions` | …needs extra runtime components |
| Storage | `storage_definitions` | …holds items |
| Universal Storage | `universal_storage_definitions` | …is shared storage |
| Crafting Stations | `crafting_station_definitions` | …the player crafts at |
| Production Stations | `production_station_definitions` | …produces over time |
| Plantable | `plantable_definitions` | …grows things |
| Elevator | `elevator_definitions` | …carries the player between floors |
| Teleporter | `teleporter_definitions` | …moves the player somewhere else |
| Death Box | `death_box_definitions` | …holds a dead player's stuff |
| Containment Cage | `containment_cage_definitions` | …contains a creature |
| Shopping Cart | `shopping_cart_definitions` | …is a pushable container |
| Spawn Points | `spawn_point_definitions` | …marks where players start |
| Enemy Spawn Points | `enemy_spawn_point_definitions` | …marks where enemies come from |
| Interactable Text | `interactable_text_definitions` | …shows readable text |
| HTML Game | `html_game_definitions` | …is a playable in-world mini-game. Empty in the base data |

**The decision tree that covers 90% of cases:**

1. Can the player break it? → **Damageable**.
2. Can the player craft at it? → **Crafting Stations** (or **Production Stations** if it runs
   unattended over time).
3. Does it hold items? → **Storage**.
4. Does it toggle? → **Toggleable**.
5. Otherwise → **Furniture**.

If you're wrong, you're not stuck — but moving a definition between folders later means moving the
file, and every layout referencing it keeps working (references are by id, not path).

## Death loot

Damageable furniture drops loot when destroyed, via `loot_dropped_on_death` — a list of references to
`LootDefinition` records.

In the **Recipes & Loot → Furniture** sub-tab, each death-loot reference **expands in place** to show
the linked loot table's editor. You don't tab away, you don't lose your place — the table opens
underneath the furniture that uses it.

A `LootDefinition` entry is:

| Field | Meaning |
|---|---|
| Item to drop | The item definition |
| Count | How many |
| Chance to drop | 0–1 probability |

Multiple entries roll independently, so a table with three 50% entries can drop none, some or all.

**Reuse tables.** Most chairs should share one chair-debris table rather than each having their own.
Check Where-Used before creating a new one — you'll usually find an existing table that fits, and
editing it improves everything at once.

## Tier chains

Every furniture sub-tab groups its rail by family. A workbench that exists at three levels shows as
one row with `base` `T1` `T2` pills under it; click a pill to edit that tier, `×` to delete it. A
piece with no upgrades is just a plain row.

The `＋` on the family row **mints the next tier and the recipe that links to it** — a new furniture
definition plus a `UFurnitureUpgradeRecipe` pointing the current top tier at it. You still have to
fill in the cost and adjust the stats, but the wiring is done.

## Upgrade recipes

Furniture is upgraded into other furniture by `UFurnitureUpgradeRecipe` records (122 in the base
game), edited inline on the furniture page — no tab switch.

An upgrade recipe needs:

- A **target**, in `upgraded_furniture_definition` — what the piece becomes.
- **Costs** — item references and quantities, in `input`.

The output map stays empty; an upgrade produces a furniture change, not an item, which is why
validations exempts this class from the "recipe has no outputs" check.

Validations flags upgrade recipes whose target is unset (`upgrade missing target`) or points at
something that doesn't exist (`upgrade target missing`). Both mean an upgrade the player can never
complete.

## Stations

Crafting and production stations are furniture *and* recipe hosts. Their gameplay content — which
recipes they offer — lives in the **Recipes & Loot → Stations** sub-tab, covered in
[chapter 7](07-recipes-and-progression.md). The Furniture tab cross-links there for exactly this reason.

Editing the *physical* station (health, mesh, storage) here; editing *what it can make* there.

## Furniture and meshes

The `static_mesh` property points at the mesh the world will render, in Unreal's `Package.Object`
form:

```
/Game/Furniture/WareHouse/Meshes/SM_Box1_01.SM_Box1_01
```

It matters beyond looks: the Layouts editor draws each object's bounding box from the mesh catalogue,
so **furniture with no mesh shows up as a "Missing mesh" error when you try to place it in a room**.

You can also point it at a mesh your own mod ships — drop a `.glb`, `.obj` or `.fbx` in the mod folder
and reference the imported path ([ch. 1](01-what-youre-editing.md#shipping-your-own-art-and-audio)).
The editor's catalogue won't know it, so the Layouts viewport draws an orange placeholder box at the
wrong size; that's an editor limitation, not a data problem.

Mesh pivots in the base game are not consistent — some are centred, some sit on a back face, some on
a corner. This matters when you rotate things in a layout; [chapter 11](11-laying-out-the-world.md)
covers it.

## Worked example: a destructible crate that drops its contents

1. **Furniture → Damageable**, duplicate an existing crate.
2. Rename, set health and mesh in Detail.
3. Go to **Recipes & Loot → Furniture**, find your crate.
4. Under death loot, add a reference to an existing debris table, or create a new `LD_` record.
5. Expand the table inline and set the items, counts and chances.
6. If you want players to be able to *build* the crate: create a constructable item
   ([ch. 5](05-items.md)) pointing at this furniture, then a recipe for that item
   ([ch. 7](07-recipes-and-progression.md)).
7. If you want it to appear in the world naturally, tag it so layout queries can find it
   ([ch. 10](10-gameplay-tags.md)) and reference it from a layout ([ch. 11](11-laying-out-the-world.md)).
8. `Save`, check **Validations**.

---

## Gotchas

- **A furniture definition nothing references never appears.** It must be placed by a layout, built
  by a constructable, or spawned some other way. Creating it is not enough.
- **Death loot names item definitions (`ID_`), not static items.** The game resolves the physical
  form through the item's own `static_item_definition`, so a missing or mesh-less `FD_…_SI` partner
  still means players destroy the crate and see nothing.
- **Damageable furniture with no death loot is valid** — it just vanishes when destroyed. Sometimes
  that's what you want; usually it isn't.
- **Editing a shared loot table affects everything using it.** Where-Used first. If you want a
  variant, duplicate the table.
- **Missing `static_mesh` breaks the layout editor, not just the look.** You'll see "Missing mesh" in
  the viewport and the object won't render.

---

Next: [Recipes, stations and progression →](07-recipes-and-progression.md)
