← [Previous](03-anatomy-of-a-definition.md) | [Index](README.md) | Next: [Items →](05-items.md)

# 4. Getting around

**What you'll be able to do**

- Pick the right tab for the job instead of hunting.
- Find any definition in two seconds.
- Use drag-and-drop, and know what it actually changes.
- Check what depends on a record *before* you break it.

---

## The seven tabs

```ui-header
tabs: Recipes & Loot | Items | Furniture | Definitions | Layouts | AI | Validations
active: Recipes & Loot
```

| Tab | Use it for |
|---|---|
| **Recipes & Loot** | Crafting stations, furniture loot, the tech tree, enemy drops, biome loot. The task-oriented view. |
| **Items** | Everything the player can carry, craft, wear or consume. |
| **Furniture** | Everything placed in the world. |
| **Definitions** | The universal editor. Any record, any class, full property list. Authoritative when a specialised tab doesn't cover what you need. |
| **Layouts** | The 3D room editor. [Chapter 11](11-laying-out-the-world.md). |
| **AI** | Enemy behaviour, perception and attack tuning, with a live sandbox. [Chapter 9](09-enemies-and-ai.md). |
| **Validations** | Everything currently wrong with your project. [Chapter 12](12-validations.md). |

The specialised tabs are *views*, not separate data. Editing a chair's health in the Furniture tab
and editing it in the Definitions tab change the same file. Use whichever shows you the most relevant
neighbours.

## Search — `⌘K`

`Ctrl+K` (or the `⌘K Search` button) searches every loaded definition. Enter opens the top hit;
arrows move the cursor; Escape closes. Results always open in the **Definitions** tab, whichever tab
you searched from.

![Searching "food". The first rows matched on id — see the highlight inside `Dog Food` — and the rest matched on a property value, here the `asset_path`. The 🧠 chip shows the concept index covering all 2922 records.](images/search-palette.jpg)

It searches three ways at once, and the result rows tell you which one matched:

| Match | How it works |
|---|---|
| **id** | Fuzzy, token-aware. `metscr` finds `ID_MetalScrews_CM`. Ranked above everything else. |
| **a property value** | Substring, across every string anywhere in the record. Searching `cardboard` finds records whose display name or mesh path contains it. The row shows the property path that matched. |
| **concept** (🧠) | Semantic. `food` finds edible things that never use the word "food"; `wooden` finds timber props. |

Concept search runs on a small language model the browser downloads once, in the background, the
first time you load a project. The 🧠 chip in the header tracks it: a percentage while downloading,
`🧠 1200/2922` while it embeds your records, `🧠 ready` when it's done. Until then the other two
kinds of match work normally. If the download fails, the chip says so and search carries on without
it.

Concept matches only ever *add* rows below the exact ones, so turning it on can't cost you a hit you
would otherwise have found.

## The item palette and drag-and-drop

Several tabs show a draggable palette of definitions. Drag-and-drop is wired app-wide through one
dispatcher, so the same gesture works in every context that accepts it:

| Drag this | Onto this | Result |
|---|---|---|
| A definition from the palette | A recipe input/output cell | Sets that ingredient |
| A definition from the palette | A loot entry | Sets the dropped item |
| A definition from the palette | An upgrade cost cell | Sets that cost |
| A **recipe card** | A different station's row | Moves the recipe *reference* between stations |
| A slot value | Another slot | Moves/copies the reference |

> **Why it works**
>
> Dragging a recipe card from one station to another does **not** move the recipe file. It removes the
> recipe's id from the first station's available-recipe list and adds it to the second's. The recipe
> asset stays exactly where it was on disk.
>
> Almost everything in this editor works that way: you're rewiring references, not moving data.

## Where-Used

Most record views have a **Where-Used** panel listing every definition that references the one you're
looking at, resolved live from a reverse index.

Build the habit: **before you change or delete anything, look at Where-Used.** A loot table that looks
orphaned may be referenced by fifteen furniture pieces. An item that looks unused may be the output of
a recipe that's the only path to a tier of progression.

It's also the fastest way to answer "where does this actually get used?", which is most of what you
need when learning an unfamiliar data set.

## Property tooltips and typed editors

Hover any property label for its description, pulled from the game's own source comments. Number
fields carry the game's clamps. Enums are dropdowns. Asset references open a picker filtered to the
correct class. Tags open the real tag tree.

Editing a crafting material looks like this — each property gets the control its *type* deserves,
and the amber bar marks a field you've changed but not yet saved:

```ui-fields
display_name :: text :: Metal Screws
*weight :: number :: 0.05
stackable :: bool :: on
max_stack_size :: number :: 200
item_category_tag :: tag :: Item.Category.Material
static_item_definition :: ref :: FD_MetalScrews_SI
```

When something renders as a plain JSON box instead, the editor's schema doesn't know that property —
see schema drift in [chapter 2](02-setup.md). It still saves correctly.

## Issue dots

Small coloured dots appear next to records on rails, lists and pickers. They carry two kinds of
problem: a **dangling `definition_ref`** (this record points at an id nothing defines) and **schema
drift** (this record uses a class or property the editor's schema doesn't know). Hovering tells you
which.

They are not the whole Validations tab. Structural problems — a station with no ARR, a recipe with no
output, an orphan loot table — only show up in [chapter 12](12-validations.md)'s list.

## Detail and Spreadsheet

The Items and Furniture tabs share one browser component with two modes:

| Mode | Best for |
|---|---|
| **Detail** | Editing one record thoroughly. |
| **Spreadsheet** | Editing one column across many records — balance passes. |

Selecting several records in the rail (shift-click a range, ctrl-click to toggle) reveals
`Bulk edit…`, `Duplicate × N` and `Clear` beneath it. Bulk edit sets one property across the whole
selection. [Chapter 5](05-items.md) covers what it can and can't set.

## Keyboard

Global, wherever you aren't typing in a field:

| Key | Does |
|---|---|
| `Ctrl+K` | Search |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / paste the current selection — see below |
| `Esc` | Clear selection / close dialog |

In the Layouts tab:

| Key | Does |
|---|---|
| `W` / `E` / `R` | Move / rotate / scale gizmo |
| `Ctrl+D` | Duplicate selection, offset 50 uu along +X |
| `Delete` or `Backspace` | Delete selection |
| Right-drag + `WASD`/`Q`/`E` | Fly the camera. `Shift` for 4× speed, `Ctrl` for quarter speed |
| `F` | Point the camera back at the tile origin |

### Undo

Undo is global and snapshot-based: every edit, creation and deletion pushes a frame, up to 100.
Consecutive keystrokes in the *same* field within about half a second collapse into one step, so
typing a name is one undo rather than twenty. Edits to *different* records never collapse — undoing a
bulk edit across 30 items takes 30 presses. Loading or reloading a project clears the history, since
it can't span a project change.

### Copy and paste

`Ctrl+C` copies whatever you have selected, and what that means depends on the selection:

| Selected | Copies | Pastes onto |
|---|---|---|
| A reference slot | The reference | Another slot, keeping the target's expected class |
| An array or map header | The whole list | Another array/map of the same kind, replacing its contents |
| A recipe card | The recipe | A station — clones the recipe as `…_Copy` and adds it to that station's ARR |

Paste refuses mismatched targets rather than mangling them, and says why in a toast.

---

## Gotchas

- **Two views of the same record can both be open.** They're the same underlying data; there's no
  merge conflict, but don't be surprised when an edit in one appears in the other.
- **Drag-and-drop between stations is a move, not a copy.** The recipe leaves the source station. If
  you wanted it on both, add it to the second rather than dragging.
- **The palette shows every definition, not just legal ones.** Dropping something nonsensical into a
  slot will be accepted and then flagged in validations. The editor is permissive by design.

---

Next: [Items →](05-items.md)
