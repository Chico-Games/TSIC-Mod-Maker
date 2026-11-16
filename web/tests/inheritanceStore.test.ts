// Store-level behaviour of `extends`: referential integrity on rename/delete,
// validation, and the resolved view that list/search consumers read through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useDefinitionsStore, type DefinitionRecord } from '../src/store/definitionsStore';
import { buildReferencedByIndex } from '../src/store/referencedByIndex';
import { buildInheritanceIssues } from '../src/store/validationStore';
import { childIdsOf, resolvedJson, resolvedProps } from '../src/store/inheritedView';
import { DEFAULT_WARNINGS } from '../src/components/classBrowser/RowWarnings';
import { semanticTextFor } from '../src/search/semanticText';

const FOLDER = 'damageable_furniture_definitions';
const CLS = 'UDamageableFurnitureDefinition';

function rec(id: string, properties: Record<string, any>, cls = CLS, folder = FOLDER): DefinitionRecord {
  return {
    folder, id,
    json: { id, asset_path: `/Game/Furniture/${id}`, class: cls, properties },
    originalText: '', diskId: id, diskFolder: folder,
  };
}

/** Parent + child + an unrelated record that merely mentions the parent id in a string. */
function seed(extra: DefinitionRecord[] = []) {
  const recs = [
    rec('FD_Fridge_DF', {
      display_name: { type: 'text', value: 'Fridge' },
      description: { type: 'text', value: 'Keeps things cold' },
      starting_health: { type: 'float', value: 100 },
    }),
    rec('FD_Fridge_Tier2_DF', {
      extends: { type: 'string', value: 'FD_Fridge_DF' },
      starting_health: { type: 'float', value: 440 },
    }),
    rec('FD_Note_DF', { description: { type: 'string', value: 'FD_Fridge_DF' } }),
    ...extra,
  ];
  const definitions = new Map(recs.map((r) => [`${r.folder}/${r.id}`, r]));
  useDefinitionsStore.setState({
    definitions,
    dirty: new Set(),
    toast: null,
    selectedKey: null,
    directoryHandle: null,
    referencedByIndex: buildReferencedByIndex(definitions),
  } as any);
  return useDefinitionsStore.getState();
}

const extendsOf = (id: string) => {
  const st = useDefinitionsStore.getState();
  return st.definitions.get(st.findKeyById(id)!)?.json.properties.extends;
};

test('resolved view: a child reads its parent values; own values win; nothing is written', () => {
  const st = seed();
  const child = st.definitions.get(`${FOLDER}/FD_Fridge_Tier2_DF`)!;
  const before = JSON.stringify(child.json);
  const props = resolvedProps(child);
  assert.equal(props.display_name.value, 'Fridge');
  assert.equal(props.starting_health.value, 440);
  assert.equal(resolvedJson(child).properties.description.value, 'Keeps things cold');
  assert.equal(resolvedJson(child).id, 'FD_Fridge_Tier2_DF');
  assert.equal(JSON.stringify(child.json), before, 'the record itself is untouched');
  // Records that extend nothing get their own object back (no allocation).
  const parent = st.definitions.get(`${FOLDER}/FD_Fridge_DF`)!;
  assert.equal(resolvedProps(parent), parent.json.properties);
  assert.equal(resolvedJson(parent), parent.json);
  assert.deepEqual(childIdsOf('FD_Fridge_DF'), ['FD_Fridge_Tier2_DF']);
});

test('resolved view follows edits (cache is per definitions snapshot)', () => {
  const st = seed();
  const key = `${FOLDER}/FD_Fridge_DF`;
  assert.equal(resolvedProps(st.definitions.get(`${FOLDER}/FD_Fridge_Tier2_DF`)!).display_name.value, 'Fridge');
  st.updateValueAtPath(key, ['properties', 'display_name'], { type: 'text', value: 'Chiller' });
  const after = useDefinitionsStore.getState();
  assert.equal(resolvedProps(after.definitions.get(`${FOLDER}/FD_Fridge_Tier2_DF`)!).display_name.value, 'Chiller');
});

test('consumers: no false "no display_name" on a child, and search text carries the inherited name', () => {
  const st = seed();
  const child = st.definitions.get(`${FOLDER}/FD_Fridge_Tier2_DF`)!;
  const ctx: any = { records: st.definitions, findKeyById: st.findKeyById };
  const rule = DEFAULT_WARNINGS.find((w) => w.id === 'missing-display-name')!;
  assert.equal(rule.test(child, ctx), null);
  assert.equal(rule.test(st.definitions.get(`${FOLDER}/FD_Note_DF`)!, ctx), 'no display_name', 'still fires for a real gap');
  const text = semanticTextFor(child);
  assert.match(text, /Fridge/);
  assert.match(text, /Keeps things cold/);
});

test('rename retargets `extends` on children and keeps the where-used index right', () => {
  const st = seed();
  const newKey = st.renameAsset(`${FOLDER}/FD_Fridge_DF`, 'Chiller');
  assert.equal(newKey, `${FOLDER}/FD_Chiller_DF`);
  assert.deepEqual(extendsOf('FD_Fridge_Tier2_DF'), { type: 'string', value: 'FD_Chiller_DF' });
  const after = useDefinitionsStore.getState();
  assert.ok(after.dirty.has(`${FOLDER}/FD_Fridge_Tier2_DF`), 'the child must be saved with its new parent id');
  assert.deepEqual(
    after.definitions.get(`${FOLDER}/FD_Note_DF`)!.json.properties.description,
    { type: 'string', value: 'FD_Fridge_DF' },
    'an ordinary string that happens to equal the id is NOT rewritten',
  );
  assert.equal(after.dirty.has(`${FOLDER}/FD_Note_DF`), false);
  assert.deepEqual(after.referencedBy('FD_Chiller_DF').map((r) => [r.ownerKey, r.path.join('.')]),
    [[`${FOLDER}/FD_Fridge_Tier2_DF`, 'properties.extends']]);
  assert.deepEqual(after.referencedBy('FD_Fridge_DF'), []);
  assert.deepEqual(buildInheritanceIssues(), [], 'no dangling parent after a rename');
});

test('renaming the CHILD leaves its extends alone and re-keys its index entry', () => {
  const st = seed();
  const newKey = st.renameAsset(`${FOLDER}/FD_Fridge_Tier2_DF`, 'Fridge_Tier3');
  assert.equal(newKey, `${FOLDER}/FD_Fridge_Tier3_DF`);
  assert.deepEqual(extendsOf('FD_Fridge_Tier3_DF'), { type: 'string', value: 'FD_Fridge_DF' });
  assert.deepEqual(useDefinitionsStore.getState().referencedBy('FD_Fridge_DF').map((r) => r.ownerKey), [newKey]);
});

test('deleting a parent is refused and names the children; deleting a leaf still works', async () => {
  const st = seed();
  await st.deleteDefinition(`${FOLDER}/FD_Fridge_DF`);
  let after = useDefinitionsStore.getState();
  assert.ok(after.definitions.has(`${FOLDER}/FD_Fridge_DF`), 'parent must survive');
  assert.equal(after.toast?.kind, 'error');
  assert.match(after.toast!.text, /Can't delete FD_Fridge_DF/);
  assert.match(after.toast!.text, /FD_Fridge_Tier2_DF/);
  assert.deepEqual(extendsOf('FD_Fridge_Tier2_DF'), { type: 'string', value: 'FD_Fridge_DF' }, 'child untouched');
  assert.equal(after.dirty.size, 0);

  await after.deleteDefinition(`${FOLDER}/FD_Fridge_Tier2_DF`);
  after = useDefinitionsStore.getState();
  assert.equal(after.definitions.has(`${FOLDER}/FD_Fridge_Tier2_DF`), false);
  assert.deepEqual(after.referencedBy('FD_Fridge_DF'), [], 'the extends entry leaves the index with the child');
  // …and with no children left the parent can go.
  await after.deleteDefinition(`${FOLDER}/FD_Fridge_DF`);
  assert.equal(useDefinitionsStore.getState().definitions.has(`${FOLDER}/FD_Fridge_DF`), false);
});

test('references list `extends` in both directions', () => {
  const st = seed();
  const out = st.outgoingReferences(`${FOLDER}/FD_Fridge_Tier2_DF`);
  assert.deepEqual(out.map((o) => [o.refPath, o.refValue, o.targetKey]),
    [['properties.extends', 'FD_Fridge_DF', `${FOLDER}/FD_Fridge_DF`]]);
  const inc = st.incomingReferences(`${FOLDER}/FD_Fridge_DF`);
  assert.deepEqual(inc.map((i) => [i.sourceId, i.refPath]), [['FD_Fridge_Tier2_DF', 'properties.extends']]);
});

test('validation reports unknown parent, cycle and class mismatch — and nothing for a healthy chain', () => {
  seed();
  assert.deepEqual(buildInheritanceIssues(), []);

  seed([
    rec('FD_Orphan_DF', { extends: { type: 'string', value: 'FD_Gone_DF' } }),
    rec('FD_LoopA_DF', { extends: { type: 'string', value: 'FD_LoopB_DF' } }),
    rec('FD_LoopB_DF', { extends: { type: 'string', value: 'FD_LoopA_DF' } }),
    rec('FD_Shelf_ST', {}, 'UStorageDefinition', 'storage_definitions'),
    rec('FD_Wrong_DF', { extends: { type: 'string', value: 'FD_Shelf_ST' } }),
    rec('FD_Downstream_DF', { extends: { type: 'string', value: 'FD_Orphan_DF' } }),
  ]);
  const byId = new Map(buildInheritanceIssues().map((i) => [i.recordKey.split('/')[1], i]));
  assert.deepEqual([...byId.keys()].sort(),
    ['FD_Downstream_DF', 'FD_LoopA_DF', 'FD_LoopB_DF', 'FD_Orphan_DF', 'FD_Wrong_DF']);
  assert.equal(byId.get('FD_Orphan_DF')!.error.kind, 'unknown-parent');
  assert.equal(byId.get('FD_LoopA_DF')!.error.kind, 'cycle');
  assert.equal(byId.get('FD_LoopB_DF')!.error.kind, 'cycle');
  assert.equal(byId.get('FD_Wrong_DF')!.error.kind, 'class-mismatch');
  // A healthy record downstream of a broken one is dropped by the game too.
  assert.equal(byId.get('FD_Downstream_DF')!.error.kind, 'unknown-parent');
  assert.equal(byId.get('FD_Downstream_DF')!.error.atId, 'FD_Orphan_DF');
  assert.match(byId.get('FD_Downstream_DF')!.detail, /via ancestor FD_Orphan_DF/);

  // The class-browser row warning agrees.
  const st = useDefinitionsStore.getState();
  const rule = DEFAULT_WARNINGS.find((w) => w.id === 'broken-extends')!;
  assert.equal(rule.severity, 'error');
  assert.match(rule.test(st.definitions.get(`${FOLDER}/FD_Orphan_DF`)!, {} as any)!, /does not exist/);
  assert.equal(rule.test(st.definitions.get(`${FOLDER}/FD_Fridge_Tier2_DF`)!, {} as any), null);
});
