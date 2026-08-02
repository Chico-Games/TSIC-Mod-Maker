← [Index](README.md) | Next: [Setup →](02-setup.md)

# 1. What you're editing

**What you'll be able to do**

- Explain what a "definition" is and where the game finds it.
- Describe how your mod stacks on top of the base game.
- Predict which mod wins when two mods change the same thing.

---

## Everything in TSIC is a definition

There is no giant spreadsheet, no database, no compiled data blob. Every *thing* in TSIC — a nail, a
chair, a crafting recipe, a zombie, a room — is one JSON file in a folder.

```
crafting_material_definitions/ID_MetalScrews_CM.json      ← an item
craft_recipe_definitions/RD_AnomalousArmorChestplate_CR.json  ← a recipe
damageable_furniture_definitions/FD_Chair_DF.json         ← a piece of furniture
layout_definitions/LYD_Bathroom_All.json                  ← a room
biome_definitions/BD_ShowFloor.json                       ← an area type
```

The folder tells the game what *kind* of thing the file is. The file's `id` is its name everywhere
else in the data — recipes refer to items by id, layouts refer to furniture by id, biomes refer to
layouts by id. Chapter 3 opens one of these files up.

The Definition Editor is a viewer and editor for exactly this tree. It knows the shape of every class
from a schema the game exports, so it can give you typed fields, dropdowns, clamps and tooltips
instead of a raw text editor. But underneath, you are always editing that folder of JSON.

## A mod is a folder of definitions

A mod is just:

```
com.yourname.yourmod/
├── mod.json
├── damageable_furniture_definitions/
│   └── FD_Chair_DF.json
└── craft_recipe_definitions/
    └── RD_MyThing_CR.json
```

`mod.json` is usually three fields:

```json
{
  "id": "com.yourname.yourmod",
  "displayName": "My Cool Mod",
  "version": "1.0.0"
}
```

`id` and `version` are required; the mod is rejected without them. `displayName` is optional and
falls back to the id, but write it anyway — it's what players see. The `id` is reverse-DNS by
convention and must be unique: it's how servers and clients agree they're running the same content.

Four more fields exist, all optional, none needed for a content mod:

| Field | What it does |
|---|---|
| `permissions` | Array from a closed set: `gameplay`, `ui`, `network`. An unknown name is an error, not a no-op. |
| `scripts` | Entry point for gameplay scripting. Requires the `gameplay` permission, and that permission requires this — half-configured scripting is rejected. |
| `overrides` | Paths under `web/` whose base-game version you're replacing. Requires the `ui` permission. Adding *new* UI files needs neither. |
| `modio` | Written by the installer when a mod is downloaded. Don't hand-write it; it's stripped before the mod's content hash is computed. |

The base game itself is a mod: `com.chicogames.default`, display name "TSIC Base Game". It ships
about 3000 definitions across ~50 folders. Nothing about it is privileged — it's loaded through the
exact same pipeline yours is.

## The overlay model

Mods load in an order. The game walks that order and builds one merged file list, keyed by each
file's path relative to its mod root, lowercased. **Later mods overwrite earlier ones at the same
path.** Because the key is lowercased, casing differences between your path and the base game's
don't stop an override from landing.

That means overriding a base-game chair is not a special operation. You ship a file at the same
relative path:

```
com.chicogames.default/damageable_furniture_definitions/FD_Chair_DF.json   ← base
com.yourname.yourmod/damageable_furniture_definitions/FD_Chair_DF.json     ← yours, loaded later
```

and yours is the one that loads. The game logs it:

```
LogScpMods: ScpMods: mod 'com.yourname.yourmod' overrides 'damageable_furniture_definitions/fd_chair_df.json'
```

There is a shipped example: `com.chicogames.chairs-to-boxes` ("Chairs to Cardboard Boxes") is a
`mod.json` plus 22 `FD_Chair_*_DF.json` files that point the chair meshes at cardboard boxes. A
complete mod with no new content in it at all.

> **Why it works**
>
> Your project in the editor is an *overlay*. When you open the base game and change one field on one
> chair, the editor tracks that one record as dirty and `Save` writes exactly one file. You are not
> copying 3000 files and editing one of them — you're producing a thin folder that the game lays over
> the base at load time.
>
> This is why the export menu has both **Export** (your overlay — what you ship) and **Export
> flattened** (base + overlay merged into a complete tree — almost never what you want).

Two rules follow:

1. **To override something, keep its folder and filename identical to the base.** A file at a
   different path is a *new* definition, not an override. The editor does this for you when you edit
   an existing record; it matters when you're moving files around by hand.
2. **Don't reuse an existing `id` for new content.** Identity comes from the `id` field inside the
   file. Two files claiming the same id is ambiguous and one will silently lose.

## What else a mod can contain

Definitions are the bulk of it, but the pipeline also handles:

| Folder / file | What it does |
|---|---|
| `*_definitions/*.json` | Definitions — the subject of this guide. |
| `maps/*.json` | Whole world maps. Later load order wins, same as definitions. See [ch. 11](11-laying-out-the-world.md). |
| `web/…` | The game's HTML/CSS/JS UI. Adding files is free; *replacing* a base file means listing it in `mod.json`'s `overrides` and taking the `ui` permission. |
| Textures, sounds, meshes | Imported at load into the game's runtime content, addressable by your definitions. |
| `mod.json` → `scripts` | Gameplay scripting, if your mod declares it. Out of scope for this guide. |

## Load order and the mod stack

The player's mod stack is: one **default mod** at the top, then an ordered list of additional mods.
It's configured on the in-game **Mod Selection** screen and saved per-install, so two people can run
different stacks. Until someone touches that screen, the project's own configured default order is used.

A mod sitting on disk but not in the load order is inactive — the game logs it and moves on. This is
worth knowing when your changes stubbornly don't appear: being installed and being *enabled* are two
different things.

## What the editor is for

| The editor is good at | Use something else for |
|---|---|
| Editing values with the right types and bounds | Making 3D meshes |
| Following references between definitions | Writing gameplay code |
| Bulk edits across many records | Painting the world map (that's the separate level editor — [ch. 11](11-laying-out-the-world.md)) |
| Catching broken references before you ship | Testing gameplay feel — you still need to play it |

---

## Gotchas

- **"I edited the file but nothing changed in game."** Almost always one of: the mod isn't in the
  load order, another mod later in the order overrides the same path, or the game wasn't restarted.
- **Renaming a file does not rename the definition.** The `id` inside the file is the real name.
  Renaming one without the other creates a mismatch. Rename in the editor, not in Explorer.
- **`Export flattened` is a trap.** It produces a full copy of the base game plus your changes. If you
  ship that, your mod overrides *everything* and will conflict with every other mod. Use plain
  `Export` or plain `Save`.

---

Next: [Setup and your first project →](02-setup.md)
