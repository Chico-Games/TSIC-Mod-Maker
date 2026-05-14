import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';
import { useAppSchemaStore } from '../src/store/appSchemaStore';

test('loadDefaultProject loads the bundled default via the configured source', async () => {
  // Pre-populate classNodes so the drift validator doesn't gate on unknown-class.
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });

  // Stub fetch with the smallest possible default tree.
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (url: any) => {
    const u = String(url);
    if (u.endsWith('/starter-project/manifest.json'))
      return new Response(JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A'] }] }));
    if (u.endsWith('/starter-project/default.json'))
      return new Response(JSON.stringify({ schema_version: 1, version: 5, label: 't', published_at: '2026-05-14T00:00:00Z' }));
    if (u.endsWith('/starter-project/items/A.json'))
      return new Response('{"id":"A","asset_path":"/items/A","class":"UItemDefinition"}\n');
    return new Response('', { status: 404 });
  };
  try {
    await useDefinitionsStore.getState().loadDefaultProject();
    const s = useDefinitionsStore.getState();
    assert.equal(s.definitions.size, 1);
    assert.equal(s.defaultProject?.meta.version, 5);
    assert.equal(s.directoryHandle, null);
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});

import { setDefaultSourceHandle, clearDefaultSourceHandle } from '../src/persistence/defaultSourceSetting';

test('loadDefaultProject prefers the FSA setting when set', async () => {
  // Pre-populate classNodes so drift validator doesn't gate.
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });

  // Build a fake FSA handle. The handleStore stores it in fake-indexeddb;
  // fake-indexeddb uses structuredClone internally. To allow objects with
  // methods to round-trip, we temporarily replace globalThis.structuredClone
  // with an identity pass-through for the duration of the put.
  function makeFakeFsa(files: Record<string, string>): any {
    const root: any = {
      name: 'fake-default',
      kind: 'directory',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async getFileHandle(name: string) {
        if (!(name in files)) {
          const e: any = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
        }
        const text = files[name];
        return {
          kind: 'file',
          async getFile() { return { async text() { return text; } } as any; },
        };
      },
      async getDirectoryHandle(name: string) {
        const prefix = name + '/';
        return {
          name, kind: 'directory',
          async getFileHandle(child: string) {
            const k = prefix + child;
            if (!(k in files)) {
              const e: any = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
            }
            return {
              kind: 'file',
              async getFile() { return { async text() { return files[k]; } } as any; },
            };
          },
          async *entries() {
            for (const k of Object.keys(files)) {
              if (!k.startsWith(prefix)) continue;
              const rest = k.slice(prefix.length);
              if (rest.includes('/')) continue;
              yield [rest, { kind: 'file' }];
            }
          },
        };
      },
      async *entries() {
        const dirs = new Set<string>();
        for (const k of Object.keys(files)) {
          const slash = k.indexOf('/');
          if (slash > 0) dirs.add(k.slice(0, slash));
        }
        for (const d of dirs) yield [d, { kind: 'directory' }];
      },
    };
    return root;
  }

  const fakeFsa = makeFakeFsa({
    'manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A'] }] }),
    'default.json': JSON.stringify({ schema_version: 1, version: 9, label: 'from-fsa', published_at: '2026-05-14T00:00:00Z' }),
    'items/A.json': '{"id":"A","asset_path":"/items/A","class":"UItemDefinition"}\n',
  });

  // Replace structuredClone with an identity function for the entire test body
  // so fake-indexeddb can store and retrieve an FSA handle object that contains
  // methods (which the structured-clone algorithm cannot serialise).
  const origClone = globalThis.structuredClone;
  (globalThis as any).structuredClone = (v: any) => v;

  // Suppress fetch so we know HTTP isn't being used.
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response('', { status: 599 });

  try {
    await setDefaultSourceHandle(fakeFsa);
    await useDefinitionsStore.getState().loadDefaultProject();
    const s = useDefinitionsStore.getState();
    assert.equal(s.defaultProject?.meta.version, 9);
    assert.equal(s.defaultProject?.meta.label, 'from-fsa');
  } finally {
    (globalThis as any).fetch = origFetch;
    (globalThis as any).structuredClone = origClone;
    await clearDefaultSourceHandle();
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});
