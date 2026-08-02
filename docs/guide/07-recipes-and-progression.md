← [Previous](06-furniture.md) | [Index](README.md) | Next: [Loot and drops →](08-loot-and-drops.md)

# 7. Recipes, stations and progression

**What you'll be able to do**

- Author a recipe and make it available at the right bench.
- Understand ARRs — the thing that decides what a station can make.
- Set up plant grow stages.
- Use the tech tree views to sanity-check progression before you playtest.

---

## What a recipe is

Every recipe shares the same core, whatever its class:

| Property | Meaning |
|---|---|
| `input` | Item → quantity. What it consumes. |
| `output` | Item → quantity. What it produces. |
| `duration` | Seconds to complete. |
| `level` | Minimum **station level** required. |
| `recipe_tags` | Tags on the recipe itself. |

Three classes build on that:

| Class | Adds | Used by |
|---|---|---|
| `UCraftRecipeDefinition` | `crafting_bench_tags` | Ordinary crafting |
| `UPlantRecipeDefinition` | grow stages | Plantable stations |
| `UFurnitureUpgradeRecipe` | an upgrade target | Furniture upgrades |

The recipe card in the Stations sub-tab changes shape depending on which class it is, so you always
see the fields that class actually has. A craft recipe reads as inputs on the left, output on the
right, and the numbers that gate it underneath:

```ui-recipe
title :: RD_MetalPanel_CR
in :: ID_SteelPanel_CM ×10 | ID_MetalScrews_CM ×12
out :: ID_MetalPanel_CM ×1
meta :: 16s · station level 3 · Craft.Bench.CraftingTable
```

Every slot on that card is a drop target — drag an item from the palette onto one to change it.

## ARRs — how a station knows what it can make

A station does not contain its recipes. It references an **Available Recipe Rules** definition (an
"ARR"), and the ARR holds the list:

```
FD_CraftingTableTierOne  ──available_recipe_rules_definition──▶  ARR_CraftingTableTierOne
                                                                  ├── RD_MetalPanel_CR
                                                                  ├── RD_Screws_CR
                                                                  └── …
```

So:

- **To add a recipe to a station**, add it to that station's ARR.
- **Several stations can share one ARR** — change it once, every station updates.
- **A recipe can be in more than one ARR** — the same recipe at multiple benches.

In the **Recipes & Loot → Stations** sub-tab, pick a station on the left and its ARR's recipes render
as cards on the right. Drag a recipe card onto a different station's row to **move** the reference
between ARRs. The recipe file doesn't move — only the id in the two lists changes.

> **Why it's built this way**
>
> A station's list of recipes is a gameplay decision that changes often; the station's physical
> properties don't. Splitting them means a balance pass touches one small ARR file instead of every
> station definition, and mods that only re-balance crafting can ship a handful of ARRs.

"Station" here means crafting stations, production stations **and plantables** — all three carry an
`available_recipe_rules_definition`, and all three are checked.

Validations covers the failure modes: `station has no ARR`, `station ARR missing`, `orphan ARR` (an
ARR nothing points at), `empty ARR` (a station that offers nothing).

## Bench tags — the other half of the handshake

`crafting_bench_tags` on a craft recipe declares which kinds of bench can run it (tags under
`Craft.Bench`). Together with the ARR list, this is how the game decides what's craftable where.

Rules of thumb:

- **ARR** = the explicit list. Authoritative, per-station.
- **Bench tags** = the category constraint on the recipe side.

If a recipe isn't showing up at a bench you expected, check both.

## Levels

`level` is a **station level** requirement, not a player level. A level-3 recipe needs a station
upgraded to at least level 3. This is why furniture upgrade recipes and crafting progression are the
same subject: upgrading the bench is what unlocks the recipes.

When you add a high-level recipe, make sure there's a reachable upgrade path to a station that can
run it.

## Plant recipes and grow stages

`UPlantRecipeDefinition` adds **grow stages** — the sequence a plant passes through. The Stations
sub-tab shows the grow-stages editor for plantable stations.

Each stage carries its own timing and appearance. Author them in order; the editor's array controls
let you insert, reorder and remove. The seed item that starts the process lives in
`seed_item_definitions` ([ch. 5](05-items.md)).

## Furniture upgrade recipes

Covered in [chapter 6](06-furniture.md), because they're edited on the furniture page. Mentioned here
because they're recipes: they consume inputs and produce a *furniture change* rather than an item.

## The tech tree

**Recipes & Loot → Tech Tree** builds a graph of items, recipes and stations from your loaded data.
It's a review tool — you can't edit here — and it has five views:

| View | Answers |
|---|---|
| 🕸️ **Chain** | "What feeds into and out of this?" The crafting web around one thing. |
| 🪜 **Ladder** | "What order does the player unlock things in?" Everything by tier. |
| 🧾 **Cost** | "What does this cost in raw materials, all the way down?" |
| 🎯 **Chokepoints** | "Which materials does the tree lean on?" |
| 🚩 **Audit** | "What's structurally broken?" |

Use them in this order when balancing:

1. **Audit** first — fix anything broken before reasoning about balance.
2. **Chokepoints** — find the items everything funnels through. These are your difficulty dials, and
   also your single points of failure.
3. **Cost** — check that deep-tier items cost meaningfully more than shallow ones in raw terms.
4. **Ladder** — confirm the unlock order tells the story you intend.
5. **Chain** — for orientation when you're lost. Click a node to trace it, double-click to open it.

### What Audit checks

Six groups, and knowing the exact list keeps you from trusting it for things it doesn't cover:

| Group | Severity | Means |
|---|---|---|
| Recipes that produce nothing | error | Empty `output` and no upgrade target |
| Recipes on no station | error | In no ARR, so unreachable. Furniture upgrades are excluded — they come from the build flow |
| Referenced but undefined | error | An id something points at that no definition claims |
| Cannot be reached from raw materials | error | Every recipe producing it also requires it, directly or in a loop |
| Craftable but never used | warning | Produced, consumed by nothing. Fine for final gear, suspicious for intermediates |
| Deepest chains | info | The longest dependency paths, for pacing |

Note what's *not* there: an item that nothing produces at all. To the graph that's a raw material,
indistinguishable from scrap metal, so an item you forgot to give a recipe or a loot entry looks
perfectly healthy here. Where-Used is the only check for that.

## Worked example: a new craftable item

1. Create the item ([ch. 5](05-items.md)). Make sure its `_SI` partner has a mesh.
2. **Recipes & Loot → Stations**, pick the station you want it made at.
3. Create a new recipe. Set `input` (drag items from the palette into the input cells), `output`
   (your new item), `duration` and `level`.
4. Set `crafting_bench_tags` to match the bench type.
5. Confirm the recipe appears in the station's ARR — if you created it from the station's page it's
   already there.
6. Open **Tech Tree → Cost** and check the total raw cost against similar-tier items.
7. `Save`, check **Validations** for `recipe has no inputs` / `recipe has no outputs`.

---

## Gotchas

- **A recipe not in any ARR is invisible in game.** It exists, it's valid, nothing can make it.
  Validations only looks at this from the station side, so it's the tech tree audit's "Recipes on no
  station" group that catches it.
- **`level` is the station's level, not the player's.** A level-4 recipe at a bench that can't reach
  level 4 is unreachable content.
- **Dragging a recipe card between stations moves it.** It leaves the source station's ARR. To have
  it at both, add it to the second ARR instead of dragging.
- **Editing a shared ARR changes every station that references it.** Where-Used before you edit.
- **Recipes reference items, not static items.** `input`/`output` take item definitions. If a picker
  is showing you `_SI` records, you're in the wrong field.
- **Zero-input recipes are legal.** They produce something from nothing. Occasionally intended,
  usually a mistake; validations flags them.

---

Next: [Loot and drops →](08-loot-and-drops.md)
