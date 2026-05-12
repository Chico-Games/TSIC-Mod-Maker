import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAssetCatalogStore } from '../src/store/assetCatalogStore';
import type { DataSource, AssetCatalog } from '../src/persistence/dataSource';

function mockDataSource(catalog: AssetCatalog | null): DataSource {
  return {
    kind: 'http', readOnly: true, displayName: 'mock',
    readManifest: async () => ({ folders: [], files: [] }),
    readFile: async () => '',
    readProjectMeta: async () => null,
    readCatalog: async (cls) => (catalog && catalog.class === cls ? catalog : null),
    readTags: async () => [],
    readAssetRefs: async () => ({}),
  };
}

test('loadCatalog memoizes', async () => {
  const cat: AssetCatalog = {
    schema_version: 1, class: 'StaticMesh',
    entries: [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' }],
  };
  let calls = 0;
  const ds: DataSource = { ...mockDataSource(cat), readCatalog: async (cls) => { calls++; return cls === 'StaticMesh' ? cat : null; } };
  // reset store between tests
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: ds });
  await useAssetCatalogStore.getState().loadCatalog('StaticMesh');
  await useAssetCatalogStore.getState().loadCatalog('StaticMesh');
  assert.equal(calls, 1);
});

test('lookupByPath returns entry after load', async () => {
  const cat: AssetCatalog = {
    schema_version: 1, class: 'StaticMesh',
    entries: [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' }],
  };
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: mockDataSource(cat) });
  await useAssetCatalogStore.getState().loadCatalog('StaticMesh');
  const e = useAssetCatalogStore.getState().lookupByPath('StaticMesh', '/Game/A.A');
  assert.equal(e?.package_guid, 'AAAA');
});

test('lookupByPath returns null before load', () => {
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: null });
  const e = useAssetCatalogStore.getState().lookupByPath('StaticMesh', '/Game/A.A');
  assert.equal(e, null);
});

test('lookupByGuid finds entry by guid', async () => {
  const cat: AssetCatalog = {
    schema_version: 1, class: 'StaticMesh',
    entries: [
      { path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' },
      { path: '/Game/B.B', name: 'B', folder: '/Game', package_guid: 'BBBB' },
    ],
  };
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: mockDataSource(cat) });
  await useAssetCatalogStore.getState().loadCatalog('StaticMesh');
  const e = useAssetCatalogStore.getState().lookupByGuid('StaticMesh', 'BBBB');
  assert.equal(e?.path, '/Game/B.B');
});

test('missing catalog marked as "missing"', async () => {
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: mockDataSource(null) });
  const out = await useAssetCatalogStore.getState().loadCatalog('NoSuchClass');
  assert.deepEqual(out, []);
  assert.equal(useAssetCatalogStore.getState().catalogs.NoSuchClass, 'missing');
});

test('loadCatalog returns [] when no dataSource set', async () => {
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: null });
  const out = await useAssetCatalogStore.getState().loadCatalog('StaticMesh');
  assert.deepEqual(out, []);
});

test('setDataSource clears cache', async () => {
  const cat: AssetCatalog = {
    schema_version: 1, class: 'StaticMesh',
    entries: [{ path: '/Game/A.A', name: 'A', folder: '/Game', package_guid: 'AAAA' }],
  };
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: mockDataSource(cat) });
  await useAssetCatalogStore.getState().loadCatalog('StaticMesh');
  assert.ok(Array.isArray(useAssetCatalogStore.getState().catalogs.StaticMesh));
  useAssetCatalogStore.getState().setDataSource(mockDataSource(null));
  assert.deepEqual(useAssetCatalogStore.getState().catalogs, {});
});

test('readCatalog throws — store recovers (not stuck on loading)', async () => {
  const errorDs: DataSource = {
    kind: 'http', readOnly: true, displayName: 'mock',
    readManifest: async () => ({ folders: [], files: [] }),
    readFile: async () => '',
    readProjectMeta: async () => null,
    readCatalog: async () => { throw new Error('boom'); },
    readTags: async () => [],
    readAssetRefs: async () => ({}),
  };
  useAssetCatalogStore.setState({ catalogs: {}, inflight: {}, dataSource: errorDs });
  const out = await useAssetCatalogStore.getState().loadCatalog('StaticMesh');
  assert.deepEqual(out, []);
  assert.equal(useAssetCatalogStore.getState().catalogs.StaticMesh, 'missing');
  assert.equal(useAssetCatalogStore.getState().inflight.StaticMesh, undefined);
});
