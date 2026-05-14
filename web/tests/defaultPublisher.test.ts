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
