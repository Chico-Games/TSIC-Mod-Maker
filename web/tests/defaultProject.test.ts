import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDefaultProjectMeta } from '../src/persistence/defaultProject';

test('parseDefaultProjectMeta accepts a full meta', () => {
  const r = parseDefaultProjectMeta({
    schema_version: 1, version: 4, label: 'spring', published_at: '2026-05-14T00:00:00Z',
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.meta.version, 4);
});

test('parseDefaultProjectMeta accepts minimal meta with default label and zero published_at', () => {
  const r = parseDefaultProjectMeta({ schema_version: 1, version: 0 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.meta.label, '');
    assert.equal(r.meta.version, 0);
    assert.equal(typeof r.meta.published_at, 'string');
  }
});

test('parseDefaultProjectMeta rejects non-integer version', () => {
  const r = parseDefaultProjectMeta({ schema_version: 1, version: 1.5 });
  assert.equal(r.ok, false);
});

test('parseDefaultProjectMeta rejects non-object input', () => {
  assert.equal(parseDefaultProjectMeta(null).ok, false);
  assert.equal(parseDefaultProjectMeta('hi').ok, false);
});

test('parseDefaultProjectMeta rejects non-positive schema_version', () => {
  assert.equal(parseDefaultProjectMeta({ schema_version: 0, version: 1 }).ok, false);
  assert.equal(parseDefaultProjectMeta({ schema_version: -1, version: 1 }).ok, false);
});

import { loadDefaultProjectFromHttp } from '../src/persistence/defaultProject';

function mockFetch(map: Record<string, string>): typeof fetch {
  return (async (url: any) => {
    const u = String(url);
    const body = map[u];
    if (body === undefined) {
      return { ok: false, status: 404, text: async () => '' } as Response;
    }
    return { ok: true, status: 200, text: async () => body } as Response;
  }) as typeof fetch;
}

test('loadDefaultProjectFromHttp fetches manifest, default.json, and every listed file', async () => {
  const fetcher = mockFetch({
    'http://x/sp/manifest.json': JSON.stringify({
      folders: ['items'],
      files: [{ folder: 'items', ids: ['A', 'B'] }],
    }),
    'http://x/sp/default.json': JSON.stringify({
      schema_version: 1, version: 2, label: 'two', published_at: '2026-05-01T00:00:00Z',
    }),
    'http://x/sp/items/A.json': '{"id":"A"}\n',
    'http://x/sp/items/B.json': '{"id":"B"}\n',
  });
  const d = await loadDefaultProjectFromHttp('http://x/sp', fetcher);
  assert.equal(d.meta.version, 2);
  assert.equal(d.records.size, 2);
  assert.equal(d.records.get('items/A').id, 'A');
  assert.equal(d.texts.get('items/A'), '{\n  "id": "A"\n}\n');
});

test('loadDefaultProjectFromHttp tolerates missing default.json (treats as v0)', async () => {
  const fetcher = mockFetch({
    'http://x/sp/manifest.json': JSON.stringify({ folders: [], files: [] }),
  });
  const d = await loadDefaultProjectFromHttp('http://x/sp', fetcher);
  assert.equal(d.meta.version, 0);
  assert.equal(d.meta.label, '');
});
