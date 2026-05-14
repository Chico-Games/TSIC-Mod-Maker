import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';
import { useAppSchemaStore } from '../src/store/appSchemaStore';

function stubFetch(map: Record<string, string>): typeof fetch {
  return (async (url: any) => {
    const u = String(url);
    const body = map[u];
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body);
  }) as typeof fetch;
}

test('overlay load: HTTP default loads as working set (no overlay applied)', async () => {
  // Pre-populate classNodes so any drift validator doesn't gate.
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });
  const orig = globalThis.fetch;
  (globalThis as any).fetch = stubFetch({
    '/starter-project/manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A','B'] }] }),
    '/starter-project/default.json': JSON.stringify({ schema_version: 1, version: 3, label: '', published_at: '2026-05-14T00:00:00Z' }),
    '/starter-project/items/A.json': '{"id":"A","asset_path":"/items/A","class":"UItemDefinition"}\n',
    '/starter-project/items/B.json': '{"id":"B","asset_path":"/items/B","class":"UItemDefinition"}\n',
  });
  try {
    await useDefinitionsStore.getState().loadDefaultProject();
    const s = useDefinitionsStore.getState();
    assert.equal(s.definitions.size, 2);
    assert.equal(s.tombstones.size, 0);
    assert.equal(s.defaultProject?.meta.version, 3);
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});
