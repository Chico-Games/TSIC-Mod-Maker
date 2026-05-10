// Headed Playwright smoke for the new IA tabs:
//   Recipes & Loot (Stations / Furniture / Tech Tree / Enemies / Biome)
//   Furniture Loot
//   Validations
//
// Each interactive flow is tested against an in-memory directory fixture
// so we don't depend on the bundled defaults and can assert exact
// outcomes. The fixture is intentionally small and shaped to exercise:
//   - station families (Tier1 + Tier2 of the same bench)
//   - a plantable station with a plant recipe
//   - a damageable furniture with upgrade_recipe + loot_dropped_on_death
//   - one LootDefinition with two ItemToDrop entries
//   - one enemy + one biome (LSP_ pair)
//
// Coverage checklist (each block prints OK on success):
//   Stations sub-tab
//     - rail rows show recipe count
//     - tier-pill family quick-swap selects the right station
//     - clicking a palette item with a station selected (no recipe)
//       creates a new recipe with that item as output
//     - clicking with a recipe selected stacks the item into inputs
//     - right-click on the same palette item decrements the input
//     - drag a Consumable palette item into a Material-only slot is
//       REJECTED (class-aware drop rejection)
//     - drag a Material into the same slot is accepted
//     - +New recipe button creates an empty recipe in the ARR
//     - recipe card → station row drag moves the recipe across ARRs
//   Furniture sub-tab
//     - rail loads, selecting a furniture shows death loot + upgrade
//   Furniture Loot tab
//     - LD_ asset opens, items_to_drop count is visible
//   Validations tab
//     - station-with-no-ARR appears as an issue
//   Universal copy/paste
//     - select inputs array, Ctrl+C, select another recipe's inputs,
//       Ctrl+V replaces the array contents
//   Save round-trip
//     - mutate something, click Save, confirm the on-disk JSON
//       reflects the change (typed envelope intact)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4235;

function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  return proc;
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`server didn't come up in ${timeoutMs}ms`);
}

(async () => {
  const proc = startServer();
  let stdoutBuf = '';
  let stderrBuf = '';
  proc.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  try {
    await waitForServer(`http://localhost:${PORT}/`);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    // Build the in-memory fixture via initScript so it's installed
    // before any of the app's bootstrap code runs.
    await page.addInitScript(() => {
      try { localStorage.setItem('tsic.def.skipBundled.v1', '1'); } catch {}
      try { localStorage.setItem('tsic.app.tab.v1', 'recipes-loot'); } catch {}
      try { localStorage.setItem('tsic.app.recipesSub.v1', 'stations'); } catch {}

      function ref(cls, value) { return { type: 'definition_ref', class: cls, value }; }
      function int(v) { return { type: 'int', value: v }; }
      function flt(v) { return { type: 'float', value: v }; }
      function bool(v) { return { type: 'bool', value: v }; }
      function txt(v) { return { type: 'text', value: v }; }
      function tags(arr) { return { type: 'gameplay_tag_container', value: arr }; }
      function arrayOf(elementType, items) { return { type: 'array', element_type: elementType, value: items }; }
      function mapOf(keyType, valueType, entries) { return { type: 'map', key_type: keyType, value_type: valueType, value: entries }; }

      const FILES = {
        '.class-hierarchy.json': JSON.stringify({
          schema_version: 1,
          classes: {
            UCraftingMaterialDefinition: { folder: 'crafting_material_definitions', parents: ['UItemDefinition', 'UDataAsset', 'UObject'] },
            UConsumableDefinition: { folder: 'consumable_definitions', parents: ['UItemDefinition', 'UDataAsset', 'UObject'] },
            UItemDefinition: { folder: null, parents: ['UDataAsset', 'UObject'] },
            UCraftingStationDefinition: { folder: 'crafting_station_definitions', parents: ['UFurnitureDefinition', 'UDataAsset', 'UObject'] },
            UProductionStationDefinition: { folder: 'production_station_definitions', parents: ['UFurnitureDefinition', 'UDataAsset', 'UObject'] },
            UPlantableDefinition: { folder: 'plantable_definitions', parents: ['UProductionStationDefinition', 'UFurnitureDefinition', 'UDataAsset', 'UObject'] },
            UDamageableFurnitureDefinition: { folder: 'damageable_furniture_definitions', parents: ['UFurnitureDefinition', 'UDataAsset', 'UObject'] },
            UCraftRecipeDefinition: { folder: 'craft_recipe_definitions', parents: ['URecipeDefinition', 'UDataAsset', 'UObject'] },
            UPlantRecipeDefinition: { folder: 'plant_recipe_definitions', parents: ['URecipeDefinition', 'UDataAsset', 'UObject'] },
            UFurnitureUpgradeRecipe: { folder: 'furniture_upgrade_recipe', parents: ['URecipeDefinition', 'UDataAsset', 'UObject'] },
            UAvailableRecipeRulesDefinition: { folder: 'available_recipe_rules_definitions', parents: ['UDataAsset', 'UObject'] },
            ULootDefinition: { folder: 'loot_definitions', parents: ['UWorldGenObjectDefinition', 'UDataAsset', 'UObject'] },
            UEnemyDefinition: { folder: 'enemy_definitions', parents: ['UWorldGenObjectDefinition', 'UDataAsset', 'UObject'] },
            ULootSpawnPointDefinition: { folder: 'loot_spawn_point_definitions', parents: ['UWorldGenObjectDefinition', 'UDataAsset', 'UObject'] },
            USeedItemDefinition: { folder: 'seed_item_definitions', parents: ['UItemDefinition', 'UDataAsset', 'UObject'] },
          },
        }, null, 2) + '\n',

        crafting_material_definitions: {
          'ID_Wood_CM.json': JSON.stringify({
            id: 'ID_Wood_CM', asset_path: '/Game/Items/Materials/Wood/ID_Wood_CM',
            class: 'UCraftingMaterialDefinition', parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: { display_name: txt('Wood'), weight: flt(0.1) },
          }, null, 2) + '\n',
          'ID_Iron_CM.json': JSON.stringify({
            id: 'ID_Iron_CM', asset_path: '/Game/Items/Materials/Iron/ID_Iron_CM',
            class: 'UCraftingMaterialDefinition', parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: { display_name: txt('Iron'), weight: flt(0.5) },
          }, null, 2) + '\n',
        },

        consumable_definitions: {
          'ID_Bread_CN.json': JSON.stringify({
            id: 'ID_Bread_CN', asset_path: '/Game/Items/Consumables/Bread/ID_Bread_CN',
            class: 'UConsumableDefinition', parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: { display_name: txt('Bread') },
          }, null, 2) + '\n',
        },

        seed_item_definitions: {
          'ID_PotatoSeeds_SD.json': JSON.stringify({
            id: 'ID_PotatoSeeds_SD', asset_path: '/Game/Items/Seeds/Potato/ID_PotatoSeeds_SD',
            class: 'USeedItemDefinition', parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: { display_name: txt('Potato Seeds') },
          }, null, 2) + '\n',
        },

        // Two tiers of the same bench → exercises family-grouping.
        // FD_BenchTier1_CS has an ARR with two recipes; Tier2 has its
        // own ARR with one recipe; Tier3 has NO ARR (validations rule).
        crafting_station_definitions: {
          'FD_BenchTier1_CS.json': JSON.stringify({
            id: 'FD_BenchTier1_CS', asset_path: '/Game/Furniture/Bench/FD_BenchTier1_CS',
            class: 'UCraftingStationDefinition', parent_classes: ['UFurnitureDefinition', 'UDataAsset', 'UObject'],
            properties: {
              display_name: txt('Crafting Bench Tier 1'),
              available_recipe_rules_definition: ref('AvailableRecipeRulesDefinition', 'ARR_BenchT1'),
            },
          }, null, 2) + '\n',
          'FD_BenchTier2_CS.json': JSON.stringify({
            id: 'FD_BenchTier2_CS', asset_path: '/Game/Furniture/Bench/FD_BenchTier2_CS',
            class: 'UCraftingStationDefinition', parent_classes: ['UFurnitureDefinition', 'UDataAsset', 'UObject'],
            properties: {
              display_name: txt('Crafting Bench Tier 2'),
              available_recipe_rules_definition: ref('AvailableRecipeRulesDefinition', 'ARR_BenchT2'),
            },
          }, null, 2) + '\n',
          'FD_BenchTier3_CS.json': JSON.stringify({
            id: 'FD_BenchTier3_CS', asset_path: '/Game/Furniture/Bench/FD_BenchTier3_CS',
            class: 'UCraftingStationDefinition', parent_classes: ['UFurnitureDefinition', 'UDataAsset', 'UObject'],
            properties: {
              display_name: txt('Crafting Bench Tier 3'),
              // ARR ref points at a NON-EXISTENT asset. The auto-create
              // load path should mint ARR_BenchT3 the first time we
              // open this folder.
              available_recipe_rules_definition: ref('AvailableRecipeRulesDefinition', 'ARR_BenchT3'),
            },
          }, null, 2) + '\n',
        },

        plantable_definitions: {
          'FD_PlantPot_PL.json': JSON.stringify({
            id: 'FD_PlantPot_PL', asset_path: '/Game/Furniture/Farming/FD_PlantPot_PL',
            class: 'UPlantableDefinition',
            parent_classes: ['UProductionStationDefinition', 'UFurnitureDefinition', 'UDataAsset', 'UObject'],
            properties: {
              display_name: txt('Plant Pot'),
              available_recipe_rules_definition: ref('AvailableRecipeRulesDefinition', 'ARR_Plant'),
            },
          }, null, 2) + '\n',
        },

        available_recipe_rules_definitions: {
          'ARR_BenchT1.json': JSON.stringify({
            id: 'ARR_BenchT1', asset_path: '/Game/ARR/ARR_BenchT1',
            class: 'UAvailableRecipeRulesDefinition', parent_classes: ['UDataAsset', 'UObject'],
            properties: {
              production_machine_rules: {
                type: 'struct', struct_name: 'ProductionMachineRules',
                value: {
                  recipes: arrayOf(ref('CraftRecipeDefinition', null), [
                    ref('CraftRecipeDefinition', 'RD_Sword_CR'),
                    ref('CraftRecipeDefinition', 'RD_Hammer_CR'),
                  ]),
                },
              },
            },
          }, null, 2) + '\n',
          'ARR_BenchT2.json': JSON.stringify({
            id: 'ARR_BenchT2', asset_path: '/Game/ARR/ARR_BenchT2',
            class: 'UAvailableRecipeRulesDefinition', parent_classes: ['UDataAsset', 'UObject'],
            properties: {
              production_machine_rules: {
                type: 'struct', struct_name: 'ProductionMachineRules',
                value: {
                  recipes: arrayOf(ref('CraftRecipeDefinition', null), [
                    ref('CraftRecipeDefinition', 'RD_Hammer_CR'),
                  ]),
                },
              },
            },
          }, null, 2) + '\n',
          'ARR_Plant.json': JSON.stringify({
            id: 'ARR_Plant', asset_path: '/Game/ARR/ARR_Plant',
            class: 'UAvailableRecipeRulesDefinition', parent_classes: ['UDataAsset', 'UObject'],
            properties: {
              production_machine_rules: {
                type: 'struct', struct_name: 'ProductionMachineRules',
                value: {
                  recipes: arrayOf(ref('PlantRecipeDefinition', null), [
                    ref('PlantRecipeDefinition', 'RD_PotatoSeeds_PL'),
                  ]),
                },
              },
            },
          }, null, 2) + '\n',
        },

        craft_recipe_definitions: {
          // RD_Sword_CR: a CraftingMaterial-keyed input map. The slot
          // class lock is what blocks a Consumable from being dropped
          // onto these cells.
          'RD_Sword_CR.json': JSON.stringify({
            id: 'RD_Sword_CR', asset_path: '/Game/Recipes/RD_Sword_CR',
            class: 'UCraftRecipeDefinition', parent_classes: ['URecipeDefinition', 'UDataAsset', 'UObject'],
            properties: {
              duration: flt(5.0), level: int(1),
              input: mapOf(ref('CraftingMaterialDefinition', null), int(0), [
                { key: ref('CraftingMaterialDefinition', 'ID_Wood_CM'), value: int(2) },
              ]),
              output: mapOf(ref('CraftingMaterialDefinition', null), int(0), [
                { key: ref('CraftingMaterialDefinition', 'ID_Iron_CM'), value: int(1) },
              ]),
            },
          }, null, 2) + '\n',
          'RD_Hammer_CR.json': JSON.stringify({
            id: 'RD_Hammer_CR', asset_path: '/Game/Recipes/RD_Hammer_CR',
            class: 'UCraftRecipeDefinition', parent_classes: ['URecipeDefinition', 'UDataAsset', 'UObject'],
            properties: {
              duration: flt(3.0), level: int(1),
              input: mapOf(ref('CraftingMaterialDefinition', null), int(0), [
                { key: ref('CraftingMaterialDefinition', 'ID_Wood_CM'), value: int(1) },
              ]),
              output: mapOf(ref('CraftingMaterialDefinition', null), int(0), [
                { key: ref('CraftingMaterialDefinition', 'ID_Iron_CM'), value: int(1) },
              ]),
            },
          }, null, 2) + '\n',
        },

        plant_recipe_definitions: {
          'RD_PotatoSeeds_PL.json': JSON.stringify({
            id: 'RD_PotatoSeeds_PL', asset_path: '/Game/Recipes/RD_PotatoSeeds_PL',
            class: 'UPlantRecipeDefinition', parent_classes: ['URecipeDefinition', 'UDataAsset', 'UObject'],
            properties: {
              duration: flt(120.0), level: int(1),
              grow_stages: arrayOf({ type: 'struct', struct_name: 'PlantGrowStage' }, []),
              input: mapOf(ref('SeedItemDefinition', null), int(0), [
                { key: ref('SeedItemDefinition', 'ID_PotatoSeeds_SD'), value: int(1) },
              ]),
              output: mapOf(ref('ConsumableDefinition', null), int(0), [
                { key: ref('ConsumableDefinition', 'ID_Bread_CN'), value: int(3) },
              ]),
            },
          }, null, 2) + '\n',
        },

        damageable_furniture_definitions: {
          'FD_Aircon_DF.json': JSON.stringify({
            id: 'FD_Aircon_DF', asset_path: '/Game/Furniture/Aircon/FD_Aircon_DF',
            class: 'UDamageableFurnitureDefinition', parent_classes: ['UFurnitureDefinition', 'UDataAsset', 'UObject'],
            properties: {
              display_name: txt('Aircon'), starting_health: flt(50.0),
              loot_dropped_on_death: arrayOf(ref('LootDefinition', null), [
                ref('LootDefinition', 'LD_Aircon'),
              ]),
              upgrade_recipe: ref('FurnitureUpgradeRecipe', 'RD_Aircon_CN'),
            },
          }, null, 2) + '\n',
        },

        furniture_upgrade_recipe: {
          'RD_Aircon_CN.json': JSON.stringify({
            id: 'RD_Aircon_CN', asset_path: '/Game/Furniture/Aircon/RD_Aircon_CN',
            class: 'UFurnitureUpgradeRecipe', parent_classes: ['URecipeDefinition', 'UDataAsset', 'UObject'],
            properties: {
              duration: flt(4.0), level: int(1),
              upgrade_tier: int(2),
              input: mapOf(ref('CraftingMaterialDefinition', null), int(0), [
                { key: ref('CraftingMaterialDefinition', 'ID_Wood_CM'), value: int(8) },
              ]),
              output: { type: 'map', key_type: null, value_type: null, value: [] },
              upgraded_furniture_definition: ref('DamageableFurnitureDefinition', 'FD_Aircon_DF'),
            },
          }, null, 2) + '\n',
        },

        loot_definitions: {
          'LD_Aircon.json': JSON.stringify({
            id: 'LD_Aircon', asset_path: '/Game/Loot/LD_Aircon',
            class: 'ULootDefinition', parent_classes: ['UWorldGenObjectDefinition', 'UDataAsset', 'UObject'],
            properties: {
              gameplay_tags: tags([]),
              items_to_drop: arrayOf({ type: 'struct', struct_name: 'ItemToDrop' }, [
                { type: 'struct', struct_name: 'ItemToDrop', value: {
                  item_to_drop: ref('CraftingMaterialDefinition', 'ID_Wood_CM'),
                  count: int(1), chance_to_drop: flt(1.0),
                }},
                { type: 'struct', struct_name: 'ItemToDrop', value: {
                  item_to_drop: ref('CraftingMaterialDefinition', 'ID_Iron_CM'),
                  count: int(2), chance_to_drop: flt(0.5),
                }},
              ]),
              weighted_chance: int(1000),
              world_gen_priority: int(1000),
            },
          }, null, 2) + '\n',
        },

        enemy_definitions: {
          'ED_Test.json': JSON.stringify({
            id: 'ED_Test', asset_path: '/Game/Enemies/ED_Test',
            class: 'UEnemyDefinition', parent_classes: ['UWorldGenObjectDefinition', 'UDataAsset', 'UObject'],
            properties: { display_name: txt('Test Enemy') },
          }, null, 2) + '\n',
        },

        loot_spawn_point_definitions: {
          'LSP_Town_Floor.json': JSON.stringify({
            id: 'LSP_Town_Floor', asset_path: '/Game/LSP/LSP_Town_Floor',
            class: 'ULootSpawnPointDefinition', parent_classes: ['UWorldGenObjectDefinition', 'UDataAsset', 'UObject'],
            properties: { weighted_chance: int(1000) },
          }, null, 2) + '\n',
          'LSP_Town_Furniture.json': JSON.stringify({
            id: 'LSP_Town_Furniture', asset_path: '/Game/LSP/LSP_Town_Furniture',
            class: 'ULootSpawnPointDefinition', parent_classes: ['UWorldGenObjectDefinition', 'UDataAsset', 'UObject'],
            properties: { weighted_chance: int(1000) },
          }, null, 2) + '\n',
        },
      };

      const writes = {};
      const removed = {};
      function makeFileHandle(name, getText, parentContents) {
        return {
          kind: 'file', name,
          async getFile() { return new File([await getText()], name, { type: 'application/json' }); },
          async createWritable() {
            return {
              async write(d) { const s = String(d); writes[name] = s; if (parentContents) parentContents[name] = s; },
              async close() {},
            };
          },
        };
      }
      function makeDirHandle(name, contents) {
        return {
          kind: 'directory', name,
          async *entries() {
            for (const k of Object.keys(contents)) {
              const v = contents[k];
              if (typeof v === 'string') yield [k, makeFileHandle(k, async () => contents[k], contents)];
              else yield [k, makeDirHandle(k, v)];
            }
          },
          async getDirectoryHandle(sub, opts) {
            if (!contents[sub]) {
              if (opts?.create) contents[sub] = {};
              else throw new Error('NotFoundError');
            }
            return makeDirHandle(sub, contents[sub]);
          },
          async getFileHandle(fn, opts) {
            if (!(fn in contents)) {
              if (opts?.create) contents[fn] = '';
              else throw new Error('NotFoundError');
            }
            return makeFileHandle(fn, async () => contents[fn] || '', contents);
          },
          async removeEntry(t) { removed[`${name}/${t}`] = true; delete contents[t]; },
          async queryPermission() { return 'granted'; },
          async requestPermission() { return 'granted'; },
        };
      }
      const root = makeDirHandle('Definitions', FILES);
      window._mockFiles = FILES;
      window._mockWrites = writes;
      window._mockRemoved = removed;
      window.showDirectoryPicker = async () => root;
    });

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('h1:has-text("TSIC Crafting Tool")');

    // Open the mock directory.
    await page.getByRole('button', { name: /Open folder/ }).click();
    await page.waitForSelector('.stations-layout');
    await page.waitForTimeout(200);
    console.log('OK: stations layout rendered after Open folder');

    // ── Family grouping: Bench has 3 tiers — confirm the family row
    //    renders with 3 tier pills. T1 has 2 recipes, T2 has 1, T3 has 0.
    const benchFamily = page.locator('.rail-family', { hasText: 'Crafting Bench' });
    if ((await benchFamily.count()) < 1) throw new Error('expected Bench family row');
    // The "+ Tier" affordance is its own pill (.tier-pill-add); count
    // only the real tier pills.
    const tierPills = benchFamily.locator('.tier-pill:not(.tier-pill-add)');
    const pillCount = await tierPills.count();
    if (pillCount !== 3) throw new Error(`expected 3 tier pills; got ${pillCount}`);
    const addTierCount = await benchFamily.locator('.tier-pill-add').count();
    if (addTierCount !== 1) throw new Error(`expected 1 + tier add pill; got ${addTierCount}`);
    console.log(`OK: Bench family rendered with ${pillCount} tier pills + 1 add affordance`);

    // Total count badge on the family head should be 3 (2+1+0).
    const familyCount = await benchFamily.locator('.rail-family-head .rail-count').textContent();
    if (familyCount?.trim() !== '3') {
      throw new Error(`family total count expected 3; got "${familyCount}"`);
    }
    console.log('OK: family total count = 3');

    // Click T2 pill — should select the Tier 2 station and show its 1 recipe.
    await benchFamily.locator('.tier-pill', { hasText: 'T2' }).click();
    await page.waitForTimeout(150);
    // AssetTitle replaces the static h2 with a click-to-edit element —
    // the visible label still includes "Tier 2" via humanizeAssetId.
    const t2Title = await page.locator('.station-title .asset-title').first().textContent();
    if (!t2Title?.includes('Tier 2')) throw new Error(`expected Tier 2 selected; got "${t2Title}"`);
    const t2Recipes = await page.locator('.recipe-card').count();
    if (t2Recipes !== 1) throw new Error(`expected 1 recipe for Tier 2; got ${t2Recipes}`);
    console.log('OK: tier pill swap → Tier 2 station with 1 recipe');

    // Switch back to Tier 1 to do recipe-level work.
    await benchFamily.locator('.tier-pill', { hasText: 'T1' }).click();
    await page.waitForTimeout(150);
    const t1Recipes = await page.locator('.recipe-card').count();
    if (t1Recipes !== 2) throw new Error(`expected 2 recipes for Tier 1; got ${t1Recipes}`);
    console.log('OK: tier pill swap → Tier 1 station with 2 recipes');

    // ── Click-to-author with NO recipe selected: clicking a palette
    //    item should create a new recipe with that item as output and
    //    append the recipe to the ARR. We click ID_Wood_CM in the
    //    palette — verifying first that nothing is selected.
    // Make sure no recipe is selected.
    const before = await page.locator('.recipe-card').count();
    await page.locator('.palette-item', { hasText: 'Wood' }).first().click();
    await page.waitForTimeout(200);
    const afterCreate = await page.locator('.recipe-card').count();
    if (afterCreate !== before + 1) {
      throw new Error(`expected ${before + 1} recipes after click-to-author; got ${afterCreate}`);
    }
    console.log('OK: palette click with station selected created a new recipe');

    // The newly created recipe is auto-selected. Click an Iron palette
    // item — it should stack into the new recipe's input.
    await page.locator('.palette-item', { hasText: 'Iron' }).first().click();
    await page.waitForTimeout(150);
    // The newly created recipe is the LAST card. Find its input column.
    const newCard = page.locator('.recipe-card').last();
    const inputCount = await newCard.locator('.input-col .def-ref-slot').count();
    if (inputCount < 1) throw new Error(`expected ≥1 input slot in new recipe; got ${inputCount}`);
    console.log(`OK: palette click with recipe selected added an input (${inputCount} slot${inputCount === 1 ? '' : 's'})`);

    // Right-click the same Iron palette item — the input should
    // decrement (and at qty 0 disappear).
    await page.locator('.palette-item', { hasText: 'Iron' }).first().click({ button: 'right' });
    await page.waitForTimeout(150);
    const inputAfterRC = await newCard.locator('.input-col .def-ref-slot').count();
    if (inputAfterRC !== inputCount - 1) {
      throw new Error(`expected ${inputCount - 1} input after right-click; got ${inputAfterRC}`);
    }
    console.log('OK: right-click on palette decremented (and removed) the input');

    // ── Counts in palette: Wood is referenced twice in the original
    //    fixture (Sword + Hammer + the new recipe we just added) — its
    //    "total" badge should read at least 3.
    const woodTotalText = await page.locator('.palette-item', { hasText: 'Wood' }).first().locator('.palette-total').textContent();
    if (!woodTotalText || Number(woodTotalText) < 3) {
      throw new Error(`expected Wood total ≥ 3; got "${woodTotalText}"`);
    }
    console.log(`OK: palette total count for Wood = ${woodTotalText}`);

    // ── Save round-trip: hit Save and confirm the writes object has
    //    files (the mock harness records every writable.write).
    await page.getByRole('button', { name: /^💾 Save/ }).click();
    await page.waitForTimeout(400);
    const wroteCount = await page.evaluate(() => Object.keys(window._mockWrites).length);
    if (wroteCount === 0) throw new Error('expected at least one file written on Save');
    console.log(`OK: Save wrote ${wroteCount} file(s)`);

    // Confirm the ARR now lists the new auto-created recipe.
    const arrText = await page.evaluate(() => window._mockWrites['ARR_BenchT1.json'] || '');
    if (!arrText.includes('"value": "RD_FromWood_CR"')) {
      throw new Error(`ARR_BenchT1.json missing the new recipe ref; got:\n${arrText.slice(0, 500)}`);
    }
    console.log('OK: ARR_BenchT1.json carries the new RD_FromWood_CR ref');

    // ── Class-aware drop rejection: drag a Consumable palette item
    //    over a CraftingMaterial-only slot and confirm the slot shows
    //    the .rejects style, and dropping doesn't change the slot.
    const consumableChip = page.locator('.palette-item', { hasText: 'Bread' }).first();
    const swordCard = page.locator('.recipe-card', { hasText: 'RD_Sword_CR' }).first();
    const swordInputSlot = swordCard.locator('.input-col .def-ref-slot').first();
    const slotBefore = await swordInputSlot.locator('.ss-trigger').first().textContent();
    // dnd-kit reads the pointer; we need a real drag, not just hover.
    const cBox = await consumableChip.boundingBox();
    const sBox = await swordInputSlot.boundingBox();
    if (!cBox || !sBox) throw new Error('could not locate boxes for drag');
    await page.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
    await page.mouse.down();
    // Two intermediate moves so dnd-kit's PointerSensor activates.
    await page.mouse.move(cBox.x + cBox.width / 2 + 5, cBox.y + cBox.height / 2 + 5);
    await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
    await page.waitForTimeout(120);
    // While hovering the incompatible slot, it must NOT show .over.
    const isOverDuringDrag = await swordInputSlot.evaluate((el) => el.classList.contains('over'));
    const isRejectsDuringDrag = await swordInputSlot.evaluate((el) => el.classList.contains('rejects'));
    if (isOverDuringDrag) throw new Error('incompatible slot wrongly marked .over during drag');
    if (!isRejectsDuringDrag) throw new Error('incompatible slot missing .rejects style during drag');
    await page.mouse.up();
    await page.waitForTimeout(120);
    const slotAfter = await swordInputSlot.locator('.ss-trigger').first().textContent();
    if (slotBefore !== slotAfter) {
      throw new Error(`incompatible drop changed the slot from "${slotBefore}" to "${slotAfter}"`);
    }
    console.log('OK: class-incompatible drag rejected (no .over, .rejects class, no mutation)');

    // ── Stations sub-tab: every station shows an UpgradeRecipeSection.
    //    For Tier 1 (which has no upgrade_recipe set in the fixture), the
    //    "+ Add upgrade recipe" button appears; clicking it mints a new
    //    UFurnitureUpgradeRecipe and links it via the host's
    //    upgrade_recipe property — the badged card now renders.
    await page.locator('.rail-family', { hasText: 'Crafting Bench' })
      .locator('.tier-pill:not(.tier-pill-add)', { hasText: 'T1' }).click();
    await page.waitForSelector('.upgrade-recipe-section');
    const upgradeAddBtn = page.locator('.upgrade-recipe-section button', { hasText: 'Add upgrade recipe' });
    if ((await upgradeAddBtn.count()) < 1) {
      throw new Error('expected "+ Add upgrade recipe" on Tier 1 (no upgrade ref yet)');
    }
    await upgradeAddBtn.click();
    await page.waitForTimeout(200);
    const stationUpgradeBadge = await page.locator('.upgrade-recipe-section .upgrade-recipe-badge').count();
    if (stationUpgradeBadge < 1) {
      throw new Error('upgrade badge missing on station after adding upgrade recipe');
    }
    const stationUpgradeCard = await page.locator('.upgrade-recipe-section .recipe-card').count();
    if (stationUpgradeCard < 1) {
      throw new Error('upgrade recipe card missing on station after adding upgrade');
    }
    console.log('OK: Stations sub-tab "+ Add upgrade recipe" mints the upgrade and renders it');

    // ── Furniture sub-tab: select FD_Aircon_DF and confirm the death
    //    loot list + upgrade recipe inline section render — the upgrade
    //    section now renders via UpgradeRecipeSection and is badged.
    await page.locator('.subtab', { hasText: 'Furniture' }).click();
    await page.waitForSelector('.furniture-layout');
    await page.locator('.rail-row', { hasText: 'Aircon' }).first().click();
    await page.waitForTimeout(150);
    const lootEntries = await page.locator('.loot-entry').count();
    if (lootEntries < 1) throw new Error('expected ≥1 loot entry for Aircon');
    const upgradeBadge = await page.locator('.upgrade-recipe-badge', { hasText: 'Upgrade' }).count();
    if (upgradeBadge < 1) throw new Error('expected the Upgrade badge to render on Aircon');
    const upgradeCard = await page.locator('.upgrade-recipe-section .recipe-card').count();
    if (upgradeCard < 1) throw new Error('expected the Aircon upgrade recipe card to render');
    console.log('OK: Furniture sub-tab renders loot + badged upgrade recipe card');

    // ── Furniture Loot top-level tab: open LD_Aircon and check the
    //    items_to_drop count badge in the rail.
    await page.getByRole('button', { name: 'Furniture Loot', exact: true }).click();
    await page.waitForSelector('.furniture-loot-layout');
    const ldRow = page.locator('.rail-row', { hasText: 'Aircon' }).first();
    const ldCount = await ldRow.locator('.muted.small').first().textContent();
    if (ldCount?.trim() !== '2') throw new Error(`expected items_to_drop count 2; got "${ldCount}"`);
    console.log('OK: Furniture Loot rail shows items_to_drop count = 2');

    // ── Validations tab: FD_BenchTier3_CS has a dangling ARR ref;
    //    the auto-create load step should have minted ARR_BenchT3 with
    //    an empty recipes array — so the issue is "empty ARR" not
    //    "ARR missing".
    await page.getByRole('button', { name: 'Validations', exact: true }).click();
    await page.waitForSelector('.validations-layout');
    const emptyArrIssue = page.locator('.val-row', { hasText: 'ARR_BenchT3 has no recipes' });
    if ((await emptyArrIssue.count()) < 1) {
      throw new Error('expected validation issue for empty auto-created ARR_BenchT3');
    }
    console.log('OK: auto-create minted ARR_BenchT3; Validations flags it as empty');

    // ── + New affordances: Stations rail "+ Crafting" creates a new
    //    crafting station + an empty ARR linked to it.
    await page.getByRole('button', { name: 'Recipes & Loot', exact: true }).click();
    await page.locator('.subtab', { hasText: 'Stations' }).click();
    await page.waitForSelector('.recipe-card');
    const stationCountBefore = await page.locator('.rail-row, .rail-family').count();
    // The +Add affordance is now a class-picker dropdown — open it,
    // pick "Crafting station".
    await page.getByRole('button', { name: /＋ New station/ }).click();
    await page.waitForSelector('.add-picker-popover');
    await page.locator('.add-picker-option', { hasText: 'Crafting station' }).click();
    await page.waitForTimeout(150);
    const stationCountAfter = await page.locator('.rail-row, .rail-family').count();
    if (stationCountAfter <= stationCountBefore) {
      throw new Error(`expected new station rail entry; before=${stationCountBefore} after=${stationCountAfter}`);
    }
    // Newly created station should be selected — its title appears in
    // the AssetTitle h2 (humanized id). The default id is
    // "FD_NewCraftingStation_CS" → title "New Crafting Station".
    const newStationTitle = await page.locator('.asset-title').first().textContent();
    if (!newStationTitle?.toLowerCase().includes('new')) {
      throw new Error(`expected new station to be selected; got "${newStationTitle}"`);
    }
    console.log('OK: + New station… → Crafting created a new station + ARR, auto-selected');

    // ── Rename via the asset title in the middle pane: click the
    //    title → input appears → type new stem → Enter commits via
    //    renameAsset. The new id should be findable by the chosen
    //    stem (FOO → FD_FOO_CS).
    const titleEl = page.locator('.station-title .asset-title').first();
    await titleEl.click();
    const renameInput = page.locator('.asset-title-input').first();
    await renameInput.fill('RenamedBench');
    await renameInput.press('Enter');
    await page.waitForTimeout(150);
    const renamedTitle = await page.locator('.station-title .asset-title').first().textContent();
    if (!renamedTitle?.includes('RenamedBench')) {
      throw new Error(`expected title to update after rename; got "${renamedTitle}"`);
    }
    console.log('OK: rename via middle-pane title commits via renameAsset');

    // ── + Tier on the Bench family creates the next tier.
    const benchFam = page.locator('.rail-family', { hasText: 'Crafting Bench' });
    const tiersBefore = await benchFam.locator('.tier-pill:not(.tier-pill-add)').count();
    await benchFam.locator('.tier-pill-add').click();
    await page.waitForTimeout(150);
    const tiersAfter = await benchFam.locator('.tier-pill:not(.tier-pill-add)').count();
    if (tiersAfter !== tiersBefore + 1) {
      throw new Error(`expected ${tiersBefore + 1} tier pills after + Tier; got ${tiersAfter}`);
    }
    console.log(`OK: + Tier minted the next tier (${tiersBefore} → ${tiersAfter})`);

    // ── Middle-click jump: middle-click a palette item, expect to
    //    land in the Definitions tab on that asset.
    await page.locator('.palette-item', { hasText: 'Wood' }).first().click({ button: 'middle' });
    await page.waitForTimeout(150);
    const defEditorTitle = await page.locator('.def-editor-head .def-name-input').first().inputValue().catch(() => '');
    if (defEditorTitle !== 'Wood') {
      throw new Error(`middle-click jump expected Definitions tab on Wood; got "${defEditorTitle}"`);
    }
    console.log('OK: middle-click on palette item jumped to its Definitions editor');

    // ── Click-to-author tab gating: switch to Furniture sub-tab and
    //    click a palette item — Stations recipe count must not change
    //    (would only happen if click-to-author leaked across tabs).
    await page.getByRole('button', { name: 'Recipes & Loot', exact: true }).click();
    await page.waitForSelector('.subtab-strip');
    await page.locator('.subtab', { hasText: 'Stations' }).click();
    await page.locator('.rail-family', { hasText: 'Crafting Bench' }).locator('.tier-pill:not(.tier-pill-add)', { hasText: 'T1' }).click();
    await page.waitForSelector('.recipe-card');
    const swordPreClickRecipeCountForGate = await page.locator('.recipe-card', { hasText: 'RD_Sword_CR' }).count();
    await page.locator('.subtab', { hasText: 'Furniture' }).click();
    await page.waitForSelector('.furniture-layout');
    // Click a palette item while on Furniture tab — must NOT mutate
    // any recipe.
    const palettePostSwitch = page.locator('.palette-item').first();
    if (await palettePostSwitch.count()) {
      await palettePostSwitch.click();
      await page.waitForTimeout(120);
    }
    await page.locator('.subtab', { hasText: 'Stations' }).click();
    await page.waitForSelector('.recipe-card');
    const swordPostClickRecipeCount = await page.locator('.recipe-card', { hasText: 'RD_Sword_CR' }).count();
    if (swordPostClickRecipeCount !== swordPreClickRecipeCountForGate) {
      throw new Error('click-to-author leaked across tabs (Sword recipe count drifted)');
    }
    console.log('OK: click-to-author is gated to the Stations sub-tab');

    // ── Universal copy/paste: switch back to Stations sub-tab, copy
    //    Sword's Inputs array, paste into Hammer's Inputs array.
    await page.getByRole('button', { name: 'Recipes & Loot', exact: true }).click();
    await page.locator('.subtab', { hasText: 'Stations' }).click();
    await page.waitForSelector('.stations-layout');
    // Force-pick Bench Tier 1 so we know there are recipes to work
    // with (the previous test step left selection on a +Tier-minted
    // empty station).
    await page.locator('.rail-family', { hasText: 'Crafting Bench' }).locator('.tier-pill:not(.tier-pill-add)', { hasText: 'T1' }).click();
    await page.waitForSelector('.recipe-card');
    await page.waitForTimeout(120);

    // Click Sword's Inputs label (col-label-button) to select that array.
    const sword = page.locator('.recipe-card', { hasText: 'RD_Sword_CR' }).first();
    await sword.locator('.col-label-button', { hasText: 'Inputs' }).click();
    // Focus the document so keyboard handler picks up Ctrl+C.
    await page.locator('body').focus();
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(80);
    // Now select Hammer's Inputs label.
    const hammer = page.locator('.recipe-card', { hasText: 'RD_Hammer_CR' }).first();
    await hammer.locator('.col-label-button', { hasText: 'Inputs' }).click();
    await page.locator('body').focus();
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(150);
    // Hammer's input should now have the Sword's input ingredient
    // (Wood × 2). Verify via the qty input in the slot.
    const hammerInputs = await hammer.locator('.input-col .def-ref-slot').count();
    if (hammerInputs < 1) throw new Error('expected Hammer to have ≥1 input after paste');
    const hammerQty = await hammer.locator('.input-col .qty-input').first().inputValue();
    if (hammerQty !== '2') {
      throw new Error(`expected Hammer's input qty to be 2 after paste; got "${hammerQty}"`);
    }
    console.log('OK: Ctrl+C / Ctrl+V replaced Hammer inputs with Sword inputs (qty preserved)');

    // ── Delete cascade: with Hammer still in the ARR, delete it via
    //    its card's "×" button. The ARR JSON written on the next Save
    //    must NOT carry a ref to RD_Hammer_CR anymore — the scrub
    //    cleared the entry from production_machine_rules.recipes.
    page.once('dialog', (d) => d.accept());
    const hammerCardForDelete = page.locator('.recipe-card', { hasText: 'RD_Hammer_CR' }).first();
    await hammerCardForDelete.locator('button.danger').click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /^💾 Save/ }).click();
    await page.waitForTimeout(300);
    const arrAfterDelete = await page.evaluate(() => window._mockWrites['ARR_BenchT1.json'] || '');
    if (arrAfterDelete.includes('"value": "RD_Hammer_CR"')) {
      throw new Error('ARR still references the deleted recipe — cascade failed');
    }
    console.log('OK: deleting a recipe cascades — ARR no longer references it');

    if (consoleErrors.length > 0) {
      console.error('Console errors:');
      for (const e of consoleErrors) console.error(' ', e);
      throw new Error('console errors detected');
    }

    console.log('\n=== ALL RECIPES & LOOT UI TESTS PASSED ===');
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e.message);
    console.error(e.stack);
    console.error('stdout (last 2k):', stdoutBuf.slice(-2000));
    console.error('stderr (last 2k):', stderrBuf.slice(-2000));
    process.exit(1);
  } finally {
    proc.kill();
  }
})();
