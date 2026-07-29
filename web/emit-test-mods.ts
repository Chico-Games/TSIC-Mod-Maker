// Authors a set of SEPARATE single-purpose mods with the definition editor's
// own record serialiser, so each modding surface can be enabled, tested and
// blamed on its own. The kitchen-sink fixture proves the surfaces exist; these
// prove they compose — you can run the items mod without the AI mod, and a
// broken one cannot hide behind the others.
//
// usage: node --import tsx emit-test-mods.ts <mods-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeRecord } from './src/modio/packer';
import type { DefinitionRecord } from './src/store/definitionsStore';

const modsDir = process.argv[2];
if (!modsDir) {
  console.error('usage: emit-test-mods.ts <mods-dir>');
  process.exit(1);
}

function rec(folder: string, id: string, cls: string, properties: unknown): DefinitionRecord {
  const json = { id, class: cls, schema_version: 2, properties };
  return { folder, id, json, originalText: '', diskId: id, diskFolder: folder } as DefinitionRecord;
}

interface ModSpec {
  id: string;
  displayName: string;
  permissions?: string[];
  records?: DefinitionRecord[];
  /** Extra non-definition files, relative to the mod root. */
  files?: Record<string, string>;
  /** Copy a base-game map under a new name. */
  map?: string;
}

const MODS: ModSpec[] = [
  // --- ITEMS ---------------------------------------------------------------
  {
    id: 'com.test.items',
    displayName: 'Test Mod — Items',
    records: [
      rec('crafting_material_definitions', 'ID_TestIngot_CM', 'UCraftingMaterialDefinition', {
        display_name: 'Test Ingot',
        description: 'A brand-new crafting material from a mod.',
        stackable: true,
        weight: 2.5,
        item_category_tag: 'Entity.Inventory.Item.Category.CraftingMaterial',
        max_stack_size: 25,
      }),
      rec('consumable_definitions', 'ID_TestTonic_CN', 'UConsumableDefinition', {
        display_name: 'Test Tonic',
        description: 'A brand-new consumable from a mod.',
        stackable: true,
        weight: 0.5,
        item_category_tag: 'Entity.Inventory.Item.Category.Consumable',
        max_stack_size: 5,
      }),
    ],
  },

  // --- FURNITURE -----------------------------------------------------------
  {
    id: 'com.test.furniture',
    displayName: 'Test Mod — Furniture',
    records: [
      rec('furniture_definitions', 'FD_TestPlinth_DF', 'UFurnitureDefinition', {
        display_name: 'Test Plinth',
        description: 'A brand-new placeable from a mod.',
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
    ],
  },

  // --- SPAWN RATES ---------------------------------------------------------
  // Overrides base-game ids on purpose: rebalancing is the common case, and it
  // is the merge (last-writer-wins) being tested, not addition.
  {
    id: 'com.test.spawnrates',
    displayName: 'Test Mod — Spawn Rates',
    records: [
      rec('loot_spawn_point_definitions', 'LSP_Bathroom_Floor', 'ULootSpawnPointDefinition', {
        loot_by_difficulty: [
          {
            key: { name: 'EASY', value: 0 },
            value: {
              loot_items: [{ item_entity: 'FD_Plasters_SI', count: 5, weight: 1 }],
              // Base game is 0.35.
              spawn_chance: 0.95,
            },
          },
        ],
      }),
      rec('enemy_spawn_point_definitions', 'ESP_CarPark', 'UEnemySpawnPointDefinition', {
        enemies_by_difficulty: [
          {
            key: { name: 'EASY', value: 0 },
            value: {
              enemies_can_spawn: [
                { enemy_spawn_parameter: 'JanitorSpawnParameters', weight: 9500 },
              ],
            },
          },
        ],
      }),
    ],
  },

  // --- AI ------------------------------------------------------------------
  {
    id: 'com.test.ai',
    displayName: 'Test Mod — AI',
    records: [
      // Retunes a shipped enemy's behaviour tree rather than adding a new one:
      // the interesting question is whether a mod can change how an existing
      // enemy thinks.
      rec('behavior_definitions', 'BHV_MaleStaff', 'ScpBehaviorDefinition', {
        root_eval_interval: 4.0,
        roots: [
          {
            name: 'Combat',
            when: [{ if: 'has_target' }],
            hold_seconds: 8.0,
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
      rec('perception_definitions', 'PRC_MaleStaff', 'ScpPerceptionDefinition', {
        extends: 'PRC_BaseHostile',
      }),
      rec('enemy_definitions', 'ED_TestWraith', 'UEnemyDefinition', {
        display_name: 'Test Wraith',
        gameplay_tags: [],
        death_drop_table: [{ world_item: 'FD_Backpack_SI', count: 1, weight: 1 }],
        weighted_chance: 1000,
        world_gen_priority: 1000,
        variants: [],
        shirt_material_slot_index: 2,
      }),
    ],
  },

  // --- UI ------------------------------------------------------------------
  {
    id: 'com.test.ui',
    displayName: 'Test Mod — UI',
    permissions: ['ui'],
    files: {
      'web/shared/mod-test-ui.css':
        '/* Served from com.test.ui through the CEF scheme handler. */\n' +
        ':root { --tsic-test-ui-marker: 1; }\n',
      'web/shared/mod-test-ui.js':
        '// Loaded from a mod\'s web overlay root.\n' +
        'window.TSIC_TEST_UI_MARKER = true;\n',
    },
  },

  // --- MAP -----------------------------------------------------------------
  {
    id: 'com.test.map',
    displayName: 'Test Mod — Map',
    map: 'TestModWorld',
  },
];

for (const spec of MODS) {
  const root = join(modsDir, spec.id);
  mkdirSync(root, { recursive: true });

  for (const r of spec.records ?? []) {
    const dir = join(root, r.folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${r.id}.json`), serializeRecord(r));
  }

  for (const [rel, contents] of Object.entries(spec.files ?? {})) {
    const parts = rel.split('/');
    mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...parts), contents);
  }

  if (spec.map) {
    // Derived from a real base-game map: JSON-RLE carries palettes, colour
    // mappings and per-layer metadata, and a hand-written stub would prove
    // only that a file with the right name exists.
    const base = JSON.parse(
      readFileSync(join(modsDir, 'com.chicogames.default', 'maps', 'DevBlankFloor.json'), 'utf8'),
    );
    base.metadata.name = spec.map;
    base.metadata.description = `Test map shipped by ${spec.id}.`;
    mkdirSync(join(root, 'maps'), { recursive: true });
    writeFileSync(join(root, 'maps', `${spec.map}.json`), JSON.stringify(base, null, 2) + '\n');
  }

  const modJson: Record<string, unknown> = {
    id: spec.id,
    displayName: spec.displayName,
    version: '1.0.0',
  };
  if (spec.permissions) modJson.permissions = spec.permissions;
  writeFileSync(join(root, 'mod.json'), JSON.stringify(modJson, null, 2) + '\n');

  const count = (spec.records ?? []).length;
  console.log(`${spec.id}: ${count} definition(s)` +
    (spec.files ? `, ${Object.keys(spec.files).length} web file(s)` : '') +
    (spec.map ? `, map "${spec.map}"` : ''));
}
console.log(`wrote ${MODS.length} mods to ${modsDir}`);
