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
const ROOT = join(__dirname, 'public', 'base-definitions');

if (!existsSync(ROOT)) {
  console.error('No bundled defaults at', ROOT, '— run `npm run sync-defaults` first.');
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
