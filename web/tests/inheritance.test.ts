import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  childrenOf,
  describeInheritError,
  getExtendsId,
  isAbstract,
  mergeInheritedValue,
  resolveInherited,
  retargetExtends,
  type InheritRec,
} from '../src/store/inheritance';
import { buildReferencedByIndex, reindexRecord } from '../src/store/referencedByIndex';
import {
  envelopeToLean,
  leanToEnvelope,
  leanPropsToEnvelope,
  envelopePropsToLean,
  type LeanSchema,
} from '../src/persistence/leanEnvelope';
import { buildSearchTree } from '../src/components/layouts/resolver/searchTree';
import { PACK_DIR, PACK_AVAILABLE } from './packDir';

// ── fixtures ────────────────────────────────────────────────────────────────

const f = (value: number) => ({ type: 'float', value });
const s = (value: string | null) => ({ type: 'string', value });
const struct = (value: Record<string, any>, struct_name = 'Box') => ({ type: 'struct', struct_name, value });
const arr = (...value: any[]) => ({ type: 'array', element_type: { type: 'float' }, value });

function rec(id: string, properties: Record<string, any>, cls = 'UFurnitureDefinition'): InheritRec {
  return { id, json: { id, class: cls, properties } };
}

function lookupOf(...recs: InheritRec[]) {
  const m = new Map(recs.map((r) => [r.id, r]));
  return (id: string) => m.get(id);
}

// ── getExtendsId / isAbstract ───────────────────────────────────────────────

test('getExtendsId reads the envelope and the lean shape; empty means none', () => {
  assert.equal(getExtendsId(rec('A', { extends: s('P') })), 'P');
  assert.equal(getExtendsId(rec('A', { extends: 'P' })), 'P');
  assert.equal(getExtendsId(rec('A', { extends: s('') })), null);
  assert.equal(getExtendsId(rec('A', { extends: s(null) })), null);
  assert.equal(getExtendsId(rec('A', {})), null);
  assert.equal(getExtendsId({ id: 'A', json: null }), null);
  assert.equal(getExtendsId(null), null);
});

test('isAbstract reads envelope and lean; only strict true counts', () => {
  assert.equal(isAbstract(rec('A', { abstract: { type: 'bool', value: true } })), true);
  assert.equal(isAbstract(rec('A', { abstract: true })), true);
  assert.equal(isAbstract(rec('A', { abstract: { type: 'bool', value: false } })), false);
  assert.equal(isAbstract(rec('A', {})), false);
});

// ── merge ───────────────────────────────────────────────────────────────────

test('a record that extends nothing resolves to its own properties object', () => {
  const a = rec('A', { hp: f(1) });
  const r = resolveInherited(a, lookupOf());
  assert.equal(r.properties, a.json.properties, 'no copy for the common case');
  assert.deepEqual(r.origin, { hp: 'own' });
  assert.deepEqual(r.ancestorChain, []);
  assert.equal(r.parentId, null);
  assert.equal(r.error, null);
});

test('absent keys inherit, own keys win, provenance is per top-level key', () => {
  const parent = rec('P', { hp: f(100), armour: f(2), name: s('Fridge') });
  const child = rec('C', { extends: s('P'), hp: f(440), extra: f(7) });
  const r = resolveInherited(child, lookupOf(parent));
  assert.equal(r.error, null);
  assert.equal(r.parentId, 'P');
  assert.deepEqual(r.ancestorChain, ['P']);
  assert.equal(r.properties.hp.value, 440);
  assert.equal(r.properties.armour.value, 2);
  assert.equal(r.properties.name.value, 'Fridge');
  assert.equal(r.properties.extra.value, 7);
  assert.deepEqual(r.origin, { armour: 'P', name: 'P', extends: 'own', hp: 'own', extra: 'own' });
  // hp shadows the parent; `extra` is new here and `extends` is a directive.
  assert.deepEqual(r.overrides, { hp: 'P' });
});

test('resolution is recursive and the nearest ancestor wins', () => {
  const root = rec('R', { a: f(1), b: f(1), c: f(1) });
  const mid = rec('M', { extends: s('R'), b: f(2) });
  const leaf = rec('L', { extends: s('M'), c: f(3) });
  const r = resolveInherited(leaf, lookupOf(root, mid));
  assert.deepEqual(r.ancestorChain, ['M', 'R'], 'nearest first');
  assert.deepEqual(
    Object.fromEntries(['a', 'b', 'c'].map((k) => [k, r.properties[k].value])),
    { a: 1, b: 2, c: 3 },
  );
  assert.equal(r.origin.a, 'R');
  assert.equal(r.origin.b, 'M');
  assert.equal(r.origin.c, 'own');
  assert.deepEqual(r.overrides, { c: 'R' });
});

test('structs deep-merge with the child winning; untouched fields survive', () => {
  const parent = rec('P', {
    box: struct({ x: f(1), y: f(2), inner: struct({ p: f(10), q: f(20) }) }),
  });
  const child = rec('C', {
    extends: s('P'),
    box: struct({ y: f(99), inner: struct({ q: f(77) }) }),
  });
  const r = resolveInherited(child, lookupOf(parent));
  const box = r.properties.box.value;
  assert.equal(box.x.value, 1);
  assert.equal(box.y.value, 99);
  assert.equal(box.inner.value.p.value, 10);
  assert.equal(box.inner.value.q.value, 77);
  assert.equal(r.origin.box, 'own');
  assert.equal(r.overrides.box, 'P');
  // Inputs are never mutated.
  assert.equal(parent.json.properties.box.value.y.value, 2);
  assert.deepEqual(Object.keys(child.json.properties.box.value), ['y', 'inner']);
});

test('arrays, sets and maps replace wholesale — no element merging', () => {
  const parent = rec('P', {
    list: arr(f(1), f(2), f(3)),
    map: { type: 'map', key_type: null, value_type: null, value: [{ key: s('a'), value: f(1) }] },
    tags: { type: 'gameplay_tag_container', value: ['A.B', 'A.C'] },
  });
  const child = rec('C', {
    extends: s('P'),
    list: arr(f(9)),
    map: { type: 'map', key_type: null, value_type: null, value: [] },
    tags: { type: 'gameplay_tag_container', value: ['Z'] },
  });
  const r = resolveInherited(child, lookupOf(parent));
  assert.deepEqual(r.properties.list.value.map((e: any) => e.value), [9]);
  assert.deepEqual(r.properties.map.value, []);
  assert.deepEqual(r.properties.tags.value, ['Z']);
});

test('explicit null clears instead of inheriting — for scalars and structs', () => {
  const parent = rec('P', {
    recipe: { type: 'definition_ref', class: 'Recipe', value: 'R_1' },
    box: struct({ x: f(1) }),
    list: arr(f(1)),
  });
  const child = rec('C', {
    extends: s('P'),
    recipe: { type: 'definition_ref', class: 'Recipe', value: null },
    box: { type: 'struct', struct_name: 'Box', value: null },
    list: { type: 'array', element_type: null, value: null },
  });
  const r = resolveInherited(child, lookupOf(parent));
  assert.equal(r.properties.recipe.value, null);
  assert.equal(r.properties.box.value, null, 'a null struct is a clear, not a merge');
  assert.equal(r.properties.list.value, null);
  assert.deepEqual(r.overrides, { recipe: 'P', box: 'P', list: 'P' });
});

test('directives are never inherited: a child of an abstract parent is concrete', () => {
  const root = rec('R', { hp: f(1) });
  const base = rec('B', { extends: s('R'), abstract: { type: 'bool', value: true }, armour: f(2) });
  const child = rec('C', { extends: s('B') });
  const r = resolveInherited(child, lookupOf(root, base));
  assert.equal('abstract' in r.properties, false);
  assert.equal(r.properties.extends.value, 'B', "the record keeps its OWN extends, not the ancestor's");
  assert.equal(r.origin.extends, 'own');
  assert.equal(isAbstract({ id: 'C', json: { properties: r.properties } }), false);
  assert.equal(r.properties.hp.value, 1);
  assert.equal(r.properties.armour.value, 2);
});

test('mergeInheritedValue: undefined child inherits, anything else replaces non-structs', () => {
  assert.deepEqual(mergeInheritedValue(f(1), undefined), f(1));
  assert.deepEqual(mergeInheritedValue(f(1), f(2)), f(2));
  assert.deepEqual(mergeInheritedValue(struct({ a: f(1) }), f(2)), f(2), 'type change → child wins');
  assert.deepEqual(mergeInheritedValue(undefined, struct({ a: f(1) })), struct({ a: f(1) }));
});

// ── errors ──────────────────────────────────────────────────────────────────

test('unknown parent is reported and the record resolves to its own values', () => {
  const child = rec('C', { extends: s('Nope'), hp: f(1) });
  const r = resolveInherited(child, lookupOf());
  assert.deepEqual(r.error, { kind: 'unknown-parent', atId: 'C', parentId: 'Nope' });
  assert.deepEqual(r.ancestorChain, []);
  assert.equal(r.properties.hp.value, 1);
  assert.match(describeInheritError('C', r.error!), /extends "Nope", which does not exist$/);
});

test('an unknown GRANDparent is reported against the ancestor that holds the bad link', () => {
  const mid = rec('M', { extends: s('Gone'), a: f(1) });
  const leaf = rec('L', { extends: s('M') });
  const r = resolveInherited(leaf, lookupOf(mid));
  assert.deepEqual(r.error, { kind: 'unknown-parent', atId: 'M', parentId: 'Gone' });
  assert.deepEqual(r.ancestorChain, ['M'], 'what did resolve is still merged');
  assert.equal(r.properties.a.value, 1);
  assert.match(describeInheritError('L', r.error!), /via ancestor M/);
});

test('cycles terminate and are reported — self, two-step and longer', () => {
  const self = rec('A', { extends: s('A') });
  assert.deepEqual(resolveInherited(self, lookupOf(self)).error, { kind: 'cycle', atId: 'A', parentId: 'A' });

  const a = rec('A', { extends: s('B'), x: f(1) });
  const b = rec('B', { extends: s('A'), y: f(2) });
  const r = resolveInherited(a, lookupOf(a, b));
  assert.deepEqual(r.error, { kind: 'cycle', atId: 'B', parentId: 'A' });
  assert.deepEqual(r.ancestorChain, ['B']);

  // A record that merely leads INTO a cycle is broken too.
  const c = rec('C', { extends: s('A') });
  assert.equal(resolveInherited(c, lookupOf(a, b)).error?.kind, 'cycle');
});

test('class mismatch is an exact class-string comparison and stops the merge', () => {
  const parent = rec('P', { hp: f(100) }, 'UStorageDefinition');
  const child = rec('C', { extends: s('P'), armour: f(1) }, 'UFurnitureDefinition');
  const r = resolveInherited(child, lookupOf(parent));
  assert.deepEqual(r.error, {
    kind: 'class-mismatch', atId: 'C', parentId: 'P',
    childClass: 'UFurnitureDefinition', parentClass: 'UStorageDefinition',
  });
  assert.equal('hp' in r.properties, false, 'nothing is merged across a class mismatch');
  assert.deepEqual(r.ancestorChain, []);
});

// ── graph helpers ───────────────────────────────────────────────────────────

test('childrenOf lists direct children only', () => {
  const recs = [
    rec('P', {}),
    rec('C1', { extends: s('P') }),
    rec('C2', { extends: 'P' }),
    rec('G', { extends: s('C1') }),
    rec('X', { extends: s('Other') }),
  ];
  assert.deepEqual(childrenOf('P', recs), ['C1', 'C2']);
  assert.deepEqual(childrenOf('C1', recs), ['G']);
  assert.deepEqual(childrenOf('G', recs), []);
  assert.deepEqual(childrenOf('', recs), []);
});

test('retargetExtends rewrites only a matching parent and keeps the authored shape', () => {
  const env = { id: 'C', properties: { extends: s('Old'), hp: f(1) } };
  const out = retargetExtends(env, 'Old', 'New');
  assert.notEqual(out, env);
  assert.deepEqual(out.properties.extends, s('New'));
  assert.equal(out.properties.hp, env.properties.hp, 'untouched branches are shared');
  assert.equal(env.properties.extends.value, 'Old', 'input not mutated');

  const lean = { id: 'C', properties: { extends: 'Old' } };
  assert.equal(retargetExtends(lean, 'Old', 'New').properties.extends, 'New');

  const other = { id: 'C', properties: { extends: s('Else') } };
  assert.equal(retargetExtends(other, 'Old', 'New'), other, 'same object when nothing changed');
  const none = { id: 'C', properties: {} };
  assert.equal(retargetExtends(none, 'Old', 'New'), none);
});

// ── referenced-by index ─────────────────────────────────────────────────────

test('the referenced-by index treats `extends` as a reference', () => {
  const defs = new Map<string, any>([
    ['furn/P', { folder: 'furn', id: 'P', json: { properties: { hp: f(1) } } }],
    ['furn/C', {
      folder: 'furn', id: 'C',
      json: { properties: { extends: s('P'), loot: { type: 'definition_ref', class: 'Loot', value: 'L' } } },
    }],
  ]);
  const idx = buildReferencedByIndex(defs);
  assert.deepEqual(idx.get('P'), [{ ownerKey: 'furn/C', path: ['properties', 'extends'], ownerFolder: 'furn' }]);
  assert.equal(idx.get('L')?.length, 1);
  // A plain string property that merely CONTAINS an id is not a reference.
  assert.equal(idx.has('C'), false);

  // Re-parenting moves the entry.
  reindexRecord(idx, 'furn/C', 'furn', { extends: s('Q') });
  assert.equal(idx.has('P'), false);
  assert.deepEqual(idx.get('Q')?.[0].path, ['properties', 'extends']);
  assert.equal(idx.has('L'), false);
});

// ── layout search tree ──────────────────────────────────────────────────────

test('the layout search tree matches a child on inherited tags and skips abstract defs', () => {
  const tags = (...value: string[]) => ({ type: 'gameplay_tag_container', value });
  const defs = new Map<string, InheritRec>([
    ['P', rec('P', { gameplay_tags: tags('Furniture.Fridge') })],
    ['C', rec('C', { extends: s('P') })],
    ['D', rec('D', { extends: s('P'), gameplay_tags: tags('Furniture.Other') })],
    ['Abs', rec('Abs', { abstract: { type: 'bool', value: true }, gameplay_tags: tags('Furniture.Fridge') })],
  ]);
  const tree = buildSearchTree(defs, 'UFurnitureDefinition');
  const byId = new Map(tree.allDefs.map((d) => [d.id, d.tags]));
  assert.deepEqual(byId.get('C'), ['Furniture.Fridge'], 'child inherits the parent tags');
  assert.deepEqual(byId.get('D'), ['Furniture.Other'], 'child tags replace, not append');
  assert.equal(byId.has('Abs'), false, 'abstract definitions are never registered');
});

// ── explicit null round-trip (persistence) ──────────────────────────────────

const schema: LeanSchema = {
  classes: {
    UThing: {
      parents: [],
      properties: {
        hp: { kind: 'float' },
        box: { kind: 'struct', name: 'Box' },
        list: { kind: 'array', element: { kind: 'float' } },
        bag: { kind: 'set', element: { kind: 'name' } },
        rates: { kind: 'map', key: { kind: 'name' }, value: { kind: 'int' } },
        recipe: { kind: 'definition_ref', class: 'URecipe' },
      },
    },
  },
  structs: { Box: { fields: { x: { kind: 'float' }, inner: { kind: 'struct', name: 'Box' } } } },
  enums: {},
};

test('an explicit null round-trips for every kind, containers included', () => {
  const lean = { extends: 'P', hp: null, box: null, list: null, bag: null, rates: null, recipe: null };
  const env = leanPropsToEnvelope(lean, 'UThing', schema);
  // The envelope keeps its type so the grid can still draw the row…
  assert.equal(env.box.type, 'struct');
  assert.equal(env.list.type, 'array');
  assert.equal(env.rates.type, 'map');
  assert.equal(env.box.value, null);
  // …and the null comes back out as null, NOT as {} / [].
  assert.deepEqual(envelopePropsToLean(env, schema), lean);
  assert.equal(JSON.stringify(envelopePropsToLean(env, schema)), JSON.stringify(lean), 'key order too');
});

test('a null nested inside a struct or array round-trips', () => {
  const kind = { kind: 'struct', name: 'Box' } as const;
  const lean = { x: 1, inner: null };
  assert.deepEqual(envelopeToLean(leanToEnvelope(lean, kind, schema), schema), lean);
  const listKind = { kind: 'array', element: { kind: 'struct', name: 'Box' } } as const;
  const leanList = [{ x: 1 }, null];
  assert.deepEqual(envelopeToLean(leanToEnvelope(leanList, listKind, schema), schema), leanList);
});

test('empty containers are still written as empty, not null', () => {
  assert.deepEqual(envelopeToLean({ type: 'array', element_type: null, value: [] }, schema), []);
  assert.deepEqual(envelopeToLean({ type: 'map', key_type: null, value_type: null, value: [] }, schema), []);
  assert.deepEqual(envelopeToLean({ type: 'struct', struct_name: 'Box', value: {} }, schema), {});
  // A skeleton-shaped envelope with NO value key keeps its old defensive output.
  assert.deepEqual(envelopeToLean({ type: 'array', element_type: null }, schema), []);
  assert.deepEqual(envelopeToLean({ type: 'struct', struct_name: 'Box' }, schema), {});
});

// ── the real pack ───────────────────────────────────────────────────────────

/** Load every record of the real pack as envelopes, exactly as the editor does. */
function loadPack(): Map<string, InheritRec & { folder: string }> {
  const packSchema = JSON.parse(readFileSync(join(PACK_DIR, '_schema.json'), 'utf8')) as LeanSchema;
  const out = new Map<string, InheritRec & { folder: string }>();
  for (const folder of readdirSync(PACK_DIR, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name.startsWith('.')) continue;
    for (const file of readdirSync(join(PACK_DIR, folder.name))) {
      if (!file.endsWith('.json')) continue;
      let json: any;
      try { json = JSON.parse(readFileSync(join(PACK_DIR, folder.name, file), 'utf8')); } catch { continue; }
      if (!json || typeof json !== 'object' || typeof json.class !== 'string' || !json.properties) continue;
      json.properties = leanPropsToEnvelope(json.properties, json.class, packSchema);
      out.set(json.id, { id: json.id, folder: folder.name, json });
    }
  }
  return out;
}

test('real pack: every `extends` resolves cleanly and children gain their parent values', { skip: !PACK_AVAILABLE }, () => {
  const pack = loadPack();
  const children = [...pack.values()].filter((r) => getExtendsId(r));
  if (children.length === 0) return; // a pre-inheritance pack: nothing to assert
  const lookup = (id: string) => pack.get(id);
  for (const c of children) {
    // `extends` has no schema kind, so it must arrive as a plain string envelope.
    assert.deepEqual(c.json.properties.extends, { type: 'string', value: getExtendsId(c) }, c.id);
    const r = resolveInherited(c, lookup);
    assert.equal(r.error, null, `${c.id}: ${r.error && describeInheritError(c.id, r.error)}`);
    assert.ok(r.ancestorChain.length >= 1, c.id);
    // Every own key is still own; every other key is attributed to an ancestor in the chain.
    for (const [k, from] of Object.entries(r.origin)) {
      if (k in c.json.properties) assert.equal(from, 'own', `${c.id}.${k}`);
      else assert.ok(r.ancestorChain.includes(from), `${c.id}.${k} ← ${from}`);
    }
  }
  const aircon = pack.get('FD_Aircon_Tier2_DF');
  if (aircon) {
    const own = Object.keys(aircon.json.properties).length;
    const r = resolveInherited(aircon, lookup);
    assert.deepEqual(r.ancestorChain, ['FD_Aircon_DF']);
    assert.ok(Object.keys(r.properties).length > own * 2, 'the child gains most of its rows from the parent');
    assert.equal(r.properties.starting_health.value, 440, 'own value wins');
    assert.equal(typeof r.properties.display_name?.value, 'string', 'display_name is inherited');
    assert.equal(r.origin.display_name, 'FD_Aircon_DF');
    assert.equal(r.properties.upgrade_recipe.value, null, 'explicit null stays a clear');
    assert.equal(r.origin.upgrade_recipe, 'own');
  }
});

test('real pack: a child round-trips byte-identically (nothing inherited leaks to disk)', { skip: !PACK_AVAILABLE }, () => {
  const path = join(PACK_DIR, 'damageable_furniture_definitions', 'FD_Aircon_Tier2_DF.json');
  if (!existsSync(path)) return;
  const packSchema = JSON.parse(readFileSync(join(PACK_DIR, '_schema.json'), 'utf8')) as LeanSchema;
  const lean = JSON.parse(readFileSync(path, 'utf8'));
  const env = leanPropsToEnvelope(lean.properties, lean.class, packSchema);
  assert.equal(JSON.stringify(envelopePropsToLean(env, packSchema)), JSON.stringify(lean.properties));
});
