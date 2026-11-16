import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyLeanSchemaOverrides,
  envelopePropsToLean,
  leanPropsToEnvelope,
  type LeanSchema,
} from '../src/persistence/leanEnvelope';
import {
  dropEnvelopeWith,
  effectiveRows,
  enemyListWith,
  expectedDrops,
  readDropRows,
  readEnemyRows,
  readWorldLoot,
  shares,
  without,
  worldListWith,
  worldTiersWith,
} from '../src/components/loot/lootModel';
import { PACK_DIR, PACK_AVAILABLE } from './packDir';

// The Loot tab edits typed envelopes, but what matters is the lean JSON that
// lands on disk — it has to be exactly what the game's reader expects. These
// tests take real records from the pack, apply the tab's edits, convert back to
// lean, and check the result is the original plus precisely the intended row.

const skip = !PACK_AVAILABLE && `pack not found at ${PACK_DIR}`;

function load(folder: string, id: string) {
  const schema = applyLeanSchemaOverrides(
    JSON.parse(readFileSync(join(PACK_DIR, '_schema.json'), 'utf8')) as LeanSchema,
  );
  const lean = JSON.parse(readFileSync(join(PACK_DIR, folder, `${id}.json`), 'utf8'));
  const rec = {
    folder,
    id,
    json: { ...lean, properties: leanPropsToEnvelope(lean.properties, lean.class, schema) },
    originalText: '',
    diskId: id,
    diskFolder: folder,
  };
  const toLean = (props: any) => envelopePropsToLean(props, schema);
  return { lean, rec, toLean };
}

test('drop table: unedited record converts back to the bytes it came from', { skip }, () => {
  const { lean, rec, toLean } = load('loot_definitions', 'LD_BinsLoot');
  assert.deepEqual(toLean(rec.json.properties), lean.properties);
});

test('drop table: reads rows and averages', { skip }, () => {
  const { lean, rec } = load('loot_definitions', 'LD_BinsLoot');
  const rows = readDropRows(rec);
  assert.equal(rows.length, lean.properties.items_to_drop.length);
  assert.equal(rows[0].item, lean.properties.items_to_drop[0].item_to_drop);
  const avg = expectedDrops([
    { item: 'A', count: 2, chance: 0.5, path: [] },
    { item: 'A', count: 1, chance: 1, path: [] },
    { item: 'B', count: 4, chance: 0.25, path: [] },
  ]);
  assert.deepEqual(avg, [{ item: 'A', avg: 2 }, { item: 'B', avg: 1 }]);
});

test('drop table: adding an item appends exactly one lean row', { skip }, () => {
  const { lean, rec, toLean } = load('loot_definitions', 'LD_BinsLoot');
  const next = { ...rec.json.properties, items_to_drop: dropEnvelopeWith(rec, 'ID_MetalScrews_CM') };
  const out = toLean(next);
  assert.deepEqual(out.items_to_drop, [
    ...lean.properties.items_to_drop,
    { item_to_drop: 'ID_MetalScrews_CM', count: 1, chance_to_drop: 1 },
  ]);
  // Nothing else on the record moved.
  assert.deepEqual({ ...out, items_to_drop: null }, { ...lean.properties, items_to_drop: null });
});

test('drop table: removing a row removes only that row', { skip }, () => {
  const { lean, rec, toLean } = load('loot_definitions', 'LD_BinsLoot');
  const next = { ...rec.json.properties, items_to_drop: without(rec.json.properties.items_to_drop, 0) };
  assert.deepEqual(toLean(next).items_to_drop, lean.properties.items_to_drop.slice(1));
});

test('world loot: tiers, accumulation and shares', { skip }, () => {
  const { lean, rec } = load('loot_spawn_point_definitions', 'LSP_Warehouse_Container');
  const loot = readWorldLoot(rec);
  const leanTiers = lean.properties.loot_by_difficulty;
  assert.deepEqual(loot.tiers.filter((t) => t.index >= 0).map((t) => t.difficulty), leanTiers.map((t: any) => t.key.name));
  assert.equal(loot.source, lean.properties.source_type.name);
  assert.equal(loot.accumulate, lean.properties.accumulate_previous_tiers);

  const easy = loot.tiers[0].rows.length;
  const normal = loot.tiers[1].rows.length;
  const pool = effectiveRows(loot, 1);
  assert.equal(pool.length, loot.accumulate ? easy + normal : normal);
  if (loot.accumulate) assert.equal(pool[0].inheritedFrom, 'EASY');
  const s = shares(pool);
  assert.ok(Math.abs(s.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'shares sum to 1');
});

test('world loot: adding an item to one tier appends one lean row there and nowhere else', { skip }, () => {
  const { lean, rec, toLean } = load('loot_spawn_point_definitions', 'LSP_Warehouse_Container');
  const loot = readWorldLoot(rec);
  const tier = loot.tiers[1];
  const props = JSON.parse(JSON.stringify(rec.json.properties));
  props.loot_by_difficulty.value[tier.index].value.value.loot_items = worldListWith(rec, tier, 'FD_ScrapMetal_SI');
  const out = toLean(props);
  const expected = JSON.parse(JSON.stringify(lean.properties));
  expected.loot_by_difficulty[tier.index].value.loot_items.push({ item_entity: 'FD_ScrapMetal_SI', count: 1, weight: 1 });
  assert.deepEqual(out, expected);
});

test('world loot: a missing tier is added in difficulty order with the game shape', { skip }, () => {
  const { lean, rec, toLean } = load('loot_spawn_point_definitions', 'LSP_Warehouse_Container');
  // Drop NORMAL, then ask for it back.
  const props = JSON.parse(JSON.stringify(rec.json.properties));
  props.loot_by_difficulty.value = props.loot_by_difficulty.value.filter((e: any) => e.key.value !== 'NORMAL');
  const cut = { ...rec, json: { ...rec.json, properties: props } };
  assert.equal(readWorldLoot(cut).tiers[1].index, -1);

  const restored = { ...props, loot_by_difficulty: worldTiersWith(cut, 'NORMAL', 0.5) };
  const out = toLean(restored).loot_by_difficulty;
  assert.deepEqual(out.map((e: any) => e.key.name), ['EASY', 'NORMAL', 'HARD']);
  assert.deepEqual(out[1], {
    key: lean.properties.loot_by_difficulty[1].key,
    value: { loot_items: [], spawn_chance: 0.5 },
  });
});

test('enemy drops: adding a drop appends one lean row', { skip }, () => {
  const { lean, rec, toLean } = load('enemy_definitions', 'ED_BoneHead');
  assert.equal(readEnemyRows(rec).length, lean.properties.death_drop_table.length);
  const next = { ...rec.json.properties, death_drop_table: enemyListWith(rec, 'FD_ScrapMetal_SI') };
  assert.deepEqual(toLean(next).death_drop_table, [
    ...lean.properties.death_drop_table,
    { world_item: 'FD_ScrapMetal_SI', count: 1, weight: 1 },
  ]);
});
