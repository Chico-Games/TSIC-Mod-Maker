# Schema/Data Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move engine schema (`.class-hierarchy.json`, `.property-meta.json`) out of `web/public/base-definitions/` into an app-level `web/public/schema/`, rename the data tree to `web/public/starter-project/`, and refactor the definitions store so the Starter project flows through the same DataSource abstraction as picked folders — eliminating the bundled-vs-picked branch.

**Architecture:** Build new modules (`appSchemaStore`, `dataSource`, `schemaDriftValidator`) in isolation with unit tests, then wire them into `definitionsStore`. Sync script split happens first (dual-emit) so old paths keep working until the new ones are wired. Old `base-definitions/` emit is removed at the end.

**Tech Stack:** TypeScript, React 18, Zustand, Vite, File System Access API, IndexedDB. Tests: `node:test` + `tsx`; Playwright smokes.

---

## Files

- Modify: `web/scripts/sync-base-definitions.mjs` — dual-emit schema + starter (rename in last task).
- Create: `web/src/persistence/dataSource.ts` — `DataSource` interface + `HttpDataSource` + `FsaDataSource`.
- Create: `web/src/persistence/schemaDriftValidator.ts` — drift detection over loaded records.
- Create: `web/src/store/appSchemaStore.ts` — engine schema + lookup helpers.
- Modify: `web/src/store/definitionsStore.ts` — thread through DataSource; remove schema fields; replace `loadBundledDefaults` with `openStarterProject`.
- Modify: `web/src/handleStore.ts` — no change unless an issue surfaces.
- Modify: `web/src/components/App.tsx` — wrap with `<SchemaGate>`.
- Create: `web/src/components/SchemaGate.tsx` — blocks render until schema loaded.
- Modify: `web/src/components/Header.tsx` — `↺ Bundled defaults` → `↺ Starter project`; disable Save when `dataSource.readOnly`; Sync-to-Unreal disabled likewise.
- Modify: `web/src/components/DefinitionsTab.tsx` — toolbar reads `dataSource.displayName`; disable Save buttons on read-only.
- Modify: `web/src/components/LoadGate.tsx` — third mode `'drift'`.
- Modify: `web/src/components/TypedValueEditor.tsx`, `web/src/dnd/dispatch.ts`, `web/src/inferFolders.ts`, `web/src/components/useRefAdapter.ts` — read schema lookups from `appSchemaStore` instead of `definitionsStore`.
- Modify: `web/src/persistence/recentProjects.ts` — synthesise permanent Starter entry.
- Create: `web/tests/schemaDriftValidator.test.ts`
- Create: `web/tests/dataSource.test.ts`
- Create: `web/tests/appSchemaStore.test.ts`
- Modify: `web/definitions-ui-smoke.mjs` — paths + drift gate scenario.
- Modify: `web/data-smoke.mjs` (if it touches `base-definitions/`).
- Modify: `web/debug-semantic.mjs` — path.
- Modify: `README.md` — Bundled defaults section rewritten.

---

## Task 1: Sync script dual-emits schema + starter-project

Goal: write the new layout to disk without removing the old one yet. Lets every subsequent task verify the new HTTP paths exist while the running app keeps booting.

**Files:**
- Modify: `web/scripts/sync-base-definitions.mjs`

- [ ] **Step 1: Add dual-emit logic**

Edit `web/scripts/sync-base-definitions.mjs` to add new output paths alongside the old one. Replace the file with:

```js
#!/usr/bin/env node
// Mirror the source Definitions/ tree into:
//   - web/public/schema/                (.class-hierarchy.json, .property-meta.json)
//   - web/public/starter-project/       (per-folder data + manifest.json)
// Also continues to emit web/public/base-definitions/ for the legacy path
// during the migration (Task 14 removes that).

import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_WEB = join(__dirname, '..');
const SCHEMA_DIR = join(REPO_WEB, 'public', 'schema');
const STARTER_DIR = join(REPO_WEB, 'public', 'starter-project');
const LEGACY_DIR = join(REPO_WEB, 'public', 'base-definitions');
const SRC = process.env.TSIC_DEFINITIONS_SRC
  ?? 'C:\\Users\\Administrator\\Documents\\Unreal Projects\\TSIC\\Tools\\Export\\test-output\\Definitions';

function isLayoutFolder(name) {
  return /^layout/.test(name);
}

async function ensureDir(p) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

async function copyFile(src, dst) {
  const data = await readFile(src);
  await writeFile(dst, data);
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync-defaults] source not found: ${SRC}`);
    console.error('Set TSIC_DEFINITIONS_SRC to override. Skipping (no bundled defaults will be available).');
    await ensureDir(SCHEMA_DIR);
    await ensureDir(STARTER_DIR);
    await ensureDir(LEGACY_DIR);
    const empty = { folders: [], files: [], generatedAt: new Date().toISOString(), source: SRC };
    await writeFile(join(STARTER_DIR, 'manifest.json'), JSON.stringify(empty, null, 2));
    await writeFile(
      join(LEGACY_DIR, 'manifest.json'),
      JSON.stringify({ ...empty, sidecars: { hierarchy: false, propertyMeta: false } }, null, 2),
    );
    return;
  }

  await ensureDir(SCHEMA_DIR);
  await ensureDir(STARTER_DIR);
  await ensureDir(LEGACY_DIR);

  const folders = [];
  const files = [];
  let hierarchyPresent = false;
  let propertyMetaPresent = false;

  const entries = await readdir(SRC, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isFile()) {
      if (name === '.class-hierarchy.json') {
        await copyFile(join(SRC, name), join(SCHEMA_DIR, 'class-hierarchy.json'));
        await copyFile(join(SRC, name), join(LEGACY_DIR, name));
        hierarchyPresent = true;
      } else if (name === '.property-meta.json') {
        await copyFile(join(SRC, name), join(SCHEMA_DIR, 'property-meta.json'));
        await copyFile(join(SRC, name), join(LEGACY_DIR, name));
        propertyMetaPresent = true;
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (name.startsWith('.')) continue;
    if (isLayoutFolder(name)) continue;

    const folderSrc = join(SRC, name);
    const starterDst = join(STARTER_DIR, name);
    const legacyDst = join(LEGACY_DIR, name);
    await ensureDir(starterDst);
    await ensureDir(legacyDst);
    folders.push(name);

    const ids = [];
    const folderEntries = await readdir(folderSrc, { withFileTypes: true });
    for (const fe of folderEntries) {
      if (!fe.isFile()) continue;
      if (!fe.name.toLowerCase().endsWith('.json')) continue;
      const id = fe.name.replace(/\.json$/i, '');
      await copyFile(join(folderSrc, fe.name), join(starterDst, fe.name));
      await copyFile(join(folderSrc, fe.name), join(legacyDst, fe.name));
      ids.push(id);
    }
    ids.sort();
    files.push({ folder: name, ids });
  }

  folders.sort();
  files.sort((a, b) => a.folder.localeCompare(b.folder));

  const starterManifest = {
    folders,
    files,
    generatedAt: new Date().toISOString(),
    source: SRC,
  };
  await writeFile(
    join(STARTER_DIR, 'manifest.json'),
    JSON.stringify(starterManifest, null, 2),
  );

  const legacyManifest = {
    ...starterManifest,
    sidecars: { hierarchy: hierarchyPresent, propertyMeta: propertyMetaPresent },
  };
  await writeFile(
    join(LEGACY_DIR, 'manifest.json'),
    JSON.stringify(legacyManifest, null, 2),
  );

  const totalFiles = files.reduce((n, f) => n + f.ids.length, 0);
  console.log(`[sync-defaults] wrote ${totalFiles} files to schema/, starter-project/, and base-definitions/`);
}

main().catch((e) => {
  console.error('[sync-defaults] failed:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the sync script**

```
cd web
npm run sync-defaults
```

Expected: console line "wrote N files to schema/, starter-project/, and base-definitions/". `web/public/schema/{class-hierarchy,property-meta}.json` exist. `web/public/starter-project/manifest.json` exists with no `sidecars` field. `web/public/base-definitions/` unchanged from before.

- [ ] **Step 3: Verify the running app still boots from `base-definitions/`**

```
cd web
npm run typecheck
```

Expected: passes. No code changes yet, no behavior change in the running app.

- [ ] **Step 4: Commit**

```
git add web/scripts/sync-base-definitions.mjs web/public/schema/ web/public/starter-project/
git commit -m "build(sync): dual-emit schema/ and starter-project/ alongside base-definitions/"
```

---

## Task 2: schemaDriftValidator — failing tests

**Files:**
- Create: `web/tests/schemaDriftValidator.test.ts`

- [ ] **Step 1: Write the tests file**

Create `web/tests/schemaDriftValidator.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchemaDrift, type DriftIssue } from '../src/persistence/schemaDriftValidator';
import type { DefinitionRecord, DefinitionsKey } from '../src/store/definitionsStore';
import type { ClassNode, PropertyMeta } from '../src/store/appSchemaStore';

function mkRec(folder: string, id: string, json: any): [DefinitionsKey, DefinitionRecord] {
  const text = JSON.stringify(json);
  return [
    `${folder}/${id}`,
    { folder, id, json, originalText: text, diskId: id, diskFolder: folder },
  ];
}

function mkClassNodes(...names: string[]): Map<string, ClassNode> {
  const m = new Map<string, ClassNode>();
  for (const n of names) m.set(n, { name: n, parents: [], folder: null });
  return m;
}

function mkPropertyMeta(...keys: string[]): Map<string, PropertyMeta> {
  const blank: PropertyMeta = {
    tooltip: null, category: null, cpp_type: null, element_class: null,
    clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
    edit_condition: null, edit_spec: null, display_name: null, categories: null,
  };
  const m = new Map<string, PropertyMeta>();
  for (const k of keys) m.set(k, blank);
  return m;
}

test('clean record set yields no issues', () => {
  const defs = new Map([
    mkRec('items', 'A', { id: 'A', class: 'UItemDefinition', name: { type: 'FString', value: 'x' } }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.name', 'ItemDefinition.id'),
  );
  assert.deepEqual(issues, []);
});

test('unknown-class kind when record class missing from schema', () => {
  const defs = new Map([
    mkRec('items', 'A', { id: 'A', class: 'UMysteryDef' }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta(),
  );
  assert.equal(issues.length, 1);
  const issue = issues[0] as Extract<DriftIssue, { kind: 'unknown-class' }>;
  assert.equal(issue.kind, 'unknown-class');
  assert.equal(issue.className, 'UMysteryDef');
  assert.equal(issue.recordKey, 'items/A');
});

test('unknown-property kind when property missing from schema', () => {
  const defs = new Map([
    mkRec('items', 'A', {
      id: 'A',
      class: 'UItemDefinition',
      ghost_field: { type: 'FString', value: 'x' },
    }),
  ]);
  const issues = validateSchemaDrift(
    defs,
    mkClassNodes('UItemDefinition'),
    mkPropertyMeta('ItemDefinition.id'),
  );
  const unknown = issues.filter((i): i is Extract<DriftIssue, { kind: 'unknown-property' }> => i.kind === 'unknown-property');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].propertyName, 'ghost_field');
  assert.equal(unknown[0].parentType, 'ItemDefinition');
});

test('property check walks parent chain', () => {
  const defs = new Map([
    mkRec('items', 'A', {
      id: 'A',
      class: 'UConsumableDefinition',
      parent_classes: ['UItemDefinition'],
      name: { type: 'FString', value: 'x' },
    }),
  ]);
  const classNodes = new Map<string, ClassNode>([
    ['UConsumableDefinition', { name: 'UConsumableDefinition', parents: ['UItemDefinition'], folder: null }],
    ['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: null }],
  ]);
  const issues = validateSchemaDrift(
    defs,
    classNodes,
    mkPropertyMeta('ItemDefinition.name', 'ItemDefinition.id'),
  );
  assert.deepEqual(issues, []);
});

test('caps at 200 issues with an "and more" trailer', () => {
  const defs = new Map<DefinitionsKey, DefinitionRecord>();
  for (let i = 0; i < 300; i++) {
    const [k, r] = mkRec('items', `A${i}`, { id: `A${i}`, class: 'UMysteryDef' });
    defs.set(k, r);
  }
  const issues = validateSchemaDrift(defs, mkClassNodes(), mkPropertyMeta());
  assert.equal(issues.length, 201);
  assert.equal(issues[200].kind, 'unknown-class');
  assert.equal((issues[200] as any).recordKey, '__and_more__');
});
```

- [ ] **Step 2: Run tests and verify they fail**

```
cd web
npm test -- tests/schemaDriftValidator.test.ts
```

Expected: FAIL with "Cannot find module '../src/persistence/schemaDriftValidator'" and "Cannot find module '../src/store/appSchemaStore'".

- [ ] **Step 3: Commit (red)**

```
git add web/tests/schemaDriftValidator.test.ts
git commit -m "test(drift): failing tests for schemaDriftValidator"
```

---

## Task 3: schemaDriftValidator — implementation

**Files:**
- Create: `web/src/persistence/schemaDriftValidator.ts`
- Create: `web/src/store/appSchemaStore.ts` (just type re-exports for now; full impl comes in Task 6)

- [ ] **Step 1: Create the type shim**

Create `web/src/store/appSchemaStore.ts` with just the types the validator needs (the real store comes in Task 6):

```ts
// Engine schema store. Fully populated in Task 6; this stub exists so other
// modules can import the types and lookups without circular dependencies.

export interface ClassNode {
  name: string;
  parents: string[];
  folder: string | null;
}

export interface EnumMember {
  name: string;
  display_name?: string;
}

export interface PropertyMeta {
  tooltip: string | null;
  category: string | null;
  cpp_type: string | null;
  element_class: string | null;
  clamp_min: number | string | null;
  clamp_max: number | string | null;
  ui_min: number | string | null;
  ui_max: number | string | null;
  edit_condition: string | null;
  edit_spec: string | null;
  display_name: string | null;
  categories: string | null;
}
```

- [ ] **Step 2: Create the validator**

Create `web/src/persistence/schemaDriftValidator.ts`:

```ts
import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';
import type { ClassNode, PropertyMeta } from '../store/appSchemaStore';

export type DriftIssue =
  | { recordKey: DefinitionsKey; kind: 'unknown-class'; className: string }
  | { recordKey: DefinitionsKey; kind: 'unknown-property'; parentType: string; propertyName: string };

const MAX_ISSUES = 200;

/** Strip a leading "U" from a class name. The schema uses "UItemDefinition";
 *  property keys drop the prefix ("ItemDefinition.id"). */
function bareName(className: string): string {
  return className.startsWith('U') ? className.slice(1) : className;
}

function parentChain(className: string, classNodes: Map<string, ClassNode>): string[] {
  const node = classNodes.get(className);
  return node ? [className, ...node.parents] : [className];
}

export function validateSchemaDrift(
  defs: Map<DefinitionsKey, DefinitionRecord>,
  classNodes: Map<string, ClassNode>,
  propertyMeta: Map<string, PropertyMeta>,
): DriftIssue[] {
  const out: DriftIssue[] = [];

  const push = (issue: DriftIssue): boolean => {
    if (out.length >= MAX_ISSUES) {
      out.push({ recordKey: '__and_more__', kind: 'unknown-class', className: '__and_more__' });
      return false;
    }
    out.push(issue);
    return true;
  };

  for (const [key, rec] of defs) {
    const className = rec.json?.class;
    if (typeof className !== 'string') continue;

    const fullName = className.startsWith('U') ? className : `U${className}`;
    if (!classNodes.has(fullName)) {
      if (!push({ recordKey: key, kind: 'unknown-class', className: fullName })) return out;
      continue;
    }

    const chain = parentChain(fullName, classNodes).map(bareName);
    for (const propName of Object.keys(rec.json)) {
      if (propName === 'class' || propName === 'parent_classes') continue;
      const found = chain.some((c) => propertyMeta.has(`${c}.${propName}`));
      if (!found) {
        if (!push({
          recordKey: key,
          kind: 'unknown-property',
          parentType: bareName(fullName),
          propertyName: propName,
        })) return out;
      }
    }
  }
  return out;
}
```

- [ ] **Step 3: Run tests and verify they pass**

```
cd web
npm test -- tests/schemaDriftValidator.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 4: Run typecheck**

```
cd web
npm run typecheck
```

Expected: passes.

- [ ] **Step 5: Commit (green)**

```
git add web/src/persistence/schemaDriftValidator.ts web/src/store/appSchemaStore.ts
git commit -m "feat(drift): schemaDriftValidator detects unknown class/property"
```

---

## Task 4: dataSource — failing tests

**Files:**
- Create: `web/tests/dataSource.test.ts`

- [ ] **Step 1: Write the tests file**

Create `web/tests/dataSource.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpDataSource,
  FsaDataSource,
  type DataSource,
} from '../src/persistence/dataSource';

/** Build a minimal mock matching the parts of `fetch` we use. */
function mockFetch(routes: Record<string, { status: number; body: string }>): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    const r = routes[u];
    if (!r) return { ok: false, status: 404, text: async () => '' } as any;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body } as any;
  }) as any;
}

test('HttpDataSource: readOnly true, fetches manifest', async () => {
  const ds: DataSource = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/manifest.json': {
      status: 200,
      body: JSON.stringify({
        folders: ['items'],
        files: [{ folder: 'items', ids: ['A'] }],
      }),
    },
  }));
  assert.equal(ds.readOnly, true);
  assert.equal(ds.kind, 'http');
  const m = await ds.readManifest();
  assert.deepEqual(m.folders, ['items']);
  assert.deepEqual(m.files, [{ folder: 'items', ids: ['A'] }]);
});

test('HttpDataSource: readFile fetches file body', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({
    '/starter-project/items/A.json': { status: 200, body: '{"id":"A"}' },
  }));
  const text = await ds.readFile('items', 'A');
  assert.equal(text, '{"id":"A"}');
});

test('HttpDataSource: readProjectMeta returns synthesised meta', async () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  const meta = await ds.readProjectMeta();
  assert.equal(meta?.name, 'Starter project');
  assert.equal(meta?.schema_version, 1);
});

test('HttpDataSource: writeFile undefined (read-only)', () => {
  const ds = new HttpDataSource('/starter-project', mockFetch({}));
  assert.equal(ds.writeFile, undefined);
  assert.equal(ds.deleteFile, undefined);
  assert.equal(ds.writeProjectMeta, undefined);
});

// --- FsaDataSource ---

function mockFile(text: string): FileSystemFileHandle {
  return {
    kind: 'file',
    async getFile() {
      return { text: async () => text } as any;
    },
  } as any;
}

function mockDir(entries: Record<string, FileSystemFileHandle | FileSystemDirectoryHandle>): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    async *entries() {
      for (const [name, h] of Object.entries(entries)) yield [name, h];
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      const h = entries[name];
      if (h && h.kind === 'file') return h as FileSystemFileHandle;
      if (opts?.create) {
        const stored = { content: '' };
        const fh: FileSystemFileHandle = {
          kind: 'file',
          async getFile() { return { text: async () => stored.content } as any; },
          async createWritable() {
            return {
              async write(s: string) { stored.content = s; },
              async close() { /* noop */ },
            } as any;
          },
        } as any;
        entries[name] = fh;
        return fh;
      }
      throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    },
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      const h = entries[name];
      if (h && h.kind === 'directory') return h as FileSystemDirectoryHandle;
      throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    },
    async removeEntry(name: string) {
      delete entries[name];
    },
  } as any;
}

test('FsaDataSource: readManifest skips dot-files and layout folders', async () => {
  const root = mockDir({
    items: mockDir({
      'A.json': mockFile('{"id":"A"}'),
      'B.json': mockFile('{"id":"B"}'),
    }),
    layout_meta: mockDir({ 'X.json': mockFile('{}') }),
    '.class-hierarchy.json': mockFile('{}'),
    '.property-meta.json': mockFile('{}'),
  });
  const ds = new FsaDataSource(root);
  const m = await ds.readManifest();
  assert.deepEqual(m.folders, ['items']);
  assert.deepEqual(m.files, [{ folder: 'items', ids: ['A', 'B'] }]);
});

test('FsaDataSource: readFile returns file text', async () => {
  const root = mockDir({
    items: mockDir({ 'A.json': mockFile('hello') }),
  });
  const ds = new FsaDataSource(root);
  const text = await ds.readFile('items', 'A');
  assert.equal(text, 'hello');
});

test('FsaDataSource: writeFile creates file', async () => {
  const items: any = { kind: 'directory' };
  const stored: Record<string, string> = {};
  items.entries = async function*() { /* empty */ };
  items.getFileHandle = async (name: string, opts: any) => {
    if (!opts?.create) throw new Error('no');
    return {
      kind: 'file',
      async createWritable() {
        return { async write(s: string) { stored[name] = s; }, async close() {} } as any;
      },
    } as any;
  };
  items.removeEntry = async () => {};
  const root = mockDir({ items });
  const ds = new FsaDataSource(root);
  await ds.writeFile!('items', 'A', '{"new":true}');
  assert.equal(stored['A.json'], '{"new":true}');
});

test('FsaDataSource: readProjectMeta returns null when absent', async () => {
  const root = mockDir({ items: mockDir({}) });
  const ds = new FsaDataSource(root);
  const meta = await ds.readProjectMeta();
  assert.equal(meta, null);
});
```

- [ ] **Step 2: Run tests and verify they fail**

```
cd web
npm test -- tests/dataSource.test.ts
```

Expected: FAIL with "Cannot find module '../src/persistence/dataSource'".

- [ ] **Step 3: Commit (red)**

```
git add web/tests/dataSource.test.ts
git commit -m "test(dataSource): failing tests for Http and Fsa implementations"
```

---

## Task 5: dataSource — implementation

**Files:**
- Create: `web/src/persistence/dataSource.ts`

- [ ] **Step 1: Create the module**

Create `web/src/persistence/dataSource.ts`:

```ts
import type { ProjectMeta } from '../store/definitionsStore';

export interface DataSourceManifest {
  folders: string[];
  files: Array<{ folder: string; ids: string[] }>;
}

export interface DataSource {
  readonly kind: 'http' | 'fsa';
  readonly readOnly: boolean;
  readonly displayName: string;
  readManifest(): Promise<DataSourceManifest>;
  readFile(folder: string, id: string): Promise<string>;
  writeFile?(folder: string, id: string, text: string): Promise<void>;
  deleteFile?(folder: string, id: string): Promise<void>;
  renameFile?(fromFolder: string, fromId: string, toFolder: string, toId: string): Promise<void>;
  readProjectMeta(): Promise<ProjectMeta | null>;
  writeProjectMeta?(meta: ProjectMeta): Promise<void>;
}

function isLayoutFolder(name: string): boolean {
  return /^layout/i.test(name);
}

/** HTTP-backed read-only DataSource. Used for the Starter project. */
export class HttpDataSource implements DataSource {
  readonly kind = 'http' as const;
  readonly readOnly = true;
  readonly displayName = 'Starter project';

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('no fetch'); }) as any),
  ) {}

  async readManifest(): Promise<DataSourceManifest> {
    const url = `${this.baseUrl}/manifest.json`;
    const r = await this.fetcher(url);
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    const json = JSON.parse(await r.text());
    return {
      folders: (json.folders ?? []).filter((f: string) => !isLayoutFolder(f)),
      files: (json.files ?? []).filter((f: any) => !isLayoutFolder(f.folder)),
    };
  }

  async readFile(folder: string, id: string): Promise<string> {
    const url = `${this.baseUrl}/${folder}/${id}.json`;
    const r = await this.fetcher(url);
    if (!r.ok) throw new Error(`file ${folder}/${id} ${r.status}`);
    return r.text();
  }

  async readProjectMeta(): Promise<ProjectMeta> {
    return { schema_version: 1, name: 'Starter project' };
  }

  // writeFile / deleteFile / renameFile / writeProjectMeta intentionally undefined.
}

const SCHEMA_FILES = new Set(['.class-hierarchy.json', '.property-meta.json']);
const PROJECT_META_FILE = 'project.json';

/** FSA-backed read/write DataSource. Wraps a FileSystemDirectoryHandle. */
export class FsaDataSource implements DataSource {
  readonly kind = 'fsa' as const;
  readonly readOnly = false;

  constructor(public readonly rootHandle: FileSystemDirectoryHandle) {}

  get displayName(): string { return this.rootHandle.name; }

  async readManifest(): Promise<DataSourceManifest> {
    const folders: string[] = [];
    const files: Array<{ folder: string; ids: string[] }> = [];
    // @ts-ignore — .entries() is part of the FSA spec; TS libs sometimes lag.
    for await (const [name, entry] of this.rootHandle.entries()) {
      if ((entry as any).kind !== 'directory') continue;
      if (name.startsWith('.')) continue;
      if (isLayoutFolder(name)) continue;
      folders.push(name);
      const ids: string[] = [];
      // @ts-ignore
      for await (const [fileName, fileEntry] of (entry as FileSystemDirectoryHandle).entries()) {
        if ((fileEntry as any).kind !== 'file') continue;
        if (!fileName.toLowerCase().endsWith('.json')) continue;
        ids.push(fileName.replace(/\.json$/i, ''));
      }
      ids.sort();
      files.push({ folder: name, ids });
    }
    folders.sort();
    files.sort((a, b) => a.folder.localeCompare(b.folder));
    return { folders, files };
  }

  async readFile(folder: string, id: string): Promise<string> {
    const dir = await this.rootHandle.getDirectoryHandle(folder);
    const fh = await dir.getFileHandle(`${id}.json`);
    const file = await fh.getFile();
    return file.text();
  }

  async writeFile(folder: string, id: string, text: string): Promise<void> {
    const dir = await this.rootHandle.getDirectoryHandle(folder, { create: true });
    const fh = await dir.getFileHandle(`${id}.json`, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(text);
    await w.close();
  }

  async deleteFile(folder: string, id: string): Promise<void> {
    const dir = await this.rootHandle.getDirectoryHandle(folder);
    await (dir as any).removeEntry(`${id}.json`);
  }

  async renameFile(fromFolder: string, fromId: string, toFolder: string, toId: string): Promise<void> {
    const text = await this.readFile(fromFolder, fromId);
    await this.writeFile(toFolder, toId, text);
    if (fromFolder !== toFolder || fromId !== toId) {
      await this.deleteFile(fromFolder, fromId);
    }
  }

  async readProjectMeta(): Promise<ProjectMeta | null> {
    try {
      const fh = await this.rootHandle.getFileHandle(PROJECT_META_FILE);
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch (e: any) {
      if (e?.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async writeProjectMeta(meta: ProjectMeta): Promise<void> {
    const fh = await this.rootHandle.getFileHandle(PROJECT_META_FILE, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(JSON.stringify(meta, null, 2));
    await w.close();
  }
}
```

- [ ] **Step 2: Run tests**

```
cd web
npm test -- tests/dataSource.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 3: Run typecheck**

```
cd web
npm run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit (green)**

```
git add web/src/persistence/dataSource.ts
git commit -m "feat(dataSource): Http (Starter, read-only) + Fsa (picked, R/W) impls"
```

---

## Task 6: appSchemaStore — failing tests

**Files:**
- Create: `web/tests/appSchemaStore.test.ts`

- [ ] **Step 1: Write the tests file**

Create `web/tests/appSchemaStore.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppSchemaStore } from '../src/store/appSchemaStore';

function mockFetch(routes: Record<string, { status: number; body: string }>): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    const r = routes[u];
    if (!r) return { ok: false, status: 404, text: async () => '' } as any;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body } as any;
  }) as any;
}

test('loadSchema populates classNodes and propertyMeta', async () => {
  useAppSchemaStore.setState({ loaded: false, classNodes: new Map(), propertyMeta: new Map(), enumMeta: new Map() });
  const hierarchy = {
    classes: [
      { name: 'UItemDefinition', parents: [], folder: 'items' },
    ],
  };
  const propertyMeta = {
    properties: {
      'ItemDefinition.name': { tooltip: 'The display name', clamp_min: null, clamp_max: null },
    },
    enums: { EFoo: [{ name: 'A' }, { name: 'B' }] },
  };
  const fetcher = mockFetch({
    '/schema/class-hierarchy.json': { status: 200, body: JSON.stringify(hierarchy) },
    '/schema/property-meta.json': { status: 200, body: JSON.stringify(propertyMeta) },
  });
  await useAppSchemaStore.getState().loadSchema(fetcher);
  const s = useAppSchemaStore.getState();
  assert.equal(s.loaded, true);
  assert.equal(s.classNodes.get('UItemDefinition')?.folder, 'items');
  assert.equal(s.propertyMeta.get('ItemDefinition.name')?.tooltip, 'The display name');
  assert.equal(s.enumMeta.get('Foo')?.[0].name, 'A');
});

test('loadSchema is idempotent', async () => {
  useAppSchemaStore.setState({ loaded: false, classNodes: new Map(), propertyMeta: new Map(), enumMeta: new Map() });
  let calls = 0;
  const fetcher: typeof fetch = (async (url: string | URL) => {
    calls++;
    const u = url.toString();
    if (u.endsWith('class-hierarchy.json')) return { ok: true, status: 200, text: async () => '{"classes":[]}' } as any;
    if (u.endsWith('property-meta.json')) return { ok: true, status: 200, text: async () => '{"properties":{},"enums":{}}' } as any;
    return { ok: false, status: 404, text: async () => '' } as any;
  }) as any;
  await useAppSchemaStore.getState().loadSchema(fetcher);
  await useAppSchemaStore.getState().loadSchema(fetcher);
  assert.equal(calls, 2); // 2 fetches once, idempotency means no extra fetches the second call
});

test('loadSchema throws on 404', async () => {
  useAppSchemaStore.setState({ loaded: false, classNodes: new Map(), propertyMeta: new Map(), enumMeta: new Map() });
  const fetcher = mockFetch({});
  await assert.rejects(useAppSchemaStore.getState().loadSchema(fetcher), /class-hierarchy/);
});

test('getPropertyMeta walks parent chain', () => {
  useAppSchemaStore.setState({
    loaded: true,
    classNodes: new Map([
      ['UConsumableDefinition', { name: 'UConsumableDefinition', parents: ['UItemDefinition'], folder: 'consumables' }],
      ['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }],
    ]),
    propertyMeta: new Map([['ItemDefinition.name', {
      tooltip: 'from base', category: null, cpp_type: null, element_class: null,
      clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
      edit_condition: null, edit_spec: null, display_name: null, categories: null,
    }]]),
    enumMeta: new Map(),
  });
  const m = useAppSchemaStore.getState().getPropertyMeta('ConsumableDefinition', 'name');
  assert.equal(m?.tooltip, 'from base');
});
```

- [ ] **Step 2: Run tests, verify they fail**

```
cd web
npm test -- tests/appSchemaStore.test.ts
```

Expected: FAIL — `useAppSchemaStore` does not exist yet (only types).

- [ ] **Step 3: Commit (red)**

```
git add web/tests/appSchemaStore.test.ts
git commit -m "test(appSchemaStore): failing tests for schema load and lookups"
```

---

## Task 7: appSchemaStore — implementation

Goal: full store. Imports from `definitionsStore` for `propertySchema` / `idTemplates` are NOT introduced yet — those move in Task 10.

**Files:**
- Modify: `web/src/store/appSchemaStore.ts`

- [ ] **Step 1: Replace the stub with the real store**

Replace `web/src/store/appSchemaStore.ts` with:

```ts
import { create } from 'zustand';

export interface ClassNode {
  name: string;
  parents: string[];
  folder: string | null;
}

export interface EnumMember {
  name: string;
  display_name?: string;
}

export interface PropertyMeta {
  tooltip: string | null;
  category: string | null;
  cpp_type: string | null;
  element_class: string | null;
  clamp_min: number | string | null;
  clamp_max: number | string | null;
  ui_min: number | string | null;
  ui_max: number | string | null;
  edit_condition: string | null;
  edit_spec: string | null;
  display_name: string | null;
  categories: string | null;
}

const PINNED_KEY = 'tsic.def.pinned-props.v1';

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function savePinned(s: Set<string>) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...s])); } catch { /* noop */ }
}

interface AppSchemaStore {
  loaded: boolean;
  errorText: string | null;
  classNodes: Map<string, ClassNode>;
  hierarchySidecar: any | null;
  propertyMeta: Map<string, PropertyMeta>;
  enumMeta: Map<string, EnumMember[]>;
  pinnedProperties: Set<string>;

  loadSchema: (fetcher?: typeof fetch) => Promise<void>;

  getPropertyMeta: (parentTypeName: string | null | undefined, propertyName: string) => PropertyMeta | null;
  lookupArrayElementClass: (parentTypeName: string | null | undefined, propertyName: string) => string | null;
  getEnumMembers: (enumName: string | null | undefined) => EnumMember[] | null;
  folderForClass: (bareClassName: string) => string | null;
  togglePinnedProperty: (name: string) => void;
}

function bareName(c: string): string { return c.startsWith('U') ? c.slice(1) : c; }

function buildClassNodes(payload: any): Map<string, ClassNode> {
  const m = new Map<string, ClassNode>();
  if (!payload?.classes) return m;
  for (const c of payload.classes) {
    if (!c?.name) continue;
    m.set(c.name, {
      name: c.name,
      parents: Array.isArray(c.parents) ? c.parents : [],
      folder: c.folder ?? null,
    });
  }
  return m;
}

function buildPropertyMeta(payload: any): Map<string, PropertyMeta> {
  const m = new Map<string, PropertyMeta>();
  const props = payload?.properties ?? {};
  for (const [k, raw] of Object.entries(props)) {
    const r = raw as Partial<PropertyMeta>;
    m.set(k, {
      tooltip: r.tooltip ?? null,
      category: r.category ?? null,
      cpp_type: r.cpp_type ?? null,
      element_class: r.element_class ?? null,
      clamp_min: r.clamp_min ?? null,
      clamp_max: r.clamp_max ?? null,
      ui_min: r.ui_min ?? null,
      ui_max: r.ui_max ?? null,
      edit_condition: r.edit_condition ?? null,
      edit_spec: r.edit_spec ?? null,
      display_name: r.display_name ?? null,
      categories: r.categories ?? null,
    });
  }
  return m;
}

function buildEnumMeta(payload: any): Map<string, EnumMember[]> {
  const m = new Map<string, EnumMember[]>();
  const enums = payload?.enums ?? {};
  for (const [name, members] of Object.entries(enums)) {
    if (!Array.isArray(members)) continue;
    m.set(name, (members as any[]).map((x) => ({
      name: x.name,
      display_name: x.display_name,
    })));
  }
  return m;
}

export const useAppSchemaStore = create<AppSchemaStore>((set, get) => ({
  loaded: false,
  errorText: null,
  classNodes: new Map(),
  hierarchySidecar: null,
  propertyMeta: new Map(),
  enumMeta: new Map(),
  pinnedProperties: loadPinned(),

  loadSchema: async (fetcher = fetch) => {
    if (get().loaded) return;
    try {
      const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
      const hUrl = `${baseUrl}schema/class-hierarchy.json`;
      const pUrl = `${baseUrl}schema/property-meta.json`;
      const [hResp, pResp] = await Promise.all([fetcher(hUrl), fetcher(pUrl)]);
      if (!hResp.ok) throw new Error(`class-hierarchy ${hResp.status}`);
      if (!pResp.ok) throw new Error(`property-meta ${pResp.status}`);
      const hierarchy = JSON.parse(await hResp.text());
      const propertyMeta = JSON.parse(await pResp.text());
      set({
        loaded: true,
        errorText: null,
        hierarchySidecar: hierarchy,
        classNodes: buildClassNodes(hierarchy),
        propertyMeta: buildPropertyMeta(propertyMeta),
        enumMeta: buildEnumMeta(propertyMeta),
      });
    } catch (e: any) {
      set({ errorText: String(e?.message ?? e) });
      throw e;
    }
  },

  getPropertyMeta: (parentTypeName, propertyName) => {
    if (!parentTypeName || !propertyName) return null;
    const { classNodes, propertyMeta } = get();
    const full = parentTypeName.startsWith('U') ? parentTypeName : `U${parentTypeName}`;
    const chain = [full, ...(classNodes.get(full)?.parents ?? [])].map(bareName);
    chain.push(bareName(parentTypeName));
    for (const c of chain) {
      const m = propertyMeta.get(`${c}.${propertyName}`);
      if (m) return m;
    }
    return null;
  },

  lookupArrayElementClass: (parentTypeName, propertyName) => {
    const m = get().getPropertyMeta(parentTypeName, propertyName);
    return m?.element_class ?? null;
  },

  getEnumMembers: (enumName) => {
    if (!enumName) return null;
    const bare = enumName.startsWith('E') ? enumName.slice(1) : enumName;
    return get().enumMeta.get(bare) ?? null;
  },

  folderForClass: (bareClassName) => {
    const { classNodes } = get();
    const full = bareClassName.startsWith('U') ? bareClassName : `U${bareClassName}`;
    return classNodes.get(full)?.folder ?? null;
  },

  togglePinnedProperty: (name) => set((s) => {
    const next = new Set(s.pinnedProperties);
    if (next.has(name)) next.delete(name); else next.add(name);
    savePinned(next);
    return { pinnedProperties: next };
  }),
}));
```

- [ ] **Step 2: Run tests**

```
cd web
npm test -- tests/appSchemaStore.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 3: Run typecheck**

```
cd web
npm run typecheck
```

Expected: passes (consumers still read schema from `definitionsStore` — they'll be migrated in Task 10).

- [ ] **Step 4: Commit**

```
git add web/src/store/appSchemaStore.ts
git commit -m "feat(schema): appSchemaStore loads engine schema once at boot"
```

---

## Task 8: SchemaGate component + App wiring

**Files:**
- Create: `web/src/components/SchemaGate.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create SchemaGate**

Create `web/src/components/SchemaGate.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';
import { useAppSchemaStore } from '../store/appSchemaStore';

/** Blocks render until the engine schema is fetched. Renders a fatal panel
 *  on failure — schema is required for any meaningful UI. */
export function SchemaGate({ children }: { children: ReactNode }) {
  const loaded = useAppSchemaStore((s) => s.loaded);
  const errorText = useAppSchemaStore((s) => s.errorText);
  const loadSchema = useAppSchemaStore((s) => s.loadSchema);

  useEffect(() => { void loadSchema(); }, [loadSchema]);

  if (errorText) {
    return (
      <div style={{ padding: 24, color: '#c00', fontFamily: 'system-ui' }}>
        <h2>Cannot start — schema load failed</h2>
        <p>{errorText}</p>
        <p>Re-run <code>npm run sync-defaults</code> and reload.</p>
      </div>
    );
  }
  if (!loaded) return null;
  return <>{children}</>;
}
```

- [ ] **Step 2: Wrap App with SchemaGate**

Edit `web/src/App.tsx`. Find the top-level return and wrap with `<SchemaGate>`. If the existing return is:

```tsx
return (
  <DndContext ...>
    ...
  </DndContext>
);
```

Replace with:

```tsx
return (
  <SchemaGate>
    <DndContext ...>
      ...
    </DndContext>
  </SchemaGate>
);
```

And add the import: `import { SchemaGate } from './components/SchemaGate';`

- [ ] **Step 3: Verify app boots**

```
cd web
npm run dev
```

Open http://localhost:5173. Expected: app loads. Confirm in DevTools Network that `schema/class-hierarchy.json` and `schema/property-meta.json` are fetched once.

Stop the dev server (Ctrl-C).

- [ ] **Step 4: Run typecheck**

```
cd web
npm run typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```
git add web/src/components/SchemaGate.tsx web/src/App.tsx
git commit -m "feat(boot): SchemaGate fetches engine schema before render"
```

---

## Task 9: Recents — synthesised permanent Starter entry

**Files:**
- Modify: `web/src/persistence/recentProjects.ts`

- [ ] **Step 1: Read current shape**

Look at `web/src/persistence/recentProjects.ts` to find `listRecents()`. It returns an array of `RecentEntry`.

- [ ] **Step 2: Synthesise the Starter entry at the bottom**

Find the `listRecents()` function. Append the Starter entry to the result before returning. The change looks like:

```ts
const STARTER_HANDLE_NAME = 'starter-project';
const STARTER_NAME = 'Starter project';

export async function listRecents(): Promise<RecentEntry[]> {
  // ... existing logic that builds `out` from IDB ...
  // Filter out any user-added entry that collides with the synthetic name.
  const filtered = out.filter((r) => r.handleName !== STARTER_HANDLE_NAME);
  filtered.push({
    name: STARTER_NAME,
    handleName: STARTER_HANDLE_NAME,
    handle: null as any,  // Resolved by definitionsStore.openRecent → openStarterProject
    lastOpened: 0,
  });
  return filtered;
}
```

Show the full updated function in the diff if more changes are needed.

- [ ] **Step 3: Run existing recentProjects tests**

```
cd web
npm test -- tests/recentProjects.test.ts
```

Expected: PASS (existing tests still cover non-Starter entries).

- [ ] **Step 4: Add a new test for the Starter entry**

Append to `web/tests/recentProjects.test.ts`:

```ts
test('listRecents always includes synthetic Starter entry', async () => {
  // Empty DB.
  const r = await listRecents();
  const starter = r.find((e) => e.handleName === 'starter-project');
  assert.ok(starter);
  assert.equal(starter!.name, 'Starter project');
});
```

Run:

```
cd web
npm test -- tests/recentProjects.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add web/src/persistence/recentProjects.ts web/tests/recentProjects.test.ts
git commit -m "feat(recents): synthesise permanent Starter project entry"
```

---

## Task 10: definitionsStore — introduce DataSource field

This is the riskiest task. It introduces the new field alongside the existing `directoryHandle` field; later tasks migrate flows over and remove the old field. Keep all existing behavior working.

**Files:**
- Modify: `web/src/store/definitionsStore.ts`

- [ ] **Step 1: Add `dataSource` field and basic setter**

Open `web/src/store/definitionsStore.ts`. In the `DefinitionsStore` interface (around line 76), add:

```ts
  dataSource: import('../persistence/dataSource').DataSource | null;
```

In the initial state object (around line 1089, the `directoryHandle: null` line area), add:

```ts
  dataSource: null,
```

- [ ] **Step 2: Run typecheck**

```
cd web
npm run typecheck
```

Expected: passes. No behavior change.

- [ ] **Step 3: Commit**

```
git add web/src/store/definitionsStore.ts
git commit -m "feat(store): add dataSource field (parallel to directoryHandle)"
```

---

## Task 11: definitionsStore — extract loadFromDataSource funnel

Replace the body of `loadBundledDefaults`, the loading half of `reload`, and the loading half of `openProject` with a single private function that takes a `DataSource`. Keep public actions; just have them construct a DS and delegate.

**Files:**
- Modify: `web/src/store/definitionsStore.ts`

- [ ] **Step 1: Add a private `loadFromDataSource(set, get, ds)` helper at module scope**

After the existing helper functions (around the `loadFromDirectory` definition near line 680), add a new module-private function:

```ts
import { HttpDataSource, FsaDataSource, type DataSource } from '../persistence/dataSource';
import { useAppSchemaStore } from './appSchemaStore';
import { validateSchemaDrift } from '../persistence/schemaDriftValidator';

async function loadFromDataSource(
  set: (state: Partial<DefinitionsStore>) => void,
  get: () => DefinitionsStore,
  ds: DataSource,
): Promise<void> {
  set({ loading: true, errorText: null });
  try {
    const manifest = await ds.readManifest();
    const folders = manifest.folders.slice().sort();

    const defs = new Map<DefinitionsKey, DefinitionRecord>();
    const rawFiles: Array<{ folder: string; name: string; text: string }> = [];
    const concurrency = 32;
    const allFiles: { folder: string; id: string }[] = [];
    for (const f of manifest.files) {
      for (const id of f.ids) allFiles.push({ folder: f.folder, id });
    }
    let nextIdx = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = nextIdx++;
        if (i >= allFiles.length) return;
        const { folder, id } = allFiles[i];
        try {
          const text = await ds.readFile(folder, id);
          const json = JSON.parse(text);
          defs.set(key(folder, id), {
            folder, id, json, originalText: text, diskId: id, diskFolder: folder,
          });
          rawFiles.push({ folder, name: `${id}.json`, text });
        } catch (e) {
          console.warn(`[definitions] failed to read ${folder}/${id}`, e);
        }
      }
    });
    await Promise.all(workers);

    const rawMeta = await ds.readProjectMeta();
    const projectMeta: ProjectMeta = rawMeta ?? { schema_version: 1, name: ds.displayName };

    // Run structural validator (existing behavior).
    const structuralIssues = validateBatch(rawFiles);
    if (structuralIssues.length > 0) {
      // Use existing loadGate for structural issues.
      const proceed = await new Promise<boolean>((resolve) => {
        set({
          loadGate: {
            issues: structuralIssues,
            onContinue: () => resolve(true),
            onCancel: () => resolve(false),
          },
        });
      });
      if (!proceed) {
        set({ loading: false });
        return;
      }
    }

    // Run drift validator.
    const schema = useAppSchemaStore.getState();
    const driftIssues = validateSchemaDrift(defs, schema.classNodes, schema.propertyMeta);
    if (driftIssues.length > 0) {
      const proceed = await new Promise<boolean>((resolve) => {
        set({
          loadGate: {
            // Extended LoadGate covers both — see Task 13 for the union shape.
            issues: driftIssues as any,
            onContinue: () => resolve(true),
            onCancel: () => resolve(false),
          },
        });
      });
      if (!proceed) {
        set({ loading: false });
        return;
      }
    }

    const classNodes = schema.classNodes;
    const propertySchema = buildPropertySchema(defs);
    const idTemplates = buildIdTemplates(defs);

    set({
      dataSource: ds,
      directoryHandle: ds.kind === 'fsa' ? (ds as FsaDataSource).rootHandle : null,
      projectMeta,
      definitions: defs,
      dirty: new Set(),
      folders,
      classNodes,
      hierarchySidecar: schema.hierarchySidecar,
      propertySchema,
      propertyMeta: schema.propertyMeta,
      enumMeta: schema.enumMeta,
      idTemplates,
      referencedByIndex: buildReferencedByIndex(defs),
      loadedAt: Date.now(),
      loading: false,
      unrealSyncPath: projectMeta.ue_sync_path ?? '',
    });

    // Auto-create missing refs (existing behavior).
    get().autoCreateMissingRefs();

    // Draft restore prompt (existing behavior).
    const pk = projectKey(projectMeta, ds.kind === 'fsa' ? (ds as FsaDataSource).rootHandle.name : 'starter-project');
    const draft = await loadDraft(pk);
    if (draft) {
      set({
        restoreDraftPrompt: {
          key: pk,
          savedAt: draft.savedAt,
          recordCount: draft.records.length,
        },
      });
    }
  } catch (e: any) {
    console.error('[definitions] load failed', e);
    set({ errorText: String(e?.message ?? e), loading: false });
  }
}
```

- [ ] **Step 2: Replace `loadBundledDefaults` body to delegate**

Find `loadBundledDefaults: async () => {` (around line 1471). Replace its entire body with:

```ts
  loadBundledDefaults: async () => {
    const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
    const ds = new HttpDataSource(`${baseUrl.replace(/\/$/, '')}/starter-project`);
    await loadFromDataSource(set, get, ds);
  },
```

- [ ] **Step 3: Replace `reload` body to delegate**

Find `reload: async () => {` (around line 1641). Replace with:

```ts
  reload: async () => {
    const { directoryHandle, dataSource } = get();
    let ds = dataSource;
    if (!ds && directoryHandle) ds = new FsaDataSource(directoryHandle);
    if (!ds) {
      // Fall back to Starter.
      await get().loadBundledDefaults();
      return;
    }
    await loadFromDataSource(set, get, ds);
  },
```

- [ ] **Step 4: Run typecheck**

```
cd web
npm run typecheck
```

Expected: passes.

- [ ] **Step 5: Manual boot check**

```
cd web
npm run dev
```

Open the app. Expected: bundled Starter project loads (via the new `HttpDataSource('/starter-project')`). Pick a directory — that flow works via `FsaDataSource`. Stop the server.

- [ ] **Step 6: Run unit tests**

```
cd web
npm test
```

Expected: existing tests pass.

- [ ] **Step 7: Commit**

```
git add web/src/store/definitionsStore.ts
git commit -m "refactor(store): single loadFromDataSource funnel for Http and Fsa loads"
```

---

## Task 12: definitionsStore — saveOne/saveAllDirty via DataSource

Goal: writes go through `dataSource.writeFile` instead of touching `directoryHandle` directly.

**Files:**
- Modify: `web/src/store/definitionsStore.ts`

- [ ] **Step 1: Replace `saveOne` body**

Find `saveOne: async (key) => {` and replace with:

```ts
  saveOne: async (k) => {
    const { dataSource, definitions, dirty } = get();
    if (!dataSource || dataSource.readOnly || !dataSource.writeFile) {
      set({ toast: { kind: 'error', text: 'This source is read-only. Use Save As to write changes.' } });
      return;
    }
    const rec = definitions.get(k);
    if (!rec) return;
    const text = JSON.stringify(rec.json, null, 2);
    // Honour disk id / folder for renames + class moves (existing semantics).
    if (rec.diskFolder !== rec.folder || rec.diskId !== rec.id) {
      if (dataSource.renameFile) {
        await dataSource.renameFile(rec.diskFolder, rec.diskId, rec.folder, rec.id);
      } else {
        await dataSource.writeFile(rec.folder, rec.id, text);
        if (dataSource.deleteFile) await dataSource.deleteFile(rec.diskFolder, rec.diskId);
      }
    } else {
      await dataSource.writeFile(rec.folder, rec.id, text);
    }
    const newDirty = new Set(dirty); newDirty.delete(k);
    const next = new Map(definitions);
    next.set(k, { ...rec, originalText: text, diskFolder: rec.folder, diskId: rec.id });
    set({ definitions: next, dirty: newDirty });
  },
```

- [ ] **Step 2: Replace `saveAllDirty` body**

Find `saveAllDirty: async () => {` and have it call `saveOne` per dirty key, tracking saved/failed counts. Replace with:

```ts
  saveAllDirty: async () => {
    const { dirty } = get();
    let saved = 0, failed = 0;
    for (const k of [...dirty]) {
      try { await get().saveOne(k); saved++; }
      catch (e) { console.error('[save]', k, e); failed++; }
    }
    return { saved, failed };
  },
```

- [ ] **Step 3: Typecheck**

```
cd web
npm run typecheck
```

Expected: passes.

- [ ] **Step 4: Manual smoke**

```
cd web
npm run dev
```

Pick a directory. Edit a record. Click Save. Expected: file content on disk reflects the edit.

Switch to Starter. Edit a record. Click Save. Expected: toast "This source is read-only. Use Save As to write changes."

Stop the dev server.

- [ ] **Step 5: Commit**

```
git add web/src/store/definitionsStore.ts
git commit -m "refactor(store): saveOne/saveAllDirty go through DataSource"
```

---

## Task 13: LoadGate — drift mode

**Files:**
- Modify: `web/src/components/LoadGate.tsx`
- Modify: `web/src/store/definitionsStore.ts` — extend `loadGate` discriminator

- [ ] **Step 1: Extend the loadGate shape in the store**

In `web/src/store/definitionsStore.ts`, find the `loadGate` field declaration (around line 147). Replace with:

```ts
  loadGate: {
    mode: 'structural' | 'drift';
    issues: import('./persistence/structuralValidator').StructuralIssue[] | import('../persistence/schemaDriftValidator').DriftIssue[];
    onContinue: () => void;
    onCancel: () => void;
  } | null;
```

Update the two `set({ loadGate: ... })` calls in `loadFromDataSource` from Task 11 to include the discriminator: structural pass sets `mode: 'structural'`, drift pass sets `mode: 'drift'`.

- [ ] **Step 2: Update LoadGate.tsx**

Open `web/src/components/LoadGate.tsx`. Render different content based on `loadGate.mode`. Pattern:

```tsx
if (loadGate.mode === 'drift') {
  return (
    <Modal>
      <h2>Schema drift detected</h2>
      <p>The following records use classes or properties unknown to the current app schema:</p>
      <ul style={{ maxHeight: 320, overflow: 'auto' }}>
        {(loadGate.issues as DriftIssue[]).slice(0, 50).map((i, idx) => (
          <li key={idx}>
            {i.kind === 'unknown-class'
              ? <>Unknown class <code>{i.className}</code> in <code>{i.recordKey}</code></>
              : <>Unknown property <code>{i.parentType}.{i.propertyName}</code> in <code>{i.recordKey}</code></>}
          </li>
        ))}
        {loadGate.issues.length > 50 && <li>…and {loadGate.issues.length - 50} more</li>}
      </ul>
      <div className="modal-buttons">
        <button onClick={() => dismissLoadGate('continue')} className="primary">Continue anyway</button>
        <button onClick={() => dismissLoadGate('cancel')}>Cancel</button>
      </div>
    </Modal>
  );
}
// existing structural rendering stays under the else branch
```

- [ ] **Step 3: Run typecheck**

```
cd web
npm run typecheck
```

Expected: passes.

- [ ] **Step 4: Manual smoke**

```
cd web
npm run dev
```

Pick a folder containing a record whose `class` is unknown (or temporarily edit one bundled record's class to something fake before opening). Expected: drift gate appears, Continue commits, Cancel returns.

Stop the dev server.

- [ ] **Step 5: Commit**

```
git add web/src/components/LoadGate.tsx web/src/store/definitionsStore.ts
git commit -m "feat(LoadGate): drift mode for unknown class/property"
```

---

## Task 14: Migrate consumers off `definitionsStore.{classNodes,propertyMeta,enumMeta}`

Goal: schema lookups in five consumer files switch from `useDefinitionsStore` to `useAppSchemaStore`. After this task we can delete the duplicated fields from `definitionsStore`.

**Files:**
- Modify: `web/src/components/TypedValueEditor.tsx`
- Modify: `web/src/dnd/dispatch.ts`
- Modify: `web/src/components/DefinitionsTab.tsx`
- Modify: `web/src/inferFolders.ts`
- Modify: `web/src/components/useRefAdapter.ts`

- [ ] **Step 1: Grep for each schema lookup and update**

For each file in the Files list:

1. Add `import { useAppSchemaStore } from '../store/appSchemaStore';` (path adjusted).
2. Replace `useDefinitionsStore((s) => s.classNodes)` → `useAppSchemaStore((s) => s.classNodes)`. Same for `propertyMeta`, `enumMeta`, `getPropertyMeta`, `lookupArrayElementClass`, `getEnumMembers`, `folderForClass`, `togglePinnedProperty`, `pinnedProperties`.
3. For non-React modules (`dnd/dispatch.ts`, `inferFolders.ts`), use `useAppSchemaStore.getState().classNodes` instead.

For each file, after edits, run:

```
cd web
npm run typecheck
```

- [ ] **Step 2: Run full typecheck + tests**

```
cd web
npm run typecheck && npm test
```

Expected: passes.

- [ ] **Step 3: Manual smoke**

```
cd web
npm run dev
```

Open the app. Open Definitions tab on a record. Expected: property tooltips show, enum dropdowns populate, ref dropdowns work. Stop server.

- [ ] **Step 4: Commit**

```
git add web/src/components/TypedValueEditor.tsx web/src/dnd/dispatch.ts web/src/components/DefinitionsTab.tsx web/src/inferFolders.ts web/src/components/useRefAdapter.ts
git commit -m "refactor: consumers read schema from appSchemaStore (not definitionsStore)"
```

---

## Task 15: Remove schema fields from definitionsStore

Goal: drop the mirrored schema fields from `definitionsStore` and the sidecar reads from `loadFromDirectory`.

**Files:**
- Modify: `web/src/store/definitionsStore.ts`

- [ ] **Step 1: Remove fields from interface and initial state**

In `DefinitionsStore` interface, remove: `classNodes`, `hierarchySidecar`, `propertySchema`, `propertyMeta`, `enumMeta`, `idTemplates`, `pinnedProperties`.

In the initial state, remove the same fields.

In `loadFromDataSource` (Task 11), stop setting these fields. Keep `propertySchema` and `idTemplates` calls — those still need to live somewhere accessible. Move them onto `appSchemaStore` via a new action `setPerLoadDerived({ propertySchema, idTemplates })`. Update `appSchemaStore.ts`:

```ts
interface AppSchemaStore {
  // ...existing
  propertySchema: Map<string, { element_type?: any; key_type?: any; value_type?: any }>;
  idTemplates: Map<string, { prefix: string; suffix: string }>;
  setPerLoadDerived: (d: { propertySchema: Map<string, any>; idTemplates: Map<string, { prefix: string; suffix: string }> }) => void;
  // ...
  lookupContainerType: (path: (string | number)[], slot: 'element_type' | 'key_type' | 'value_type') => any | null;
}
```

Update `loadFromDataSource` to push:

```ts
useAppSchemaStore.getState().setPerLoadDerived({ propertySchema, idTemplates });
```

instead of setting them on `definitionsStore`.

- [ ] **Step 2: Remove sidecar reads from `loadFromDirectory`**

Find `loadFromDirectory` (around line 680). Delete the branches that handle `.class-hierarchy.json` and `.property-meta.json` (the inner-loop `if (name === '.class-hierarchy.json')` block and its sibling). Folders matching dot-prefix were already skipped.

- [ ] **Step 3: Remove sidecar seeding from `createProject`**

Find `createProject` (around line 1280-1350). Remove the `try { ... copy class-hierarchy ... }` and `try { ... copy property-meta ... }` blocks (lines ~1329-1349). `seedFromBundled` continues to copy data files via the HttpDataSource pattern; pull the file list from `HttpDataSource('/starter-project').readManifest()` instead of hand-rolled fetches.

- [ ] **Step 4: Remove schema lookup helpers from definitionsStore**

Delete the implementations of `getPropertyMeta`, `lookupContainerType`, `lookupArrayElementClass`, `getEnumMembers`, `folderForClass`, `togglePinnedProperty` from the store (they live on `appSchemaStore` now). Remove their interface declarations too.

- [ ] **Step 5: Typecheck**

```
cd web
npm run typecheck
```

Expected: passes (Task 14 already migrated consumers).

- [ ] **Step 6: Manual smoke**

```
cd web
npm run dev
```

Open Definitions tab. Property editor still works. Pick a folder. Edit and Save. Stop server.

- [ ] **Step 7: Commit**

```
git add web/src/store/definitionsStore.ts web/src/store/appSchemaStore.ts
git commit -m "refactor(store): drop schema fields and sidecar reads from definitionsStore"
```

---

## Task 16: openStarterProject + Header/DefinitionsTab UI

**Files:**
- Modify: `web/src/store/definitionsStore.ts` — alias `loadBundledDefaults` → `openStarterProject`
- Modify: `web/src/components/Header.tsx`
- Modify: `web/src/components/DefinitionsTab.tsx`

- [ ] **Step 1: Add `openStarterProject` action; keep `loadBundledDefaults` as alias**

In `definitionsStore.ts`, add to the interface:

```ts
  openStarterProject: () => Promise<void>;
```

And in the implementation, after `loadBundledDefaults`:

```ts
  openStarterProject: async () => { await get().loadBundledDefaults(); },
```

- [ ] **Step 2: Wire `openRecent` for the Starter entry**

In `openRecent` (around line 1162), at the top:

```ts
  openRecent: async (handleName) => {
    if (handleName === 'starter-project') {
      await get().openStarterProject();
      return;
    }
    // ... existing logic
  },
```

- [ ] **Step 3: Header label + button changes**

Open `web/src/components/Header.tsx`. Find the `↺ Bundled defaults` button. Change to:

```tsx
<button onClick={() => loadBundledDefaults()} title="Switch to the Starter project (drops the picked folder)">
  ↺ Starter project
</button>
```

Find the Save / Save current / Save all buttons. Disable them when the active source is read-only. Add at top of the component:

```tsx
const dataSource = useDefinitionsStore((s) => s.dataSource);
const readOnly = dataSource?.readOnly ?? true;
```

Then for each save button, add `disabled={readOnly || ...existing-conditions}` and a title like `"Use Save As — Starter is read-only"`.

Same for the Sync-to-Unreal button.

- [ ] **Step 4: DefinitionsTab toolbar label**

In `web/src/components/DefinitionsTab.tsx`, find the `headerLabel` (around line 136):

```ts
const headerLabel = dataSource ? `Target: ${dataSource.displayName}` : 'No directory selected';
```

Replace with:

```ts
const headerLabel = `Target: ${dataSource?.displayName ?? 'Starter project'}`;
```

And add `const dataSource = useDefinitionsStore((s) => s.dataSource);` near the other selectors.

Disable Save current / Save all in this toolbar based on `dataSource?.readOnly`.

- [ ] **Step 5: Typecheck + manual smoke**

```
cd web
npm run typecheck && npm run dev
```

Open the app. Header dropdown shows "Starter project" entry. Click `↺ Starter project` → switches. Save buttons disabled. Pick a folder → Save buttons enabled.

Stop the server.

- [ ] **Step 6: Commit**

```
git add web/src/store/definitionsStore.ts web/src/components/Header.tsx web/src/components/DefinitionsTab.tsx
git commit -m "feat(ui): openStarterProject + read-only Save buttons + 'Starter project' label"
```

---

## Task 17: Remove legacy `base-definitions/` from sync script

**Files:**
- Modify: `web/scripts/sync-base-definitions.mjs`

- [ ] **Step 1: Drop legacy emit**

Open `web/scripts/sync-base-definitions.mjs`. Remove every line referencing `LEGACY_DIR`, `legacyDst`, `legacyManifest`. The script should emit ONLY `web/public/schema/` and `web/public/starter-project/`.

- [ ] **Step 2: Run sync, delete the old directory**

```
cd web
rm -rf public/base-definitions
npm run sync-defaults
```

Expected: only `schema/` and `starter-project/` are produced.

- [ ] **Step 3: Manual smoke**

```
cd web
npm run dev
```

Open the app. Expected: Starter project loads fine. Stop the server.

- [ ] **Step 4: Commit**

```
git add web/scripts/sync-base-definitions.mjs web/public/schema/ web/public/starter-project/
git rm -r --cached web/public/base-definitions/ 2>/dev/null || true
git commit -m "build(sync): drop legacy base-definitions/ emit"
```

---

## Task 18: Update smoke harnesses + README

**Files:**
- Modify: `web/definitions-ui-smoke.mjs`
- Modify: `web/debug-semantic.mjs`
- Modify: `web/data-smoke.mjs` (if applicable)
- Modify: `README.md`

- [ ] **Step 1: Grep for `base-definitions` and update**

```
cd web
```

Use Grep on the working dir for `base-definitions` outside `node_modules/` and `public/`. Update every occurrence:
- In `definitions-ui-smoke.mjs`, `debug-semantic.mjs`, `data-smoke.mjs`: change paths to `starter-project` for data and `schema` for sidecars.

- [ ] **Step 2: Update README**

In `README.md`:
- Rename the "Bundled defaults" section to "Starter project".
- Update the file-structure block: `public/base-definitions/` → `public/schema/` + `public/starter-project/`.
- Note that `↺ Bundled defaults` is now `↺ Starter project`.

- [ ] **Step 3: Run smokes**

```
cd web
npm run data-smoke
npm run smoke:def
```

Expected: pass.

- [ ] **Step 4: Commit**

```
git add web/definitions-ui-smoke.mjs web/debug-semantic.mjs web/data-smoke.mjs README.md
git commit -m "docs(test): rename base-definitions → starter-project / schema in tests + README"
```

---

## Task 19: Add Playwright drift-gate smoke

**Files:**
- Modify: `web/savedload-ui-smoke.mjs` (or create a new `web/drift-ui-smoke.mjs`)
- Modify: `web/package.json` if a new script is needed

- [ ] **Step 1: Add a scenario to the existing savedload smoke**

The scenario:
1. Start vite preview.
2. Open the app.
3. Use `evaluate()` to set up an FSA mock that returns a record whose `class` is `UFakeClass_QYZ`.
4. Trigger `openProject`.
5. Wait for `.load-gate` containing "Schema drift detected".
6. Click "Continue anyway".
7. Assert the record is visible.

Add a similarly-structured test next to the existing structural-validator scenario. Use the existing helper functions (e.g., `mockShowDirectoryPicker`).

- [ ] **Step 2: Run**

```
cd web
npm run smoke:savedload
```

Expected: pass.

- [ ] **Step 3: Commit**

```
git add web/savedload-ui-smoke.mjs
git commit -m "test(smoke): drift LoadGate scenario in savedload smoke"
```

---

## Self-Review Notes (inline, found during writing)

Spec coverage check:
- ✅ Sync script split — Task 1, finalised in Task 17.
- ✅ HttpDataSource + FsaDataSource — Tasks 4-5.
- ✅ appSchemaStore — Tasks 6-7-8 (load + boot gate + consumer migration in 14).
- ✅ schemaDriftValidator — Tasks 2-3.
- ✅ definitionsStore refactor — Tasks 10-12-15.
- ✅ LoadGate drift mode — Task 13.
- ✅ Recents Starter entry + openStarterProject — Tasks 9, 16.
- ✅ Header / DefinitionsTab UI — Task 16.
- ✅ Smoke tests + README — Tasks 18-19.

Type/method consistency:
- `DataSource` interface used same across Tasks 4-5-11-12. `readFile` / `writeFile` / `deleteFile` / `renameFile` / `readProjectMeta` / `writeProjectMeta` signatures consistent.
- `useAppSchemaStore` selector pattern matches existing `useDefinitionsStore` pattern.
- `validateSchemaDrift(defs, classNodes, propertyMeta)` arg order consistent between test (Task 2) and call site (Task 11).
- `loadGate` discriminated union `{mode: 'structural' | 'drift'}` introduced cleanly in Task 13; earlier sets in Task 11 use this shape.

Placeholder scan: no TBD, no "implement later", no "handle edge cases" hand-waves. Every code block is the actual code to write.
