import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishAsNewDefaultVersion } from '../src/persistence/defaultPublisher';
import type { DefaultProject } from '../src/persistence/defaultProject';

function makeMockHandle(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const dir = (path: string): any => ({
    name: path || 'root',
    kind: 'directory',
    async getDirectoryHandle(name: string) {
      return dir(path + name + '/');
    },
    async getFileHandle(name: string, opts?: any) {
      const full = path + name;
      if (!files.has(full) && !opts?.create) {
        const e: any = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
      }
      return {
        kind: 'file',
        async createWritable() {
          return { async write(text: string) { files.set(full, text); }, async close() {} };
        },
        async getFile() { return { async text() { return files.get(full) ?? ''; } }; },
      };
    },
    async removeEntry(name: string) { files.delete(path + name); },
  });
  return { handle: dir(''), files };
}

test('publishAsNewDefaultVersion refuses a folder without manifest.json', async () => {
  const { handle } = makeMockHandle({});
  await assert.rejects(
    () => publishAsNewDefaultVersion(handle, new Map(), {
      meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' },
      records: new Map(), texts: new Map(),
    } as DefaultProject, {}),
    /manifest\.json/i,
  );
});

test('publishAsNewDefaultVersion writes records, manifest, default.json with bumped version', async () => {
  const { handle, files } = makeMockHandle({ 'manifest.json': '{"folders":[],"files":[]}' });
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 4, label: 'old', published_at: '2026-05-01T00:00:00Z' },
    records: new Map(),
    texts: new Map(),
  };
  const working = new Map();
  working.set('items/A', {
    folder: 'items', id: 'A', json: { id: 'A' },
    originalText: '', diskFolder: 'items', diskId: 'A',
  });
  const out = await publishAsNewDefaultVersion(handle, working, def, { label: 'new' });
  assert.equal(out.version, 5);
  assert.equal(out.label, 'new');
  assert.ok(files.get('items/A.json')!.includes('"id": "A"'));
  const m = JSON.parse(files.get('manifest.json')!);
  assert.deepEqual(m.folders, ['items']);
});

test('publishAsNewDefaultVersion removes default-side files no longer in the working set', async () => {
  const { handle, files } = makeMockHandle({
    'manifest.json': '{"folders":["items"],"files":[{"folder":"items","ids":["A","B"]}]}',
    'items/A.json': '{"id":"A"}\n',
    'items/B.json': '{"id":"B"}\n',
  });
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-01T00:00:00Z' },
    records: new Map([['items/A', { id: 'A' }], ['items/B', { id: 'B' }]]),
    texts: new Map([['items/A', '{\n  "id": "A"\n}\n'], ['items/B', '{\n  "id": "B"\n}\n']]),
  };
  const working = new Map();
  working.set('items/A', {
    folder: 'items', id: 'A', json: { id: 'A' },
    originalText: '', diskFolder: 'items', diskId: 'A',
  });
  await publishAsNewDefaultVersion(handle, working, def, {});
  assert.ok(files.has('items/A.json'));
  assert.equal(files.has('items/B.json'), false);
});

test('publishAsNewDefaultVersion writes the default-project convention (asset-index manifest, preserves mod.json + sidecars, keeps data-only defs, no default.json)', async () => {
  const { handle, files } = makeMockHandle({
    '.manifest.json': '{"schema_version":2,"generated_at":"old","assets":{}}',
    'mod.json': '{"id":"com.chicogames.default","displayName":"TSIC Base Game","version":"0.1.0"}',
    '.class-hierarchy.json': '{"schema_version":2,"classes":{}}',
  });
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 0, label: '', published_at: '2026-05-01T00:00:00Z' },
    records: new Map(), texts: new Map(),
  };
  const working = new Map();
  // asset-backed def (has asset_path) — belongs in the asset index
  working.set('damageable_furniture_definitions/FD_Chair_DF', {
    folder: 'damageable_furniture_definitions', id: 'FD_Chair_DF',
    json: { id: 'FD_Chair_DF', asset_path: '/Game/Furniture/FD_Chair_DF', class: 'UDamageableFurnitureDefinition' },
    originalText: '', diskFolder: 'damageable_furniture_definitions', diskId: 'FD_Chair_DF',
  });
  // data-only def (no asset_path) — written, but EXCLUDED from the asset index
  working.set('situation_definitions/SIT_Combat', {
    folder: 'situation_definitions', id: 'SIT_Combat',
    json: { id: 'SIT_Combat' },
    originalText: '', diskFolder: 'situation_definitions', diskId: 'SIT_Combat',
  });

  const modBefore = files.get('mod.json');
  const hierBefore = files.get('.class-hierarchy.json');
  await publishAsNewDefaultVersion(handle, working, def, { label: 'x' });

  // both record files written, including the data-only def
  assert.ok(files.get('damageable_furniture_definitions/FD_Chair_DF.json')!.includes('"id": "FD_Chair_DF"'));
  assert.ok(files.get('situation_definitions/SIT_Combat.json')!.includes('"id": "SIT_Combat"'), 'data-only def file kept');

  // .manifest.json is an asset INDEX: chair present (with its path), situation EXCLUDED
  const m = JSON.parse(files.get('.manifest.json')!);
  assert.equal(m.schema_version, 2);
  assert.equal(m.assets.damageable_furniture_definitions.FD_Chair_DF, '/Game/Furniture/FD_Chair_DF');
  assert.equal(m.assets.situation_definitions, undefined, 'data-only folder excluded from the asset index');

  // identity + sidecars untouched; no editor-convention files written
  assert.equal(files.get('mod.json'), modBefore, 'mod.json byte-unchanged');
  assert.equal(files.get('.class-hierarchy.json'), hierBefore, 'class-hierarchy sidecar untouched');
  assert.equal(files.has('manifest.json'), false, 'no undotted manifest.json written to a default-project');
  assert.equal(files.has('default.json'), false, 'no default.json polluting the default-project');
});
