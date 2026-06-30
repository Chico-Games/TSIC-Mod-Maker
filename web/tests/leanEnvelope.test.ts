import test from 'node:test';
import assert from 'node:assert/strict';
import {
  leanToEnvelope,
  envelopeToLean,
  leanPropsToEnvelope,
  envelopePropsToLean,
  isLeanProperties,
  kindToSkeleton,
  type LeanSchema,
} from '../src/persistence/leanEnvelope';

const schema: LeanSchema = {
  classes: {
    UItemDefinition: {
      parents: ['UDataAsset', 'UObject'],
      properties: {
        display_name: { kind: 'text' },
        weight: { kind: 'float' },
        stackable: { kind: 'bool' },
        tags: { kind: 'gameplay_tag_container' },
        size: { kind: 'enum', name: 'EItemSize' },
        recipe: { kind: 'definition_ref', class: 'const URecipeDefinition' },
        mesh: { kind: 'soft_object', class: 'StaticMesh' },
        tiers: { kind: 'array', element: { kind: 'struct', name: 'Tier' } },
        rates: { kind: 'map', key: { kind: 'enum', name: 'EItemSize' }, value: { kind: 'int' } },
      },
    },
  },
  structs: {
    Tier: { fields: { level: { kind: 'int' }, label: { kind: 'name' } } },
  },
  // Mirrors the exporter's real (buggy) output: an empty E-prefixed entry next
  // to the populated bare one. The converter must still resolve members.
  enums: {
    EItemSize: { members: [] },
    ItemSize: { members: [{ name: 'SMALL', value: 0 }, { name: 'LARGE', value: 2 }] },
  },
};

test('scalar round-trips', () => {
  for (const [kind, v] of [
    [{ kind: 'bool' }, true], [{ kind: 'int' }, 7], [{ kind: 'float' }, 1.5],
    [{ kind: 'text' }, 'Hi'], [{ kind: 'name' }, 'N'], [{ kind: 'gameplay_tag' }, 'A.B'],
  ] as const) {
    const env = leanToEnvelope(v, kind as any, schema);
    assert.equal(env.type, kind.kind);
    assert.deepEqual(envelopeToLean(env, schema), v);
  }
});

test('enum recovers int despite empty E-prefixed schema entry', () => {
  const lean = { name: 'LARGE', value: 2 };
  const env = leanToEnvelope(lean, { kind: 'enum', name: 'EItemSize' }, schema);
  assert.equal(env.type, 'enum');
  assert.equal(env.value, 'LARGE');
  assert.deepEqual(envelopeToLean(env, schema), lean);
});

test('nested array of structs round-trips', () => {
  const lean = [{ level: 1, label: 'a' }, { level: 2, label: 'b' }];
  const env = leanToEnvelope(lean, schema.classes.UItemDefinition.properties.tiers, schema);
  assert.equal(env.type, 'array');
  assert.equal(env.value[0].type, 'struct');
  assert.deepEqual(envelopeToLean(env, schema), lean);
});

test('map with enum keys round-trips', () => {
  const lean = [{ key: { name: 'SMALL', value: 0 }, value: 5 }];
  const env = leanToEnvelope(lean, schema.classes.UItemDefinition.properties.rates, schema);
  assert.equal(env.type, 'map');
  assert.deepEqual(envelopeToLean(env, schema), lean);
});

test('struct skeleton carries its schema fields (drives "+ Add" on struct arrays)', () => {
  // The element_type skeleton on an array-of-structs must expand the struct's
  // fields, or appending a new element seeds an empty `{type:'struct'}` that
  // renders as "(empty struct) · 0 fields".
  const env = leanToEnvelope([], schema.classes.UItemDefinition.properties.tiers, schema);
  const el = env.element_type;
  assert.equal(el.type, 'struct');
  assert.equal(el.struct_name, 'Tier');
  assert.deepEqual(Object.keys(el.fields ?? {}).sort(), ['label', 'level']);
  assert.equal(el.fields.level.type, 'int');
  assert.equal(el.fields.label.type, 'name');
});

test('kindToSkeleton tolerates self-referential structs', () => {
  // A struct that contains itself must not recurse forever; the cycle slot
  // keeps a bare struct skeleton (no `fields`).
  const recursive: LeanSchema = {
    classes: {},
    enums: {},
    structs: {
      Node: { fields: { value: { kind: 'int' }, child: { kind: 'struct', name: 'Node' } } },
    },
  };
  const skel = kindToSkeleton({ kind: 'struct', name: 'Node' }, recursive);
  assert.equal(skel.fields.value.type, 'int');
  assert.equal(skel.fields.child.type, 'struct');
  assert.equal(skel.fields.child.fields, undefined); // cycle stopped here
});

test('null nested slot is preserved', () => {
  const lean = [1, null, 3];
  const env = leanToEnvelope(lean, { kind: 'array', element: { kind: 'int' } }, schema);
  assert.deepEqual(envelopeToLean(env, schema), lean);
});

test('isLeanProperties distinguishes envelopes from lean values', () => {
  // Envelope props → not lean.
  assert.equal(isLeanProperties({ weight: { type: 'float', value: 2.5 } }), false);
  // Plain lean scalars / arrays → lean.
  assert.equal(isLeanProperties({ weight: 2.5, tags: ['A.B'] }), true);
  // A lean struct that HAPPENS to have a string field named `type` must not
  // be mistaken for an envelope ("Wood" is not an envelope type tag).
  assert.equal(isLeanProperties({ material: { type: 'Wood', count: 3 } }), true);
  // Empty / absent props.
  assert.equal(isLeanProperties({}), true);
  assert.equal(isLeanProperties(null), false);
});

test('whole-record round-trip is lossless', () => {
  const props = {
    display_name: 'Sword', weight: 2.5, stackable: false,
    tags: ['Weapon', 'Sharp'],
    size: { name: 'LARGE', value: 2 },
    recipe: 'RD_Sword',
    mesh: '/Game/Meshes/SM_Sword.SM_Sword',
    tiers: [{ level: 1, label: 'base' }],
    rates: [{ key: { name: 'SMALL', value: 0 }, value: 3 }],
    // unknown property (no schema kind) — inferred + preserved
    legacy_flag: true,
  };
  const env = leanPropsToEnvelope(props, 'UItemDefinition', schema);
  assert.deepEqual(envelopePropsToLean(env, schema), props);
});
