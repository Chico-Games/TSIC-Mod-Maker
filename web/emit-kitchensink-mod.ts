// Authors the TSIC integration-test mod `com.test.kitchensink` using the
// definition editor's own record serialiser, so the files on disk are
// byte-identical to what a modder gets out of the tool's Save.
//
// The mod deliberately touches every surface a mod can touch:
//   items · furniture · loot spawn rates · enemy spawn rates · AI · UI · a map
//
// usage: node --import tsx emit-kitchensink-mod.ts <mods-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeRecord } from './src/modio/packer';
import type { DefinitionRecord } from './src/store/definitionsStore';

const modsDir = process.argv[2];
if (!modsDir) {
  console.error('usage: emit-kitchensink-mod.ts <mods-dir>');
  process.exit(1);
}

const MOD_ID = 'com.test.kitchensink';
const root = join(modsDir, MOD_ID);

function rec(folder: string, id: string, cls: string, properties: any): DefinitionRecord {
  const json = { id, class: cls, schema_version: 2, properties };
  return { folder, id, json, originalText: '', diskId: id, diskFolder: folder } as DefinitionRecord;
}

const records: DefinitionRecord[] = [
  // --- ITEM: a brand-new crafting material -------------------------------
  rec('crafting_material_definitions', 'ID_KitchenSink_CM', 'UCraftingMaterialDefinition', {
    display_name: 'Kitchen Sink',
    description: 'Everything but.',
    stackable: true,
    weight: 4.5,
    item_category_tag: 'Entity.Inventory.Item.Category.CraftingMaterial',
    max_stack_size: 7,
  }),

  // --- FURNITURE: a brand-new placeable ----------------------------------
  rec('furniture_definitions', 'FD_KitchenSinkBench_DF', 'UFurnitureDefinition', {
    display_name: 'Kitchen Sink Bench',
    description: 'A bench from a mod.',
    level: 1,
    gameplay_tags: ['Entity.RandomGeneration.CanBeRandom'],
    default_world_gen_gameplay_tags: [],
    meta_tags: [],
    is_pingable: false,
    static_mesh: '/Game/Furniture/WareHouse/Meshes/SM_Box1_01.SM_Box1_01',
    casts_shadow: true,
    collision_profile_name: { name: 'Furniture' },
    random_material_overrides: [],
    loot_positions: [],
    weighted_chance: 1000,
    world_gen_priority: 5000,
  }),

  // --- LOOT SPAWN RATES: override a base-game spawn point -----------------
  // Same id as the default mod's, so this exercises last-writer-wins merging
  // on the virtual path, not just addition.
  rec('loot_spawn_point_definitions', 'LSP_Bathroom_Floor', 'ULootSpawnPointDefinition', {
    loot_by_difficulty: [
      {
        key: { name: 'EASY', value: 0 },
        value: {
          loot_items: [{ item_entity: 'FD_Plasters_SI', count: 3, weight: 1 }],
          // The tell: base game is 0.35. A mod that cannot move spawn rates is
          // a mod that cannot balance anything.
          spawn_chance: 0.99,
        },
      },
    ],
  }),

  // --- ENEMY SPAWN RATES --------------------------------------------------
  rec('enemy_spawn_point_definitions', 'ESP_CarPark', 'UEnemySpawnPointDefinition', {
    enemies_by_difficulty: [
      {
        key: { name: 'EASY', value: 0 },
        value: {
          enemies_can_spawn: [
            { enemy_spawn_parameter: 'JanitorSpawnParameters', weight: 9000 },
          ],
        },
      },
    ],
  }),

  // --- AI: retune an existing enemy's behaviour tree ----------------------
  // Overriding BHV_MaleStaff rather than adding a new one, because the
  // interesting question is whether a mod can change how a shipped enemy
  // thinks.
  rec('behavior_definitions', 'BHV_MaleStaff', 'ScpBehaviorDefinition', {
    root_eval_interval: 5.0,
    roots: [
      {
        name: 'Combat',
        when: [{ if: 'has_target' }],
        hold_seconds: 9.0,
        nav_policy: 'breach',
        actions: [
          {
            do: 'run_skill',
            skill: 'SKL_Engage',
            params: { Target: '$Perception.Target', Attack: '$Attack.Tag' },
          },
        ],
      },
    ],
  }),

  // --- AI: a brand-new enemy ---------------------------------------------
  rec('enemy_definitions', 'ED_KitchenSinkGhoul', 'UEnemyDefinition', {
    display_name: 'Kitchen Sink Ghoul',
    gameplay_tags: [],
    death_drop_table: [{ world_item: 'FD_Backpack_SI', count: 1, weight: 1 }],
    weighted_chance: 1000,
    world_gen_priority: 1000,
    variants: [],
    shirt_material_slot_index: 2,
  }),
];

// ---------------------------------------------------------------------------
// Write the tree.
// ---------------------------------------------------------------------------
for (const r of records) {
  const dir = join(root, r.folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${r.id}.json`), serializeRecord(r));
}

// mod.json — the game's schema. "ui" is what lets the mod ship web/ content at
// all. No `overrides`: this mod ADDS a file rather than shadowing a base one,
// and declaring a base file it does not replace would be a lie the tooling is
// meant to surface.
mkdirSync(root, { recursive: true });
writeFileSync(
  join(root, 'mod.json'),
  JSON.stringify(
    {
      id: MOD_ID,
      displayName: 'Kitchen Sink Integration Fixture',
      version: '1.0.0',
      permissions: ['ui'],
    },
    null,
    2,
  ) + '\n',
);

// --- UI: a web overlay file ------------------------------------------------
mkdirSync(join(root, 'web', 'shared'), { recursive: true });
writeFileSync(
  join(root, 'web', 'shared', 'mod-kitchensink.css'),
  '/* Served from com.test.kitchensink instead of the default mod. */\n' +
    ':root { --tsic-kitchensink-marker: 1; }\n',
);

// --- MAP: a level shipped by the mod ---------------------------------------
// Derived from a real base-game map rather than hand-rolled: the JSON-RLE
// format carries palettes, colour mappings and per-layer metadata, and a
// hand-written stub would prove nothing except that a file with the right name
// exists. Only the identity is changed.
const baseMapPath = join(modsDir, 'com.chicogames.default', 'maps', 'DevBlankFloor.json');
const baseMap = JSON.parse(readFileSync(baseMapPath, 'utf8'));
baseMap.metadata.name = 'KitchenSinkWorld';
baseMap.metadata.description = 'Integration fixture map shipped by com.test.kitchensink.';
mkdirSync(join(root, 'maps'), { recursive: true });
writeFileSync(join(root, 'maps', 'KitchenSinkWorld.json'), JSON.stringify(baseMap, null, 2) + '\n');

console.log(`wrote ${records.length} definitions + mod.json + web overlay + map to ${root}`);
