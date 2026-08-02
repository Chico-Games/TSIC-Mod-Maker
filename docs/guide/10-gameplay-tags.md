← [Previous](09-enemies-and-ai.md) | [Index](README.md) | Next: [Laying out the world →](11-laying-out-the-world.md)

# 10. Gameplay tags

**What you'll be able to do**

- Read the tag hierarchy and understand parent/child matching.
- Know which systems tags actually drive.
- Tag new content so the world can find it.

A short chapter that everything in [chapter 11](11-laying-out-the-world.md) depends on.

---

## Tags are a tree

A gameplay tag is a dotted path:

```
Furniture.Seating.Chair
Entity.RandomGeneration.FurnitureType.Chair
Tile.Biome.ShowFloor
Craft.Bench.CraftingTable
```

Each dot is a level. `Furniture.Seating.Chair` is a **child** of `Furniture.Seating`, which is a child
of `Furniture`. That relationship is the whole point: a query can ask for `Furniture.Seating` and
match every kind of seating without listing them.

The editor's **tag picker** shows the real tag tree loaded from the game, so you pick from what exists
rather than typing strings and hoping. Typos are the most common tag bug, and the picker removes them.

Two things about it are worth knowing:

- It has a **flat list** and a **tree** view. The list is faster when you know roughly what the tag is
  called; the tree is how you learn a family you haven't used.
- Some fields **restrict it to one root**. The Layouts tile-tag override only offers `Tile.*`, because
  that's the only thing a tile context can contain. If a picker seems to be missing tags, it's
  scoped, not broken.

Pressing Enter accepts free text, which is how you use a tag the bundled catalogue doesn't have yet.
It's also how you introduce a typo, so use it deliberately.

## Exact vs. including-parents

Every tag query chooses one of two matching styles:

| Style | `Furniture.Seating` matches… |
|---|---|
| **Exact** | only something tagged literally `Furniture.Seating` |
| **Including parents** | anything tagged `Furniture.Seating` **or any descendant** — `Furniture.Seating.Chair`, `Furniture.Seating.Sofa`, … |

The name reads backwards the first time. "Including parents" is from the *target's* point of view — a
chair tagged `Furniture.Seating.Chair` counts as having `Furniture.Seating`, because that's its
parent. It's the mode you usually want when describing a *category*. Exact is for when you mean
precisely that tag and nothing below it.

This distinction is responsible for a large share of "why does my query find nothing" — see
[chapter 11](11-laying-out-the-world.md), where it's most visible.

## Where tags actually do work

| System | Tag used | Effect |
|---|---|---|
| **Layout search queries** | `Entity.RandomGeneration.*` and friends on furniture | Decides which furniture can be picked for a slot |
| **Tile requirements** | `Tile.Biome.*`, `Tile.MazeDirection.*`, `Tile.Layer.*` | Decides whether an object spawns on this tile at all |
| **Crafting** | `Craft.Bench.*` in a recipe's `crafting_bench_tags` | Which benches can run the recipe |
| **Recipes** | `recipe_tags` | Grouping and filtering |
| **Biomes** | `biome_tag` | The biome's identity in world generation |
| **Loot spawn points** | `gameplay_tags` (under `Tile`) | Filtering where a spawn point applies |

The important families to know:

- **`Tile.*`** — describes a tile: its biome, layer, maze openings, rotation, and what's next to it.
- **`Entity.RandomGeneration.FurnitureType.*`** — what a piece of furniture *is*: `Chair`, `Table`,
  `Sofa`, `Counter`, `Shelf.Floor`, `Sign.Floor`, `Light.Floor`, `Light.Wall`, `Mat`, `Door`.
- **`Entity.RandomGeneration.FurnitureCategory.*`** — what *style* it is: `LivingRoom`, `Bedroom`,
  `DiningRoom`, `Office`.
- **`Entity.RandomGeneration.Size.*`** — `Small`, `Medium`, used to fit things into nooks.
- **`Layout.Type.*`** — what kind of layout this is: `Tile`, `Quarter`, `Nook`, `Display`, `Rack`,
  `BenchGroup`.
- **`Craft.Bench.*`** — bench categories.

## Tagging is a design activity

When you add a new chair to the game and give it `Entity.RandomGeneration.FurnitureType.Chair` plus
`Entity.RandomGeneration.FurnitureCategory.Office`, you have not just labelled it. You have made it
eligible for **every layout in the game that asks for an office chair** — including layouts written
before your chair existed, and layouts in other people's mods.

That's how the base game stays extensible: tiles almost never name specific furniture. They describe
what they want, and the content pool answers. Adding well-tagged furniture enriches the whole world
for free.

The inverse is also true. **Untagged furniture is invisible to the world.** It exists, it can be
placed by hand in a specific layout, and it will never be picked by any query. If you're wondering why
your new content never shows up in generated levels, check its tags first.

## Practical tagging rules

1. **Copy the tags of the closest existing thing**, then adjust. Duplicating a record gets you this
   for free.
2. **Tag by what it is, not where you plan to use it.** `FurnitureType.Chair` is durable;
   `GoesInMyNewRoom` is not.
3. **Use the picker, never type.** A typo'd tag matches nothing and reports no error.
4. **Tag the size** if it's meant to fit into a nook or display slot — `Size.Small` / `Size.Medium`.
5. **Check with a query before you rely on it.** The Layouts tab will tell you how many definitions a
   query matches — see the next chapter.

## Finding out what a tag matches

The Layouts editor is the practical tag debugger: build a search query, and objects using it either
resolve or show `No matching definitions found`. If you're unsure whether your tagging worked, make a
throwaway layout object with that query and look.

---

## Gotchas

- **A typo'd tag is silent.** No error, no warning, just nothing ever matches.
- **Exact vs. including-parents is not cosmetic.** A query for `Furniture.Seating` in exact mode
  matches nothing if every actual chair is tagged `Furniture.Seating.Chair`.
- **Tags are additive, not exclusive.** Something can be `Chair` and `Office` and `Small`. Queries
  combine, so more tags generally means *more* eligible, not less.
- **Removing a tag can silently empty someone else's query.** Tags are a shared contract. Where-Used
  doesn't track tag usage — search the layouts if you're removing a tag from a family of objects.

---

Next: [Laying out the world →](11-laying-out-the-world.md)
