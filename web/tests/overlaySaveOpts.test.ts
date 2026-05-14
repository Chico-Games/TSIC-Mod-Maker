import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';
import { useAppSchemaStore } from '../src/store/appSchemaStore';
import { FsaDataSource } from '../src/persistence/dataSource';

// ---------------------------------------------------------------------------
// Helpers (duplicated from overlaySaveAs.test.ts for independence)
// ---------------------------------------------------------------------------

function makeMockHandle() {
  const files = new Map<string, string>();
  const deleted = new Set<string>();
  const dir = (path: string): any => ({
    name: path || 'root',
    kind: 'directory',
    async getDirectoryHandle(name: string) {
      return dir(path + name + '/');
    },
    async getFileHandle(name: string, opts?: any) {
      const full = path + name;
      return {
        kind: 'file',
        async createWritable() {
          return {
            async write(text: string) { files.set(full, text); },
            async close() {},
          };
        },
        async getFile() {
          const content = files.get(full);
          if (content === undefined) {
            const err: any = new Error('NotFoundError');
            err.name = 'NotFoundError';
            throw err;
          }
          return { async text() { return content; } };
        },
      };
    },
    async removeEntry(name: string) { deleted.add(path + name); files.delete(path + name); },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async *entries() {
      const seen = new Set<string>();
      for (const k of files.keys()) {
        if (!k.startsWith(path)) continue;
        const rest = k.slice(path.length);
        const slash = rest.indexOf('/');
        const name = slash >= 0 ? rest.slice(0, slash) : rest;
        if (seen.has(name)) continue;
        seen.add(name);
        yield [name, { kind: slash >= 0 ? 'directory' : 'file' }];
      }
    },
  });
  return { handle: dir(''), files, deleted };
}

function stubFetch(map: Record<string, string>): typeof fetch {
  return (async (url: any) => {
    const u = String(url);
    const body = map[u];
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body);
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------

test('saveAllDirty writes zero-byte placeholders for tombstoned keys', async () => {
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });
  const orig = globalThis.fetch;
  (globalThis as any).fetch = stubFetch({
    '/starter-project/manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A'] }] }),
    '/starter-project/default.json': JSON.stringify({ schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' }),
    '/starter-project/items/A.json': '{"id":"A","asset_path":"/items/A","class":"UItemDefinition"}\n',
  });
  const { handle, files } = makeMockHandle();
  try {
    // Load the default project.
    await useDefinitionsStore.getState().loadDefaultProject();
    // Save As to get a writable FSA dataSource.
    (globalThis as any).window = { ...(globalThis as any).window, showDirectoryPicker: async () => handle };
    await useDefinitionsStore.getState().saveAs();

    // Now manually add a tombstone for 'items/A'.
    useDefinitionsStore.setState((s) => ({
      definitions: new Map([...s.definitions].filter(([k]) => k !== 'items/A')),
      tombstones: new Set(['items/A']),
    }));

    // Run saveAllDirty — should write zero-byte placeholder.
    await useDefinitionsStore.getState().saveAllDirty();

    assert.equal(files.get('items/A.json'), '', 'items/A.json should be a zero-byte tombstone placeholder');
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});

test('saveOne deletes the on-disk file when the record reverts to match the default', async () => {
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });
  const orig = globalThis.fetch;
  const defaultText = '{"id":"A","asset_path":"/items/A","class":"UItemDefinition"}\n';
  (globalThis as any).fetch = stubFetch({
    '/starter-project/manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A'] }] }),
    '/starter-project/default.json': JSON.stringify({ schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' }),
    '/starter-project/items/A.json': defaultText,
  });
  const { handle, files } = makeMockHandle();
  try {
    await useDefinitionsStore.getState().loadDefaultProject();
    // Save As to get a writable FSA dataSource.
    (globalThis as any).window = { ...(globalThis as any).window, showDirectoryPicker: async () => handle };
    await useDefinitionsStore.getState().saveAs();

    // Edit record A (makes it dirty / an override).
    useDefinitionsStore.getState().updateValueAtPath('items/A', ['v'], 99);

    // Revert back to default by calling revertOne (restores originalText).
    useDefinitionsStore.getState().revertOne('items/A');

    // At this point the record's json matches the default. saveOne should delete
    // the override file.
    files.set('items/A.json', 'some-previous-override-content');
    await useDefinitionsStore.getState().saveOne('items/A');

    // The file should have been deleted (undefined) because content == default.
    assert.equal(
      files.has('items/A.json'),
      false,
      'Override file should be deleted when content matches the default',
    );
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});

test('legacy v1 project is migrated to v2 on first saveAllDirty', async () => {
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });
  const orig = globalThis.fetch;
  const defaultText = '{"id":"A","asset_path":"/items/A","class":"UItemDefinition"}\n';
  (globalThis as any).fetch = stubFetch({
    '/starter-project/manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A'] }] }),
    '/starter-project/default.json': JSON.stringify({ schema_version: 1, version: 7, label: '', published_at: '2026-05-14T00:00:00Z' }),
    '/starter-project/items/A.json': defaultText,
  });
  const { handle, files } = makeMockHandle();
  try {
    // Pre-populate the mock FSA with a v1 project: items/A.json is identical to default,
    // and project.json has schema_version: 1.
    files.set('items/A.json', defaultText);
    files.set('project.json', JSON.stringify({ schema_version: 1, name: 'Legacy' }) + '\n');

    // Load the default project (populates defaultProject).
    await useDefinitionsStore.getState().loadDefaultProject();

    // Now manually point the store at the FSA handle with schema_version: 1.
    const fsaDs = new FsaDataSource(handle);
    useDefinitionsStore.setState({
      dataSource: fsaDs,
      directoryHandle: handle,
      projectMeta: { schema_version: 1, name: 'Legacy' },
    });

    // saveAllDirty with no dirty records should still trigger migration.
    await useDefinitionsStore.getState().saveAllDirty();

    // items/A.json should have been deleted (it matched the default exactly).
    assert.equal(
      files.has('items/A.json'),
      false,
      'items/A.json should be removed because it is identical to the default',
    );

    // project.json should now have schema_version: 2 and based_on_default_version.
    const metaRaw = files.get('project.json');
    assert.ok(metaRaw, 'project.json should have been written');
    const meta = JSON.parse(metaRaw!);
    assert.equal(meta.schema_version, 2, 'schema_version should be 2 after migration');
    assert.equal(meta.based_on_default_version, 7, 'based_on_default_version should match default meta version');
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});
