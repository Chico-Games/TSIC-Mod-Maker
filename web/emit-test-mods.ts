// Authors a set of SEPARATE single-purpose mods with the definition editor's
// own record serialiser, so each modding surface can be enabled, tested and
// blamed on its own. The kitchen-sink fixture proves the surfaces exist; these
// prove they compose — you can run the items mod without the AI mod, and a
// broken one cannot hide behind the others.
//
// usage: node --import tsx emit-test-mods.ts <mods-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeRecord } from './src/modio/packer';
import type { DefinitionRecord } from './src/store/definitionsStore';

const modsDir = process.argv[2];
if (!modsDir) {
  console.error('usage: emit-test-mods.ts <mods-dir>');
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'mods');

function rec(folder: string, id: string, cls: string, properties: unknown): DefinitionRecord {
  const json = { id, class: cls, schema_version: 2, properties };
  return { folder, id, json, originalText: '', diskId: id, diskFolder: folder } as DefinitionRecord;
}

interface ModSpec {
  id: string;
  displayName: string;
  version?: string;
  /** The game's closed vocabulary: gameplay, ui, rules, cheats, console (network reserved). */
  capabilities?: string[];
  /** Lua entry points under scripts/, per VM. Both-or-neither with the capability. */
  scripts?: { rules?: string; ui?: string };
  records?: DefinitionRecord[];
  /** Extra text files, relative to the mod root. */
  files?: Record<string, string>;
  /** Extra binary files copied from fixtures/mods, relative to the mod root. */
  fixtureFiles?: Record<string, string>;
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
  // A screen, a theme and an icon: the three things a UI mod ships. The theme
  // extends the base game's and only overrides the accent; the screen draws
  // the mod's own PNG through a `mod:` ref. Both are definitions the game
  // compiles itself (`compiled` classes in _schema.json), so their `tree` and
  // `colours` are opaque JSON to the editor.
  {
    id: 'com.test.ui',
    displayName: 'Test Mod — UI',
    capabilities: ['ui'],
    records: [
      rec('ui_definitions', 'UI_TestUi_TH', 'ScpUiThemeDefinition', {
        extends: 'UI_Default_TH',
        colours: {
          accent: '#00c853',
          'accent.hover': '#1de37a',
        },
      }),
      rec('ui_definitions', 'UI_TestUiBadge_SC', 'ScpUiScreenDefinition', {
        screen: 'TestUiBadge',
        layer: 'menu',
        theme: 'UI_TestUi_TH',
        input_mode: 'InputMode.Menu.MainMenu',
        cancel: 'UI.Cmd.Menu.Back',
        actions: [{ action: 'back', label: 'Back' }],
        uses: [],
        tree: {
          id: 'stage', widget: 'panel', layout: 'overlay', style: 'screen.dim',
          children: [
            {
              id: 'card', widget: 'panel', layout: 'vertical', style: 'panel.page', gap: 12,
              slot: { align: 'center', valign: 'center', width: 420 },
              children: [
                { id: 'title', widget: 'text', style: 'text.title', text: 'Mod screen' },
                { id: 'badge', widget: 'image', source: 'mod:icons/ui/test-badge', slot: { align: 'center' }, bind: { size: "'64,64'" } },
                { id: 'blurb', widget: 'text', style: 'text.body', wrap: true, text: "A screen, a theme and an icon shipped by com.test.ui. The title is drawn in this mod's accent colour; the badge is this mod's PNG." },
                { id: 'close', widget: 'button', style: 'button.primary', label: 'Close', focus: 'initial', slot: { align: 'center' }, on: { click: { cmd: 'UI.Cmd.Menu.Back' } } },
              ],
            },
          ],
        },
      }),
    ],
    fixtureFiles: {
      'icons/ui/test-badge.png': 'test-badge.png',
    },
  },

  // --- SCRIPTING -----------------------------------------------------------
  // A rules-VM Lua script on the listen-server host. "gameplay" is what lets
  // it call the gameplay commands (spawn, grant, schedule); the manifest is
  // rejected if the capability and the entry do not come as a pair.
  {
    id: 'com.test.scripting',
    displayName: 'Mod Scripting Fixture',
    version: '0.2.0',
    capabilities: ['gameplay'],
    scripts: { rules: 'scripts/main.lua' },
    fixtureFiles: {
      'scripts/main.lua': 'scripting-main.lua',
    },
  },

  // --- MAP -----------------------------------------------------------------
  {
    id: 'com.test.map',
    displayName: 'Test Mod — Map',
    map: 'TestModWorld',
  },
];

function writeRelative(root: string, rel: string, contents: string | Buffer): void {
  const parts = rel.split('/');
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...parts), contents);
}

for (const spec of MODS) {
  const root = join(modsDir, spec.id);
  mkdirSync(root, { recursive: true });

  for (const r of spec.records ?? []) {
    const dir = join(root, r.folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${r.id}.json`), serializeRecord(r));
  }

  for (const [rel, contents] of Object.entries(spec.files ?? {})) writeRelative(root, rel, contents);
  for (const [rel, fixture] of Object.entries(spec.fixtureFiles ?? {})) {
    writeRelative(root, rel, readFileSync(join(FIXTURES, fixture)));
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
    version: spec.version ?? '1.0.0',
  };
  if (spec.capabilities) modJson.capabilities = spec.capabilities;
  if (spec.scripts) modJson.scripts = spec.scripts;
  writeFileSync(join(root, 'mod.json'), JSON.stringify(modJson, null, 2) + '\n');

  const count = (spec.records ?? []).length;
  const extras = Object.keys(spec.files ?? {}).length + Object.keys(spec.fixtureFiles ?? {}).length;
  console.log(`${spec.id}: ${count} definition(s)` +
    (extras ? `, ${extras} extra file(s)` : '') +
    (spec.map ? `, map "${spec.map}"` : ''));
}
console.log(`wrote ${MODS.length} mods to ${modsDir}`);
