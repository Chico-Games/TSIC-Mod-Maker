import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchemaDrift, type DriftIssue } from '../src/persistence/schemaDriftValidator';
import type { DefinitionRecord, DefinitionsKey } from '../src/store/definitionsStore';
import type { ClassNode, PropertyMeta } from '../src/store/appSchemaStore';

function mkRec(folder: string, id: string, json: any): [DefinitionsKey, DefinitionRecord] {
  const text = JSON.stringify(json);
  return [
    `${folder}/${id}`,
    { folder, id, json, originalText: text, diskId: id, diskFolder: folder },
  ];
}

function mkClassNodes(...names: string[]): Map<string, ClassNode> {
  const m = new Map<string, ClassNode>();
  for (const n of names) m.set(n, { name: n, parents: [], folder: null });
  return m;
}

function mkPropertyMeta(...keys: string[]): Map<string, PropertyMeta> {
  const blank: PropertyMeta = {
    tooltip: null, category: null, cpp_type: null, element_class: null,
    clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
    edit_condition: null, edit_spec: null, display_name: null, categories: null,
  };
  const m = new Map<string, PropertyMeta>();
  for (const k of keys) m.set(k, blank);
  return m;
}

test('clean record set yields no issues', () => {
  const defs = new Map([
    mkRec('items', 'A', { id: 'A', class: 'UItemDefinition', name: { type: 'FString', value: 'x' } }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.name', 'ItemDefinition.id'),
  );
  assert.deepEqual(issues, []);
});

test('unknown-class kind when record class missing from schema', () => {
  const defs = new Map([
    mkRec('items', 'A', { id: 'A', class: 'UMysteryDef' }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta(),
  );
  assert.equal(issues.length, 1);
  const issue = issues[0] as Extract<DriftIssue, { kind: 'unknown-class' }>;
  assert.equal(issue.kind, 'unknown-class');
  assert.equal(issue.className, 'UMysteryDef');
  assert.equal(issue.recordKey, 'items/A');
});

test('unknown-property kind when property missing from schema', () => {
  const defs = new Map([
    mkRec('items', 'A', {
      id: 'A',
      class: 'UItemDefinition',
      ghost_field: { type: 'FString', value: 'x' },
    }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.id'),
  );
  const unknown = issues.filter((i): i is Extract<DriftIssue, { kind: 'unknown-property' }> => i.kind === 'unknown-property');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].propertyName, 'ghost_field');
  assert.equal(unknown[0].parentType, 'ItemDefinition');
});

test('property check walks parent chain', () => {
  const defs = new Map([
    mkRec('items', 'A', {
      id: 'A',
      class: 'UConsumableDefinition',
      parent_classes: ['UItemDefinition'],
      name: { type: 'FString', value: 'x' },
    }),
  ]);
  const classNodes = new Map<string, ClassNode>([
    ['UConsumableDefinition', { name: 'UConsumableDefinition', parents: ['UItemDefinition'], folder: null }],
    ['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: null }],
  ]);
  const issues = validateSchemaDrift(
    defs,
    classNodes,
    mkPropertyMeta('ItemDefinition.name', 'ItemDefinition.id'),
  );
  assert.deepEqual(issues, []);
});

test('caps at 200 issues with an "and more" trailer', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>();
  for (let i = 0; i < 300; i++) {
    const [k, r] = mkRec('items', `A${i}`, { id: `A${i}`, class: 'UMysteryDef' });
    defs.set(k, r);
  }
  const issues = validateSchemaDrift(defs, mkClassNodes(), mkPropertyMeta());
  assert.equal(issues.length, 201);
  assert.equal(issues[200].kind, 'unknown-class');
  assert.equal((issues[200] as any).recordKey, '__and_more__');
});
