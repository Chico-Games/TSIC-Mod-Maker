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

import { loadDefaultProjectFromFsa } from '../src/persistence/defaultProject';

function makeFakeFsa(files: Record<string, string>): any {
  // Path keys look like 'manifest.json' or 'items/A.json' or 'default.json'.
  const root: any = {
    name: 'fake-root',
    kind: 'directory',
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
      const sub: any = {
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
      return sub;
    },
    async *entries() {
      const seenDirs = new Set<string>();
      for (const k of Object.keys(files)) {
        const slash = k.indexOf('/');
        if (slash > 0) {
          const dir = k.slice(0, slash);
          if (seenDirs.has(dir)) continue;
          seenDirs.add(dir);
          yield [dir, { kind: 'directory' }];
        }
      }
    },
  };
  return root;
}

test('loadDefaultProjectFromFsa reads manifest, default.json, and JSONs from disk', async () => {
  const fsa = makeFakeFsa({
    'manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A'] }] }),
    'default.json': JSON.stringify({
      schema_version: 1, version: 7, label: '', published_at: '2026-05-14T00:00:00Z',
    }),
    'items/A.json': '{"id":"A"}\n',
  });
  const d = await loadDefaultProjectFromFsa(fsa);
  assert.equal(d.meta.version, 7);
  assert.equal(d.records.size, 1);
  assert.equal(d.records.get('items/A').id, 'A');
});
