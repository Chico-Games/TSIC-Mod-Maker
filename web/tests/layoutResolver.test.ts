import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/components/layouts/resolver/resolver';
import type { LayoutObject } from '../src/components/layouts/types';

function mkDef(id: string, klass: string, tags: string[], extra: any = {}) {
  return {
    id, json: {
      id, asset_path: `/Game/${id}`, class: klass, parent_classes: [],
      properties: {
        gameplay_tags: { type: 'gameplay_tag_container', value: tags },
        ...extra,
      },
    }, dirty: false,
  } as any;
}

function mkLayoutObject(over: Partial<LayoutObject['value']> = {}): LayoutObject {
  return {
    type: 'struct', struct_name: 'LayoutObject',
    value: {
      layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: 'PROXY_ACTOR' },
      b_visual_helper: { type: 'bool', value: false },
      definition_filter: {
        type: 'struct', struct_name: 'DefinitionFilter',
        value: {
          seed_offset: { type: 'int', value: -1 },
          search_queries: { type: 'array', value: [] as any },
          tile_requirements: { type: 'array', value: [] as any },
          spawn_chance_over: { type: 'float', value: 0 },
          spawn_chance_under: { type: 'float', value: 1 },
        },
      },
      transform: {
        type: 'struct', struct_name: 'Transform',
        value: {
          translation: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 0 }, y: { type: 'float', value: 0 }, z: { type: 'float', value: 0 } } },
          rotation: { type: 'struct', struct_name: 'Rotator', value: { pitch: { type: 'float', value: 0 }, yaw: { type: 'float', value: 0 }, roll: { type: 'float', value: 0 } } },
          scale_3d: { type: 'struct', struct_name: 'Vector', value: { x: { type: 'float', value: 1 }, y: { type: 'float', value: 1 }, z: { type: 'float', value: 1 } } },
        },
      },
      ...over,
    },
  };
}

test('not-configured: no ref and no queries', () => {
  const lo = mkLayoutObject();
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: ['Tile.Biome.X'], seed: 0,
    definitions: new Map(),
    catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'not-configured');
});

test('filtered-by-tile-requirements: tile reqs do not match', () => {
  const lo = mkLayoutObject({
    definition_filter: {
      type: 'struct', struct_name: 'DefinitionFilter',
      value: {
        seed_offset: { type: 'int', value: -1 },
        search_queries: { type: 'array', value: [{
          type: 'struct', struct_name: 'ProxySearchTreeQuery',
          value: {
            search_query: { type: 'enum', enum_name: 'ESearchQuery', value: 'HasAnyExact' },
            tags: { type: 'gameplay_tag_container', value: ['Entity.Door'] },
            b_not: { type: 'bool', value: false },
          },
        }] as any },
        tile_requirements: { type: 'array', value: [{
          type: 'struct', struct_name: 'ProxySearchTreeQuery',
          value: {
            search_query: { type: 'enum', enum_name: 'ESearchQuery', value: 'HasAnyExact' },
            tags: { type: 'gameplay_tag_container', value: ['Tile.Biome.Required'] },
            b_not: { type: 'bool', value: false },
          },
        }] as any },
        spawn_chance_over: { type: 'float', value: 0 },
        spawn_chance_under: { type: 'float', value: 1 },
      },
    },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Entity.Door'])]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: ['Tile.Biome.Other'], seed: 0,
    definitions: defs, catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'filtered-by-tile-requirements');
});

test('spawn-chance-skipped: roll outside range', () => {
  const lo = mkLayoutObject({
    furniture_definition: { type: 'definition_ref', class: 'FurnitureDefinition', value: 'FD_A' },
    definition_filter: {
      type: 'struct', struct_name: 'DefinitionFilter',
      value: {
        seed_offset: { type: 'int', value: -1 },
        search_queries: { type: 'array', value: [] as any },
        tile_requirements: { type: 'array', value: [] as any },
        spawn_chance_over: { type: 'float', value: 0.9 },
        spawn_chance_under: { type: 'float', value: 1.0 },
      },
    },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', [], { static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/M.M' } })]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 1,
    definitions: defs,
    catalogLookup: () => ({ path: '/Game/M.M', name: 'M', folder: '/Game', package_guid: '', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }),
  });
  assert.equal(r.status.kind, 'spawn-chance-skipped');
});

test('no-matches: search queries find zero defs', () => {
  const lo = mkLayoutObject({
    definition_filter: {
      type: 'struct', struct_name: 'DefinitionFilter',
      value: {
        seed_offset: { type: 'int', value: -1 },
        search_queries: { type: 'array', value: [{
          type: 'struct', struct_name: 'ProxySearchTreeQuery',
          value: {
            search_query: { type: 'enum', enum_name: 'ESearchQuery', value: 'HasAnyExact' },
            tags: { type: 'gameplay_tag_container', value: ['Nonexistent'] },
            b_not: { type: 'bool', value: false },
          },
        }] as any },
        tile_requirements: { type: 'array', value: [] as any },
        spawn_chance_over: { type: 'float', value: 0 },
        spawn_chance_under: { type: 'float', value: 1 },
      },
    },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Other'])]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs, catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'no-matches');
});

test('ok: direct furniture ref with mesh', () => {
  const lo = mkLayoutObject({
    furniture_definition: { type: 'definition_ref', class: 'FurnitureDefinition', value: 'FD_A' },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', [], { static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/M.M' } })]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs,
    catalogLookup: (cls, path) => cls === 'StaticMesh' && path === '/Game/M.M'
      ? { path, name: 'M', folder: '/Game', package_guid: '', bounds: { min: [0, 0, 0], max: [1, 1, 1] } } : null,
  });
  assert.equal(r.status.kind, 'ok');
  if (r.status.kind === 'ok') {
    assert.equal(r.status.chosenDefinitionId, 'FD_A');
    assert.equal(r.status.meshPath, '/Game/M.M');
    assert.deepEqual(r.status.bounds, { min: [0, 0, 0], max: [1, 1, 1] });
  }
});

test('missing-mesh: chosen def has no static_mesh ref', () => {
  const lo = mkLayoutObject({
    furniture_definition: { type: 'definition_ref', class: 'FurnitureDefinition', value: 'FD_A' },
  });
  const defs = new Map([['FD_A', mkDef('FD_A', 'UFurnitureDefinition', [])]]);
  const r = resolve({
    layoutObject: lo, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs, catalogLookup: () => null,
  });
  assert.equal(r.status.kind, 'missing-mesh');
});

test('cycle: nested layout refs itself', () => {
  const innerLO = mkLayoutObject({
    layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: 'LAYOUT' },
    layout_definition: { type: 'definition_ref', class: 'LayoutDefinition', value: 'LYD_X' },
  });
  const layoutJson = {
    id: 'LYD_X', asset_path: '/Game/LYD_X', class: 'ULayoutDefinition', parent_classes: [],
    properties: {
      gameplay_tags: { type: 'gameplay_tag_container', value: [] },
      layout_objects: { type: 'array', value: [innerLO] },
    },
  };
  const defs = new Map([['LYD_X', { id: 'LYD_X', json: layoutJson, dirty: false } as any]]);

  const outerLO = mkLayoutObject({
    layout_actor_type: { type: 'enum', enum_name: 'ELayoutActorType', value: 'LAYOUT' },
    layout_definition: { type: 'definition_ref', class: 'LayoutDefinition', value: 'LYD_X' },
  });
  const r = resolve({
    layoutObject: outerLO, ownerLayoutKey: 'L', ownerIndex: 0,
    tileTags: [], seed: 0,
    definitions: defs, catalogLookup: () => null,
    visitedLayouts: new Set(['LYD_X']),
  });
  assert.equal(r.status.kind, 'cycle');
});
