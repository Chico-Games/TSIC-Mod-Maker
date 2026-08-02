← [Previous](02-setup.md) | [Index](README.md) | Next: [Getting around →](04-getting-around.md)

# 3. Anatomy of a definition

**What you'll be able to do**

- Read any definition file and know what each part does.
- Work out which folder a new definition belongs in.
- Decode the naming conventions used throughout the base game.
- Understand what a reference is and why renaming by hand breaks things.

---

## A real file

`craft_recipe_definitions/RD_AnomalousArmorChestplate_CR.json`:

```json
{
  "id": "RD_AnomalousArmorChestplate_CR",
  "asset_path": "/Game/Items/Equipment/Armor/AnomalousArmor/Chestplate/Recipes/RD_AnomalousArmorChestplate_CR",
  "class": "UCraftRecipeDefinition",
  "schema_version": 2,
  "properties": {
    "recipe_tags": [],
    "input": [
      {
        "key": "ID_ResearchPaper_MaleStaff_CM",
        "value": 1
      },
      {
        "key": "ID_SteelPanel_CM",
        "value": 10
      }
    ],
    "output": [
      {
        "key": "ID_AnomalousArmorChestplate_EQ",
        "value": 1
      }
    ],
    "duration": 16.0,
    "level": 3,
    "crafting_bench_tags": []
  }
}
```

(The real file has five inputs; three are cut here.) Four header fields, then everything else lives
under `properties`.

| Field | Meaning |
|---|---|
| `id` | **The name of this definition everywhere in the game.** Must match the filename stem. This is the identity — not the path, not the filename. |
| `asset_path` | Where the original asset lived in the game project. Cosmetic for modding; keep it plausible and consistent, but nothing resolves against it. |
| `class` | Which definition class this is, and therefore which properties are valid. Determines how the editor renders it. |
| `schema_version` | Format version of the file. The editor manages it; don't hand-edit. |
| `properties` | The actual data. Shape depends entirely on `class`. |

Some files carry a fifth header field, `parent_classes` — the class's ancestry. It's what lets a
layout search query for "any furniture" also match damageable furniture, storage and stations. The
editor maintains it; don't edit it by hand.

## Folder tells you class

Every folder holds one class of definition:

```
craft_recipe_definitions/     → UCraftRecipeDefinition
damageable_furniture_definitions/ → UDamageableFurnitureDefinition
layout_definitions/           → ULayoutDefinition
biome_definitions/            → UBiomeDefinition
```

The full table of all ~50 folders is in [Appendix A](14-appendices.md#appendix-a--folder--class).

A file in the wrong folder is a real problem: overrides are matched by *path*, so a base-game record
you've filed elsewhere becomes a second, competing definition rather than a replacement.

In practice you rarely choose a folder by hand. Creating a record from within a tab puts it in the
right place, duplicating an existing record keeps it there, and if you change a record's `class` the
editor moves the file to that class's folder on the next save and deletes the old one.

## Naming conventions

The base game is consistent about these, and the editor's search and auto-partnering rely on it.
Follow it.

**Prefixes — what kind of thing:**

| Prefix | Meaning | Example |
|---|---|---|
| `ID_` | Item definition (any item) | `ID_MetalScrews_CM` |
| `FD_` | Furniture definition, **and every static item** | `FD_Chair_DF`, `FD_MetalScrews_SI` |
| `RD_` | Recipe definition | `RD_MetalPanel_CR` |
| `LD_` | Loot definition (a drop table) | `LD_Chair` |
| `LSP_` | Loot spawn point | `LSP_ShowFloor_Floor` |
| `ESP_` | Enemy spawn point | `ESP_ShowFloor` |
| `LYD_` | Layout definition (a room/tile) | `LYD_Bathroom_All` |
| `BD_` | Biome definition | `BD_Warehouse` |
| `ARR_` | Available recipe rules | `ARR_CraftingTableTierOne` |
| `ED_` / `BHV_` / `PRC_` | Enemy / AI behaviour / AI perception | `ED_BoneHead`, `BHV_BoneHead` |

The `FD_` prefix on static items catches everyone out: an item is `ID_MetalScrews_CM` but its
physical form is `FD_MetalScrews_SI`. All 545 static items in the base game are named that way, and
the editor's partner auto-creation mints new ones to match.

**Suffixes — the sub-kind:**

| Suffix | Meaning |
|---|---|
| `_CM` | Crafting material |
| `_EQ` | Equippable |
| `_CN` | Consumable |
| `_CR` | Craft recipe |
| `_DF` | Damageable furniture |
| `_SI` | Static item |

So `ID_MetalScrews_CM` reads as "item definition, metal screws, crafting material" and you can guess
its folder (`crafting_material_definitions`) without looking.

Layout names additionally encode biome and maze direction — `LYD_Bathroom_UpRight` is the bathroom
tile with openings up and right. [Chapter 11](11-laying-out-the-world.md) covers that scheme.

## References

Definitions point at each other by **id string**:

```json
"input": [ { "key": "ID_SteelPanel_CM", "value": 10 } ]
```

`ID_SteelPanel_CM` is not a path or a link — it's a name that gets resolved when the game loads. Two
consequences:

1. **Renaming a definition breaks every reference to it** unless they're all updated. The editor
   handles this when you rename in-app. Renaming a file in Explorer does not, and leaves you with
   dangling refs that [validations](12-validations.md) will report.
2. **A reference to something that doesn't exist is just a dead string.** Nothing crashes at author
   time; it fails at load time or silently produces nothing. This is why the Where-Used panel and the
   Validations tab matter more here than in a typical editor.

## Items come in pairs

One of the few structural rules worth memorising: most items exist as **two** definitions.

| | Class | What it describes |
|---|---|---|
| `ID_Thing_CM` | e.g. `UCraftingMaterialDefinition` | The item as a game concept — name, stack size, crafting behaviour |
| `FD_Thing_SI` | `UStaticItemDefinition` | The item as a physical object — mesh, physics, how it looks on the floor |

The item points at its partner through a `static_item_definition` reference. World loot spawns the
**static item**; recipes produce the **item**. Missing a partner means an item that can't appear in
the world, or a mesh with no gameplay identity. The editor mints missing partners when you open the
Items tab and flags mismatches in validations. [Chapter 5](05-items.md) covers it properly.

## What the editor adds on top

The editor loads a schema exported from the game, which is why it can show you:

- **Tooltips** — the actual comment written above that property in the game's source.
- **Clamps** — sliders and number fields that refuse out-of-range values.
- **Enum dropdowns** — real options instead of typing a magic string.
- **Typed pickers** — an asset reference field offers assets of the right class; a tag field offers
  the real tag tree.

If a property renders as a raw JSON blob rather than a proper editor, that's schema drift: the game
has a field the editor's schema doesn't know. It still saves correctly — it just isn't pretty.

## File formatting

The editor writes 2-space-indented JSON with LF line endings and a trailing newline. Two differences
from the files the game's exporter ships:

- **The exporter writes CRLF; the editor writes LF.** Harmless to the game, noisy in a diff. If
  you're keeping the project in git, a `.gitattributes` saves you a one-time churn commit.
- **`16.0` comes back as `16`.** JSON has one number type, so a whole-valued float loses its trailing
  `.0` the first time the editor rewrites the file. The value is identical; only the text changes.

Neither is worth fighting. What is worth avoiding is hand-editing a file the editor also has open —
`⟳ Reload` before you touch anything on disk, and reload again afterwards.

---

## Gotchas

- **`id` must equal the filename stem.** `FD_Chair_DF.json` must contain `"id": "FD_Chair_DF"`. A
  mismatch loads under the id and confuses every path-based operation, including overrides.
- **`asset_path` is not a reference.** Changing it doesn't move anything or break anything. Don't
  spend time on it, but don't delete it either.
- **Ids are global.** `ID_Chair` and `FD_Chair` can coexist, but two definitions with the same id in
  different mods is a collision — one silently wins.
- **Don't copy a file to make a variant.** Use Duplicate in the editor, which assigns a new id and
  fixes up the internals. A hand-copied file with the original's id shadows it.

---

Next: [Getting around →](04-getting-around.md)
