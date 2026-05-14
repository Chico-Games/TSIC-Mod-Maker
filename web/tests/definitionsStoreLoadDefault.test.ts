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
