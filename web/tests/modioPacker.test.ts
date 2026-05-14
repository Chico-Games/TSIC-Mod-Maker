import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeltaZip, defaultCatalogFromLoaded, serializeRecord, type StarterCatalog } from '../src/modio/packer';
import { readZipAsync } from '../src/modio/zip';
import type { DefinitionRecord } from '../src/store/definitionsStore';
import type { DefaultProject } from '../src/persistence/defaultProject';

function rec(folder: string, id: string, json: any): DefinitionRecord {
  const text = JSON.stringify(json, null, 2) + '\n';
  return { folder, id, json, originalText: text, diskId: id, diskFolder: folder };
}

test('packer: only modified + new records are included; unchanged is skipped', async () => {
  const starter: StarterCatalog = new Map();
  starter.set('items/A', serializeRecord(rec('items', 'A', { id: 'A', val: 1 })));
  starter.set('items/B', serializeRecord(rec('items', 'B', { id: 'B', val: 2 })));

  const records: DefinitionRecord[] = [
    rec('items', 'A', { id: 'A', val: 1 }), // unchanged
    rec('items', 'B', { id: 'B', val: 999 }), // modified
    rec('items', 'C', { id: 'C', val: 3 }), // new
  ];

  const out = await buildDeltaZip(records, starter, { editorVersion: '0.0.0', baseSource: 'default-project' });
  assert.equal(out.files.length, 2);
  assert.equal(out.added.length, 1);
  assert.equal(out.modified.length, 1);
  assert.equal(out.unchangedCount, 1);
  assert.equal(out.added[0].id, 'C');
  assert.equal(out.modified[0].id, 'B');

  // ZIP contains mod.json + B.json + C.json
  const entries = await readZipAsync(await out.blob.arrayBuffer());
  assert.ok(entries !== null);
  const paths = entries!.map((e) => e.path).sort();
  assert.deepEqual(paths, ['items/B.json', 'items/C.json', 'mod.json']);

  const manifest = JSON.parse(new TextDecoder().decode(entries!.find((e) => e.path === 'mod.json')!.data));
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.generated_by, 'tsic-definition-editor');
  assert.equal(manifest.base.source, 'default-project');
  assert.equal('version' in manifest.base, false);
});

test('packer: md5 stable across runs for identical input', async () => {
  // Deterministic ordering is required for stable md5. The packer should sort.
  const starter: StarterCatalog = new Map();
  const records: DefinitionRecord[] = [
    rec('z', 'A', { v: 1 }),
    rec('a', 'B', { v: 2 }),
  ];
  // mod.json includes generated_at (timestamp) so the outer md5 will differ
  // between runs. We check inner file md5 stability instead.
  const o1 = await buildDeltaZip(records, starter, { editorVersion: '0.0.0', baseSource: 'default-project' });
  const o2 = await buildDeltaZip(records.slice().reverse(), starter, { editorVersion: '0.0.0', baseSource: 'default-project' });
  const m1 = new Map(o1.files.map((f) => [f.folder + '/' + f.id, f.md5]));
  const m2 = new Map(o2.files.map((f) => [f.folder + '/' + f.id, f.md5]));
  assert.deepEqual([...m1.entries()].sort(), [...m2.entries()].sort());
});

test('packer: empty diff still emits mod.json', async () => {
  const starter: StarterCatalog = new Map();
  starter.set('items/A', serializeRecord(rec('items', 'A', { id: 'A' })));
  const records: DefinitionRecord[] = [rec('items', 'A', { id: 'A' })];
  const out = await buildDeltaZip(records, starter, { editorVersion: '0.0.0', baseSource: 'default-project' });
  assert.equal(out.files.length, 0);
  assert.equal(out.unchangedCount, 1);
  const entries = await readZipAsync(await out.blob.arrayBuffer());
  assert.equal(entries!.length, 1);
  assert.equal(entries![0].path, 'mod.json');
});

test('defaultCatalogFromLoaded converts a DefaultProject to a StarterCatalog', () => {
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' },
    records: new Map([['items/A', { id: 'A' }]]),
    texts: new Map([['items/A', '{\n  "id": "A"\n}\n']]),
  };
  const catalog = defaultCatalogFromLoaded(def);
  assert.equal(catalog.get('items/A'), '{\n  "id": "A"\n}\n');
});
