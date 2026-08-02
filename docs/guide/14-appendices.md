← [Previous](13-shipping.md) | [Index](README.md)

# 14. Appendices

---

## Appendix A — Folder → class

Every folder in the base game data, the class it holds, and how many records ship in it. 50 folders,
2922 records. Counts are from the bundled base project and will drift as the game updates —
`html_game_definitions` exists as a Furniture sub-tab but ships empty, so it isn't listed below.

| Folder | Class | Records |
|---|---|---|
| `ammo_definitions` | `UAmmoDefinition` | 3 |
| `available_recipe_rules_definitions` | `UAvailableRecipeRulesDefinition` | 43 |
| `behavior_definitions` | `ScpBehaviorDefinition` | 7 |
| `biome_definitions` | `UBiomeDefinition` | 30 |
| `boss_summon_recipe_definitions` | `UBossSummonRecipeDefinition` | 2 |
| `boss_summoner_definitions` | `UBossSummonerDefinition` | 2 |
| `constructable_item_definitions` | `UConstructableItemDefinition` | 299 |
| `consumable_definitions` | `UConsumableDefinition` | 87 |
| `containment_cage_definitions` | `UContainmentCageDefinition` | 1 |
| `craft_recipe_definitions` | `UCraftRecipeDefinition` | 162 |
| `crafting_material_definitions` | `UCraftingMaterialDefinition` | 130 |
| `crafting_station_definitions` | `UCraftingStationDefinition` | 17 |
| `damageable_furniture_definitions` | `UDamageableFurnitureDefinition` | 436 |
| `death_box_definitions` | `UDeathBoxDefinition` | 1 |
| `elevator_definitions` | `UElevatorDefinition` | 1 |
| `enemy_definitions` | `UEnemyDefinition` | 10 |
| `enemy_spawn_parameter_definitions` | `EnemySpawnParameters` | 7 |
| `enemy_spawn_point_definitions` | `UEnemySpawnPointDefinition` | 9 |
| `equippable_definitions` | `UEquippableDefinition` | 34 |
| `furniture_definitions` | `UFurnitureDefinition` | 93 |
| `furniture_upgrade_recipe` | `UFurnitureUpgradeRecipe` | 122 |
| `furniture_with_components_definitions` | `UFurnitureWithComponentsDefinition` | 27 |
| `glove_definitions` | `UGloveDefinition` | 4 |
| `hotkey_definitions` | `HotkeyDefinition` | 66 |
| `input_behavior_definitions` | `InputBehaviorDefinition` | 66 |
| `interactable_text_definitions` | `UInteractableTextDefinition` | 2 |
| `inventory_rules_definitions` | `UInventoryRulesDefinition` | 11 |
| `layout_definitions` | `ULayoutDefinition` | 435 |
| `loot_definitions` | `ULootDefinition` | 79 |
| `loot_spawn_point_definitions` | `ULootSpawnPointDefinition` | 26 |
| `outfit_definitions` | `UOutfitDefinition` | 2 |
| `perception_definitions` | `ScpPerceptionDefinition` | 8 |
| `plant_recipe_definitions` | `UPlantRecipeDefinition` | 10 |
| `plantable_definitions` | `UPlantableDefinition` | 4 |
| `production_station_definitions` | `UProductionStationDefinition` | 27 |
| `random_event_definitions` | `RandomEventDefinition` | 7 |
| `scp_game_data` | `UScpGameData` | 1 |
| `seed_item_definitions` | `USeedItemDefinition` | 10 |
| `shoe_definitions` | `UEquippableDefinition` | 1 |
| `shopping_cart_definitions` | `UShoppingCartDefinition` | 1 |
| `situation_definitions` | `SituationDefinition` | 11 |
| `skill_definitions` | `ScpSkillDefinition` | 4 |
| `spawn_point_definitions` | `USpawnPointDefinition` | 12 |
| `static_item_definitions` | `UStaticItemDefinition` | 545 |
| `storage_definitions` | `UStorageDefinition` | 29 |
| `teleporter_definitions` | `UTeleporterDefinition` | 2 |
| `toggleable_furniture_definitions` | `UToggleableFurnitureDefinition` | 31 |
| `trap_item_definitions` | `UTrapItemDefinition` | 3 |
| `universal_storage_definitions` | `UUniversalStorageDefinition` | 1 |
| `world_rules_definitions` | `WorldRulesDefinition` | 1 |

Plus `maps/` (world files) and `web/` (UI overrides), which aren't definition folders.

### The folders this guide doesn't otherwise cover

Most of the tree is items, furniture, recipes, loot, layouts and AI — the chapters above. These are
the rest. All are editable in the **Definitions** tab; none have a specialised view.

| Folder | What it holds |
|---|---|
| `boss_summoner_definitions` | Altar/station furniture used to summon a boss |
| `boss_summon_recipe_definitions` | What a summon costs, and which `ED_` it produces |
| `containment_cage_definitions` | Cages that hold a captured creature |
| `death_box_definitions` | The container a dead player's inventory lands in |
| `hotkey_definitions` | A physical binding across keyboard and controller, plus how it's shown |
| `input_behavior_definitions` | A named input intent (`behavior_tag`) bound to exactly one hotkey. One hotkey can serve many behaviours |
| `situation_definitions` | Which input behaviours are live in a given context — `SIT_Combat`, menus, and so on. Abilities and screens activate a situation to enter it |
| `inventory_rules_definitions` | Per-container rules: capacity, item whitelist/blacklist, whether items can be added at all |
| `outfit_definitions` / `shoe_definitions` | Equippables with their own folders — same shape as `equippable_definitions`, split out by slot |
| `random_event_definitions` | World events like `RE_GraveyardShift` — lighting, intercom announcement, ambient audio |
| `world_rules_definitions` | One record, `WR_Default`: day sections and the lighting config for each. JSON is the source of truth; the C++ defaults are only an error floor. A mod overrides the whole set |
| `scp_game_data` | One record of global pointers — front-end map, icon atlas, fallback mesh, shared materials |
| `spawn_point_definitions` | Where players enter the world |
| `enemy_spawn_parameter_definitions` | Rates and conditions for enemy spawning ([ch. 9](09-enemies-and-ai.md)) |
| `skill_definitions` | The individual actions an AI behaviour can invoke ([ch. 9](09-enemies-and-ai.md)) |

Hotkeys, input behaviours and situations are one system in three folders: a **hotkey** is the physical
key, a **behaviour** is the intent bound to it, and a **situation** is the set of behaviours that
apply right now. Rebinding a key means editing the hotkey; adding a new action means a behaviour plus
a situation that lists it.

---

## Appendix B — Naming glossary

**Prefixes**

| Prefix | Meaning |
|---|---|
| `ID_` | Item definition |
| `FD_` | Furniture definition — **and every static item**, `FD_<Name>_SI` |
| `RD_` | Recipe definition |
| `LD_` | Loot definition (drop table) |
| `LSP_` | Loot spawn point |
| `ESP_` | Enemy spawn point |
| `LYD_` | Layout definition |
| `BD_` | Biome definition |
| `ARR_` | Available recipe rules |
| `ED_` | Enemy definition |
| `BHV_` | AI behaviour |
| `PRC_` | AI perception |
| `SKL_` | AI skill |
| `SIT_` | Situation |
| `SM_` | Static mesh (an engine asset, not a definition) |

**Suffixes**

| Suffix | Meaning |
|---|---|
| `_CM` | Crafting material |
| `_CN` | Consumable |
| `_EQ` | Equippable |
| `_CR` | Craft recipe |
| `_DF` | Damageable furniture |
| `_SI` | Static item |

**Layout name shape**

```
LYD_<Biome><Feature>_<MazeDirection>[_<Variant>][_Decrease]
LYD_Bathroom_UpRight        bathroom tile, openings up and right
LYD_ShowFloor_All_3         showfloor crossroads, third variant
LYD_Kids_Up_2_Decrease      kids dead-end, second variant, height-drop
```

---

## Appendix C — Keyboard and mouse

**Anywhere** (when a text field doesn't have focus):

| Key | Action |
|---|---|
| `Ctrl+K` | Search all definitions |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / paste the selected slot, array, map or recipe |
| `Esc` | Clear selection / close dialog |
| Shift-click / Ctrl-click | Extend / toggle selection in any list |
| Middle-click | Open a rail row in the Definitions tab |

**Layouts tab:**

| Input | Action |
|---|---|
| `W` / `E` / `R` | Move / rotate / scale gizmo |
| `Ctrl+D` | Duplicate selection, offset +50 uu on X |
| `Delete` / `Backspace` | Delete selection |
| Right-drag (or left-drag) | Look around |
| `W` `A` `S` `D` while dragging | Fly |
| `Q` / `E` while dragging | Fly down / up |
| `Shift` / `Ctrl` while flying | 4× / ¼× speed |
| Middle-drag | Pan |
| Wheel | Dolly |
| `F` | Point the camera at the tile origin |
| Click empty space | Clear selection |

There are no orthographic numpad views and no double-click-to-frame.

**AI tab, Sandbox:**

| Input | Action |
|---|---|
| `WASD` | Walk the selected player |
| `C` / `V` | Crouch / stealth |
| `F` | Player swings |
| `N` | Loud noise here |
| `Space` / `.` | Pause / single step |
| Wheel, drag empty space | Zoom, pan |

---

## Appendix D — Reference numbers

Values worth memorising when laying out the world:

| Thing | Value |
|---|---|
| Tile size | 1500 × 1500 uu |
| Perimeter wall line | ±750 |
| Wall segment length | 300 uu |
| Nook wall offset | ±575 |
| Recommended bench quadrant slots | (±430, ±430) |
| Corridor cross half-width | ≈ 200 uu |
| Corridor mouth clearance | skip slots within ~260 uu perpendicular, ~300 uu deep |
| Axis convention | Up = +X, Down = −X, Left = −Y, Right = +Y |
| Units | Unreal centimetres, Z up, rotations in degrees |
| Default `weighted_chance` | 1000 |
| Default `world_gen_priority` | 1000 |
| Loot item weights in the base data | 1–3 (small integers, relative within the pool) |
| Bench-group roll in a tile | `spawn_chance_under 0.35` |
| Standard floor LSP seed offsets | 19, 20, 21 |
| Standard furniture LSP seed offsets | 22, 23, 24 |
| Enemy spawn point position | (51, 0, 0) |

---

## Appendix E — Troubleshooting

**"Save is greyed out."**
Nothing is dirty, or the source is read-only (bundled base game, or a folder without write
permission). Use `Save as…`.

**"I can't open a folder at all."**
You're not in a Chromium browser. Chrome, Edge or Brave only.

**"My changes vanished after reload."**
`⟳ Reload` discards unsaved edits by design. If the tab crashed instead, the next load offers to
restore a draft — take it.

**"The game doesn't see my mod."**
In order: is the folder in `Mods/` next to `Content/`? Does it contain a `mod.json` with an `id` and
a `version`? Is that id enabled in the Mod Selection screen? Did you restart? Check the log for
`inactive` / `not on disk` / `overrides`.

**"My change is in the game but something else overwrites it."**
Another mod later in the load order ships the same file path. Reorder, or rename your file if it was
meant to be new content rather than an override.

**"My new furniture never appears in generated levels."**
It isn't tagged, so no layout query matches it. See [ch. 10](10-gameplay-tags.md).

**"My layout query finds nothing."**
Wrong match mode (`Exact` where you meant `InclParents`), a typo'd tag, or multiple queries ANDing
into an impossible combination. See [ch. 11 §11.6](11-laying-out-the-world.md#116-direct-references-vs-search-queries).

**"My room is empty about half the time."**
Spawn chance windows. Seed-sweep and check the "Spawn chance" overlays.

**"Objects render as red boxes."**
Resolution failed. The billboard says which failure it is —
[ch. 11 §11.13](11-laying-out-the-world.md#1113-reading-the-status-overlays). **Orange** is different:
the object resolved but its mesh isn't in the catalogue, so the box is a 100 uu placeholder.

**"The editor created files I didn't ask for."**
Every load, dangling references get stub definitions minted so they resolve, and opening the Items
tab mints missing `FD_…_SI` partners. Both are unsaved until you save. Undo or delete them first if
you don't want them in your mod.

**"My item exists but players can't get it."**
Nothing produces it. Give it a recipe or a loot entry, then check Tech Tree → Audit.

**"My enemy just stands there."**
Its attack range is below the approach envelope. AI → Attacks matrix.

**"Schema drift on load."**
The project is from a newer game build than the editor's schema. Continue anyway — data is preserved,
some fields just render generically.

---

[← Back to index](README.md)
