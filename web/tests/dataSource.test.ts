import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpDataSource,
  FsaDataSource,
  type DataSource,
} from '../src/persistence/dataSource';

/** Build a minimal mock matching the parts of `fetch` we use. */
function mockFetch(routes: Record<string, { status: number; body: string }>): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    const r = routes[u];
    if (!r) return { ok: false, status: 404, text: async () => '' } as any;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body } as any;
  }) as any;
}

test('HttpDataSource: readOnly true, fetches manifest', async () => {
  const ds: DataSource = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/manifest.json': {
      status: 200,
      body: JSON.stringify({
        folders: ['items'],
        files: [{ folder: 'items', ids: ['A'] }],
      }),
    },
  }));
  assert.equal(ds.readOnly, true);
  assert.equal(ds.kind, 'http');
  const m = await ds.readManifest();
  assert.deepEqual(m.folders, ['items']);
  assert.deepEqual(m.files, [{ folder: 'items', ids: ['A'] }]);
});

test('HttpDataSource: readFile fetches file body', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/items/A.json': { status: 200, body: '{"id":"A"}' },
  }));
  const text = await ds.readFile('items', 'A');
  assert.equal(text, '{"id":"A"}');
});

test('HttpDataSource: readProjectMeta returns synthesised meta', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  const meta = await ds.readProjectMeta();
  assert.equal(meta?.name, 'Starter project');
  assert.equal(meta?.schema_version, 1);
});

test('HttpDataSource: writeFile undefined (read-only)', () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  assert.equal(ds.writeFile, undefined);
  assert.equal(ds.deleteFile, undefined);
  assert.equal(ds.writeProjectMeta, undefined);
});

// --- FsaDataSource ---

function mockFile(text: string): FileSystemFileHandle {
  return {
    kind: 'file',
    async getFile() {
      return { text: async () => text } as any;
    },
  } as any;
}

function mockDir(entries: Record<string, FileSystemFileHandle | FileSystemDirectoryHandle>): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    async *entries() {
      for (const [name, h] of Object.entries(entries)) yield [name, h];
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      const h = entries[name];
      if (h && h.kind === 'file') return h as FileSystemFileHandle;
      if (opts?.create) {
        const stored = { content: '' };
        const fh: FileSystemFileHandle = {
          kind: 'file',
          async getFile() { return { text: async () => stored.content } as any; },
          async createWritable() {
            return {
              async write(s: string) { stored.content = s; },
              async close() { /* noop */ },
            } as any;
          },
        } as any;
        entries[name] = fh;
        return fh;
      }
      throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    },
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      const h = entries[name];
      if (h && h.kind === 'directory') return h as FileSystemDirectoryHandle;
      throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    },
    async removeEntry(name: string) {
      delete entries[name];
    },
  } as any;
}

test('FsaDataSource: readManifest skips dot-files and layout folders', async () => {
  const root = mockDir({
    items: mockDir({
      'A.json': mockFile('{"id":"A"}'),
      'B.json': mockFile('{"id":"B"}'),
    }),
    layout_meta: mockDir({ 'X.json': mockFile('{}') }),
    '.class-hierarchy.json': mockFile('{}'),
    '.property-meta.json': mockFile('{}'),
  });
  const ds = new FsaDataSource(root);
  const m = await ds.readManifest();
  assert.deepEqual(m.folders, ['items']);
  assert.deepEqual(m.files, [{ folder: 'items', ids: ['A', 'B'] }]);
});

test('FsaDataSource: readFile returns file text', async () => {
  const root = mockDir({
    items: mockDir({ 'A.json': mockFile('hello') }),
  });
  const ds = new FsaDataSource(root);
  const text = await ds.readFile('items', 'A');
  assert.equal(text, 'hello');
});

test('FsaDataSource: writeFile creates file', async () => {
  const items: any = { kind: 'directory' };
  const stored: Record<string, string> = {};
  items.entries = async function*() { /* empty */ };
  items.getFileHandle = async (name: string, opts: any) => {
    if (!opts?.create) throw new Error('no');
    return {
      kind: 'file',
      async createWritable() {
        return { async write(s: string) { stored[name] = s; }, async close() {} } as any;
      },
    } as any;
  };
  items.removeEntry = async () => {};
  const root = mockDir({ items });
  const ds = new FsaDataSource(root);
  await ds.writeFile!('items', 'A', '{"new":true}');
  assert.equal(stored['A.json'], '{"new":true}');
});

test('FsaDataSource: readProjectMeta returns null when absent', async () => {
  const root = mockDir({ items: mockDir({}) });
  const ds = new FsaDataSource(root);
  const meta = await ds.readProjectMeta();
  assert.equal(meta, null);
});

test('FsaDataSource: deleteFile removes the file from the folder', async () => {
  const removed: string[] = [];
  const items: any = {
    kind: 'directory',
    async *entries() { /* empty */ },
    async getFileHandle() { throw new Error('not used'); },
    async getDirectoryHandle() { throw new Error('not used'); },
    async removeEntry(name: string) { removed.push(name); },
  };
  const root = mockDir({ items });
  const ds = new FsaDataSource(root);
  await ds.deleteFile!('items', 'A');
  assert.deepEqual(removed, ['A.json']);
});

test('FsaDataSource: renameFile copies then deletes the source', async () => {
  const stored: Record<string, string> = { 'A.json': 'original-text' };
  const removed: string[] = [];
  const items: any = {
    kind: 'directory',
    async *entries() {},
    async getFileHandle(name: string, opts: any) {
      if (stored[name] != null) {
        return {
          kind: 'file',
          async getFile() { return { text: async () => stored[name] } as any; },
          async createWritable() {
            return { async write(s: string) { stored[name] = s; }, async close() {} } as any;
          },
        } as any;
      }
      if (opts?.create) {
        return {
          kind: 'file',
          async createWritable() {
            return { async write(s: string) { stored[name] = s; }, async close() {} } as any;
          },
        } as any;
      }
      throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    },
    async getDirectoryHandle() { throw new Error('not used'); },
    async removeEntry(name: string) { removed.push(name); delete stored[name]; },
  };
  const root = mockDir({ items });
  const ds = new FsaDataSource(root);
  await ds.renameFile!('items', 'A', 'items', 'B');
  assert.equal(stored['B.json'], 'original-text');
  assert.deepEqual(removed, ['A.json']);
  assert.equal(stored['A.json'], undefined);
});

test('FsaDataSource: renameFile is a no-op delete when src equals dst', async () => {
  const stored: Record<string, string> = { 'A.json': 'text' };
  const removed: string[] = [];
  const items: any = {
    kind: 'directory',
    async *entries() {},
    async getFileHandle(name: string, opts: any) {
      if (stored[name] != null) {
        return {
          kind: 'file',
          async getFile() { return { text: async () => stored[name] } as any; },
          async createWritable() {
            return { async write(s: string) { stored[name] = s; }, async close() {} } as any;
          },
        } as any;
      }
      if (opts?.create) {
        return {
          kind: 'file',
          async createWritable() {
            return { async write(s: string) { stored[name] = s; }, async close() {} } as any;
          },
        } as any;
      }
      throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    },
    async getDirectoryHandle() { throw new Error('not used'); },
    async removeEntry(name: string) { removed.push(name); delete stored[name]; },
  };
  const root = mockDir({ items });
  const ds = new FsaDataSource(root);
  await ds.renameFile!('items', 'A', 'items', 'A');
  assert.equal(stored['A.json'], 'text');
  assert.deepEqual(removed, []);
});

test('FsaDataSource: writeProjectMeta writes project.json at root', async () => {
  const stored: Record<string, string> = {};
  const root: any = {
    kind: 'directory',
    async *entries() {},
    async getFileHandle(name: string, opts: any) {
      if (!opts?.create) throw new Error('expected create');
      return {
        kind: 'file',
        async createWritable() {
          return { async write(s: string) { stored[name] = s; }, async close() {} } as any;
        },
      } as any;
    },
    async getDirectoryHandle() { throw new Error('not used'); },
    async removeEntry() {},
  };
  const ds = new FsaDataSource(root);
  await ds.writeProjectMeta!({ schema_version: 1, name: 'My Project' });
  const parsed = JSON.parse(stored['project.json']);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.name, 'My Project');
});

test('HttpDataSource: readCatalog fetches per-class file', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/.assets/StaticMesh.json': {
      status: 200,
      body: JSON.stringify({
        schema_version: 1, class: 'StaticMesh', entries: [
          { path: '/Game/Foo.SM_Foo', name: 'SM_Foo', folder: '/Game', package_guid: 'ABCD' }
        ]
      }),
    },
  }));
  const cat = await ds.readCatalog('StaticMesh');
  assert.equal(cat?.entries.length, 1);
  assert.equal(cat?.entries[0].package_guid, 'ABCD');
});

test('HttpDataSource: readCatalog returns null on 404', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  const cat = await ds.readCatalog('NotARealClass');
  assert.equal(cat, null);
});

test('HttpDataSource: readTags returns the list (order preserved from server)', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/.gameplay-tags.json': {
      status: 200,
      body: JSON.stringify({ schema_version: 1, tags: ['A.Z', 'Z.A'] }),
    },
  }));
  assert.deepEqual(await ds.readTags(), ['A.Z', 'Z.A']);
});

test('HttpDataSource: readTags returns [] when sidecar missing', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  assert.deepEqual(await ds.readTags(), []);
});

test('HttpDataSource: readAssetRefs returns the expected_guids map', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/.asset-refs.json': {
      status: 200,
      body: JSON.stringify({
        schema_version: 1,
        expected_guids: { '/Game/Foo.SM_Foo': 'ABCD' },
      }),
    },
  }));
  assert.deepEqual(await ds.readAssetRefs(), { '/Game/Foo.SM_Foo': 'ABCD' });
});

test('HttpDataSource: readAssetRefs returns {} when sidecar missing', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  assert.deepEqual(await ds.readAssetRefs(), {});
});
