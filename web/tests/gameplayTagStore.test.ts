import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTagTree, isTagOrChild } from '../src/store/gameplayTagStore';

test('buildTagTree groups by dot', () => {
  const tree = buildTagTree(['A.B', 'A.C.D', 'A.C.E', 'X']);
  assert.deepEqual(Object.keys(tree).sort(), ['A', 'X']);
  assert.deepEqual(Object.keys(tree.A.children).sort(), ['B', 'C']);
  assert.deepEqual(Object.keys(tree.A.children.C.children).sort(), ['D', 'E']);
});

test('buildTagTree empty input', () => {
  assert.deepEqual(buildTagTree([]), {});
});

test('isTagOrChild: exact match', () => {
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Tile.Biome.Bathroom'), true);
});

test('isTagOrChild: child of parent', () => {
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Tile.Biome'), true);
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Tile'), true);
});

test('isTagOrChild: unrelated', () => {
  assert.equal(isTagOrChild('Tile.Biome.Bathroom', 'Entity'), false);
});

test('isTagOrChild: prefix-only-not-tag-child', () => {
  // "Tile.B" is a string prefix of "Tile.Biome" but not its tag parent.
  assert.equal(isTagOrChild('Tile.Biome', 'Tile.B'), false);
});
