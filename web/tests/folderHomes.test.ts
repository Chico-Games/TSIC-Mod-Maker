import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configFor, editedElsewhere, labelFor, railFor } from '../src/components/classBrowser/folderHomes';
import type { ClassNode } from '../src/store/appSchemaStore';
import { PACK_DIR, PACK_AVAILABLE } from './packDir';

// "Does the editor have a place for everything the game ships?" as a test.
//
// The game keeps adding definition folders. When a new one had no tab it was
// only reachable through the raw Definitions list, and nobody noticed for
// months. This walks the real pack and fails if any folder is left without a
// home — a rail tab, or a purpose-built editor named in `editedElsewhere`.

const skip = !PACK_AVAILABLE && `pack not found at ${PACK_DIR}`;

function loadPack() {
  const defs = new Map<string, any>();
  for (const folder of readdirSync(PACK_DIR)) {
    const dir = join(PACK_DIR, folder);
    if (folder.startsWith('.') || folder.startsWith('_') || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      let json: any;
      try { json = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
      if (typeof json?.id !== 'string' || typeof json?.class !== 'string') continue;
      const id = f.slice(0, -5);
      defs.set(`${folder}/${id}`, { folder, id, json, originalText: '', diskId: id, diskFolder: folder });
    }
  }
  // The hierarchy the app actually loads: the bundled one, which refresh-schema
  // self-heals with classes the pack's own sidecar has not caught up on.
  const hierarchy = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'public', 'schema', 'class-hierarchy.json'), 'utf8'),
  );
  const classNodes = new Map<string, ClassNode>();
  for (const [name, info] of Object.entries<any>(hierarchy.classes ?? {})) {
    classNodes.set(name, { name, parents: info.parents ?? [], folder: info.folder ?? null });
  }
  return { defs, classNodes };
}

test('every definition folder in the pack has exactly one home', { skip }, () => {
  const { defs, classNodes } = loadPack();
  const folders = new Set([...defs.values()].map((r) => r.folder));
  const homes = new Map<string, string[]>();
  for (const home of ['items', 'furniture', 'systems'] as const) {
    for (const f of railFor(home, defs, classNodes).folders) {
      homes.set(f, [...(homes.get(f) ?? []), home]);
    }
  }
  const homeless: string[] = [];
  const doubled: string[] = [];
  for (const f of folders) {
    const rails = homes.get(f) ?? [];
    const elsewhere = editedElsewhere(f);
    if (rails.length === 0 && !elsewhere) homeless.push(f);
    if (rails.length > 1 || (rails.length === 1 && elsewhere)) doubled.push(f);
  }
  assert.deepEqual(homeless, [], 'folders with no tab');
  assert.deepEqual(doubled, [], 'folders claimed by more than one place');
});

test('items and furniture rails are sorted by class ancestry, not by folder name', { skip }, () => {
  const { defs, classNodes } = loadPack();
  const items = railFor('items', defs, classNodes).folders;
  const furniture = railFor('furniture', defs, classNodes).folders;
  const systems = railFor('systems', defs, classNodes).folders;
  // Folders nobody hand-listed, placed by what their class descends from.
  assert.ok(items.includes('outfit_definitions'), 'outfits are items');
  assert.ok(furniture.includes('computer_terminal_definitions'), 'computer terminals are furniture');
  assert.ok(systems.includes('sound_definitions'), 'sound slots are neither');
  assert.ok(!systems.includes('loot_definitions'), 'loot has its own editor');
});

test('a folder the editor has never heard of still gets a usable config', () => {
  const cfg = configFor('weather_front_definitions', 'UWeatherFrontDefinition');
  assert.ok(cfg);
  assert.equal(cfg.label, 'Weather Fronts');
  assert.equal(cfg.newLabel, 'Weather Front');
  assert.equal(cfg.newRecordClass, 'WeatherFrontDefinition');
  assert.equal(cfg.idTemplate?.(3), 'WeatherFront_New3');
  assert.equal(labelFor('enemy_spawn_parameter_definitions'), 'Enemy Spawn Parameters');
  assert.equal(labelFor('scp_game_data'), 'SCP Game Data');
});
