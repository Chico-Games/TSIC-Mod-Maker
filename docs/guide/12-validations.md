← [Previous](11-laying-out-the-world.md) | [Index](README.md) | Next: [Shipping your mod →](13-shipping.md)

# 12. Validations

**What you'll be able to do**

- Read every warning the editor can raise and know what causes it.
- Tell the fatal ones from the cosmetic ones.
- Keep a project healthy rather than fixing it all at the end.

---

## The Validations tab

One list, grouped by category, with a count in the header and an `Open` link on each row that jumps
to the offending record in the **Definitions** tab. Rows are coloured by severity: red for `error`,
amber for `warning`.

Run it **before every save-and-test cycle**, not before publish. A dangling reference found five
minutes after you made it takes seconds to fix; found three weeks later it takes an afternoon of
archaeology.

Note that the issue dots elsewhere in the app are a *different, smaller* set — dangling references
and schema drift only. Structural problems live here and nowhere else.

## Every category

### `orphan ref` — error

A `definition_ref` pointing at an id that doesn't exist in the project.

**Cause:** something was renamed or deleted, or a reference was typed by hand, or you're overlaying a
project that doesn't contain the base game.

**Severity:** usually fatal — the reference silently produces nothing at runtime.

**Fix:** repoint it, or restore/create the missing definition. If your project is a thin overlay and
the target lives in the base game, this is a **false alarm** — the editor only sees what's loaded.
Open your project seeded from the default project to check properly.

Rarer than you'd expect, because loading a project mints a stub for every dangling ref whose class
the schema recognises ([ch. 2](02-setup.md)). What survives to this list is mostly refs to classes
the editor doesn't know.

### `item↔static` — warning

An item whose `static_item_definition` is empty or points at something unloaded, or a static item
that no item references.

**Cause:** created one side manually, or deleted one half.

**Severity:** high despite the colour. Items with no static form can't exist physically; statics with
no item have no gameplay identity.

**Fix:** open the Items tab — it mints missing partners — then give the new static a mesh. See
[ch. 5](05-items.md).

### `station has no ARR` — warning

A crafting station, production station or plantable with no `available_recipe_rules_definition`.

**Severity:** fatal for that station — it can make nothing.

**Fix:** create an ARR and reference it, or point at an existing one if the station should share.

### `station ARR missing` — error

The station references an ARR that doesn't exist.

**Fix:** same as above. Usually a rename that didn't propagate.

### `orphan ARR` — warning

An ARR no station references.

**Severity:** cosmetic — dead data, not broken data.

**Fix:** wire it to a station or delete it. Common while mid-build; don't let it accumulate.

### `empty ARR` — warning

An ARR with no recipes.

**Severity:** high. Every station using it offers nothing.

**Fix:** add recipes, or point the station elsewhere.

### `recipe has no inputs` — warning

A recipe that consumes nothing — produces its output from thin air.

**Severity:** occasionally intentional, usually a mistake.

### `recipe has no outputs` — warning

A recipe that produces nothing. Never intentional. Furniture upgrade recipes are exempt: their result
is the target furniture, not an item.

### `upgrade missing target` — warning

A furniture upgrade recipe with no `upgraded_furniture_definition`.

**Severity:** fatal — an upgrade the player can start and never complete.

### `upgrade target missing` — error

The target is set but points at a definition that doesn't exist.

**Fix:** repoint. Usually a rename.

### `orphan loot` — warning

A `LootDefinition` nothing references.

**Severity:** cosmetic. Often a table you built and haven't wired up.

**Fix:** attach it to furniture death loot or an enemy drop table, or delete it.

## Things validations does NOT catch

Just as important. None of these produce a warning:

| Not caught | Why it matters | How to catch it |
|---|---|---|
| An item nothing produces | Unobtainable content | **Where-Used.** The tech tree can't help — an item with no producer reads as a raw material |
| A recipe in no ARR | Uncraftable recipe | Tech Tree → Audit, "Recipes on no station" |
| Untagged furniture | Invisible to every layout query | Layouts: query for it and see |
| A layout with no ESP/LSPs | A room with no enemies or loot | Compare against the standard skeleton ([ch. 11](11-laying-out-the-world.md)) |
| A layout not tagged for any biome | Never selected by the generator | Check its `gameplay_tags` |
| Typo'd gameplay tags | Match nothing, silently | Always use the tag picker |
| An enemy whose attack can't reach | Enemy stands there doing nothing | AI → Attacks matrix ([ch. 9](09-enemies-and-ai.md)) |
| Loot tiers above the tile's difficulty | Nothing ever spawns | Read the tiers ([ch. 8](08-loot-and-drops.md)) |
| Furniture with no `static_mesh` | Invisible objects | Layouts viewport shows "Missing mesh" |
| A mesh path that isn't in the catalogue | Wrong size in the editor, possibly fine in game | Layouts viewport draws it orange |
| Stub records the loader minted for you | Empty definitions shipped in your mod | Skim the Definitions tab for records with no properties before publishing |

So the full pre-ship check is four passes, not one:

1. **Validations** — references and structure.
2. **Tech Tree → Audit** — reachability and progression.
3. **Layouts** — seed-sweep anything you touched, watch the status overlays.
4. **AI → Attacks** — if you changed enemies, weapons or sizes.

## Load-time warnings

Two dialogs on project load are also validations of a sort:

**Schema drift.** Records using classes or properties the editor's schema doesn't know. Continue
anyway — editing and saving work, unknown fields are preserved, they just render generically. It
usually means the project came from a newer game build than the editor's schema.

**Future schema version.** The project declares a schema version this editor doesn't support. Don't
force it; update the editor.

## A healthy-project routine

- Fix `orphan ref` and `*missing*` categories immediately — they're always real.
- Let `orphan ARR` / `orphan loot` accumulate during a build, clear them at the end of a session.
- Never ship with anything in the fatal categories.
- Run the four-pass check before each playtest, not just before publishing.

---

Next: [Shipping your mod →](13-shipping.md)
