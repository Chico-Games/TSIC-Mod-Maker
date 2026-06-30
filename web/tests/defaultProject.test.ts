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
  assert.equal(d.modIdentity, undefined); // editor convention has no mod.json
});

import { parseModIdentity } from '../src/persistence/defaultProject';

test('parseModIdentity reads id/displayName/version; defaults displayName to id', () => {
  assert.deepEqual(
    parseModIdentity({ id: 'a.b', displayName: 'A B', version: '1.2.3' }),
    { id: 'a.b', displayName: 'A B', version: '1.2.3' },
  );
  assert.equal(parseModIdentity({ id: 'a.b' })?.displayName, 'a.b');
  assert.equal(parseModIdentity({ id: 'a.b', version: 5 })?.version, '5'); // coerced to string
  assert.equal(parseModIdentity({}), null);
  assert.equal(parseModIdentity(null), null);
});

test('loadDefaultProjectFromFsa directory-scans a default-project (dotted manifest + mod.json)', async () => {
  const fsa = makeFakeFsa({
    // dotted asset-index manifest — intentionally OMITS situation_definitions
    '.manifest.json': JSON.stringify({
      schema_version: 2, generated_at: 'x',
      assets: { damageable_furniture_definitions: { FD_Chair_DF: '/Game/Furniture/FD_Chair_DF' } },
    }),
    'mod.json': JSON.stringify({ id: 'com.chicogames.default', displayName: 'TSIC Base Game', version: '0.1.0' }),
    'default.json': JSON.stringify({ schema_version: 1, version: 3 }),
    'damageable_furniture_definitions/FD_Chair_DF.json':
      '{"id":"FD_Chair_DF","class":"UDamageableFurnitureDefinition"}\n',
    // data-only def folder — absent from .manifest.json assets, must STILL load via scan
    'situation_definitions/SIT_Combat.json': '{"id":"SIT_Combat"}\n',
    // dotted sidecar dir must be skipped entirely
    '.assets/Class.json': '{"class":"X"}\n',
  });
  const d = await loadDefaultProjectFromFsa(fsa);
  // scanned both def folders, including the data-only one the manifest omits
  assert.equal(d.records.size, 2);
  assert.ok(d.records.get('situation_definitions/SIT_Combat'), 'data-only def loaded via directory scan');
  assert.ok(d.records.get('damageable_furniture_definitions/FD_Chair_DF'));
  assert.equal(d.records.get('.assets/Class'), undefined, '.assets sidecar dir skipped');
  // mod identity carried separately from the integer publish counter
  assert.equal(d.modIdentity?.id, 'com.chicogames.default');
  assert.equal(d.modIdentity?.version, '0.1.0'); // semver string, untouched
  assert.equal(d.meta.version, 3); // editor publish counter from default.json
});

// ── Real-data acceptance: scan the actual exported pack via an fs→FSA shim ────
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { PACK_DIR, PACK_AVAILABLE } from './packDir';

/** Minimal FileSystemDirectoryHandle backed by a real on-disk folder. */
function fsaFromDisk(dirPath: string): any {
  return {
    kind: 'directory',
    name: dirPath,
    async getFileHandle(name: string) {
      const p = pjoin(dirPath, name);
      if (!existsSync(p)) { const e: any = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e; }
      return { kind: 'file', async getFile() { return { async text() { return readFileSync(p, 'utf-8'); } } as any; } };
    },
    async getDirectoryHandle(name: string) { return fsaFromDisk(pjoin(dirPath, name)); },
    async *entries() {
      for (const d of readdirSync(dirPath, { withFileTypes: true })) {
        yield [d.name, { kind: d.isDirectory() ? 'directory' : 'file' }];
      }
    },
  };
}

test('loadDefaultProjectFromFsa loads a REAL default-project incl. data-only defs', { skip: !PACK_AVAILABLE && `pack not found at ${PACK_DIR}` }, async () => {
  const d = await loadDefaultProjectFromFsa(fsaFromDisk(PACK_DIR));
  assert.ok(d.records.size > 100, `expected many records, got ${d.records.size}`);
  // categories that .manifest.json omits must still load via the directory scan
  const keys = [...d.records.keys()];
  assert.ok(keys.some((k) => k.startsWith('hotkey_definitions/')), 'data-only hotkey_definitions loaded');
  // a dotted sidecar dir must NOT have been scanned as definitions
  assert.ok(!keys.some((k) => k.startsWith('.assets/')), '.assets sidecar dir skipped');
});
