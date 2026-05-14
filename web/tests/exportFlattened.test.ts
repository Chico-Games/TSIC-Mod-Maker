import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';
import { useAppSchemaStore } from '../src/store/appSchemaStore';
import { readZipAsync } from '../src/modio/zip';

test('exportFlattenedZip emits every effective record (default + overlay merged)', async () => {
  useAppSchemaStore.setState({
    classNodes: new Map([['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }]]),
  });
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (url: any) => {
    const u = String(url);
    if (u.endsWith('/starter-project/manifest.json'))
      return new Response(JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A','B'] }] }));
    if (u.endsWith('/starter-project/default.json'))
      return new Response(JSON.stringify({ schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' }));
    if (u.endsWith('/starter-project/items/A.json'))
      return new Response('{"id":"A","asset_path":"/items/A","class":"UItemDefinition"}\n');
    if (u.endsWith('/starter-project/items/B.json'))
      return new Response('{"id":"B","asset_path":"/items/B","class":"UItemDefinition"}\n');
    return new Response('', { status: 404 });
  };
  try {
    await useDefinitionsStore.getState().loadDefaultProject();
    const blob = await useDefinitionsStore.getState().exportFlattenedZip();
    const entries = await readZipAsync(await blob.arrayBuffer());
    assert.ok(entries !== null);
    const paths = entries!.map((e) => e.path).sort();
    assert.deepEqual(paths, ['items/A.json', 'items/B.json']);
  } finally {
    (globalThis as any).fetch = orig;
    useAppSchemaStore.setState({ classNodes: new Map() });
  }
});
