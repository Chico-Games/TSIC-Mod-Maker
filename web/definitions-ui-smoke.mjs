// Headed Playwright smoke test for the Definitions tab — typed editor.
//
// The picker can't be triggered headless, so this test installs a mock
// `showDirectoryPicker` that returns an in-memory tree pre-populated with
// realistic typed-envelope JSON fixtures plus a `.property-meta.json`
// sidecar so the .h-derived metadata path is exercised.
//
// Coverage:
//   - Loads .class-hierarchy.json + .property-meta.json sidecars
//   - Skips layout_* folders entirely
//   - Renders typed-envelope properties (string, bool→WideToggle,
//     number→NumberSlider when meta has bounds, struct, gameplay_tag,
//     definition_ref→SearchableSelect, array of struct, map)
//   - definition_ref dropdown lists matching-class assets (incl. subclasses)
//   - "+ New …" inline-create flow inside the SearchableSelect
//   - Save round-trips through the typed-envelope JSON shape
//   - Save relocates the file when class changes
//   - Per-asset property search filters fields
//   - Folder list search filters folders
//   - Folder rows show emoji + class hook
//   - Property fields carry distinct CSS color hooks per type
//   - Property grouping toggle reorders properties
//   - Whitelisted-items dropdown is populated from .property-meta when the
//     loaded data has no element_type to sniff

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4234;

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

/**
 * Pick an option in a SearchableSelect (combobox). The select is identified
 * by a Locator pointing at the `.ss-root` (or any ancestor that contains a
 * single one). The displayed value is the trigger button's label; the
 * option list opens on click and is filterable by typing.
 *
 * Pass an empty `value` to pick the "— None —" entry.
 * Pass `__create__` to drop into inline-create mode (pair with onCreate).
 */
async function pickInCombobox(page, ssRoot, value, { filter = '' } = {}) {
  const trigger = ssRoot.locator('.ss-trigger').first();
  await trigger.click();
  await page.waitForSelector('.ss-popover');
  if (filter) {
    await page.locator('.ss-popover .ss-search').fill(filter);
  }
  if (value === '') {
    await page.locator('.ss-popover .ss-item-empty').first().click();
    return;
  }
  // Match by exact value via the label content (when ids round-trip
  // through humanizeAssetId, the label is the stripped form). Use the
  // hint-via-title as a more reliable matcher.
  const item = page.locator('.ss-popover .ss-item', { hasText: value });
  await item.first().click();
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
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    await page.addInitScript(() => {
      // Suppress bundled-defaults auto-load so the test starts from an
      // empty store and drives loading via the mocked directory picker.
      try { localStorage.setItem('tsic.def.skipBundled.v1', '1'); } catch {}
      function ref(cls, value) { return { type: 'definition_ref', class: cls, value }; }
      function int(v) { return { type: 'int', value: v }; }
      function flt(v) { return { type: 'float', value: v }; }
      function bool(v) { return { type: 'bool', value: v }; }
      function text(v) { return { type: 'text', value: v }; }
      function tag(v) { return { type: 'gameplay_tag', value: v }; }
      function tags(arr) { return { type: 'gameplay_tag_container', value: arr }; }
      function structVal(name, fields) {
        return { type: 'struct', struct_name: name, value: fields };
      }
      function arrayOf(elementType, items) {
        return { type: 'array', element_type: elementType, value: items };
      }
      function mapOf(keyType, valueType, entries) {
        return { type: 'map', key_type: keyType, value_type: valueType, value: entries };
      }

      const FILES = {
        '.class-hierarchy.json': JSON.stringify({
          schema_version: 1,
          classes: {
            UAmmoDefinition: { folder: 'ammo_definitions', parents: ['UItemDefinition', 'UDataAsset', 'UObject'], family_root: 'UItemDefinition' },
            UConsumableDefinition: { folder: 'consumable_definitions', parents: ['UItemDefinition', 'UDataAsset', 'UObject'], family_root: 'UItemDefinition' },
            UCraftingMaterialDefinition: { folder: 'crafting_material_definitions', parents: ['UItemDefinition', 'UDataAsset', 'UObject'], family_root: 'UItemDefinition' },
            UCraftRecipeDefinition: { folder: 'craft_recipe_definitions', parents: ['URecipeDefinition', 'UDataAsset', 'UObject'], family_root: 'URecipeDefinition' },
            UItemDefinition: { folder: null, parents: ['UDataAsset', 'UObject'], family_root: 'UItemDefinition' },
            UInventoryRulesDefinition: { folder: 'inventory_rules_definitions', parents: ['UDataAsset', 'UObject'], family_root: 'UInventoryRulesDefinition' },
          },
        }, null, 2) + '\n',

        // .property-meta sidecar — drives tooltips, slider bounds, and
        // element_class fallback for whitelisted_items.
        '.property-meta.json': JSON.stringify({
          schema_version: 1,
          properties: {
            'ItemDefinition.stackable': {
              tooltip: 'Whether multiple instances stack in a single inventory slot.',
              category: 'Item', cpp_type: 'bool', element_class: null,
              clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
              edit_condition: null, edit_spec: 'EditDefaultsOnly',
              display_name: null, categories: null,
            },
            'ItemDefinition.weight': {
              tooltip: 'Weight per unit for inventory weight calculations.',
              category: 'Item', cpp_type: 'float', element_class: null,
              clamp_min: 0, clamp_max: 10, ui_min: null, ui_max: null,
              edit_condition: null, edit_spec: 'EditDefaultsOnly',
              display_name: null, categories: null,
            },
            'ConsumableDefinition.duration': {
              tooltip: 'Duration in seconds for applied effects.',
              category: 'Consumable', cpp_type: 'float', element_class: null,
              clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
              edit_condition: null, edit_spec: 'EditDefaultsOnly',
              display_name: null, categories: null,
            },
            'ConsumableDefinition.effect_type': {
              tooltip: 'Which effect to apply on consumption.',
              category: 'Consumable', cpp_type: 'EConsumableEffectType',
              element_class: null,
              clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
              edit_condition: null, edit_spec: 'EditDefaultsOnly',
              display_name: null, categories: null,
            },
            'InventoryRules.whitelisted_items': {
              tooltip: null, category: null,
              cpp_type: 'TArray<TObjectPtr<const UItemDefinition>>',
              element_class: 'ItemDefinition',
              clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
              edit_condition: null, edit_spec: 'EditAnywhere',
              display_name: null, categories: null,
            },
          },
          enums: {
            ConsumableEffectType: [
              { name: 'None', display_name: 'No Effect' },
              { name: 'FlatHeal', display_name: 'Flat Heal' },
              { name: 'PoisonResist' },
            ],
          },
        }, null, 2) + '\n',

        ammo_definitions: {
          'ID_Pencil_AM.json': JSON.stringify({
            id: 'ID_Pencil_AM',
            asset_path: '/Game/Items/Ammo/Pencil/ID_Pencil_AM',
            class: 'UAmmoDefinition',
            parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: {
              description: text('A pencil ammo.'),
              display_name: text('Pencil'),
              item_category_tag: tag('Entity.Inventory.Item.Category.Ammo'),
              stackable: bool(true),
              weight: flt(0.05),
            },
          }, null, 2) + '\n',
        },

        crafting_material_definitions: {
          'ID_WoodenDowel_CM.json': JSON.stringify({
            id: 'ID_WoodenDowel_CM',
            asset_path: '/Game/Items/Materials/WoodenDowel/ID_WoodenDowel_CM',
            class: 'UCraftingMaterialDefinition',
            parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: {
              description: text('A wooden dowel.'),
              display_name: text('Wooden Dowel'),
              stackable: bool(true),
              weight: flt(0.1),
            },
          }, null, 2) + '\n',
          'ID_Bread_CM.json': JSON.stringify({
            id: 'ID_Bread_CM',
            asset_path: '/Game/Items/Materials/Bread/ID_Bread_CM',
            class: 'UCraftingMaterialDefinition',
            parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: {
              description: text('A loaf of bread.'),
              display_name: text('Bread'),
              stackable: bool(true),
              weight: flt(0.2),
            },
          }, null, 2) + '\n',
        },

        consumable_definitions: {
          'ID_BakedPotato_CN.json': JSON.stringify({
            id: 'ID_BakedPotato_CN',
            asset_path: '/Game/Items/Consumables/BakedPotato/ID_BakedPotato_CN',
            class: 'UConsumableDefinition',
            parent_classes: ['UItemDefinition', 'UDataAsset', 'UObject'],
            properties: {
              description: text('Hot potato.'),
              display_name: text('Baked Potato'),
              duration: flt(300.0),
              effects_to_apply: structVal('GameplayEffectsToApply', {
                b_apply_instant_heal: bool(true),
                instant_heal: flt(5.0),
                b_apply_max_health_increase: bool(false),
                max_health_increase: flt(0.0),
              }),
              gameplay_tags: tags(['Tag.A', 'Tag.B']),
              has_ammo: bool(false),
              has_static_audio: bool(false),
              interaction_hold_time: flt(1.5),
              interaction_prompt_text: text('Eat'),
              casts_shadow: bool(true),
              static_item_definition: ref('CraftingMaterialDefinition', 'ID_WoodenDowel_CM'),
              orphan_ref: ref('CraftingMaterialDefinition', 'ID_DoesNotExist_CM'),
              weight: flt(0.1),
              effect_type: { type: 'enum', enum_name: 'ConsumableEffectType', value: 'FlatHeal' },
            },
          }, null, 2) + '\n',
        },

        crafting_station_definitions: {
          'FD_BenchTier1_CS.json': JSON.stringify({
            id: 'FD_BenchTier1_CS',
            asset_path: '/Game/Furniture/CraftingBenches/FD_BenchTier1_CS',
            class: 'UCraftingStationDefinition',
            parent_classes: ['UFurnitureDefinition', 'UDataAsset', 'UObject'],
            properties: {
              display_name: text('Crafting Bench Tier 1'),
              loot_dropped_on_death: arrayOf(
                ref('CraftingMaterialDefinition', null),
                [ref('CraftingMaterialDefinition', 'ID_WoodenDowel_CM')],
              ),
              starting_health: flt(100.0),
            },
          }, null, 2) + '\n',
        },

        containment_cage_definitions: {
          'FD_Cage_Basic_DF.json': JSON.stringify({
            id: 'FD_Cage_Basic_DF',
            asset_path: '/Game/Furniture/Cages/FD_Cage_Basic_DF',
            class: 'UContainmentCageDefinition',
            parent_classes: ['UFurnitureDefinition', 'UDataAsset', 'UObject'],
            properties: {
              display_name: text('Basic Cage'),
              loot_dropped_on_death: { type: 'array', element_type: null, value: [] },
              starting_health: flt(50.0),
            },
          }, null, 2) + '\n',
        },

        craft_recipe_definitions: {
          'RD_Bread_CR.json': JSON.stringify({
            id: 'RD_Bread_CR',
            asset_path: '/Game/Recipes/RD_Bread_CR',
            class: 'UCraftRecipeDefinition',
            parent_classes: ['URecipeDefinition', 'UDataAsset', 'UObject'],
            properties: {
              duration: flt(8.0),
              level: int(1),
              input: mapOf(
                ref('CraftingMaterialDefinition', null),
                int(0),
                [{ key: ref('CraftingMaterialDefinition', 'ID_WoodenDowel_CM'), value: int(2) }],
              ),
              output: mapOf(
                ref('CraftingMaterialDefinition', null),
                int(0),
                [{ key: ref('CraftingMaterialDefinition', 'ID_Bread_CM'), value: int(1) }],
              ),
            },
          }, null, 2) + '\n',
        },

        inventory_rules_definitions: {
          // Empty whitelisted_items array — element_type=null — no other
          // record has it populated, so the only source of element_class
          // is the .property-meta sidecar.
          'IRD_Test.json': JSON.stringify({
            id: 'IRD_Test',
            asset_path: '/Game/Items/Rules/IRD_Test',
            class: 'UInventoryRulesDefinition',
            parent_classes: ['UDataAsset', 'UObject'],
            properties: {
              inventory_rules: structVal('InventoryRules', {
                whitelisted_items: { type: 'array', element_type: null, value: [] },
                blacklisted_items: { type: 'array', element_type: null, value: [] },
                can_add_items: bool(true),
                capacity: flt(200.0),
              }),
            },
          }, null, 2) + '\n',
        },

        // Layout folder — should be skipped on load.
        layout_definitions: {
          'LYD_ShouldBeSkipped.json': JSON.stringify({
            id: 'LYD_ShouldBeSkipped',
            class: 'ULayoutDefinition',
            parent_classes: ['UDataAsset'],
            properties: {},
          }, null, 2) + '\n',
        },
      };

      const writes = {};
      const removed = {};

      function makeFileHandle(name, getText, parentContents) {
        return {
          kind: 'file',
          name,
          async getFile() {
            const text = await getText();
            return new File([text], name, { type: 'application/json' });
          },
          async createWritable() {
            return {
              async write(data) {
                const s = String(data);
                writes[name] = s;
                if (parentContents) parentContents[name] = s;
              },
              async close() {},
            };
          },
        };
      }

      function makeDirHandle(name, contents) {
        const handle = {
          kind: 'directory',
          name,
          async *entries() {
            for (const k of Object.keys(contents)) {
              const v = contents[k];
              if (typeof v === 'string') {
                yield [k, makeFileHandle(k, async () => contents[k], contents)];
              } else {
                yield [k, makeDirHandle(k, v)];
              }
            }
          },
          async getDirectoryHandle(subName, opts) {
            if (!contents[subName]) {
              if (opts?.create) contents[subName] = {};
              else throw new Error('NotFoundError');
            }
            return makeDirHandle(subName, contents[subName]);
          },
          async getFileHandle(fileName, opts) {
            if (!(fileName in contents)) {
              if (opts?.create) contents[fileName] = '';
              else throw new Error('NotFoundError');
            }
            return makeFileHandle(fileName, async () => contents[fileName] || '', contents);
          },
          async removeEntry(targetName) {
            removed[`${name}/${targetName}`] = true;
            delete contents[targetName];
          },
          async queryPermission() { return 'granted'; },
          async requestPermission() { return 'granted'; },
        };
        return handle;
      }

      const root = makeDirHandle('Definitions', FILES);
      window._mockRoot = root;
      window._mockFiles = FILES;
      window._mockWrites = writes;
      window._mockRemoved = removed;
      window.showDirectoryPicker = async () => root;
    });

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('h1:has-text("TSIC Crafting Tool")');
    await page.getByRole('button', { name: 'Definitions' }).click();
    await page.waitForSelector('.def-empty-state h2:has-text("Pick a Definitions root")');
    console.log('OK: Definitions tab empty state visible');

    await page.locator('button.primary:has-text("Pick directory")').click();
    await page.waitForSelector('.def-grid');
    await page.waitForTimeout(400);

    // 7 folders expected (ammo, crafting_material, consumable, craft_recipe,
    // crafting_station, containment_cage, inventory_rules). layout_* must
    // be skipped; the dotfile sidecars hidden too.
    const folderCount = await page.locator('.def-folders li').count();
    if (folderCount !== 7) throw new Error(`expected 7 folders (layout excluded), got ${folderCount}`);
    console.log(`OK: loaded folder count = ${folderCount} (layout_* skipped)`);

    const layoutFolderHits = await page.locator('.def-folders li', { hasText: 'Layout' }).count();
    if (layoutFolderHits > 0) throw new Error(`layout folder leaked into UI`);
    console.log('OK: layout_definitions absent from folder list');

    // Folder rows carry an emoji span + the def-folder-color CSS variable.
    const consumableFolder = page.locator('.def-folders li', { hasText: 'Consumable Definitions' });
    const emojiCount = await consumableFolder.locator('.def-folder-emoji').count();
    if (emojiCount !== 1) throw new Error('folder emoji span missing');
    const inlineStyle = await consumableFolder.getAttribute('style');
    if (!inlineStyle || !inlineStyle.includes('--def-folder-color')) {
      throw new Error(`expected folder color CSS var; got ${inlineStyle}`);
    }
    console.log('OK: folder rows render with emoji + theme color hook');

    // Folder list search filters folders.
    await page.locator('.def-folders .def-pane-head input').fill('crafting');
    await page.waitForTimeout(150);
    const filteredFolders = await page.locator('.def-folders li').count();
    if (filteredFolders !== 2) {
      // crafting_material_definitions + crafting_station_definitions
      throw new Error(`folder search filter wrong count, got ${filteredFolders}`);
    }
    console.log(`OK: folder search filter (got ${filteredFolders})`);
    await page.locator('.def-folders .def-pane-head input').fill('');
    await page.waitForTimeout(100);

    // Open Consumable folder + BakedPotato.
    await consumableFolder.click();
    const fileNameText = await page.locator('.def-files .def-file-name').first().textContent();
    if (fileNameText !== 'BakedPotato') {
      throw new Error(`expected stripped filename "BakedPotato", got "${fileNameText}"`);
    }
    await page.locator('.def-files li', { hasText: 'BakedPotato' }).click();
    await page.waitForSelector('.def-editor-head .def-name-input');
    const title = await page.locator('.def-name-input').inputValue();
    if (title !== 'BakedPotato') throw new Error(`expected stripped editor title; got "${title}"`);
    console.log(`OK: editor title = ${title}`);

    // Class field hover-title must contain the parent chain.
    // Class chain lives on the SearchableSelect trigger title attribute
    // in the editor head bar.
    const classTrigger = page.locator('.def-editor-head .ss-trigger.def-class-select');
    const classChain = await classTrigger.getAttribute('title');
    if (!classChain || !classChain.includes('UItemDefinition') || !classChain.includes('UDataAsset')) {
      throw new Error(`class chain missing on hover; got "${classChain}"`);
    }
    console.log(`OK: class chain on hover = "${classChain}"`);

    // Property tooltip — Duration should show the .h doc comment on hover.
    const durationLabel = page.locator('.def-properties .def-field-label', { hasText: 'Duration' }).first();
    const durationTooltip = await durationLabel.getAttribute('title');
    if (!durationTooltip || !durationTooltip.includes('Duration in seconds')) {
      throw new Error(`duration tooltip missing; got "${durationTooltip}"`);
    }
    console.log(`OK: property tooltip from .property-meta sidecar`);

    // Type-color stripes — each rendered field should carry the matching
    // def-type-color-* class.
    const hasAmmoField = page.locator('.def-properties .def-field-row', { hasText: 'Has Ammo' }).first();
    const hasAmmoClasses = await hasAmmoField.getAttribute('class');
    if (!hasAmmoClasses?.includes('def-type-color-bool')) {
      throw new Error(`bool field missing color class; got "${hasAmmoClasses}"`);
    }
    const dnField = page.locator('.def-properties .def-field-row', { hasText: 'Display Name' }).first();
    const dnClasses = await dnField.getAttribute('class');
    if (!dnClasses?.includes('def-type-color-string')) {
      throw new Error(`string field missing color class; got "${dnClasses}"`);
    }
    console.log('OK: typed-envelope color stripes present');

    // Per-asset property search filters fields. Type "duration" — only
    // properties whose name/label match should remain visible.
    await page.locator('.def-prop-search').fill('duration');
    await page.waitForTimeout(150);
    const visibleFields = await page.locator('.def-properties .def-field, .def-properties .def-field-row').count();
    const durationVisible = await page.locator('.def-properties .def-field-label', { hasText: 'Duration' }).count();
    if (durationVisible === 0) throw new Error('property search hid Duration');
    // Other fields like "Display Name" should be hidden now.
    const dnVisible = await page.locator('.def-properties .def-field-label', { hasText: /^Display Name/ }).count();
    if (dnVisible > 0) throw new Error('property search did not hide Display Name');
    console.log(`OK: property search filter (visible ≈ ${visibleFields})`);
    await page.locator('.def-prop-search').fill('');
    await page.waitForTimeout(100);

    // Grouping toggle — switching to "By Type" should produce group headers.
    await page.locator('.def-prop-group select').selectOption('type');
    await page.waitForTimeout(150);
    const groupHeads = await page.locator('.def-group-head').count();
    if (groupHeads === 0) throw new Error('grouping mode "type" did not produce headers');
    console.log(`OK: grouping by type rendered ${groupHeads} group headers`);
    await page.locator('.def-prop-group select').selectOption('default');
    await page.waitForTimeout(100);

    // WideToggle — Has Ammo bool should render a button with role=switch
    // (no <input type=checkbox>). Click toggles aria-checked.
    const hasAmmoToggle = page.locator('.def-properties .def-field-row', { hasText: 'Has Ammo' })
      .locator('button[role="switch"]').first();
    if (!(await hasAmmoToggle.count())) throw new Error('WideToggle button missing for Has Ammo');
    const ariaBefore = await hasAmmoToggle.getAttribute('aria-checked');
    await hasAmmoToggle.click();
    await page.waitForTimeout(150);
    const ariaAfter = await hasAmmoToggle.getAttribute('aria-checked');
    if (ariaBefore === ariaAfter) throw new Error('WideToggle did not flip aria-checked');
    const dirty = await page.locator('.def-editor-head .def-dirty').count();
    if (dirty === 0) throw new Error('WideToggle click did not mark dirty');
    console.log(`OK: WideToggle flipped (${ariaBefore} → ${ariaAfter}) and marked dirty`);

    // Edit Display Name (text envelope).
    const dnInput = page.locator('.def-field-row', { hasText: 'Display Name' }).locator('input[type="text"]').first();
    await dnInput.fill('Baked Potato Edited');
    await page.waitForTimeout(150);

    // NumberSlider — Weight has clamp_min=0/clamp_max=10 in property-meta,
    // so it should render a slider input alongside the number input.
    const weightField = page.locator('.def-field-row', { hasText: 'Weight' }).first();
    const weightSlider = weightField.locator('input[type="range"]');
    if (!(await weightSlider.count())) {
      throw new Error('NumberSlider did not render for Weight (clamp meta present)');
    }
    const weightNumberInput = weightField.locator('.ns-number');
    await weightNumberInput.fill('5');
    await page.waitForTimeout(150);
    console.log('OK: NumberSlider rendered for clamp-bounded float');

    // definition_ref combobox — Static Item Definition. Open + filter.
    const refRow = page.locator('.def-field', { hasText: 'Static Item Definition' }).first();
    const refSs = refRow.locator('.ss-root').first();
    await refSs.locator('.ss-trigger').click();
    await page.waitForSelector('.ss-popover');
    // Filter to "Bread" — should narrow to one option (and the +New row).
    await page.locator('.ss-popover .ss-search').fill('bread');
    await page.waitForTimeout(100);
    const filteredItems = await page.locator('.ss-popover .ss-item:not(.ss-create-row)').count();
    if (filteredItems < 1) throw new Error(`searchable dropdown filter empty`);
    // Click the Bread option.
    await page.locator('.ss-popover .ss-item', { hasText: 'Bread' }).first().click();
    await page.waitForTimeout(150);
    const triggerLabel = await refSs.locator('.ss-trigger-label').textContent();
    // Definition_ref dropdown labels are now prefixed with the target's
    // folderTheme emoji (J3) — "Bread" lives in crafting_material_definitions
    // (🧪). Just check the bare stem appears.
    if (!triggerLabel?.includes('Bread')) {
      throw new Error(`SearchableSelect trigger label wrong; got "${triggerLabel}"`);
    }
    console.log(`OK: SearchableSelect filter + selection on definition_ref (label "${triggerLabel}")`);

    // Save current — verify saved JSON keeps the typed envelopes + new ref.
    await page.locator('button:has-text("Save current")').click();
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => window._mockWrites['ID_BakedPotato_CN.json']);
    if (!saved) throw new Error('save did not write file');
    const savedJson = JSON.parse(saved);
    if (savedJson.properties.static_item_definition.value !== 'ID_Bread_CM') {
      throw new Error(`saved JSON wrong ref value: ${JSON.stringify(savedJson.properties.static_item_definition)}`);
    }
    if (savedJson.properties.weight.type !== 'float') {
      throw new Error('saved JSON lost float envelope');
    }
    console.log('OK: saved JSON preserves typed envelopes + new ref');

    // ─── Whitelisted items via .property-meta ───────────────────────────
    // IRD_Test.inventory_rules.whitelisted_items is an empty array with
    // element_type=null. No other record has it populated, so the only
    // source of element_class is the .property-meta.json sidecar
    // (InventoryRules.whitelisted_items → ItemDefinition).
    const irdFolder = page.locator('.def-folders li', { hasText: 'Inventory Rules Definitions' });
    await irdFolder.click();
    await page.locator('.def-files li[title="IRD_Test"]').click();
    await page.waitForSelector('.def-editor-head .def-name-input');

    // Drill into the inventory_rules struct → whitelisted_items array.
    const wlField = page.locator('.def-field', { hasText: 'Whitelisted Items' }).first();
    if (!(await wlField.count())) throw new Error('whitelisted_items field missing');
    await wlField.locator('button', { hasText: '+ Add' }).first().click();
    await page.waitForTimeout(150);
    // The +Add seed should be a definition_ref combobox bound to ItemDefinition.
    const seededSs = wlField.locator('.ss-root').first();
    if (!(await seededSs.count())) {
      throw new Error('property-meta element_class seed did not produce a SearchableSelect');
    }
    await seededSs.locator('.ss-trigger').click();
    await page.waitForSelector('.ss-popover');
    // Should have ItemDefinition subclasses (Pencil, BakedPotato, WoodenDowel, Bread) at minimum.
    const wlOptions = await page.locator('.ss-popover .ss-item').allTextContents();
    const wantBare = ['Pencil', 'BakedPotato', 'WoodenDowel', 'Bread'];
    for (const w of wantBare) {
      if (!wlOptions.some((t) => t.includes(w))) {
        throw new Error(`whitelisted-items dropdown missing ${w}; got ${JSON.stringify(wlOptions)}`);
      }
    }
    console.log(`OK: whitelisted_items dropdown seeded from property-meta (${wlOptions.length} options)`);
    await page.keyboard.press('Escape');
    await page.locator('button', { hasText: 'Revert' }).click();
    await page.waitForTimeout(150);

    // ─── Class change relocates the file on save ───────────────────────
    // Pick BakedPotato; change its class to UCraftingMaterialDefinition.
    await consumableFolder.click();
    await page.locator('.def-files li[title="ID_BakedPotato_CN"]').click();
    await page.waitForSelector('.def-editor-head .def-name-input');
    // Class SearchableSelect now lives in the editor head, identified by the
    // `def-class-select` triggerClassName.
    const classSs = page.locator('.def-editor-head .ss-root').first();
    await classSs.locator('.ss-trigger.def-class-select').click();
    await page.waitForSelector('.ss-popover');
    await page.locator('.ss-popover .ss-search').fill('UCraftingMaterial');
    await page.waitForTimeout(100);
    await page.locator('.ss-popover .ss-item', { hasText: 'UCraftingMaterialDefinition' }).first().click();
    await page.waitForTimeout(150);
    // Class subline should now show the new class.
    const updatedClass = await page.locator('.def-editor-head .ss-trigger.def-class-select .ss-trigger-label').textContent();
    if (updatedClass !== 'UCraftingMaterialDefinition') {
      throw new Error(`class change did not propagate; got "${updatedClass}"`);
    }
    // Save — file should land in crafting_material_definitions/ and the
    // old consumable_definitions/ID_BakedPotato_CN.json should be removed.
    await page.locator('button:has-text("Save current")').click();
    await page.waitForTimeout(400);
    const removedKey = await page.evaluate(() =>
      Object.keys(window._mockRemoved).find((k) => k.endsWith('ID_BakedPotato_CN.json')),
    );
    if (!removedKey || !removedKey.startsWith('consumable_definitions/')) {
      throw new Error(`old file not removed after class change; got ${removedKey}`);
    }
    const relocSaved = await page.evaluate(() => window._mockWrites['ID_BakedPotato_CN.json']);
    const relocJson = JSON.parse(relocSaved);
    if (relocJson.class !== 'UCraftingMaterialDefinition') {
      throw new Error(`relocated JSON has wrong class: ${relocJson.class}`);
    }
    if (!Array.isArray(relocJson.parent_classes) || !relocJson.parent_classes.includes('UItemDefinition')) {
      throw new Error(`parent_classes not synced after class change: ${JSON.stringify(relocJson.parent_classes)}`);
    }
    console.log(`OK: class change relocated + parent_classes synced (removed ${removedKey})`);

    // After relocation the editor should follow the asset to the new folder.
    const newFolderName = await page.locator('.def-folders li.active .def-folder-name').textContent();
    if (newFolderName !== 'Crafting Material Definitions') {
      throw new Error(`expected folder follow; got "${newFolderName}"`);
    }
    console.log('OK: editor follows asset to its new folder');

    // ─── Map editor still works ────────────────────────────────────────
    const recipeFolder = page.locator('.def-folders li', { hasText: 'Craft Recipe Definitions' });
    await recipeFolder.click();
    await page.locator('.def-files li[title="RD_Bread_CR"]').click();
    await page.waitForSelector('.def-editor-head .def-name-input');
    const inputMapField = page.locator('.def-field', { hasText: 'Input' }).first();
    const initialMapCount = await page.locator('.def-map-entry').count();
    await inputMapField.locator('button', { hasText: '+ Add' }).first().click();
    await page.waitForTimeout(200);
    const afterAddCount = await page.locator('.def-map-entry').count();
    if (afterAddCount !== initialMapCount + 1) {
      throw new Error(`expected map+1 entries, got ${afterAddCount}`);
    }
    console.log(`OK: map append (${initialMapCount}→${afterAddCount})`);

    // Inline + New flow inside the SearchableSelect on the new map row.
    const newMapEntry = page.locator('.def-map-entry').nth(1);
    const newKeySs = newMapEntry.locator('.ss-root').first();
    await newKeySs.locator('.ss-trigger').click();
    await page.waitForSelector('.ss-popover');
    await page.locator('.ss-popover .ss-create-row').click();
    await page.waitForSelector('.ss-create input');
    await page.locator('.ss-create input').fill('ID_NewMaterial_CM');
    await page.locator('.ss-create button.primary').click();
    await page.waitForTimeout(300);
    const newKeyLabel = await newKeySs.locator('.ss-trigger-label').textContent();
    if (!newKeyLabel?.includes('NewMaterial')) {
      throw new Error(`+ New flow did not select new asset; trigger label = "${newKeyLabel}"`);
    }
    console.log(`OK: SearchableSelect + New flow created and selected new asset (label "${newKeyLabel}")`);

    // Save-all should write the new material.
    const saveAllBtn = page.locator('button:has-text("Save all")');
    if (await saveAllBtn.isEnabled()) {
      await saveAllBtn.click();
      await page.waitForTimeout(300);
      const writes2 = await page.evaluate(() => Object.keys(window._mockWrites));
      if (!writes2.includes('ID_NewMaterial_CM.json')) {
        throw new Error(`new asset not saved; writes=${JSON.stringify(writes2)}`);
      }
      console.log(`OK: save-all wrote ${writes2.length} files including new asset`);
    }

    // Layout asset should never have been written even on save-all.
    const layoutWritten = await page.evaluate(() => Object.keys(window._mockWrites)
      .some((k) => k.startsWith('LYD_')));
    if (layoutWritten) throw new Error('layout fixture was written despite skip rule');
    console.log('OK: layout files never written');

    // ─── Pin a property ───────────────────────────────────────────────
    // Open the bench and pin "starting_health". Then visit the cage and
    // verify that "starting_health" appears under the "Pinned" group head.
    const stationFolder = page.locator('.def-folders li', { hasText: 'Crafting Station Definitions' });
    await stationFolder.click();
    await page.locator('.def-files li', { hasText: 'BenchTier1' }).click();
    await page.waitForSelector('.def-editor-head .def-name-input');
    const startingHealthRow = page.locator('.def-properties .def-field-row', { hasText: 'Starting Health' }).first();
    const pinBtn = startingHealthRow.locator('.def-pin-btn').first();
    await pinBtn.click();
    await page.waitForTimeout(150);
    const pinned = await pinBtn.getAttribute('class');
    if (!pinned?.includes('pinned')) throw new Error('pin toggle did not stick on bench');
    // Pinned group should now exist on this asset.
    const benchPinnedHead = await page.locator('.def-group-pinned .def-group-head').count();
    if (benchPinnedHead === 0) throw new Error('Pinned group head missing after pin');
    console.log('OK: pinned property surfaces in Pinned group');

    // Cage should also surface starting_health under Pinned now.
    const cageFolder = page.locator('.def-folders li', { hasText: 'Containment Cage Definitions' });
    await cageFolder.click();
    await page.locator('.def-files li', { hasText: 'Cage_Basic' }).click();
    await page.waitForSelector('.def-editor-head .def-name-input');
    const cagePinnedHead = await page.locator('.def-group-pinned .def-group-head').count();
    if (cagePinnedHead === 0) throw new Error('Pinned group missing on cage — pin should be global');
    const cagePinnedField = await page.locator('.def-group-pinned .def-field-row', { hasText: 'Starting Health' }).count();
    if (cagePinnedField === 0) throw new Error('starting_health not under Pinned on cage');
    console.log('OK: pin is global across assets');

    // Unpin to keep state clean for the table-mode assertion below.
    const cagePinBtn = page.locator('.def-group-pinned .def-pin-btn').first();
    await cagePinBtn.click();
    await page.waitForTimeout(100);

    // ─── Multi-select + table view ────────────────────────────────────
    // Switch to crafting_material folder and Ctrl-click both files into
    // the multi-select. Then enter Table view and verify columns/rows.
    const matFolder = page.locator('.def-folders li', { hasText: 'Crafting Material Definitions' });
    await matFolder.click();
    await page.waitForTimeout(100);
    // Primary: pick the first file.
    await page.locator('.def-files li[title="ID_Bread_CM"]').click();
    await page.waitForSelector('.def-editor-head .def-name-input');
    // Ctrl-click another file to add to multi-select.
    await page.locator('.def-files li[title="ID_WoodenDowel_CM"]').click({ modifiers: ['Control'] });
    await page.waitForTimeout(100);
    const extraSelected = await page.locator('.def-files li.extra-selected').count();
    if (extraSelected !== 1) throw new Error(`expected 1 extra-selected; got ${extraSelected}`);
    console.log('OK: ctrl-click adds to multi-select');

    // Click the "Table" button in the view-mode segmented control.
    await page.locator('.def-view-mode button', { hasText: /^Table/ }).click();
    await page.waitForSelector('.def-table');
    const rowCount = await page.locator('.def-table tbody tr').count();
    if (rowCount !== 2) throw new Error(`expected 2 rows in table; got ${rowCount}`);
    console.log(`OK: table renders ${rowCount} rows`);

    // Both rows should share Display Name + Stackable + Weight as
    // properties — verify the column header counts are 2/2 (shared).
    const dnHeader = page.locator('.def-table thead th', { hasText: 'Display Name' }).first();
    const dnHeaderClass = await dnHeader.getAttribute('class');
    if (!dnHeaderClass?.includes('shared')) {
      throw new Error(`Display Name column not marked shared; class = "${dnHeaderClass}"`);
    }
    console.log('OK: shared column marked');

    // Add a brand new property "favorite_color" to all selected rows.
    const addInput = page.locator('.def-table-toolbar input[placeholder*="Add property"]');
    await addInput.fill('favorite_color');
    await page.locator('.def-table-toolbar button.primary').click();
    await page.waitForTimeout(150);
    const newCol = page.locator('.def-table thead th', { hasText: 'Favorite Color' }).first();
    if (!(await newCol.count())) throw new Error('add-property did not create column');
    const newColCount = await newCol.locator('..').locator('.def-muted').first().textContent();
    // Header shows "2/2" since we seeded both rows.
    if (!newColCount?.includes('2/2')) {
      throw new Error(`expected 2/2 presence on new column; got "${newColCount}"`);
    }
    console.log('OK: bulk add property propagated to all selected rows');

    // Edit the first row's favorite_color string value.
    const firstFavCell = page.locator('.def-table tbody tr').first()
      .locator('td').filter({ has: page.locator('.def-field-row') }).last();
    const favInput = firstFavCell.locator('input[type="text"]').first();
    if (await favInput.count()) {
      await favInput.fill('cerulean');
      await page.waitForTimeout(150);
    }
    console.log('OK: cell edit accepted');

    // Switch back to form view.
    await page.locator('.def-view-mode button', { hasText: /^Form$/ }).click();
    await page.waitForTimeout(150);
    if (!(await page.locator('.def-editor-body').count())) {
      throw new Error('Form view did not restore');
    }
    console.log('OK: toggled back to form view');

    // ─── Recipe Builder view (G1) ─────────────────────────────────────
    // Switch to the craft_recipe_definitions folder; the Recipes tab
    // should appear in the segmented control. Render a card per recipe.
    await page.locator('.def-folders li', { hasText: 'Craft Recipe Definitions' }).click();
    await page.waitForTimeout(100);
    const recipesBtn = page.locator('.def-view-mode button', { hasText: /^Recipes$/ });
    if (!(await recipesBtn.count())) throw new Error('Recipes view button missing on recipe folder');
    await recipesBtn.click();
    await page.waitForSelector('.rb-card');
    const cardCount = await page.locator('.rb-card').count();
    if (cardCount < 1) throw new Error('Recipe builder rendered no cards');
    console.log(`OK: Recipe builder rendered ${cardCount} card(s)`);

    // Add a row to one card's input map and edit qty.
    const firstCard = page.locator('.rb-card').first();
    const addRowBtn = firstCard.locator('.rb-add-row').first();
    await addRowBtn.click();
    await page.waitForTimeout(100);
    const newRow = firstCard.locator('.rb-row').last();
    const qtyInput = newRow.locator('.rb-row-qty');
    await qtyInput.click();
    await qtyInput.fill('3');
    await page.waitForTimeout(100);
    console.log('OK: Recipe builder add row + qty edit');

    // ─── Enum dropdown (H3/H5) ────────────────────────────────────────
    // Switch back to form view on the BakedPotato (now in
    // crafting_material_definitions after the class change earlier).
    await page.locator('.def-folders li', { hasText: 'Crafting Material Definitions' }).click();
    await page.locator('.def-files li[title="ID_BakedPotato_CN"]').click();
    await page.waitForSelector('.def-editor-head h3, .def-name-input');
    const effectField = page.locator('.def-properties .def-field-row', { hasText: 'Effect Type' }).first();
    if (!(await effectField.count())) throw new Error('effect_type field missing');
    const effectSs = effectField.locator('.ss-root').first();
    if (!(await effectSs.count())) throw new Error('Enum dropdown did not render — got text input');
    const triggerLabelEnum = await effectSs.locator('.ss-trigger-label').textContent();
    if (triggerLabelEnum !== 'Flat Heal') {
      throw new Error(`enum trigger label wrong; expected DisplayName "Flat Heal", got "${triggerLabelEnum}"`);
    }
    await effectSs.locator('.ss-trigger').click();
    await page.waitForSelector('.ss-popover');
    const enumLabels = await page.locator('.ss-popover .ss-item-label').allTextContents();
    if (!enumLabels.includes('No Effect')) {
      throw new Error(`enum dropdown missing "No Effect"; got ${JSON.stringify(enumLabels)}`);
    }
    if (!enumLabels.includes('Poison Resist')) {
      throw new Error(`humanized member missing — expected "Poison Resist"; got ${JSON.stringify(enumLabels)}`);
    }
    await page.locator('.ss-popover .ss-item', { hasText: 'No Effect' }).first().click();
    await page.waitForTimeout(100);
    const updatedEnum = await effectSs.locator('.ss-trigger-label').textContent();
    if (updatedEnum !== 'No Effect') throw new Error(`enum did not update; got "${updatedEnum}"`);
    console.log('OK: enum dropdown shows DisplayName + humanized labels');

    // ─── Bare-name id input (I1/H4) ───────────────────────────────────
    // The editor head should expose the stripped name as an editable
    // input — saving with a new bare name must rebuild the full id and
    // remove the old file from disk.
    const nameInput = page.locator('.def-name-input');
    const initialName = await nameInput.inputValue();
    if (initialName !== 'BakedPotato') {
      throw new Error(`name input should show stripped form; got "${initialName}"`);
    }
    await nameInput.fill('BakedSpud');
    await nameInput.blur();
    await page.waitForTimeout(150);
    // Save and verify the file landed at ID_BakedSpud_CN.json (prefix
    // ID_/suffix _CN come from idTemplates derived from the loaded data).
    // Use the editor head's primary Save button (avoids the toolbar's
    // "Save current" / "Save all" buttons).
    await page.locator('.def-editor-head button.primary', { hasText: 'Save' }).click();
    await page.waitForTimeout(300);
    const writes3 = await page.evaluate(() => Object.keys(window._mockWrites));
    if (!writes3.some((w) => w.includes('BakedSpud'))) {
      throw new Error(`rename did not produce a BakedSpud-named write; got ${JSON.stringify(writes3)}`);
    }
    console.log('OK: bare-name rename rebuilt full id with prefix/suffix on save');

    // ─── Item ↔ StaticItem partner button (J1) ────────────────────────
    // We don't have a StaticItem fixture in this smoke, so just assert the
    // button is absent on a non-item asset.
    await page.locator('.def-folders li', { hasText: 'Inventory Rules Definitions' }).click();
    await page.locator('.def-files li[title="IRD_Test"]').click();
    await page.waitForSelector('.def-name-input');
    const partnerBtn = await page.locator('.def-pair-btn').count();
    if (partnerBtn !== 0) throw new Error('partner button should not appear on non-Item assets');
    console.log('OK: partner button hidden when no pair');

    // ─── Validation panel includes pair issues (J2) ───────────────────
    await page.getByRole('button', { name: /Show validation/ }).click();
    await page.waitForSelector('.def-validation-panel');
    const pairHeader = await page.locator('.def-validation-panel').textContent();
    if (!pairHeader?.includes('Item ↔ StaticItem pairs')) {
      throw new Error(`validation panel missing pairs section; got ${pairHeader?.slice(0, 200)}`);
    }
    console.log('OK: validation panel surfaces Item ↔ StaticItem pair section');
    await page.getByRole('button', { name: /Hide validation/ }).click();

    // ─────────────────────────────────────────────────────────────────
    // New IA: walk the four top-level tabs and the five Recipes & Loot
    // sub-tabs. Each one must render its body component without console
    // errors. We don't assert on specific data here — the bundled tree
    // is suppressed in this smoke, so most rails will be empty.
    // ─────────────────────────────────────────────────────────────────
    for (const t of ['Recipes & Loot', 'Furniture Loot', 'Validations']) {
      await page.getByRole('button', { name: t, exact: true }).click();
      await page.waitForTimeout(80);
    }
    console.log('OK: top-level tabs reachable');

    await page.getByRole('button', { name: 'Recipes & Loot', exact: true }).click();
    for (const sub of ['Stations', 'Furniture', 'Tech Tree', 'Enemies', 'Biome']) {
      await page.locator('.subtab', { hasText: sub }).click();
      await page.waitForTimeout(80);
    }
    console.log('OK: Recipes & Loot sub-tabs reachable');

    if (consoleErrors.length > 0) {
      console.error('Console errors:');
      for (const e of consoleErrors) console.error(' ', e);
      throw new Error('console errors detected');
    }

    console.log('\n=== ALL DEFINITIONS UI TESTS PASSED ===');
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
