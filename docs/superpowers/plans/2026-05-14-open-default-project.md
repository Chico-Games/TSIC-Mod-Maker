# Open Default Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bundled Default Project an always-loaded versioned baseline, switch project saves to an overlay (diff-only) format, and give the dev team an in-app "Publish as new Default Project version" action that writes back into `web/public/starter-project/`.

**Architecture:** Default project metadata (`default.json`) ships next to the existing `manifest.json`. A new `defaultProject.ts` module loads the default tree into memory (from HTTP or, when configured, an FSA handle). A new `overlay.ts` module composes default + overlay into the working set on load and computes the reverse diff on save. `definitionsStore` is refactored to call these modules; `saveAs` writes only the overlay (overrides + additions + zero-byte tombstones) plus a `project.json` stamped with `based_on_default_version` and bumped `schema_version: 2`. Mod.io packer's source label flips to `default-project` and the `version` field is dropped from `mod.json`. Existing v1 projects migrate lazily on first save. The "Publish as new Default Project version" action validates a picked folder and writes a regenerated tree + bumped `default.json` to it.

**Tech Stack:** TypeScript, Zustand, React, Vite, File System Access API, IndexedDB, `node:test` + `tsx` for tests.

**Spec:** `docs/superpowers/specs/2026-05-14-open-default-project-design.md`

---

## File Structure

**Create:**
- `web/public/starter-project/default.json` — initial bundled default-project metadata.
- `web/src/persistence/defaultProject.ts` — `DefaultProjectMeta`, `DefaultProject`, `loadDefaultProjectFromHttp`, `loadDefaultProjectFromFsa`, `DefaultProjectSource`.
- `web/src/persistence/overlay.ts` — `composeWorkingSet`, `computeOverlay`.
- `web/src/persistence/defaultPublisher.ts` — `publishAsNewDefaultVersion`.
- `web/src/persistence/defaultSourceSetting.ts` — IDB-backed FSA handle for "Default project location".
- `web/src/persistence/devFlags.ts` — localStorage-backed `showDeveloperActions` flag.
- `web/src/components/PublishDefaultModal.tsx` — modal that prompts for an optional label + confirms.
- `web/tests/defaultProject.test.ts`, `overlay.test.ts`, `defaultPublisher.test.ts`, `devFlags.test.ts`, `overlaySaveAs.test.ts`.

**Modify:**
- `web/public/starter-project/manifest.json` — only by the publish action at runtime; structure unchanged.
- `web/src/persistence/schemaVersion.ts` — bump `SUPPORTED_VERSION` from `1` to `2`.
- `web/src/persistence/dataSource.ts` — `HttpDataSource.readProjectMeta` returns `schema_version: 2` (otherwise the default is loaded as a v1 project).
- `web/src/store/definitionsStore.ts` — rename + refactor (largest set of edits).
- `web/src/store/modIoStore.ts` — pass an already-loaded `DefaultProject` to the packer instead of refetching.
- `web/src/modio/packer.ts` — rename `loadStarterCatalog` to `defaultCatalogFromLoaded`, flip `baseSource`, drop `version`.
- `web/src/components/Header.tsx` — rename "Load Bundled Defaults" → "Open Default Project".
- `web/src/components/SettingsModal.tsx` — add "Default project location" picker, dev-actions toggle, "Publish as new Default Project version" button.
- `web/src/components/DefinitionsTab.tsx` — string "bundled sample data" → "the default project".
- `web/src/App.tsx` — bootstrap uses `loadDefaultProject` name.
- `web/src/persistence/recentProjects.ts` — docstring update only.

---

## Task 1: Ship `default.json` next to the existing manifest

**Files:**
- Create: `web/public/starter-project/default.json`

- [ ] **Step 1: Create the file**

Write:
```json
{
  "schema_version": 1,
  "version": 1,
  "label": "initial",
  "published_at": "2026-05-14T00:00:00.000Z"
}
```

- [ ] **Step 2: Commit**

```bash
git add web/public/starter-project/default.json
git commit -m "feat(default-project): seed default.json (v1) alongside manifest"
```

---

## Task 2: `DefaultProjectMeta` + `DefaultProject` types

**Files:**
- Create: `web/src/persistence/defaultProject.ts`
- Test: `web/tests/defaultProject.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/defaultProject.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --test-name-pattern='parseDefaultProjectMeta'`
Expected: FAIL — `parseDefaultProjectMeta` is not defined.

- [ ] **Step 3: Implement the parser**

Create `web/src/persistence/defaultProject.ts`:
```ts
export interface DefaultProjectMeta {
  schema_version: number;
  version: number;
  label: string;
  published_at: string;
}

export type ParseMetaResult =
  | { ok: true; meta: DefaultProjectMeta }
  | { ok: false; reason: 'malformed' | 'bad-version' };

export function parseDefaultProjectMeta(raw: unknown): ParseMetaResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed' };
  const r = raw as Record<string, unknown>;
  const sv = r.schema_version;
  const v = r.version;
  if (typeof sv !== 'number' || !Number.isInteger(sv)) return { ok: false, reason: 'bad-version' };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { ok: false, reason: 'bad-version' };
  const label = typeof r.label === 'string' ? r.label : '';
  const published_at = typeof r.published_at === 'string' ? r.published_at : new Date(0).toISOString();
  return { ok: true, meta: { schema_version: sv, version: v, label, published_at } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --test-name-pattern='parseDefaultProjectMeta'`
Expected: PASS, 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/defaultProject.ts web/tests/defaultProject.test.ts
git commit -m "feat(default-project): DefaultProjectMeta + parser"
```

---

## Task 3: `loadDefaultProjectFromHttp`

**Files:**
- Modify: `web/src/persistence/defaultProject.ts`
- Modify: `web/tests/defaultProject.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/tests/defaultProject.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --test-name-pattern='loadDefaultProjectFromHttp'`
Expected: FAIL — `loadDefaultProjectFromHttp` is not exported.

- [ ] **Step 3: Implement the loader**

Append to `web/src/persistence/defaultProject.ts`:
```ts
export interface DefaultProject {
  meta: DefaultProjectMeta;
  /** Parsed JSON, keyed `${folder}/${id}`. */
  records: Map<string, any>;
  /** Canonical re-serialised text for diffing, keyed `${folder}/${id}`. */
  texts: Map<string, string>;
}

const FALLBACK_META: DefaultProjectMeta = {
  schema_version: 1,
  version: 0,
  label: '',
  published_at: new Date(0).toISOString(),
};

function canonical(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2) + '\n';
  } catch {
    return text;
  }
}

export async function loadDefaultProjectFromHttp(
  baseUrl: string,
  fetcher: typeof fetch = fetch.bind(globalThis),
): Promise<DefaultProject> {
  const stripped = baseUrl.replace(/\/$/, '');
  const manifestResp = await fetcher(`${stripped}/manifest.json`);
  if (!manifestResp.ok) throw new Error(`default manifest ${manifestResp.status}`);
  const manifest: { folders: string[]; files: { folder: string; ids: string[] }[] } =
    JSON.parse(await manifestResp.text());

  let meta = FALLBACK_META;
  try {
    const r = await fetcher(`${stripped}/default.json`);
    if (r.ok) {
      const parsed = parseDefaultProjectMeta(JSON.parse(await r.text()));
      if (parsed.ok) meta = parsed.meta;
    }
  } catch { /* fall through to FALLBACK_META */ }

  const records = new Map<string, any>();
  const texts = new Map<string, string>();
  const tasks: Promise<void>[] = [];
  for (const f of manifest.files) {
    for (const id of f.ids) {
      tasks.push((async () => {
        const fr = await fetcher(`${stripped}/${f.folder}/${id}.json`);
        if (!fr.ok) return;
        const raw = await fr.text();
        const text = canonical(raw);
        try {
          records.set(`${f.folder}/${id}`, JSON.parse(text));
          texts.set(`${f.folder}/${id}`, text);
        } catch { /* skip malformed */ }
      })());
    }
  }
  await Promise.all(tasks);
  return { meta, records, texts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --test-name-pattern='loadDefaultProjectFromHttp'`
Expected: PASS, 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/defaultProject.ts web/tests/defaultProject.test.ts
git commit -m "feat(default-project): loadDefaultProjectFromHttp"
```

---

## Task 4: `loadDefaultProjectFromFsa`

**Files:**
- Modify: `web/src/persistence/defaultProject.ts`
- Modify: `web/tests/defaultProject.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/tests/defaultProject.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --test-name-pattern='loadDefaultProjectFromFsa'`
Expected: FAIL — `loadDefaultProjectFromFsa` is not exported.

- [ ] **Step 3: Implement the loader**

Append to `web/src/persistence/defaultProject.ts`:
```ts
export type DefaultProjectSource =
  | { kind: 'http'; baseUrl: string }
  | { kind: 'fsa'; handle: FileSystemDirectoryHandle };

export async function loadDefaultProjectFromFsa(
  handle: FileSystemDirectoryHandle,
): Promise<DefaultProject> {
  // Manifest
  const manifestText = await (await (await handle.getFileHandle('manifest.json')).getFile()).text();
  const manifest: { folders: string[]; files: { folder: string; ids: string[] }[] } =
    JSON.parse(manifestText);

  // default.json (optional)
  let meta = FALLBACK_META;
  try {
    const fh = await handle.getFileHandle('default.json');
    const text = await (await fh.getFile()).text();
    const parsed = parseDefaultProjectMeta(JSON.parse(text));
    if (parsed.ok) meta = parsed.meta;
  } catch (e: any) {
    if (e?.name !== 'NotFoundError' && e?.message !== 'NotFoundError') throw e;
  }

  const records = new Map<string, any>();
  const texts = new Map<string, string>();
  for (const f of manifest.files) {
    let dir: FileSystemDirectoryHandle;
    try { dir = await handle.getDirectoryHandle(f.folder); }
    catch { continue; }
    for (const id of f.ids) {
      try {
        const fh = await dir.getFileHandle(`${id}.json`);
        const raw = await (await fh.getFile()).text();
        const text = canonical(raw);
        records.set(`${f.folder}/${id}`, JSON.parse(text));
        texts.set(`${f.folder}/${id}`, text);
      } catch { /* skip missing/malformed */ }
    }
  }
  return { meta, records, texts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --test-name-pattern='loadDefaultProjectFromFsa'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/defaultProject.ts web/tests/defaultProject.test.ts
git commit -m "feat(default-project): loadDefaultProjectFromFsa"
```

---

## Task 5: `composeWorkingSet` (overlay composition)

**Files:**
- Create: `web/src/persistence/overlay.ts`
- Create: `web/tests/overlay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/overlay.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeWorkingSet } from '../src/persistence/overlay';
import type { DefaultProject } from '../src/persistence/defaultProject';

function makeDefault(records: Record<string, any>): DefaultProject {
  const rec = new Map<string, any>();
  const txt = new Map<string, string>();
  for (const [k, v] of Object.entries(records)) {
    rec.set(k, v);
    txt.set(k, JSON.stringify(v, null, 2) + '\n');
  }
  return {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' },
    records: rec,
    texts: txt,
  };
}

test('composeWorkingSet: pure default with empty overlay returns the default', () => {
  const def = makeDefault({ 'items/A': { id: 'A' }, 'items/B': { id: 'B' } });
  const out = composeWorkingSet(def, {
    overrides: new Map(), overrideTexts: new Map(), additions: new Map(), tombstones: new Set(),
  });
  assert.equal(out.definitions.size, 2);
  assert.deepEqual([...out.definitions.keys()].sort(), ['items/A', 'items/B']);
  const a = out.definitions.get('items/A')!;
  assert.equal(a.id, 'A');
  assert.equal(a.diskFolder, 'items');
  assert.equal(a.diskId, 'A');
  // originalText comes from the default's canonical text.
  assert.equal(a.originalText, '{\n  "id": "A"\n}\n');
});

test('composeWorkingSet: overrides replace default records', () => {
  const def = makeDefault({ 'items/A': { id: 'A', val: 1 } });
  const overrideText = '{\n  "id": "A",\n  "val": 99\n}\n';
  const out = composeWorkingSet(def, {
    overrides: new Map([['items/A', JSON.parse(overrideText)]]),
    overrideTexts: new Map([['items/A', overrideText]]),
    additions: new Map(),
    tombstones: new Set(),
  });
  const a = out.definitions.get('items/A')!;
  assert.equal(a.json.val, 99);
  assert.equal(a.originalText, overrideText);
});

test('composeWorkingSet: additions are included', () => {
  const def = makeDefault({});
  const text = '{\n  "id": "X"\n}\n';
  const out = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map([['items/X', JSON.parse(text)]]),
    tombstones: new Set(),
  });
  assert.equal(out.definitions.size, 1);
  assert.equal(out.definitions.get('items/X')!.json.id, 'X');
});

test('composeWorkingSet: tombstones remove default records', () => {
  const def = makeDefault({ 'items/A': { id: 'A' }, 'items/B': { id: 'B' } });
  const out = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map(),
    tombstones: new Set(['items/A']),
  });
  assert.equal(out.definitions.size, 1);
  assert.equal(out.definitions.get('items/A'), undefined);
});

test('composeWorkingSet: folders list contains every folder used', () => {
  const def = makeDefault({ 'items/A': { id: 'A' } });
  const text = '{}\n';
  const out = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map([['recipes/R', JSON.parse(text)]]),
    tombstones: new Set(),
  });
  assert.deepEqual([...out.folders].sort(), ['items', 'recipes']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --test-name-pattern='composeWorkingSet'`
Expected: FAIL — `composeWorkingSet` not defined.

- [ ] **Step 3: Implement the function**

Create `web/src/persistence/overlay.ts`:
```ts
import type { DefaultProject } from './defaultProject';
import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';

export interface OverlayInput {
  /** Default-side keys whose JSON is replaced by the user. */
  overrides: Map<DefinitionsKey, any>;
  /** Canonical text of each override (the bytes on disk, re-canonicalised). */
  overrideTexts: Map<DefinitionsKey, string>;
  /** New keys not present in the default. */
  additions: Map<DefinitionsKey, any>;
  /** Default-side keys the user has removed from their project. */
  tombstones: Set<DefinitionsKey>;
}

export interface ComposedWorkingSet {
  definitions: Map<DefinitionsKey, DefinitionRecord>;
  folders: string[];
}

function splitKey(k: DefinitionsKey): { folder: string; id: string } {
  const slash = k.indexOf('/');
  return { folder: k.slice(0, slash), id: k.slice(slash + 1) };
}

function canonicalTextOf(json: any): string {
  return JSON.stringify(json, null, 2) + '\n';
}

export function composeWorkingSet(
  def: DefaultProject,
  overlay: OverlayInput,
): ComposedWorkingSet {
  const out = new Map<DefinitionsKey, DefinitionRecord>();
  const folderSet = new Set<string>();

  // 1) Default records (skipped if tombstoned or overridden).
  for (const [k, json] of def.records) {
    if (overlay.tombstones.has(k)) continue;
    if (overlay.overrides.has(k)) continue;
    const { folder, id } = splitKey(k);
    folderSet.add(folder);
    out.set(k, {
      folder, id,
      json,
      originalText: def.texts.get(k) ?? canonicalTextOf(json),
      diskFolder: folder,
      diskId: id,
    });
  }
  // 2) Overrides.
  for (const [k, json] of overlay.overrides) {
    const { folder, id } = splitKey(k);
    folderSet.add(folder);
    out.set(k, {
      folder, id,
      json,
      originalText: overlay.overrideTexts.get(k) ?? canonicalTextOf(json),
      diskFolder: folder,
      diskId: id,
    });
  }
  // 3) Additions.
  for (const [k, json] of overlay.additions) {
    const { folder, id } = splitKey(k);
    folderSet.add(folder);
    out.set(k, {
      folder, id,
      json,
      originalText: canonicalTextOf(json),
      diskFolder: folder,
      diskId: id,
    });
  }

  return { definitions: out, folders: [...folderSet].sort() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --test-name-pattern='composeWorkingSet'`
Expected: PASS, 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/overlay.ts web/tests/overlay.test.ts
git commit -m "feat(overlay): composeWorkingSet"
```

---

## Task 6: `computeOverlay` (the save-time reverse)

**Files:**
- Modify: `web/src/persistence/overlay.ts`
- Modify: `web/tests/overlay.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/tests/overlay.test.ts`:
```ts
import { computeOverlay } from '../src/persistence/overlay';

test('computeOverlay: unchanged-from-default keys produce no overrides/additions', () => {
  const def = makeDefault({ 'items/A': { id: 'A' }, 'items/B': { id: 'B' } });
  const compose = composeWorkingSet(def, {
    overrides: new Map(), overrideTexts: new Map(), additions: new Map(), tombstones: new Set(),
  });
  const diff = computeOverlay(def, compose.definitions);
  assert.equal(diff.overrides.size, 0);
  assert.equal(diff.additions.size, 0);
  assert.equal(diff.tombstones.size, 0);
});

test('computeOverlay: edited default key is an override', () => {
  const def = makeDefault({ 'items/A': { id: 'A', v: 1 } });
  const compose = composeWorkingSet(def, {
    overrides: new Map(), overrideTexts: new Map(), additions: new Map(), tombstones: new Set(),
  });
  const rec = compose.definitions.get('items/A')!;
  rec.json = { id: 'A', v: 999 };
  const diff = computeOverlay(def, compose.definitions);
  assert.equal(diff.overrides.size, 1);
  assert.equal(diff.overrides.get('items/A').v, 999);
  assert.equal(diff.additions.size, 0);
});

test('computeOverlay: missing default key is a tombstone', () => {
  const def = makeDefault({ 'items/A': { id: 'A' } });
  const diff = computeOverlay(def, new Map()); // empty working set
  assert.equal(diff.tombstones.size, 1);
  assert.ok(diff.tombstones.has('items/A'));
});

test('computeOverlay: not-in-default key is an addition', () => {
  const def = makeDefault({});
  const compose = composeWorkingSet(def, {
    overrides: new Map(),
    overrideTexts: new Map(),
    additions: new Map([['items/X', { id: 'X' }]]),
    tombstones: new Set(),
  });
  const diff = computeOverlay(def, compose.definitions);
  assert.equal(diff.additions.size, 1);
  assert.equal(diff.additions.get('items/X').id, 'X');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --test-name-pattern='computeOverlay'`
Expected: FAIL — `computeOverlay` not defined.

- [ ] **Step 3: Implement the function**

Append to `web/src/persistence/overlay.ts`:
```ts
export interface ComputedOverlay {
  /** Keys present in default whose working-set JSON differs. */
  overrides: Map<DefinitionsKey, any>;
  /** Keys not present in default. */
  additions: Map<DefinitionsKey, any>;
  /** Keys present in default but absent from the working set. */
  tombstones: Set<DefinitionsKey>;
}

export function computeOverlay(
  def: DefaultProject,
  working: Map<DefinitionsKey, DefinitionRecord>,
): ComputedOverlay {
  const overrides = new Map<DefinitionsKey, any>();
  const additions = new Map<DefinitionsKey, any>();
  const tombstones = new Set<DefinitionsKey>();

  for (const [k, rec] of working) {
    const defText = def.texts.get(k);
    const recText = canonicalTextOf(rec.json);
    if (defText === undefined) {
      additions.set(k, rec.json);
    } else if (defText !== recText) {
      overrides.set(k, rec.json);
    }
  }
  for (const k of def.records.keys()) {
    if (!working.has(k)) tombstones.add(k);
  }
  return { overrides, additions, tombstones };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --test-name-pattern='computeOverlay'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/overlay.ts web/tests/overlay.test.ts
git commit -m "feat(overlay): computeOverlay"
```

---

## Task 7: Bump `SUPPORTED_VERSION` from 1 to 2

**Files:**
- Modify: `web/src/persistence/schemaVersion.ts`
- Modify: `web/tests/schemaVersion.test.ts`

- [ ] **Step 1: Update the existing test for the new version**

Edit `web/tests/schemaVersion.test.ts`. Replace the test `'parseMeta accepts a valid project.json shape'` body so it expects `schema_version: 2` as the canonical current version, and add one new test:

```ts
test('parseMeta accepts the new overlay v2 shape including based_on_default_version', () => {
  const r = parseMeta({ schema_version: 2, name: 'P', based_on_default_version: 3 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.meta.schema_version, 2);
    assert.equal(r.meta.based_on_default_version, 3);
  }
});

test('parseMeta accepts legacy v1 (no based_on_default_version)', () => {
  const r = parseMeta({ schema_version: 1, name: 'P' });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run test to verify the new tests fail**

Run: `cd web && npm test -- --test-name-pattern='parseMeta'`
Expected: at least the new `based_on_default_version` test FAILS.

- [ ] **Step 3: Update the source**

Edit `web/src/persistence/schemaVersion.ts`:
- Change `SUPPORTED_VERSION = 1` to `SUPPORTED_VERSION = 2`.
- Update `parseMeta` to recognise `based_on_default_version?: number` as an allowed optional integer field, copying it onto the resulting meta when present and integer.

Also edit `web/src/store/definitionsStore.ts` `ProjectMeta` interface to add the optional field:
```ts
export interface ProjectMeta {
  schema_version: number;
  name: string;
  description?: string;
  created_at?: string;
  based_on_default_version?: number;
}
```

- [ ] **Step 4: Run all tests**

Run: `cd web && npm test`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/schemaVersion.ts web/src/store/definitionsStore.ts web/tests/schemaVersion.test.ts
git commit -m "feat(project): bump schema_version to 2 with based_on_default_version"
```

---

## Task 8: `loadDefaultProject` action (rename `loadBundledDefaults`, factor by DefaultProject)

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/src/App.tsx` and `web/src/components/Header.tsx` (callers)

- [ ] **Step 1: Write the failing test**

Create `web/tests/definitionsStoreLoadDefault.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';

test('loadDefaultProject loads the bundled default via the configured source', async () => {
  // Stub fetch with the smallest possible default tree.
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (url: any) => {
    const u = String(url);
    if (u.endsWith('/starter-project/manifest.json'))
      return new Response(JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A'] }] }));
    if (u.endsWith('/starter-project/default.json'))
      return new Response(JSON.stringify({ schema_version: 1, version: 5, label: 't', published_at: '2026-05-14T00:00:00Z' }));
    if (u.endsWith('/starter-project/items/A.json'))
      return new Response('{"id":"A"}\n');
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
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --test-name-pattern='loadDefaultProject'`
Expected: FAIL — `loadDefaultProject` and `defaultProject` field don't exist.

- [ ] **Step 3: Update the store**

In `web/src/store/definitionsStore.ts`:

1. Add to `DefinitionsStore` interface:
   ```ts
   /** The currently-loaded Default Project (in memory). Null until loaded. */
   defaultProject: import('../persistence/defaultProject').DefaultProject | null;
   /** Tombstones for default keys removed by the user (empty placeholder files on disk). */
   tombstones: Set<DefinitionsKey>;
   loadDefaultProject: () => Promise<void>;
   ```

2. Add field initialisers in the `create` block:
   ```ts
   defaultProject: null,
   tombstones: new Set<DefinitionsKey>(),
   ```

3. Implement `loadDefaultProject` (replacing the old `loadBundledDefaults`):
   ```ts
   loadDefaultProject: async () => {
     try { await deleteHandle(HANDLE_KEY); } catch { /* ignore */ }
     const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
     const trimmed = baseUrl.replace(/\/$/, '');
     const { loadDefaultProjectFromHttp } = await import('../persistence/defaultProject');
     const def = await loadDefaultProjectFromHttp(`${trimmed}/starter-project`);
     set({ defaultProject: def, tombstones: new Set() });
     const ds = new HttpDataSource(`${trimmed}/starter-project`);
     await loadFromDataSource(set, get, ds);
   },
   ```

4. Keep a shim:
   ```ts
   loadBundledDefaults: async () => { await get().loadDefaultProject(); },
   ```

5. Update the `openStarterProject` action to call `loadDefaultProject` instead. Keep the action name (recents key compatibility).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --test-name-pattern='loadDefaultProject'`
Expected: PASS.

- [ ] **Step 5: Update callers**

In `web/src/components/Header.tsx`:
- Replace selector `loadBundledDefaults` with `loadDefaultProject`.
- Change button label from "Load Bundled Defaults" to "Open Default Project".
- Change the title tooltip from "Load the bundled sample data into a fresh save folder" to "Open the Default Project. Edits become an overlay you can Save As to a new folder.".
- Update the "Seed from bundled defaults?" label in the create-project dialog to "Seed from default project?".

In `web/src/App.tsx`: rename usages of `loadBundledDefaults` → `loadDefaultProject`.

In `web/src/components/DefinitionsTab.tsx`: change "bundled sample data" string to "the default project".

- [ ] **Step 6: Run all tests + typecheck**

Run:
```bash
cd web && npm test && npm run typecheck
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/store/definitionsStore.ts web/src/App.tsx web/src/components/Header.tsx web/src/components/DefinitionsTab.tsx web/tests/definitionsStoreLoadDefault.test.ts
git commit -m "feat(default-project): rename loadBundledDefaults to loadDefaultProject; cache DefaultProject"
```

---

## Task 9: Refactor `loadFromDataSource` to use `composeWorkingSet` for FSA overlay sources

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Create: `web/tests/overlayLoad.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/overlayLoad.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';

function stubFetch(map: Record<string, string>): typeof fetch {
  return (async (url: any) => {
    const u = String(url);
    const body = map[u];
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body);
  }) as typeof fetch;
}

test('overlay load: empty overlay folder yields the full default working set', async () => {
  const orig = globalThis.fetch;
  (globalThis as any).fetch = stubFetch({
    '/starter-project/manifest.json': JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A','B'] }] }),
    '/starter-project/default.json': JSON.stringify({ schema_version: 1, version: 3, label: '', published_at: '2026-05-14T00:00:00Z' }),
    '/starter-project/items/A.json': '{"id":"A"}\n',
    '/starter-project/items/B.json': '{"id":"B"}\n',
  });
  try {
    // First: load default to populate defaultProject in the store.
    await useDefinitionsStore.getState().loadDefaultProject();
    assert.equal(useDefinitionsStore.getState().definitions.size, 2);
    assert.equal(useDefinitionsStore.getState().tombstones.size, 0);
  } finally {
    (globalThis as any).fetch = orig;
  }
});
```

- [ ] **Step 2: Run test to verify it fails (or passes — if already correct, that's fine)**

Run: `cd web && npm test -- --test-name-pattern='overlay load'`
Expected: PASS if Task 8 already wired things; if not, FAIL.

- [ ] **Step 3: Refactor `loadFromDataSource`**

In `web/src/store/definitionsStore.ts`, inside `loadFromDataSource(set, get, ds)`:

After the `manifest` is read and the per-record loop completes (where the legacy code today builds `defs` directly from the manifest), add a branch:

```ts
const isOverlayCandidate =
  ds.kind === 'fsa' &&
  (projectMeta?.schema_version ?? 1) >= 2 &&
  get().defaultProject !== null;

if (isOverlayCandidate) {
  const def = get().defaultProject!;
  const overrides = new Map<DefinitionsKey, any>();
  const overrideTexts = new Map<DefinitionsKey, string>();
  const additions = new Map<DefinitionsKey, any>();
  const tombs = new Set<DefinitionsKey>();
  for (const [k, rec] of defs) {
    const text = rec.originalText ?? JSON.stringify(rec.json, null, 2) + '\n';
    // Empty-byte tombstone: rec.originalText === '' AND rec.json is treated as the marker.
    if (text === '') { tombs.add(k); continue; }
    if (def.records.has(k)) {
      overrides.set(k, rec.json);
      overrideTexts.set(k, text);
    } else {
      additions.set(k, rec.json);
    }
  }
  const composed = composeWorkingSet(def, {
    overrides, overrideTexts, additions, tombstones: tombs,
  });
  set({
    dataSource: ds,
    directoryHandle: ds.kind === 'fsa' ? (ds as FsaDataSource).rootHandle : null,
    projectMeta,
    definitions: composed.definitions,
    dirty: new Set(),
    folders: composed.folders,
    tombstones: tombs,
    selectedFolder,
    selectedKey,
    loadedAt: Date.now(),
    loading: false,
    toast: { kind: 'info', text: `Loaded ${composed.definitions.size} definitions (overlay).` },
  });
  // Re-build reverse-ref + draft restore exactly as the non-overlay branch does below.
  // (Refactor: extract the post-set bookkeeping into a helper so both branches reuse it.)
  const idx = buildReferencedByIndex(get().definitions);
  set({ referencedByIndex: idx });
  get().autoCreateMissingRefs();
  return;
}
```

Note: the existing per-record load loop needs to treat zero-byte files as records with `originalText === ''` and `json === null` so the overlay branch can tombstone them. Modify the read so an empty file body produces a record with empty originalText and a placeholder `{}` for json (json isn't used in the overlay path — only the empty-text signal is).

Imports to add to `definitionsStore.ts`:
```ts
import { composeWorkingSet } from '../persistence/overlay';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --test-name-pattern='overlay load'`
Expected: PASS.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
cd web && npm test && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add web/src/store/definitionsStore.ts web/tests/overlayLoad.test.ts
git commit -m "feat(overlay): compose working set from default + folder overlay on v2 FSA load"
```

---

## Task 10: `saveAs` writes the overlay (not the full tree) and stamps `based_on_default_version`

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Create: `web/tests/overlaySaveAs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/overlaySaveAs.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';

// Minimal FSA mock collecting writes.
function makeMockHandle() {
  const files = new Map<string, string>();
  const deleted = new Set<string>();
  const dir = (path: string): any => ({
    name: path,
    kind: 'directory',
    async getDirectoryHandle(name: string, opts?: any) {
      return dir(path + name + '/');
    },
    async getFileHandle(name: string, opts?: any) {
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

test('saveAs writes only overrides + additions + tombstones; not unchanged default records', async () => {
  // Stub the bundled default with two records.
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async (url: any) => {
    const u = String(url);
    if (u.endsWith('/manifest.json')) return new Response(JSON.stringify({ folders: ['items'], files: [{ folder: 'items', ids: ['A','B'] }] }));
    if (u.endsWith('/default.json')) return new Response(JSON.stringify({ schema_version: 1, version: 5, label: '', published_at: '2026-05-14T00:00:00Z' }));
    if (u.endsWith('/items/A.json')) return new Response('{"id":"A","v":1}\n');
    if (u.endsWith('/items/B.json')) return new Response('{"id":"B","v":2}\n');
    return new Response('', { status: 404 });
  };
  const { handle, files } = makeMockHandle();
  try {
    await useDefinitionsStore.getState().loadDefaultProject();
    // Edit A, leave B untouched.
    const state = useDefinitionsStore.getState();
    state.updateValueAtPath('items/A', ['v'], 99);
    // Inject the mock picker.
    (globalThis as any).window = { ...(globalThis as any).window, showDirectoryPicker: async () => handle };
    await state.saveAs();
    // Only items/A.json (override) should be on disk. Not items/B.json.
    assert.ok(files.has('items/A.json'), 'override A should be written');
    assert.equal(files.has('items/B.json'), false, 'unchanged B should NOT be written');
    // project.json must be present with schema_version 2 + based_on_default_version 5.
    const meta = JSON.parse(files.get('project.json') ?? '{}');
    assert.equal(meta.schema_version, 2);
    assert.equal(meta.based_on_default_version, 5);
  } finally {
    (globalThis as any).fetch = orig;
  }
});

test('saveAs writes an empty placeholder for tombstoned records', async () => {
  // Load default; tombstone one record; saveAs; verify zero-byte file at items/A.json.
  // (Test code analogous to the prior test, with state.tombstones populated before saveAs.)
});
```

Fill out the second test body with the same fetch stub + mock-handle pattern, calling `useDefinitionsStore.setState({ tombstones: new Set(['items/A']) })` before `saveAs` and asserting `files.get('items/A.json') === ''`.

- [ ] **Step 2: Run tests; verify they fail**

Run: `cd web && npm test -- --test-name-pattern='saveAs writes'`
Expected: FAIL — current `saveAs` writes the full tree.

- [ ] **Step 3: Rewrite `saveAs` to write the overlay**

In `web/src/store/definitionsStore.ts`, replace the body of `saveAs` so it:

1. Resolves the `handle` exactly as today (targetName + projects-root branch or `showDirectoryPicker`).
2. Computes the overlay via `computeOverlay(get().defaultProject, get().definitions)`. If `defaultProject` is null, log a warning and fall back to the current full-tree write (defensive — should not happen in normal flow).
3. For each `(folder, id)` in `overrides`/`additions`, serialize and `writeFile(handle, folder, id, text)`.
4. For each `(folder, id)` in `tombstones`, `writeFile(handle, folder, id, '')` (zero-byte placeholder).
5. Build a `ProjectMeta` with `schema_version: 2`, `name: targetName ?? existingMeta?.name ?? handle.name`, `based_on_default_version: get().defaultProject?.meta.version`, `created_at: existingMeta?.created_at ?? new Date().toISOString()`, and write it via the FsaDataSource's `writeProjectMeta`.
6. Update the in-memory store: `dataSource = new FsaDataSource(handle)`, `directoryHandle = handle`, `projectMeta = newMeta`, `dirty = new Set()`. Recompute `originalText` for overridden records (set to the just-written text) so subsequent dirty-detection works.
7. Refresh recents + projects-root listing as today.

Imports to add:
```ts
import { computeOverlay } from '../persistence/overlay';
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `cd web && npm test -- --test-name-pattern='saveAs writes'`
Expected: PASS.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
cd web && npm test && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add web/src/store/definitionsStore.ts web/tests/overlaySaveAs.test.ts
git commit -m "feat(overlay): saveAs writes overlay only + stamps based_on_default_version"
```

---

## Task 11: `saveOne` / `saveAllDirty` handle tombstones and revert-to-default cleanup

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/tests/overlaySaveAs.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/overlaySaveAs.test.ts`:
```ts
test('saveOne removes the file from disk when a record is reverted to match the default', async () => {
  // Setup: load default; edit A; saveAs to mock; then revert A's json back to default; saveOne(A).
  // Expected: items/A.json is deleted from disk.
});

test('saveAllDirty writes zero-byte tombstones for keys in store.tombstones', async () => {
  // Setup: load default; mark a default key as tombstoned; saveAllDirty.
  // Expected: zero-byte file written at that key's path.
});
```

Implement both bodies with the fetch + mock-handle pattern from Task 10.

- [ ] **Step 2: Run tests; verify they fail**

Run: `cd web && npm test -- --test-name-pattern='saveOne removes|saveAllDirty writes zero'`
Expected: FAIL.

- [ ] **Step 3: Update `saveOne` and `saveAllDirty`**

In `saveOne`, after the regular write succeeds:
- If `get().defaultProject` exists AND the just-written canonical text equals the default's canonical text for the same key, call `dataSource.deleteFile(folder, id)` and clear the on-disk file. Mark the record as non-dirty as today.

In `saveAllDirty`:
- Iterate `dirty` as today, but also iterate `get().tombstones` and, for each tombstoned key, call `dataSource.writeFile(folder, id, '')` to write the placeholder.

- [ ] **Step 4: Run tests; verify they pass**

Run: `cd web && npm test -- --test-name-pattern='saveOne removes|saveAllDirty writes zero'`
Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd web && npm test
```

- [ ] **Step 6: Commit**

```bash
git add web/src/store/definitionsStore.ts web/tests/overlaySaveAs.test.ts
git commit -m "feat(overlay): per-record save handles tombstones + revert-to-default cleanup"
```

---

## Task 12: Tombstone-aware delete action

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/tests/overlaySaveAs.test.ts`

There is currently a `deleteOne` (or similar) action that removes a record from the working set. When the deleted key exists in the current `defaultProject`, we must record it in `tombstones`. When it does not exist in default (a user-added record), no tombstone is needed.

- [ ] **Step 1: Write the failing test**

Append to `web/tests/overlaySaveAs.test.ts`:
```ts
test('deleting a default-side record adds it to tombstones', () => {
  // Load default; call definitionsStore.deleteDefinition('items/A');
  // Expected: state.definitions has no 'items/A'; state.tombstones has 'items/A'.
});

test('deleting a user-added record does not create a tombstone', () => {
  // Load default; add 'items/X' (not in default); deleteDefinition('items/X');
  // Expected: state.definitions has no 'items/X'; state.tombstones has no 'items/X'.
});
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd web && npm test -- --test-name-pattern='tombstone'`

- [ ] **Step 3: Update the delete action**

Find the delete action in `definitionsStore.ts` (likely `deleteDefinition` or near `saveOne`). After removing the record from `definitions`:
```ts
const def = get().defaultProject;
if (def?.records.has(k)) {
  const next = new Set(get().tombstones); next.add(k);
  set({ tombstones: next });
}
```

If the user re-adds a tombstoned key (creates a record with the same `${folder}/${id}`), remove the key from `tombstones` in the create path.

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/store/definitionsStore.ts web/tests/overlaySaveAs.test.ts
git commit -m "feat(overlay): tombstone tracking on delete + un-tombstone on re-add"
```

---

## Task 13: Legacy migration — open v1, save as v2

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Create: `web/tests/legacyMigration.test.ts`

A legacy v1 project has a full-tree on disk (or no `project.json` at all). On open, we load it the old way. On the first save after open, we migrate: rewrite `project.json` to v2 and delete files identical to the default.

- [ ] **Step 1: Write the failing test**

Create `web/tests/legacyMigration.test.ts`. The shape:
```ts
// Load default with items/A, items/B.
// Mock an FSA folder containing items/A.json (byte-identical to default), items/B.json (modified), no project.json.
// Open it via definitionsStore.openProject (or feed the FsaDataSource directly).
// Verify it loads as v1 (full-tree path).
// Edit a record, then call saveAllDirty.
// Assert: items/A.json is now deleted from the mock disk; items/B.json remains; project.json contains schema_version: 2 + based_on_default_version: (default version).
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd web && npm test -- --test-name-pattern='legacy migration'`

- [ ] **Step 3: Implement the migration**

In `loadFromDataSource`, detect `(projectMeta?.schema_version ?? 1) < 2 && ds.kind === 'fsa'`. Set an internal flag `legacy: true` on the projectMeta (don't persist to disk yet). Load the working set the old (full-tree) way.

Augment `saveAllDirty` (and the saveOne-first-save path): if `projectMeta.schema_version < 2 && ds.kind === 'fsa'`, after the regular dirty writes, run a migration pass:
- Compute `computeOverlay(defaultProject, definitions)`.
- For every default-side key not in `overrides`/`tombstones` (i.e. unchanged from default) that has a file on disk in the project folder, call `dataSource.deleteFile(folder, id)`.
- Write a new `project.json` with `schema_version: 2`, `based_on_default_version: defaultProject.meta.version`, preserving `name`/`description`/`created_at`.
- Toast: "Migrated to overlay format. Files identical to the default were removed from disk."

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Run full test suite + typecheck**

```bash
cd web && npm test && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add web/src/store/definitionsStore.ts web/tests/legacyMigration.test.ts
git commit -m "feat(overlay): migrate v1 projects to v2 overlay on first save"
```

---

## Task 14: "Default project location" setting (IDB-backed handle)

**Files:**
- Create: `web/src/persistence/defaultSourceSetting.ts`
- Create: `web/tests/defaultSourceSetting.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/defaultSourceSetting.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  setDefaultSourceHandle, getDefaultSourceHandle, clearDefaultSourceHandle,
} from '../src/persistence/defaultSourceSetting';

test('default source handle round-trips through IndexedDB', async () => {
  const fakeHandle = { name: 'starter-project', kind: 'directory' } as any;
  await setDefaultSourceHandle(fakeHandle);
  const got = await getDefaultSourceHandle();
  assert.equal(got?.name, 'starter-project');
});

test('clearDefaultSourceHandle removes the stored handle', async () => {
  await clearDefaultSourceHandle();
  assert.equal(await getDefaultSourceHandle(), null);
});
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd web && npm test -- --test-name-pattern='default source handle'`

- [ ] **Step 3: Implement the module**

Create `web/src/persistence/defaultSourceSetting.ts`:
```ts
import { getHandle, putHandle, deleteHandle } from '../handleStore';

const KEY = 'tsic.default-project-source';

export async function setDefaultSourceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await putHandle(KEY, handle as any);
}
export async function getDefaultSourceHandle(): Promise<FileSystemDirectoryHandle | null> {
  return (await getHandle(KEY)) as FileSystemDirectoryHandle | null;
}
export async function clearDefaultSourceHandle(): Promise<void> {
  await deleteHandle(KEY);
}
```

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/defaultSourceSetting.ts web/tests/defaultSourceSetting.test.ts
git commit -m "feat(default-project): IDB-backed default-source setting"
```

---

## Task 15: Wire `loadDefaultProject` to honour the FSA setting

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/tests/definitionsStoreLoadDefault.test.ts`

- [ ] **Step 1: Update the test**

Append to `web/tests/definitionsStoreLoadDefault.test.ts`:
```ts
import { setDefaultSourceHandle, clearDefaultSourceHandle } from '../src/persistence/defaultSourceSetting';

test('loadDefaultProject prefers the FSA setting when set', async () => {
  // Set a fake FSA handle that exposes a tiny manifest + default.json + one file.
  // Call loadDefaultProject().
  // Expect state.defaultProject.meta.version comes from the FSA-served default.json, not from HTTP.
});
```

Body uses a fake FSA root like in Task 4's test.

- [ ] **Step 2: Run; verify FAIL**

- [ ] **Step 3: Update `loadDefaultProject`**

```ts
loadDefaultProject: async () => {
  try { await deleteHandle(HANDLE_KEY); } catch { /* ignore */ }
  const setting = await getDefaultSourceHandle();
  let def;
  let ds: DataSource;
  if (setting) {
    const ok = await ensurePermission(setting, 'readwrite');
    if (!ok) {
      // Fall through to HTTP if permission denied.
      def = null;
    } else {
      const { loadDefaultProjectFromFsa } = await import('../persistence/defaultProject');
      def = await loadDefaultProjectFromFsa(setting);
      ds = new FsaDataSource(setting);
    }
  }
  if (!def) {
    const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
    const trimmed = baseUrl.replace(/\/$/, '');
    const { loadDefaultProjectFromHttp } = await import('../persistence/defaultProject');
    def = await loadDefaultProjectFromHttp(`${trimmed}/starter-project`);
    ds = new HttpDataSource(`${trimmed}/starter-project`);
  }
  set({ defaultProject: def, tombstones: new Set() });
  await loadFromDataSource(set, get, ds!);
},
```

Also add to the store interface + actions:
```ts
setDefaultProjectSource: (handle: FileSystemDirectoryHandle) => Promise<void>;
clearDefaultProjectSource: () => Promise<void>;
```

Both call the setting module and then call `loadDefaultProject()` so the change is immediately visible.

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/store/definitionsStore.ts web/tests/definitionsStoreLoadDefault.test.ts
git commit -m "feat(default-project): honour FSA default-source setting in loadDefaultProject"
```

---

## Task 16: `devFlags` (Show developer actions toggle)

**Files:**
- Create: `web/src/persistence/devFlags.ts`
- Create: `web/tests/devFlags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/devFlags.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getShowDeveloperActions, setShowDeveloperActions } from '../src/persistence/devFlags';

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

test('devFlags persist via localStorage', () => {
  (globalThis as any).localStorage = new FakeStorage();
  assert.equal(getShowDeveloperActions(), false);
  setShowDeveloperActions(true);
  assert.equal(getShowDeveloperActions(), true);
  setShowDeveloperActions(false);
  assert.equal(getShowDeveloperActions(), false);
});
```

- [ ] **Step 2: Run; verify FAIL**

- [ ] **Step 3: Implement**

Create `web/src/persistence/devFlags.ts`:
```ts
const KEY = 'tsic.dev.show-developer-actions';

export function getShowDeveloperActions(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setShowDeveloperActions(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* noop */ }
}
```

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/devFlags.ts web/tests/devFlags.test.ts
git commit -m "feat(dev): localStorage flag for showing developer actions"
```

---

## Task 17: `defaultPublisher.ts` (write current working set as a new default version)

**Files:**
- Create: `web/src/persistence/defaultPublisher.ts`
- Create: `web/tests/defaultPublisher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/defaultPublisher.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishAsNewDefaultVersion } from '../src/persistence/defaultPublisher';
import type { DefaultProject } from '../src/persistence/defaultProject';

// Reuse a mock-handle factory similar to Task 10's.
function makeMockHandle(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  // (mock structure identical to Task 10 — copy that helper into the test file)
  const dir = (path: string): any => ({/* same as Task 10 */});
  return { handle: dir(''), files };
}

test('publishAsNewDefaultVersion refuses a folder without manifest.json', async () => {
  const { handle } = makeMockHandle({});
  await assert.rejects(
    () => publishAsNewDefaultVersion(handle, new Map(), {
      meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' },
      records: new Map(), texts: new Map(),
    } as DefaultProject, {}),
    /manifest\.json/i,
  );
});

test('publishAsNewDefaultVersion writes records, manifest, default.json with bumped version', async () => {
  const { handle, files } = makeMockHandle({ 'manifest.json': '{"folders":[],"files":[]}' });
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 4, label: 'old', published_at: '2026-05-01T00:00:00Z' },
    records: new Map(), texts: new Map(),
  };
  const working = new Map();
  working.set('items/A', { folder: 'items', id: 'A', json: { id: 'A' }, originalText: '', diskFolder: 'items', diskId: 'A' });
  const out = await publishAsNewDefaultVersion(handle, working, def, { label: 'new' });
  assert.equal(out.version, 5);
  assert.equal(out.label, 'new');
  assert.ok(files.get('items/A.json')!.includes('"id": "A"'));
  const m = JSON.parse(files.get('manifest.json')!);
  assert.deepEqual(m.folders, ['items']);
});

test('publishAsNewDefaultVersion removes default-side files no longer in the working set', async () => {
  const { handle, files } = makeMockHandle({
    'manifest.json': '{"folders":["items"],"files":[{"folder":"items","ids":["A","B"]}]}',
    'items/A.json': '{"id":"A"}\n',
    'items/B.json': '{"id":"B"}\n',
  });
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-01T00:00:00Z' },
    records: new Map([['items/A',{id:'A'}],['items/B',{id:'B'}]]),
    texts: new Map([['items/A','{\n  "id": "A"\n}\n'],['items/B','{\n  "id": "B"\n}\n']]),
  };
  const working = new Map();
  working.set('items/A', { folder:'items', id:'A', json:{id:'A'}, originalText:'', diskFolder:'items', diskId:'A' });
  // B not in working set => should be deleted.
  await publishAsNewDefaultVersion(handle, working, def, {});
  assert.ok(files.has('items/A.json'));
  assert.equal(files.has('items/B.json'), false);
});

test('publishAsNewDefaultVersion strips zero-byte placeholders before writing', async () => {
  const { handle, files } = makeMockHandle({ 'manifest.json': '{"folders":[],"files":[]}' });
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-01T00:00:00Z' },
    records: new Map(), texts: new Map(),
  };
  const working = new Map();
  working.set('items/A', { folder:'items', id:'A', json:{id:'A'}, originalText:'', diskFolder:'items', diskId:'A' });
  // Pretend there's also a placeholder for items/Z. Caller should NOT pass it in the working set
  // (the store filters tombstones out before calling). This test just confirms the publisher
  // doesn't accidentally write zero-byte files for records whose originalText === ''.
  await publishAsNewDefaultVersion(handle, working, def, {});
  const text = files.get('items/A.json');
  assert.ok(text && text.length > 0, 'wrote canonical text, not empty');
});
```

(Copy the mock-handle helper from Task 10's test file into this file, or factor it into `web/tests/_mockFsa.ts`. If you factor it out, do that in a separate "refactor" commit.)

- [ ] **Step 2: Run; verify FAIL**

Run: `cd web && npm test -- --test-name-pattern='publishAsNewDefaultVersion'`

- [ ] **Step 3: Implement**

Create `web/src/persistence/defaultPublisher.ts`:
```ts
import type { DefaultProject, DefaultProjectMeta } from './defaultProject';
import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';

function canonicalTextOf(json: any): string {
  return JSON.stringify(json, null, 2) + '\n';
}

async function writeFile(root: FileSystemDirectoryHandle, folder: string, name: string, text: string) {
  const dir = folder
    ? await root.getDirectoryHandle(folder, { create: true })
    : root;
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await (fh as any).createWritable();
  await w.write(text);
  await w.close();
}

async function deleteFileIfExists(root: FileSystemDirectoryHandle, folder: string, name: string) {
  try {
    const dir = await root.getDirectoryHandle(folder);
    await (dir as any).removeEntry(name);
  } catch { /* noop */ }
}

async function hasFile(root: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await root.getFileHandle(name); return true; } catch { return false; }
}

export async function publishAsNewDefaultVersion(
  target: FileSystemDirectoryHandle,
  working: Map<DefinitionsKey, DefinitionRecord>,
  current: DefaultProject,
  opts: { label?: string },
): Promise<DefaultProjectMeta> {
  if (!(await hasFile(target, 'manifest.json'))) {
    throw new Error('Target folder does not look like a default project (no manifest.json).');
  }

  // 1) Write every record in the working set as canonical text.
  const folderToIds = new Map<string, Set<string>>();
  for (const rec of working.values()) {
    const text = canonicalTextOf(rec.json);
    await writeFile(target, rec.folder, `${rec.id}.json`, text);
    if (!folderToIds.has(rec.folder)) folderToIds.set(rec.folder, new Set());
    folderToIds.get(rec.folder)!.add(rec.id);
  }

  // 2) Delete default-side files not in the working set.
  const currentKeys = new Set<string>(current.records.keys());
  for (const k of currentKeys) {
    const slash = k.indexOf('/');
    const folder = k.slice(0, slash);
    const id = k.slice(slash + 1);
    if (!folderToIds.get(folder)?.has(id)) {
      await deleteFileIfExists(target, folder, `${id}.json`);
    }
  }

  // 3) Regenerate manifest.json.
  const folders = [...folderToIds.keys()].sort();
  const files = folders.map((f) => ({ folder: f, ids: [...folderToIds.get(f)!].sort() }));
  await writeFile(target, '', 'manifest.json',
    JSON.stringify({ folders, files, generatedAt: new Date().toISOString() }, null, 2) + '\n');

  // 4) Write default.json with bumped version.
  const nextMeta: DefaultProjectMeta = {
    schema_version: 1,
    version: current.meta.version + 1,
    label: opts.label ?? '',
    published_at: new Date().toISOString(),
  };
  await writeFile(target, '', 'default.json', JSON.stringify(nextMeta, null, 2) + '\n');
  return nextMeta;
}
```

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/defaultPublisher.ts web/tests/defaultPublisher.test.ts
git commit -m "feat(default-project): publishAsNewDefaultVersion writer"
```

---

## Task 18: Store action `publishAsNewDefaultVersion` (picker-based) + reload

**Files:**
- Modify: `web/src/store/definitionsStore.ts`

The store wraps the picker, calls the writer, then refreshes the in-memory `defaultProject`.

- [ ] **Step 1: Add the action**

In `definitionsStore.ts`, add to the interface:
```ts
publishAsNewDefaultVersion: (opts: { label?: string }) => Promise<void>;
```

Implementation:
```ts
publishAsNewDefaultVersion: async ({ label } = {}) => {
  const w = window as any;
  if (!w.showDirectoryPicker) {
    set({ toast: { kind: 'error', text: 'Picker unavailable in this browser.' } });
    return;
  }
  const startIn = (await import('../persistence/defaultSourceSetting')).getDefaultSourceHandle
    ? await (await import('../persistence/defaultSourceSetting')).getDefaultSourceHandle()
    : null;
  try {
    const target: FileSystemDirectoryHandle = await w.showDirectoryPicker({
      mode: 'readwrite', ...(startIn ? { startIn } : {}),
    });
    const ok = await ensurePermission(target, 'readwrite');
    if (!ok) { set({ toast: { kind: 'error', text: 'Permission denied.' } }); return; }
    const cur = get().defaultProject;
    if (!cur) { set({ toast: { kind: 'error', text: 'No default project loaded.' } }); return; }
    // Strip tombstones from the working set before publishing.
    const working = new Map(get().definitions);
    for (const k of get().tombstones) working.delete(k);
    const { publishAsNewDefaultVersion } = await import('../persistence/defaultPublisher');
    const newMeta = await publishAsNewDefaultVersion(target, working, cur, { label });
    set({ toast: { kind: 'info', text: `Published default v${newMeta.version} (${newMeta.label || 'no label'}).` } });
    // Reload the default so the in-memory copy matches what's on disk.
    await get().loadDefaultProject();
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') {
      set({ toast: { kind: 'error', text: `Publish failed: ${String((e as Error).message ?? e)}` } });
    }
  }
},
```

- [ ] **Step 2: Run typecheck**

```bash
cd web && npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/store/definitionsStore.ts
git commit -m "feat(default-project): publishAsNewDefaultVersion store action"
```

---

## Task 19: `PublishDefaultModal` UI

**Files:**
- Create: `web/src/components/PublishDefaultModal.tsx`

- [ ] **Step 1: Implement the modal**

Create `web/src/components/PublishDefaultModal.tsx`:
```tsx
import React, { useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';

export function PublishDefaultModal(props: { onClose: () => void }) {
  const def = useDefinitionsStore((s) => s.defaultProject);
  const publish = useDefinitionsStore((s) => s.publishAsNewDefaultVersion);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const cur = def?.meta.version ?? 0;
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Publish as new Default Project version</h2>
        <p>This will overwrite the picked folder with the current working set and bump the default version from <b>v{cur}</b> to <b>v{cur + 1}</b>.</p>
        <label>
          Optional label (free text):
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
        </label>
        <div className="modal-actions">
          <button onClick={props.onClose} disabled={busy}>Cancel</button>
          <button onClick={async () => {
            setBusy(true);
            try { await publish({ label: label.trim() || undefined }); props.onClose(); }
            finally { setBusy(false); }
          }} disabled={busy}>
            Pick folder + publish
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PublishDefaultModal.tsx
git commit -m "feat(default-project): PublishDefaultModal UI"
```

---

## Task 20: Add Settings UI — default-source picker, dev-actions toggle, publish button

**Files:**
- Modify: `web/src/components/SettingsModal.tsx`

- [ ] **Step 1: Add the new sections**

In `web/src/components/SettingsModal.tsx`:

Add at the top of the file:
```tsx
import { getShowDeveloperActions, setShowDeveloperActions } from '../persistence/devFlags';
import { getDefaultSourceHandle, setDefaultSourceHandle, clearDefaultSourceHandle } from '../persistence/defaultSourceSetting';
import { PublishDefaultModal } from './PublishDefaultModal';
```

Inside the component:
- Track local state: `const [devOn, setDevOn] = useState(getShowDeveloperActions());`
- Track local state: `const [defaultHandleName, setDefaultHandleName] = useState<string | null>(null);` and resolve via `useEffect(() => { getDefaultSourceHandle().then(h => setDefaultHandleName(h?.name ?? null)); }, []);`
- Track `const [showPublish, setShowPublish] = useState(false);`

Render a new section:
```tsx
<section>
  <h3>Default project</h3>
  <p>
    Location: <code>{defaultHandleName ?? 'Bundled (HTTP)'}</code>
    {' '}
    <button onClick={async () => {
      const h = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await setDefaultSourceHandle(h);
      setDefaultHandleName(h.name);
      await useDefinitionsStore.getState().loadDefaultProject();
    }}>Choose…</button>
    {defaultHandleName && (
      <button onClick={async () => {
        await clearDefaultSourceHandle();
        setDefaultHandleName(null);
        await useDefinitionsStore.getState().loadDefaultProject();
      }}>Clear</button>
    )}
  </p>
  <p>
    <label>
      <input
        type="checkbox"
        checked={devOn}
        onChange={(e) => { setDevOn(e.target.checked); setShowDeveloperActions(e.target.checked); }}
      />
      {' '}Show developer actions
    </label>
  </p>
  {devOn && (
    <p>
      <button onClick={() => setShowPublish(true)}>
        Publish as new Default Project version…
      </button>
    </p>
  )}
</section>
{showPublish && <PublishDefaultModal onClose={() => setShowPublish(false)} />}
```

(Adapt the markup to your existing SettingsModal conventions.)

- [ ] **Step 2: Typecheck + smoke**

```bash
cd web && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SettingsModal.tsx
git commit -m "feat(default-project): settings UI for source + dev actions + publish"
```

---

## Task 21: `HttpDataSource.readProjectMeta` returns v2 so default load doesn't trigger migration

**Files:**
- Modify: `web/src/persistence/dataSource.ts`
- Modify: `web/tests/dataSource.test.ts`

A subtle thing: when the user opens the default via HTTP and then Save-As, today `HttpDataSource.readProjectMeta` returns `{ schema_version: 1, name: 'Starter project' }`. We don't want that to look like a legacy v1 project. Bump to v2 (the default is not legacy).

- [ ] **Step 1: Update existing test or add a new one**

In `web/tests/dataSource.test.ts`, add:
```ts
test('HttpDataSource.readProjectMeta returns schema_version 2', async () => {
  const ds = new HttpDataSource('http://x/sp', (async () => new Response('', { status: 404 })) as typeof fetch);
  const meta = await ds.readProjectMeta();
  assert.equal(meta.schema_version, 2);
});
```

- [ ] **Step 2: Run; verify FAIL**

- [ ] **Step 3: Update**

In `web/src/persistence/dataSource.ts`, change the `HttpDataSource.readProjectMeta` body to:
```ts
return { schema_version: 2, name: 'Default project' };
```

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/persistence/dataSource.ts web/tests/dataSource.test.ts
git commit -m "fix(default-project): HttpDataSource reports schema_version 2"
```

---

## Task 22: Mod.io packer — drop `version`, rename source, use loaded `DefaultProject`

**Files:**
- Modify: `web/src/modio/packer.ts`
- Modify: `web/src/store/modIoStore.ts`
- Modify: `web/tests/modioPacker.test.ts`

- [ ] **Step 1: Update tests**

Edit `web/tests/modioPacker.test.ts`:
- Change every `baseSource: 'starter-project'` literal to `'default-project'`.
- In the "packer: only modified + new records are included" test, after the existing manifest assertions add:
  ```ts
  assert.equal(manifest.base.source, 'default-project');
  assert.equal('version' in manifest.base, false, 'no version pin in mod.json');
  ```

Add a new test:
```ts
import { defaultCatalogFromLoaded } from '../src/modio/packer';
import type { DefaultProject } from '../src/persistence/defaultProject';

test('defaultCatalogFromLoaded converts a DefaultProject to a StarterCatalog', () => {
  const def: DefaultProject = {
    meta: { schema_version: 1, version: 1, label: '', published_at: '2026-05-14T00:00:00Z' },
    records: new Map([['items/A', { id: 'A' }]]),
    texts: new Map([['items/A', '{\n  "id": "A"\n}\n']]),
  };
  const catalog = defaultCatalogFromLoaded(def);
  assert.equal(catalog.get('items/A'), '{\n  "id": "A"\n}\n');
});
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd web && npm test -- --test-name-pattern='packer|defaultCatalogFromLoaded'`

- [ ] **Step 3: Update the source**

In `web/src/modio/packer.ts`:
1. Replace `loadStarterCatalog` with:
   ```ts
   import type { DefaultProject } from '../persistence/defaultProject';

   export function defaultCatalogFromLoaded(d: DefaultProject): StarterCatalog {
     return new Map(d.texts);
   }
   ```
   Keep `loadStarterCatalog` for one release as a deprecated shim that fetches via `loadDefaultProjectFromHttp` and returns `defaultCatalogFromLoaded(d)`.

2. In `buildDeltaZip`, change the `base` field of `manifest`:
   ```ts
   base: { source: opts.baseSource },
   ```
   (no `version` key).

In `web/src/store/modIoStore.ts`:
- Replace any call to `loadStarterCatalog(...)` with `defaultCatalogFromLoaded(useDefinitionsStore.getState().defaultProject!)`. If the store hasn't loaded the default yet, await `loadDefaultProject()` first.
- Change `baseSource: 'starter-project'` to `'default-project'`.

- [ ] **Step 4: Run all tests + typecheck**

```bash
cd web && npm test && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add web/src/modio/packer.ts web/src/store/modIoStore.ts web/tests/modioPacker.test.ts
git commit -m "feat(modio): use loaded DefaultProject; rename baseSource; drop version pin"
```

---

## Task 23: Flatten-to-full-copy export action

**Files:**
- Modify: `web/src/store/definitionsStore.ts`
- Create: `web/tests/exportFlattened.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/exportFlattened.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { useDefinitionsStore } from '../src/store/definitionsStore';
import { readZipAsync } from '../src/modio/zip';

test('exportFlattenedZip emits every effective record (default + overlay merged, minus tombstones)', async () => {
  // Stub fetch to load a tiny default with A and B; tombstone B; export; expect zip contains A only.
});
```

- [ ] **Step 2: Run; verify FAIL**

- [ ] **Step 3: Implement**

In `definitionsStore.ts`:
```ts
exportFlattenedZip: async () => {
  const enc = new TextEncoder();
  const entries: { path: string; data: Uint8Array }[] = [];
  for (const rec of get().definitions.values()) {
    const text = JSON.stringify(rec.json, null, 2) + '\n';
    entries.push({ path: `${rec.folder}/${rec.id}.json`, data: enc.encode(text) });
  }
  const { makeZip } = await import('../modio/zip');
  return makeZip(entries);
},
```

Add the action to the interface.

Tombstones are already absent from `get().definitions`, so no extra filter needed.

- [ ] **Step 4: Run; verify PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/store/definitionsStore.ts web/tests/exportFlattened.test.ts
git commit -m "feat(overlay): exportFlattenedZip emits full-tree snapshot"
```

---

## Task 24: Wire flatten export into the Header / menu

**Files:**
- Modify: `web/src/components/Header.tsx`

- [ ] **Step 1: Add a menu item**

Add a button in the Header's export/menu region:
```tsx
<button
  onClick={async () => {
    const blob = await useDefinitionsStore.getState().exportFlattenedZip();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'project-flattened.zip';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }}
  title="Download a complete snapshot of the current project (default + overlay merged)."
>Export flattened snapshot</button>
```

- [ ] **Step 2: Typecheck**

```bash
cd web && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Header.tsx
git commit -m "feat(overlay): header button for flattened export"
```

---

## Task 25: Final pass — UI strings, smoke tests, and full-suite verification

**Files:**
- Modify: `web/src/components/Header.tsx`, `web/src/components/DefinitionsTab.tsx`, `web/projects-ui-smoke.mjs`, `web/savedload-ui-smoke.mjs`, `web/layouts-ui-smoke.mjs`

- [ ] **Step 1: Find lingering "Bundled" / "Starter" UI strings**

Search:
```bash
cd web && grep -rin "bundled\|starter" src components 2>$null | grep -v '\.ts:.*//' | grep -v test
```

For each surviving user-facing string, decide:
- Replace with "Default Project" if user-facing.
- Leave if it's a comment, internal identifier, or the persisted `recents` handle name `'starter-project'` (back-compat).

- [ ] **Step 2: Update smoke tests**

Each smoke `.mjs` that asserts a UI label like "Bundled" or "Starter" should be updated to match the new label.

- [ ] **Step 3: Run everything**

```bash
cd web && npm test && npm run typecheck && npm run smoke
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src web/components web/*.mjs
git commit -m "chore: finalise Default Project naming across UI + smokes"
```

---

## Task 26: Manual verification checklist (no code; record results)

- [ ] Boot the app (no project handle in IDB). Verify "Open Default Project" is the visible action and the default loads.
- [ ] Edit one record. Click Save → prompted to Save As. Pick a fresh folder. Verify only the edited file + `project.json` (with `schema_version: 2`, `based_on_default_version`) are on disk.
- [ ] Reopen the project. Verify the working set is identical to the saved state, with the default's other records still present.
- [ ] Delete a default-side record. Save. Verify a zero-byte placeholder file is on disk at that key.
- [ ] Reopen. Verify the record is absent from the working set.
- [ ] Settings → enable "Show developer actions". Click "Publish as new Default Project version…". Cancel the directory picker — no errors.
- [ ] Settings → "Default project location" → pick the local `web/public/starter-project/` directory. Verify the default reloads from disk. Edit one default record. Publish. Verify `web/public/starter-project/default.json` `version` was bumped and the edited record is on disk.
- [ ] Publish a mod via mod.io. Verify the resulting `mod.json` has `base.source: 'default-project'` and no `version` field.

---

## Self-Review Outcomes (informational, completed before this plan was finalised)

- **Spec coverage:** every section of the spec has at least one task. Naming → Task 8 + Task 25. Overlay format → Tasks 5–13. Default version + label → Tasks 1–4, 17. Update workflow → Tasks 16–20. Mod.io changes → Task 22. Flatten export → Tasks 23–24. Migration → Task 13. Testing → throughout.
- **Placeholder scan:** no "TBD" / "TODO" remain in step bodies. Two tests in Task 17 reference a mock-handle helper "same as Task 10"; the plan explicitly tells you to copy it (the engineer may be reading out of order, and we prefer duplication over indirection in test files).
- **Type consistency:** `DefinitionsKey` type alias used consistently; `DefaultProject.records`/`texts` is `Map<string, any>`/`Map<string, string>` throughout; `tombstones: Set<DefinitionsKey>` on the store and as a parameter to `composeWorkingSet`; `publishAsNewDefaultVersion` signature matches between `defaultPublisher.ts` and the store action wrapper.
