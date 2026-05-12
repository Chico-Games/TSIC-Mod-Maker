import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryMatches } from '../src/components/layouts/resolver/proxySearchQuery';
import type { ProxySearchTreeQuery } from '../src/components/layouts/types';

function mkQuery(search_query: string, tags: string[], b_not = false): ProxySearchTreeQuery {
  return {
    type: 'struct',
    struct_name: 'ProxySearchTreeQuery',
    value: {
      search_query: { type: 'enum', enum_name: 'ESearchQuery', value: search_query as any },
      tags: { type: 'gameplay_tag_container', value: tags },
      b_not: { type: 'bool', value: b_not },
    },
  };
}

test('HasAnyExact: matches when any query tag is present exactly', () => {
  const q = mkQuery('HasAnyExact', ['Tile.Biome.Bathroom']);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom']), true);
  assert.equal(queryMatches(q, ['Tile.Biome']), false);
  assert.equal(queryMatches(q, ['Other.Tag']), false);
});

test('HasAnyInclParents: matches when target carries a child of a query tag', () => {
  const q = mkQuery('HasAnyInclParents', ['Tile.Biome']);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom']), true);
  assert.equal(queryMatches(q, ['Tile.Biome']), true);
  assert.equal(queryMatches(q, ['Tile']), false);
});

test('HasAllInclParents: every query tag must be present (or via parent inclusion)', () => {
  const q = mkQuery('HasAllInclParents', ['Tile.Biome', 'Layout.Type.Tile']);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom', 'Layout.Type.Tile']), true);
  assert.equal(queryMatches(q, ['Tile.Biome.Bathroom']), false);
});

test('HasAllExact: every query tag must match exactly', () => {
  const q = mkQuery('HasAllExact', ['A.B', 'C.D']);
  assert.equal(queryMatches(q, ['A.B', 'C.D', 'E.F']), true);
  assert.equal(queryMatches(q, ['A.B.X', 'C.D']), false);
});

test('bNot inverts the result', () => {
  const q = mkQuery('HasAnyExact', ['A.B'], true);
  assert.equal(queryMatches(q, ['A.B']), false);
  assert.equal(queryMatches(q, ['Other']), true);
});

test('empty query tags: HasAny* never matches; HasAll* always matches', () => {
  assert.equal(queryMatches(mkQuery('HasAnyExact', []), ['A']), false);
  assert.equal(queryMatches(mkQuery('HasAnyInclParents', []), ['A']), false);
  assert.equal(queryMatches(mkQuery('HasAllExact', []), ['A']), true);
  assert.equal(queryMatches(mkQuery('HasAllInclParents', []), ['A']), true);
});

test('None mode: always matches (parity with Unreal)', () => {
  const q = mkQuery('None', ['anything']);
  assert.equal(queryMatches(q, []), true);
});
