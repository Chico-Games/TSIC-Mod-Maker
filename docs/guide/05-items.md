← [Previous](04-getting-around.md) | [Index](README.md) | Next: [Furniture →](06-furniture.md)

# 5. Items

**What you'll be able to do**

- Put a new item in the right folder.
- Use Detail and Spreadsheet modes, and bulk-edit dozens of records at once.
- Understand item↔static-item partners and keep them in sync.

---

## The nine item folders

| Sub-tab | Folder | Holds |
|---|---|---|
| Crafting Materials | `crafting_material_definitions` | Raw and intermediate ingredients |
| Consumables | `consumable_definitions` | Food, medical, anything used up |
| Constructables | `constructable_item_definitions` | Items that place furniture when used |
| Equippables | `equippable_definitions` | Weapons, armour, tools |
| Gloves | `glove_definitions` | Hand slot |
| Ammo | `ammo_definitions` | Ammunition types |
| Seeds | `seed_item_definitions` | Plantable seeds |
| Traps | `trap_item_definitions` | Placed traps |
| Static Items | `static_item_definitions` | The physical/world form of every item |

Choosing between them is usually obvious from what the item *does*. The one that catches people out
is **Constructables**: if using the item places a piece of furniture, it's a constructable, and it
needs a matching furniture definition to place ([ch. 6](06-furniture.md)).

## The two view modes

The Items and Furniture tabs share one browser with two modes.

### Detail

One record, every property, fully typed. This is where you author a new item or make a considered
change to an existing one. The Where-Used panel sits alongside — check it before changing anything
that already exists.

### Spreadsheet

Every record in the folder as rows, with a per-folder set of properties as columns. Crafting
materials get weight, stackable and category; equippables get slot, ammo, durability and max ammo;
damageable furniture gets health, armour, draggable, level and a loot count. Edit cells in place.

This is the balance-pass view. Comparing 130 crafting materials' weights takes seconds here and is
painful anywhere else. Row-warning chips appear inline, so problems surface as you scan: `no
display_name`, `no static partner`, `partner FD_X_SI missing`, `unresolved ref: X`.

## Multi-select and bulk edit

Select several records in the rail — shift-click for a range, ctrl-click to toggle — and three
buttons appear underneath: `Bulk edit…`, `Duplicate × N` and `Clear`.

Bulk edit takes one property and writes one value into every selected record. It handles **scalars
only**: text, numbers, booleans and single gameplay tags. Arrays, maps and structs say "not supported
in this MVP" and have to be edited per record — so bulk *retagging* isn't available, because
`gameplay_tags` is a list.

The dialog counts before it commits: "Will apply to 24 of 31 records (7 skipped — incompatible
type)". Records that don't carry the property, or carry it as a different type, are skipped rather
than coerced.

> **Why it works**
>
> Bulk edit writes the same typed value into the same property path on each selected record, marking
> each dirty. It's exactly equivalent to editing them one at a time — there's no special "bulk" state
> to get stuck in, and `Save` writes them all normally.

That equivalence has a cost: undo is also per record. `Ctrl+Z` after a 30-record bulk edit undoes one
of them. Check the selection before you apply, and if it goes badly wrong before a save, `⟳ Reload`
is the blunt fix.

## Duplicate

`⎘` on a rail row, or `Duplicate × N` for a selection, creates copies with new ids in the same
folder. This is the correct way to make a variant — it fixes the id, keeps the class and folder
right, and doesn't shadow the original the way a hand-copied file would.

After duplicating: rename it properly, then work through the properties. Duplicates inherit
everything, including references you may not want.

Middle-clicking any rail row opens that record in the **Definitions** tab, which is the fast way to
reach a property the sub-tab doesn't surface.

## Item ↔ static item partners

Every item that can exist physically in the world needs two definitions:

| Definition | Class | Describes |
|---|---|---|
| `ID_Screws_CM` | `UCraftingMaterialDefinition` | The gameplay item: name, stack size, crafting role |
| `FD_Screws_SI` | `UStaticItemDefinition` | The physical object: mesh, physics, world appearance |

Note the prefix change: the item is `ID_`, its physical form is `FD_`. The item's
`static_item_definition` property is the link between them.

**World loot spawns the static item. Recipes produce the item.** Both sides need to exist.

The editor helps:

- **Opening the Items tab mints missing partners.** Once per project load, it walks all eight item
  folders — not just the sub-tab you're looking at — and for any record whose
  `static_item_definition` is empty *or points at something that doesn't exist*, it creates
  `FD_<Name>_SI` and repoints the slot. A toast reports the count, and how many of those replaced a
  broken reference.
- The Validations tab reports item↔static mismatches under `item↔static`.

A minted partner is a stub: it exists so references resolve, but it has no mesh, and it's an unsaved
record until your next `Save`. Go to the Static Items sub-tab and give it one, or your item will be
invisible on the floor.

## Smart effects view (Equippables and Gloves)

Equippables and gloves carry a long list of paired properties: a `b_apply_X` boolean and the value it
gates. Most are off for any given item, so the raw list is mostly noise.

The smart effects view hides the inactive pairs and shows only what's actually applied, with a way to
enable more. Use it — the full list is only useful when you're auditing.

## Worked example: a new consumable

1. **Items → Consumables**, find something close to what you want (say a bandage).
2. `⎘` to duplicate. Rename to `ID_MyStim_CN`.
3. In **Detail**, set the display name, description, and the consumable's effects.
4. Switch to **Static Items**, find `FD_MyStim_SI` (minted for you), and assign a mesh.
5. Check **Where-Used** on the original bandage to see how it's obtained — a recipe, a loot table, or
   both — so you know what you need to wire up for yours.
6. Give it a recipe ([ch. 7](07-recipes-and-progression.md)) and/or put it in a loot table
   ([ch. 8](08-loot-and-drops.md)). **An item nothing produces cannot be obtained.**
7. `Save`, then check **Validations**.

Step 6 is the one people forget. Creating the item is half the job; making it reachable is the other half.

---

## Gotchas

- **A new item with no recipe and no loot entry is unobtainable.** Nothing flags this — it's valid
  data, and the tech tree reads an item with no producer as a raw material. Where-Used is the check.
- **Minted `_SI` partners have no mesh.** They resolve references but produce an invisible object in
  the world. Always finish them.
- **Bulk edit undoes one record at a time.** Verify the selection first.
- **Bulk edit can't touch lists.** Tags, effects and loot entries are per record.
- **Duplicating copies references too.** A duplicated item still points at the original's tags, loot
  entries and effects. Work through them.
- **Renaming after wiring things up.** Rename in the editor so references follow. Renaming the file on
  disk leaves every reference pointing at a name that no longer exists.

---

Next: [Furniture →](06-furniture.md)
