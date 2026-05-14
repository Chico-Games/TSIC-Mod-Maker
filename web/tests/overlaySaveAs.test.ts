import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';
import { useAppSchemaStore } from '../src/store/appSchemaStore';

function makeMockHandle() {
  const files = new Map<string, string>();
  const deleted = new Set<string>();
  const dir = (path: string): any => ({
    name: path || 'root',
    kind: 'directory',
    async getDirectoryHandle(name: string) {
      return dir(path + name + '/');
    },
    async getFileHandle(name: string) {
      const full = path + name;
      return {
        kind: 'file',
        async createWritable() {
          return { async write(text: string) { files.set(full, text); }, async close() {} };
        },
        async getFile() { return { async text() { return files.get(full) ?? ''; } }; },
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

test('saveAs writes only overrides + additions; not unchanged default records', async () => {
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });
  const orig = globalThis.fetch;
  (globalThis as any).fetch = stubFetch({
    '/starter-project/manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A','B'] }] }),
    '/starter-project/default.json': JSON.stringify({ schema_version: 1, version: 5, label: '', published_at: '2026-05-14T00:00:00Z' }),
    '/starter-project/items/A.json': '{"id":"A","v":1,"asset_path":"/items/A","class":"UItemDefinition"}\n',
    '/starter-project/items/B.json': '{"id":"B","v":2,"asset_path":"/items/B","class":"UItemDefinition"}\n',
  });
  const { handle, files } = makeMockHandle();
  try {
    await useDefinitionsStore.getState().loadDefaultProject();
    const state = useDefinitionsStore.getState();
    state.updateValueAtPath('items/A', ['v'], 99);  // edit A; leave B untouched
    (globalThis as any).window = { ...(globalThis as any).window, showDirectoryPicker: async () => handle };
    await useDefinitionsStore.getState().saveAs();
    assert.ok(files.has('items/A.json'), 'override A should be written');
    assert.equal(files.has('items/B.json'), false, 'unchanged B should NOT be written');
    const meta = JSON.parse(files.get('project.json') ?? '{}');
    assert.equal(meta.schema_version, 2);
    assert.equal(meta.based_on_default_version, 5);
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});

test('saveAs writes zero-byte placeholders for tombstoned records', async () => {
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
    await useDefinitionsStore.getState().loadDefaultProject();
    // Manually mark items/A as tombstoned without going through the delete action
    // (Task 12 wires that path; here we exercise just the save side).
    useDefinitionsStore.setState((s) => ({
      definitions: new Map([...s.definitions].filter(([k]) => k !== 'items/A')),
      tombstones: new Set(['items/A']),
    }));
    (globalThis as any).window = { ...(globalThis as any).window, showDirectoryPicker: async () => handle };
    await useDefinitionsStore.getState().saveAs();
    assert.equal(files.get('items/A.json'), '');  // zero-byte placeholder
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});
