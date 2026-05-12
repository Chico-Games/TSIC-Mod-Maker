import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchemaDrift, validateAssetRefs, type DriftIssue } from '../src/persistence/schemaDriftValidator';
import type { DefinitionRecord, DefinitionsKey } from '../src/store/definitionsStore';
import type { ClassNode, PropertyMeta } from '../src/store/appSchemaStore';
import type { AssetCatalogEntry } from '../src/persistence/dataSource';

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
    mkRec('items', 'A', {
      id: 'A',
      class: 'UItemDefinition',
      properties: { name: { type: 'FString', value: 'x' } },
    }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.name'),
  );
  assert.deepEqual(issues, []);
});

test('record missing class field yields no issues (skipped)', () => {
  const defs = new Map([
    mkRec('items', 'A', { id: 'A' /* no class */ }),
    mkRec('items', 'B', { id: 'B', class: 42 /* not a string */ }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta(),
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
      properties: { ghost_field: { type: 'FString', value: 'x' } },
    }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.name'),
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
      properties: { name: { type: 'FString', value: 'x' } },
    }),
  ]);
  const classNodes = new Map<string, ClassNode>([
    ['UConsumableDefinition', { name: 'UConsumableDefinition', parents: ['UItemDefinition'], folder: null }],
    ['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: null }],
  ]);
  const issues = validateSchemaDrift(
    defs,
    classNodes,
    mkPropertyMeta('ItemDefinition.name'),
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
  const sentinel = issues[200] as Extract<DriftIssue, { kind: 'unknown-class' }>;
  assert.equal(sentinel.kind, 'unknown-class');
  assert.equal(sentinel.recordKey, '__and_more__');
  assert.equal(sentinel.className, '__and_more__');
});

test('realistic envelope shape — envelope keys are not validated as properties', () => {
  const defs = new Map([
    mkRec('items', 'A', {
      id: 'A',
      asset_path: '/Game/X',
      class: 'UItemDefinition',
      parent_classes: ['UDataAsset', 'UObject'],
      properties: {
        display_name: { type: 'text', value: 'Hi' },
      },
    }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.display_name'),
  );
  // id, asset_path, class, parent_classes, properties at the envelope level
  // must NOT trigger unknown-property — only keys under `properties` are checked.
  assert.deepEqual(issues, []);
});

test('empty propertyMeta skips property-level checks', () => {
  const defs = new Map([
    mkRec('items', 'A', {
      id: 'A',
      class: 'UItemDefinition',
      properties: {
        any_property_at_all: { type: 'text', value: 'x' },
        another: { type: 'int', value: 42 },
      },
    }),
  ]);
  // propertyMeta intentionally empty (source export lacks .property-meta.json).
  // Validator can only check classes — properties must be skipped, not flagged.
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    new Map(),
  );
  assert.deepEqual(issues, []);
});

test('record with no properties object yields no property issues', () => {
  const defs = new Map([
    mkRec('items', 'A', { id: 'A', class: 'UItemDefinition' }),
    mkRec('items', 'B', { id: 'B', class: 'UItemDefinition', properties: null }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.name'),
  );
  assert.deepEqual(issues, []);
});

function mkAssetRec(_key: DefinitionsKey, props: any): DefinitionRecord {
  return { json: { class: 'UFurnitureDefinition', properties: props }, dirty: false } as any;
}

test('validateAssetRefs: missing-asset-ref when path not in catalog', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>([
    ['FD_X', mkAssetRec('FD_X' as DefinitionsKey, {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/Missing.SM_Missing' }
    })],
  ]);
  // Catalog exists for the class but does not contain the referenced path.
  const catalogs = new Map<string, AssetCatalogEntry[]>([['StaticMesh', []]]);
  const issues = validateAssetRefs(defs, catalogs, {});
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'missing-asset-ref');
  assert.deepEqual({ recordKey: issues[0].recordKey, path: (issues[0] as any).path },
                   { recordKey: 'FD_X', path: '/Game/Missing.SM_Missing' });
});

test('validateAssetRefs: asset-ref-guid-mismatch when expected != current', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>([
    ['FD_X', mkAssetRec('FD_X' as DefinitionsKey, {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/A.A' }
    })],
  ]);
  const catalogs = new Map<string, AssetCatalogEntry[]>([['StaticMesh',
    [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'BBBB' }]]]);
  const expected = { '/Game/A.A': 'AAAA' };
  const issues = validateAssetRefs(defs, catalogs, expected);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'asset-ref-guid-mismatch');
  assert.equal((issues[0] as any).expectedGuid, 'AAAA');
  assert.equal((issues[0] as any).currentGuid, 'BBBB');
});

test('validateAssetRefs: no issue when guids match', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>([
    ['FD_X', mkAssetRec('FD_X' as DefinitionsKey, {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/A.A' }
    })],
  ]);
  const catalogs = new Map<string, AssetCatalogEntry[]>([['StaticMesh',
    [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' }]]]);
  const expected = { '/Game/A.A': 'AAAA' };
  const issues = validateAssetRefs(defs, catalogs, expected);
  assert.deepEqual(issues, []);
});

test('validateAssetRefs: no issue when guid recorded but catalog has empty (tamper unknown)', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>([
    ['FD_X', mkAssetRec('FD_X' as DefinitionsKey, {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: '/Game/A.A' }
    })],
  ]);
  const catalogs = new Map<string, AssetCatalogEntry[]>([['StaticMesh',
    [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: '' }]]]);
  const expected = { '/Game/A.A': '' };
  // expected guid is "" (UE 5.x doesn't expose PackageGuid) — no mismatch claim.
  const issues = validateAssetRefs(defs, catalogs, expected);
  assert.deepEqual(issues, []);
});

test('validateAssetRefs: null soft_asset_ref value is skipped', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>([
    ['FD_X', mkAssetRec('FD_X' as DefinitionsKey, {
      static_mesh: { type: 'soft_asset_ref', class: 'StaticMesh', value: null }
    })],
  ]);
  const issues = validateAssetRefs(defs, new Map(), {});
  assert.deepEqual(issues, []);
});

test('validateAssetRefs: recurses into struct and array shapes', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>([
    ['FD_X', mkAssetRec('FD_X' as DefinitionsKey, {
      audio_config: {
        type: 'struct', struct_name: 'AudioConfig',
        value: {
          open_sound: {
            type: 'soft_asset_ref', class: 'SoundCue', value: '/Game/Audio/Missing.SC_Missing'
          }
        }
      }
    })],
  ]);
  // Catalog exists for SoundCue but does not contain the referenced path.
  const catalogs = new Map<string, AssetCatalogEntry[]>([['SoundCue', []]]);
  const issues = validateAssetRefs(defs, catalogs, {});
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'missing-asset-ref');
  assert.equal((issues[0] as any).path, '/Game/Audio/Missing.SC_Missing');
});

test('validateAssetRefs: no issue when catalog for the class is absent entirely', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>([
    ['FD_X', mkAssetRec('FD_X' as DefinitionsKey, {
      audio_config: {
        type: 'struct', struct_name: 'AudioConfig',
        value: {
          sound: { type: 'soft_asset_ref', class: 'SoundCue', value: '/Game/Audio/SC.SC' }
        }
      }
    })],
  ]);
  // No SoundCue catalog in the map.
  const issues = validateAssetRefs(defs, new Map(), {});
  assert.deepEqual(issues, []);
});
