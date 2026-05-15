import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModioRef } from '../src/modio/parseRef';

test('parseModioRef: numeric ID', () => {
  assert.deepEqual(parseModioRef('12345'), { kind: 'id', modId: 12345 });
  assert.deepEqual(parseModioRef('  42  '), { kind: 'id', modId: 42 });
  assert.equal(parseModioRef('0'), null);
});

test('parseModioRef: full profile URL', () => {
  assert.deepEqual(
    parseModioRef('https://mod.io/g/the-store-is-closed/m/my-cool-mod'),
    { kind: 'url', gameSlug: 'the-store-is-closed', modSlug: 'my-cool-mod' },
  );
});

test('parseModioRef: URL with trailing slash and query', () => {
  assert.deepEqual(
    parseModioRef('https://mod.io/g/the-store-is-closed/m/my-cool-mod/?utm=x'),
    { kind: 'url', gameSlug: 'the-store-is-closed', modSlug: 'my-cool-mod' },
  );
});

test('parseModioRef: URL without scheme', () => {
  assert.deepEqual(
    parseModioRef('mod.io/g/abc/m/def'),
    { kind: 'url', gameSlug: 'abc', modSlug: 'def' },
  );
});

test('parseModioRef: id redirect URL', () => {
  assert.deepEqual(
    parseModioRef('https://mod.io/search/mods/12345'),
    { kind: 'id', modId: 12345 },
  );
});

test('parseModioRef: short /m/<slug> URL', () => {
  assert.deepEqual(
    parseModioRef('https://mod.io/m/cool-mod'),
    { kind: 'slug', modSlug: 'cool-mod' },
  );
});

test('parseModioRef: bare slug', () => {
  assert.deepEqual(parseModioRef('my-cool-mod'), { kind: 'slug', modSlug: 'my-cool-mod' });
  assert.deepEqual(parseModioRef('MyMod123'), { kind: 'slug', modSlug: 'mymod123' });
});

test('parseModioRef: rejects garbage', () => {
  assert.equal(parseModioRef(''), null);
  assert.equal(parseModioRef('   '), null);
  assert.equal(parseModioRef('this has spaces'), null);
  assert.equal(parseModioRef('not!a*valid_slug'), null);
  assert.equal(parseModioRef('https://example.com/foo'), null);
});
