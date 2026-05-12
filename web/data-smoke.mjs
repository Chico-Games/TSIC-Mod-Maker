#!/usr/bin/env node
// Data smoke: load the bundled defaults straight off disk and sanity-check
// the most important cross-references. Replaces the legacy
// definitions-smoke.mjs which depended on the projectStore being loaded
// in a browser.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, 'public', 'starter-project');

if (!existsSync(ROOT)) {
  console.error('No starter project at', ROOT, '— run `npm run sync-defaults` first.');
  process.exit(1);
}

const failures = [];
function fail(msg) { failures.push(msg); }

async function loadAll() {
  const folders = (await readdir(ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !/^layout/.test(e.name))
    .map((e) => e.name);
  const byId = new Map();
  for (const folder of folders) {
    const files = await readdir(join(ROOT, folder));
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const text = await readFile(join(ROOT, folder, f), 'utf8');
      try {
        const json = JSON.parse(text);
        byId.set(id, { folder, id, json });
      } catch (e) {
        fail(`parse failed: ${folder}/${f}: ${e.message}`);
      }
    }
  }
  return byId;
}

function refValue(t) { return t && typeof t === 'object' && t.type === 'definition_ref' ? String(t.value ?? '') : ''; }

async function main() {
  const byId = await loadAll();
  console.log(`[data-smoke] loaded ${byId.size} assets`);

  // Stations resolve to ARRs.
  let stationCount = 0, arrResolved = 0;
  for (const rec of byId.values()) {
    const stationFolders = ['crafting_station_definitions', 'production_station_definitions', 'plantable_definitions'];
    if (!stationFolders.includes(rec.folder)) continue;
    stationCount++;
    const arr = refValue(rec.json?.properties?.available_recipe_rules_definition);
    if (arr && byId.has(arr)) arrResolved++;
    else if (arr) fail(`station ${rec.id} → ARR ${arr} not loaded`);
  }
  console.log(`[data-smoke] stations: ${stationCount}; ARR resolved: ${arrResolved}`);

  // ARR recipes resolve.
  let arrCount = 0, recipesResolved = 0, recipesUnresolved = 0;
  for (const rec of byId.values()) {
    if (rec.folder !== 'available_recipe_rules_definitions') continue;
    arrCount++;
    const arr = rec.json?.properties?.production_machine_rules?.value?.recipes;
    if (!arr || arr.type !== 'array' || !Array.isArray(arr.value)) continue;
    for (const e of arr.value) {
      const v = refValue(e);
      if (!v) continue;
      if (byId.has(v)) recipesResolved++;
      else { recipesUnresolved++; fail(`ARR ${rec.id} references missing recipe ${v}`); }
    }
  }
  console.log(`[data-smoke] ARRs: ${arrCount}; resolved recipe refs: ${recipesResolved}; unresolved: ${recipesUnresolved}`);

  // Furniture upgrade recipes resolve.
  let furnCount = 0, upgradeResolved = 0;
  for (const rec of byId.values()) {
    if (rec.folder !== 'damageable_furniture_definitions') continue;
    furnCount++;
    const u = refValue(rec.json?.properties?.upgrade_recipe);
    if (u && !byId.has(u)) fail(`furniture ${rec.id} → upgrade_recipe ${u} not loaded`);
    if (u && byId.has(u)) upgradeResolved++;
    const lootArr = rec.json?.properties?.loot_dropped_on_death;
    if (lootArr?.type === 'array' && Array.isArray(lootArr.value)) {
      for (const e of lootArr.value) {
        const v = refValue(e);
        if (v && !byId.has(v)) fail(`furniture ${rec.id} → loot ${v} not loaded`);
      }
    }
  }
  console.log(`[data-smoke] furniture: ${furnCount}; upgrade refs resolved: ${upgradeResolved}`);

  // Items + Furniture configs cover their folders.
  const HAS_PARTNER = new Set([
    'crafting_material_definitions', 'consumable_definitions', 'constructable_item_definitions',
    'equippable_definitions', 'glove_definitions', 'ammo_definitions',
    'seed_item_definitions', 'trap_item_definitions',
  ]);
  let partnerSlots = 0, partnerMissing = 0;
  for (const rec of byId.values()) {
    if (!HAS_PARTNER.has(rec.folder)) continue;
    const slot = rec.json?.properties?.static_item_definition;
    if (!slot || slot.type !== 'definition_ref') continue;
    partnerSlots++;
    const v = slot.value;
    if (typeof v !== 'string' || !v || !byId.has(v)) partnerMissing++;
  }
  console.log(`[data-smoke] partner-resolvable: ${partnerSlots - partnerMissing}/${partnerSlots} (missing ${partnerMissing} — auto-create will mint these)`);

  // Asset catalogs + tags cross-check.
  const catalogDir = join(ROOT, '.assets');
  const catalogs = new Map(); // class -> Set of valid paths
  if (existsSync(catalogDir)) {
    for (const file of await readdir(catalogDir)) {
      if (!file.endsWith('.json')) continue;
      const cls = file.replace(/\.json$/, '');
      const payload = JSON.parse(await readFile(join(catalogDir, file), 'utf8'));
      catalogs.set(cls, new Set((payload.entries ?? []).map((e) => e.path)));
    }
  }

  const tagFile = join(ROOT, '.gameplay-tags.json');
  const tagSet = existsSync(tagFile)
    ? new Set(JSON.parse(await readFile(tagFile, 'utf8')).tags ?? [])
    : new Set();

  function* envelopes(v) {
    if (v && typeof v === 'object') {
      if ('type' in v) {
        yield v;
        if (v.value && typeof v.value === 'object') yield* envelopes(v.value);
      } else if (Array.isArray(v)) {
        for (const x of v) yield* envelopes(x);
      } else {
        for (const x of Object.values(v)) yield* envelopes(x);
      }
    }
  }

  let unresolvedRefs = 0, unknownTags = 0, skippedNoCatalog = 0;
  for (const { folder, id, json } of byId.values()) {
    for (const env of envelopes(json.properties)) {
      if (env.type === 'soft_asset_ref' && env.value) {
        const cat = catalogs.get(env.class);
        if (!cat) {
          skippedNoCatalog++;
          fail(`${folder}/${id}: no catalog for ref class ${env.class} (envelope path: ${env.value})`);
          continue;
        }
        if (!cat.has(env.value)) {
          unresolvedRefs++;
          fail(`${folder}/${id}: unresolved ${env.class} ref ${env.value}`);
        }
      }
      if (env.type === 'gameplay_tag' && env.value) {
        if (!tagSet.has(env.value)) {
          unknownTags++;
          fail(`${folder}/${id}: unknown tag ${env.value}`);
        }
      }
      if (env.type === 'gameplay_tag_container' && Array.isArray(env.value)) {
        for (const t of env.value) {
          if (!tagSet.has(t)) {
            unknownTags++;
            fail(`${folder}/${id}: unknown tag ${t}`);
          }
        }
      }
    }
  }
  console.log(`[data-smoke] cross-check: ${unresolvedRefs} unresolved soft asset refs, ${unknownTags} unknown tags, ${skippedNoCatalog} refs with no catalog (class not exported)`);

  if (failures.length > 0) {
    console.error('\n[data-smoke] FAILURES:');
    for (const f of failures.slice(0, 50)) console.error('  -', f);
    if (failures.length > 50) console.error(`  ... and ${failures.length - 50} more`);
    process.exit(1);
  }
  console.log('\n[data-smoke] OK');
}

main().catch((e) => {
  console.error('[data-smoke] failed:', e);
  process.exit(1);
});
