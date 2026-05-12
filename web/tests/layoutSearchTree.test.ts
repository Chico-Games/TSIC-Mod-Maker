import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchTree, defsMatchingAllQueries } from '../src/components/layouts/resolver/searchTree';
import type { ProxySearchTreeQuery } from '../src/components/layouts/types';

function mkDef(id: string, klass: string, tags: string[]) {
  return {
    id,
    json: {
      id, asset_path: `/Game/${id}`,
      class: klass, parent_classes: [],
      properties: {
        gameplay_tags: { type: 'gameplay_tag_container', value: tags },
      },
    },
    dirty: false,
  } as any;
}

function mkQuery(mode: string, tags: string[], bNot = false): ProxySearchTreeQuery {
  return {
    type: 'struct', struct_name: 'ProxySearchTreeQuery',
    value: {
      search_query: { type: 'enum', enum_name: 'ESearchQuery', value: mode as any },
      tags: { type: 'gameplay_tag_container', value: tags },
      b_not: { type: 'bool', value: bNot },
    },
  };
}

test('buildSearchTree indexes definitions by tag', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom', 'Entity.Door'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_C', mkDef('FD_C', 'UFurnitureDefinition', ['Entity.Door'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  assert.equal(tree.allDefIds.length, 3);
});

test('defsMatchingAllQueries with HasAnyInclParents picks both bathroom defs', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_C', mkDef('FD_C', 'UFurnitureDefinition', ['Tile.Biome.Carpark'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const q = [mkQuery('HasAnyInclParents', ['Tile.Biome.Bathroom'])];
  const matches = defsMatchingAllQueries(tree, q);
  assert.deepEqual(matches.map((d) => d.id).sort(), ['FD_A', 'FD_B']);
});

test('bNot filters out matching defs', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Carpark'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const q = [mkQuery('HasAnyExact', ['Tile.Biome.Bathroom'], true)];
  const matches = defsMatchingAllQueries(tree, q);
  assert.deepEqual(matches.map((d) => d.id), ['FD_B']);
});

test('two AND queries: both must match', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom', 'Entity.Door'])],
    ['FD_B', mkDef('FD_B', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
    ['FD_C', mkDef('FD_C', 'UFurnitureDefinition', ['Entity.Door'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const q = [
    mkQuery('HasAnyInclParents', ['Tile.Biome.Bathroom']),
    mkQuery('HasAnyInclParents', ['Entity.Door']),
  ];
  const matches = defsMatchingAllQueries(tree, q);
  assert.deepEqual(matches.map((d) => d.id), ['FD_A']);
});

test('empty queries: every def matches', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tile.Biome.Bathroom'])],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const matches = defsMatchingAllQueries(tree, []);
  assert.equal(matches.length, 1);
});

test('different class filter excludes non-matching defs', () => {
  const defs = new Map([
    ['FD_A', mkDef('FD_A', 'UFurnitureDefinition', ['Tag'])],
    ['LYD_X', mkDef('LYD_X', 'ULayoutDefinition', ['Tag'])],
  ]);
  const fTree = buildSearchTree(defs, 'UFurnitureDefinition');
  assert.equal(fTree.allDefIds.length, 1);
  assert.equal(fTree.allDefIds[0], 'FD_A');
});
