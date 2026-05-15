import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from '../src/components/layouts/resolver/resolver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..', 'public', 'starter-project');

function loadJson(p: string): any {
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function loadAllDefinitions(): Map<string, { id: string; json: any }> {
  const out = new Map<string, { id: string; json: any }>();
  for (const folder of readdirSync(PROJECT, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    if (!folder.name.endsWith('_definitions') && folder.name !== 'furniture_upgrade_recipe' && folder.name !== 'layout_definitions') continue;
    const folderPath = join(PROJECT, folder.name);
    for (const file of readdirSync(folderPath)) {
      if (!file.endsWith('.json')) continue;
      try {
        const json = loadJson(join(folderPath, file));
        if (typeof json?.id === 'string') out.set(json.id, { id: json.id, json });
      } catch {
        // ignore — covered by structural tests
      }
    }
  }
  return out;
}

// Mocks the catalog lookup — for these tests we only care about resolver shape,
// not mesh bounds.
const noopCatalog = () => null;

test('transform envelope uses scale3_d (snake_case of Scale3D with digit-boundary)', () => {
  const layout = loadJson(join(PROJECT, 'layout_definitions', 'LYD_Bathroom_All.json'));
  const objects = layout.properties.layout_objects.value as any[];
  assert.ok(objects.length > 0, 'bathroom layout has objects');
  for (const lo of objects) {
    const t = lo.value.transform.value;
    assert.ok('scale3_d' in t, `transform missing scale3_d (got: ${Object.keys(t).join(',')})`);
    assert.ok(!('scale_3d' in t), 'transform should not have scale_3d (old shape)');
  }
});

test('transform rotation is exported as Quat (x/y/z/w), not Rotator', () => {
  const layout = loadJson(join(PROJECT, 'layout_definitions', 'LYD_Bathroom_All.json'));
  const objects = layout.properties.layout_objects.value as any[];
  for (const lo of objects) {
    const rot = lo.value.transform.value.rotation;
    assert.equal(rot.struct_name, 'Quat', `rotation should be Quat, got: ${rot.struct_name}`);
    assert.ok('w' in rot.value, `Quat rotation missing w component (got: ${Object.keys(rot.value).join(',')})`);
    assert.ok(!('pitch' in rot.value), 'Quat rotation should not have pitch (that is Rotator shape)');
  }
});

test('furniture records carry parent_classes including UFurnitureDefinition', () => {
  const chair = loadJson(join(PROJECT, 'damageable_furniture_definitions', 'FD_Chair_DF.json'));
  assert.equal(chair.class, 'UDamageableFurnitureDefinition');
  assert.ok(Array.isArray(chair.parent_classes), 'chair has parent_classes');
  assert.ok(
    chair.parent_classes.includes('UFurnitureDefinition'),
    `chair.parent_classes should include UFurnitureDefinition (got: ${chair.parent_classes.join(',')})`,
  );
});

test('resolver finds matches for a tag-based search against real furniture catalog', () => {
  const defs = loadAllDefinitions();
  // Build a layout_object that searches for furniture with the Furniture.Chair tag.
  // (Most chair furniture defs carry this tag — found in the real data.)
  const lo: any = {
    type: 'struct', struct_name: 'LayoutObject',
    value: {
      layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: 'PROXY_ACTOR' },
      b_visual_helper: { type: 'bool', value: false },
      definition_filter: {
        type: 'struct', struct_name: 'DefinitionFilter',
        value: {
          seed_offset: { type: 'int', value: -1 },
          search_queries: {
            type: 'array', value: [{
              type: 'struct', struct_name: 'ProxySearchTreeQuery',
              value: {
                search_query: { type: 'enum', enum_name: 'ESearchQuery', value: 'HasAnyInclParents' },
                tags: { type: 'gameplay_tag_container', value: ['Entity.RandomGeneration.CanBeRandom'] },
                b_not: { type: 'bool', value: false },
              },
            }],
          },
          tile_requirements: { type: 'array', value: [] },
          spawn_chance_over: { type: 'float', value: 0 },
          spawn_chance_under: { type: 'float', value: 1 },
        },
      },
      transform: {
        type: 'struct', struct_name: 'Transform',
        value: {
          translation: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 0 }, y: { type: 'float', value: 0 }, z: { type: 'float', value: 0 } } },
          rotation: { type: 'struct', struct_name: 'Quat', value: { x: { type: 'float', value: 0 }, y: { type: 'float', value: 0 }, z: { type: 'float', value: 0 }, w: { type: 'float', value: 1 } } },
          scale3_d: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 1 }, y: { type: 'float', value: 1 }, z: { type: 'float', value: 1 } } },
        },
      },
    },
  };
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs,
    catalogLookup: noopCatalog,
  });
  // With the parent_classes fix, the search tree should now include
  // subclasses of UFurnitureDefinition. The Furniture tag is broad enough
  // that some result must match — either ok or missing-mesh (still resolved
  // a def, just no static_mesh in the noopCatalog).
  assert.notEqual(r.status.kind, 'no-matches', `resolver returned no-matches: ${JSON.stringify(r.status)}`);
});

test('every real LYD has Quat rotations (no Rotator leakage)', () => {
  const layoutDir = join(PROJECT, 'layout_definitions');
  let count = 0;
  let mismatches = 0;
  for (const file of readdirSync(layoutDir)) {
    if (!file.endsWith('.json')) continue;
    const layout = loadJson(join(layoutDir, file));
    const objects = (layout.properties?.layout_objects?.value as any[] | undefined) ?? [];
    for (const lo of objects) {
      const rot = lo?.value?.transform?.value?.rotation;
      if (!rot) continue;
      count++;
      if (rot.struct_name !== 'Quat') mismatches++;
    }
  }
  assert.ok(count > 0, 'walked at least one LayoutObject');
  assert.equal(mismatches, 0, `${mismatches}/${count} LayoutObjects have non-Quat rotations`);
});

test('layout typed-shape: scale3_d on every LayoutObject across all real LYD files', () => {
  const layoutDir = join(PROJECT, 'layout_definitions');
  let count = 0;
  let mismatches = 0;
  const badFiles = new Set<string>();
  for (const file of readdirSync(layoutDir)) {
    if (!file.endsWith('.json')) continue;
    const layout = loadJson(join(layoutDir, file));
    const objects = (layout.properties?.layout_objects?.value as any[] | undefined) ?? [];
    for (const lo of objects) {
      const t = lo?.value?.transform?.value;
      if (!t) continue;
      count++;
      if (!('scale3_d' in t)) {
        mismatches++;
        badFiles.add(file);
      }
    }
  }
  assert.ok(count > 0);
  assert.equal(mismatches, 0, `${mismatches} LayoutObjects missing scale3_d (in: ${[...badFiles].slice(0, 5).join(', ')})`);
});
