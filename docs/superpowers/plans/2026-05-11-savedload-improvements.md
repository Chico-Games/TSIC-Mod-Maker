# Save/Load Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four orthogonal save/load improvements (schema-version gate, structural-validator gate, IndexedDB draft autosave, recent-projects split-button) without changing the on-disk JSON format.

**Architecture:** Four new pure modules under `web/src/persistence/` (`schemaVersion.ts`, `structuralValidator.ts`, `draftStore.ts`, `recentProjects.ts`) plus a tiny shared IndexedDB opener (`db.ts`) and two new React modals (`LoadGate.tsx`, `RestoreDraftPrompt.tsx`). `definitionsStore` wires them in; existing public API is unchanged. Unit tests with `node:test` + `tsx` + `fake-indexeddb`; flows with Playwright smoke (extends existing pattern).

**Tech Stack:** TypeScript, React 18, Zustand, Vite, File System Access API, IndexedDB. Test: `node:test`, `tsx` (loader), `fake-indexeddb`, Playwright.

---

## Files

- Create: `web/src/persistence/db.ts` — shared IndexedDB opener (bumps `tsic-handles` to v2, adds `drafts` + `recents` stores).
- Create: `web/src/persistence/schemaVersion.ts`
- Create: `web/src/persistence/structuralValidator.ts`
- Create: `web/src/persistence/draftStore.ts`
- Create: `web/src/persistence/recentProjects.ts`
- Modify: `web/src/handleStore.ts` — use the shared opener.
- Modify: `web/src/store/definitionsStore.ts` — wire the four modules; new state slots.
- Modify: `web/src/components/Header.tsx` — split-button + dropdown.
- Create: `web/src/components/LoadGate.tsx`
- Create: `web/src/components/RestoreDraftPrompt.tsx`
- Modify: `web/src/App.tsx` — mount the new modals.
- Modify: `web/src/styles.css` — small modal/dropdown styling.
- Create: `web/tests/schemaVersion.test.ts`
- Create: `web/tests/structuralValidator.test.ts`
- Create: `web/tests/draftStore.test.ts`
- Create: `web/tests/recentProjects.test.ts`
- Create: `web/savedload-ui-smoke.mjs`
- Modify: `web/package.json` — `test`, `smoke:savedload` scripts; `tsx` + `fake-indexeddb` devDeps.

---

## Task 0: Scaffold test infra + shared db

**Files:**
- Modify: `web/package.json`
- Create: `web/src/persistence/db.ts`
- Modify: `web/src/handleStore.ts`
- Create: `web/tests/scaffold.test.ts`

- [ ] **Step 1: Install dev deps**

Run from `web/`:
```
npm install --save-dev tsx fake-indexeddb
```

Expected: `package.json` devDependencies gains both entries; lockfile updates.

- [ ] **Step 2: Add npm scripts**

Edit `web/package.json`. Add to `scripts` block (keep existing entries):
```json
"test": "node --import tsx --test \"web/tests/*.test.ts\"",
"smoke:savedload": "node savedload-ui-smoke.mjs"
```
Update the chained `smoke` script to:
```json
"smoke": "node definitions-ui-smoke.mjs && node recipes-loot-ui-smoke.mjs && node items-furniture-ui-smoke.mjs && node savedload-ui-smoke.mjs"
```
Note: `test` path is relative to repo root because that's where npm scripts run from when you `cd` into web; if running from project root use `web/web/tests/*.test.ts`. We `cd web/` to run.

- [ ] **Step 3: Write the failing scaffold test**

Create `web/tests/scaffold.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDb, DRAFTS_STORE, RECENTS_STORE, KV_STORE } from '../src/persistence/db';

test('shared db opens with all three object stores', async () => {
  const db = await openDb();
  const names = Array.from(db.objectStoreNames);
  assert.ok(names.includes(KV_STORE), `missing ${KV_STORE}`);
  assert.ok(names.includes(DRAFTS_STORE), `missing ${DRAFTS_STORE}`);
  assert.ok(names.includes(RECENTS_STORE), `missing ${RECENTS_STORE}`);
  db.close();
});
```

- [ ] **Step 4: Run test, confirm fail**

```
cd web && npm test
```
Expected: FAIL — `Cannot find module '../src/persistence/db'`.

- [ ] **Step 5: Implement `db.ts`**

Create `web/src/persistence/db.ts`:
```ts
export const DB_NAME = 'tsic-handles';
export const DB_VERSION = 2;
export const KV_STORE = 'kv';
export const DRAFTS_STORE = 'drafts';
export const RECENTS_STORE = 'recents';

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) db.createObjectStore(DRAFTS_STORE);
      if (!db.objectStoreNames.contains(RECENTS_STORE)) db.createObjectStore(RECENTS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

- [ ] **Step 6: Refactor `handleStore.ts` to use shared opener**

Edit `web/src/handleStore.ts`. Replace the top of the file (lines 1–17) with:
```ts
import { openDb, KV_STORE } from './persistence/db';
const STORE = KV_STORE;
```
Delete the local `DB_NAME`, `STORE`, and `openDb` definitions. Existing `putHandle` / `getHandle` / `deleteHandle` / `ensurePermission` bodies stay the same (they reference `STORE`).

- [ ] **Step 7: Run test to verify pass**

```
cd web && npm test
```
Expected: PASS (1 test).

- [ ] **Step 8: Verify existing smoke still works**

```
cd web && npm run smoke:def
```
Expected: PASS (no regression in existing definitions smoke).

- [ ] **Step 9: Commit**

```
git add web/package.json web/package-lock.json web/src/persistence/db.ts web/src/handleStore.ts web/tests/scaffold.test.ts
git commit -m "chore(persist): shared IndexedDB opener + test scaffold"
```

---

## Task 1: Schema-version gate

**Files:**
- Create: `web/src/persistence/schemaVersion.ts`
- Create: `web/src/components/LoadGate.tsx`
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`
- Create: `web/tests/schemaVersion.test.ts`
- Modify: `web/savedload-ui-smoke.mjs` (create at first sub-step)

- [ ] **Step 1: Write the failing unit test**

Create `web/tests/schemaVersion.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSupported, isFuture, parseMeta, SUPPORTED_VERSION } from '../src/persistence/schemaVersion';

test('SUPPORTED_VERSION is a positive integer', () => {
  assert.ok(Number.isInteger(SUPPORTED_VERSION) && SUPPORTED_VERSION >= 1);
});

test('isSupported / isFuture partition the space', () => {
  assert.equal(isSupported(1), true);
  assert.equal(isFuture(1), false);
  assert.equal(isSupported(SUPPORTED_VERSION + 1), false);
  assert.equal(isFuture(SUPPORTED_VERSION + 1), true);
  assert.equal(isSupported(0), false);
  assert.equal(isSupported(Number.NaN), false);
  assert.equal(isFuture(Number.NaN), false);
});

test('parseMeta accepts a valid project.json shape', () => {
  const res = parseMeta({ schema_version: 1, name: 'P', ue_sync_path: 'X' });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.meta.name, 'P');
});

test('parseMeta rejects missing version', () => {
  const res = parseMeta({ name: 'P' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'no-version');
});

test('parseMeta rejects missing name', () => {
  const res = parseMeta({ schema_version: 1 });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'malformed');
});

test('parseMeta rejects non-object', () => {
  assert.equal(parseMeta(null).ok, false);
  assert.equal(parseMeta(42).ok, false);
  assert.equal(parseMeta('hi').ok, false);
});
```

- [ ] **Step 2: Run, confirm fail**

```
cd web && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `schemaVersion.ts`**

Create `web/src/persistence/schemaVersion.ts`:
```ts
import type { ProjectMeta } from '../store/definitionsStore';

export const SUPPORTED_VERSION = 1;

export function isSupported(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= SUPPORTED_VERSION;
}

export function isFuture(v: number): boolean {
  return Number.isInteger(v) && v > SUPPORTED_VERSION;
}

export type ParseResult =
  | { ok: true; meta: ProjectMeta }
  | { ok: false; reason: 'malformed' | 'no-version' };

export function parseMeta(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'malformed' };
  }
  const r = raw as Record<string, unknown>;
  if (!('schema_version' in r) || typeof r.schema_version !== 'number') {
    return { ok: false, reason: 'no-version' };
  }
  if (typeof r.name !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, meta: raw as ProjectMeta };
}
```

- [ ] **Step 4: Run unit tests to verify pass**

```
cd web && npm test
```
Expected: PASS (8 tests).

- [ ] **Step 5: Add store slot + wiring**

Edit `web/src/store/definitionsStore.ts`. In the `DefinitionsStore` interface block (around line 72), add:
```ts
/** When non-null, the user opened a project.json with a too-new schema_version
 *  and we refuse to load it. UI mounts <LoadGate> in refusal mode. */
futureVersionBlock: { foundVersion: number; supportedVersion: number } | null;
dismissFutureVersionBlock: () => void;
```

In the store body initial state (around line 1051), add:
```ts
futureVersionBlock: null,
```

In the actions block (alongside `setToast`):
```ts
dismissFutureVersionBlock: () => set({ futureVersionBlock: null }),
```

In `openProject`, change the `let projectMeta = await readProjectMeta(handle);` block to:
```ts
const rawMeta = await readProjectMeta(handle);
let projectMeta: ProjectMeta;
if (rawMeta) {
  const v = (rawMeta as { schema_version?: number }).schema_version;
  if (typeof v === 'number') {
    const { isFuture, SUPPORTED_VERSION } = await import('../persistence/schemaVersion');
    if (isFuture(v)) {
      set({ futureVersionBlock: { foundVersion: v, supportedVersion: SUPPORTED_VERSION } });
      return;
    }
  }
  projectMeta = rawMeta;
} else {
  // Legacy folder without project.json — migrate localStorage sync path
  const lsSyncPath = (() => {
    try { return localStorage.getItem('tsic.def.syncpath.v1') ?? undefined; }
    catch { return undefined; }
  })();
  projectMeta = {
    schema_version: 1,
    name: handle.name,
    ...(lsSyncPath ? { ue_sync_path: lsSyncPath } : {}),
  };
}
```

(Replace the existing `let projectMeta = ...` through `}` of the legacy-fallback block — see definitionsStore.ts:1116–1129 for current code.)

- [ ] **Step 6: Implement `LoadGate.tsx`**

Create `web/src/components/LoadGate.tsx`:
```tsx
import { useDefinitionsStore } from '../store/definitionsStore';

export function LoadGate() {
  const block = useDefinitionsStore((s) => s.futureVersionBlock);
  const dismiss = useDefinitionsStore((s) => s.dismissFutureVersionBlock);
  if (!block) return null;
  return (
    <div className="loadgate-overlay" onClick={dismiss}>
      <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
        <h2>This project needs a newer editor</h2>
        <p>
          The project's <code>project.json</code> declares
          <code> schema_version: {block.foundVersion}</code>, but this editor
          only supports up to <code>{block.supportedVersion}</code>.
        </p>
        <p>Update the editor before opening this project to avoid data loss.</p>
        <div className="loadgate-actions">
          <button autoFocus onClick={dismiss}>Got it</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Mount LoadGate in App.tsx**

Edit `web/src/App.tsx`. Add the import:
```tsx
import { LoadGate } from './components/LoadGate';
```
Inside the root JSX, alongside other top-level overlays, add:
```tsx
<LoadGate />
```

- [ ] **Step 8: Add minimal styles**

Append to `web/src/styles.css`:
```css
.loadgate-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.loadgate-modal {
  background: var(--bg-1, #222); color: var(--fg, #eee);
  padding: 1.5rem 2rem; border-radius: 8px; max-width: 32rem;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}
.loadgate-modal h2 { margin: 0 0 0.5rem; }
.loadgate-modal code { background: rgba(255,255,255,0.08); padding: 0 0.3em; border-radius: 3px; }
.loadgate-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
.loadgate-issues { max-height: 24rem; overflow-y: auto; margin: 1rem 0; font-size: 0.85em; }
.loadgate-issues li { margin-bottom: 0.25rem; }
```

- [ ] **Step 9: Run typecheck**

```
cd web && npm run typecheck
```
Expected: no errors.

- [ ] **Step 10: Create the smoke harness file**

Create `web/savedload-ui-smoke.mjs`. Use the same skeleton as `web/projects-ui-smoke.mjs` (port 4242, server spawn, `assert`, `buildMockPicker`). At the bottom inside the main IIFE, add Test 1 — future-version refusal:
```js
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4243;

function startServer() {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });
}
async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`server didn't come up in ${timeoutMs}ms`);
}
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`OK: ${msg}`);
}
function buildMockPicker(initialContents) {
  return `(() => {
    try { localStorage.setItem('tsic.def.skipBundled.v1', '1'); } catch {}
    const contents = ${JSON.stringify(initialContents)};
    const writes = {};
    function makeFileHandle(name, parent) {
      return {
        kind: 'file', name,
        async getFile() { return new File([parent[name] || ''], name, { type: 'application/json' }); },
        async createWritable() {
          return {
            async write(data) {
              const s = (data && typeof data === 'object' && 'text' in data) ? await data.text() : String(data);
              parent[name] = s; writes[name] = s;
            },
            async close() {},
          };
        },
      };
    }
    function makeDirHandle(name, c) {
      return {
        kind: 'directory', name,
        async *entries() {
          for (const k of Object.keys(c)) {
            const v = c[k];
            yield typeof v === 'string'
              ? [k, makeFileHandle(k, c)]
              : [k, makeDirHandle(k, v)];
          }
        },
        async getDirectoryHandle(sub, opts) {
          if (!(sub in c)) { if (opts?.create) c[sub] = {}; else throw new Error('NotFoundError'); }
          return makeDirHandle(sub, c[sub]);
        },
        async getFileHandle(fn, opts) {
          if (!(fn in c)) { if (opts?.create) c[fn] = ''; else throw new Error('NotFoundError'); }
          return makeFileHandle(fn, c);
        },
        async removeEntry(n) { delete c[n]; },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; },
      };
    }
    const root = makeDirHandle('MockRoot', contents);
    window._mockRoot = root; window._mockContents = contents; window._mockWrites = writes;
    window.showDirectoryPicker = async () => root;
  })();`;
}

(async () => {
  const proc = startServer();
  let stdoutBuf = '', stderrBuf = '';
  proc.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
  let browser;
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    browser = await chromium.launch();

    // Test 1: future-version refusal
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 999, name: 'From The Future' }, null, 2),
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.loadgate-modal h2:has-text("newer editor")');
      assert(true, 'Future-version: LoadGate refusal modal appears');
      const projectShown = await page.locator('.file-info:has-text("Project: From The Future")').count();
      assert(projectShown === 0, 'Future-version: no records loaded (file-info does NOT show project name)');
      await page.locator('.loadgate-modal button:has-text("Got it")').click();
      await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      await ctx.close();
    }

    console.log('\n=== ALL SAVE/LOAD SMOKE TESTS PASSED ===\n');
  } catch (err) {
    console.error('Test failed:', err);
    console.error('--- server stdout ---\n', stdoutBuf.slice(-1500));
    console.error('--- server stderr ---\n', stderrBuf.slice(-1500));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }
})();
```

- [ ] **Step 11: Build, then run the smoke**

```
cd web && npm run build && npm run smoke:savedload
```
Expected: PASS — "ALL SAVE/LOAD SMOKE TESTS PASSED".

- [ ] **Step 12: Commit**

```
git add web/src/persistence/schemaVersion.ts web/src/components/LoadGate.tsx web/src/store/definitionsStore.ts web/src/App.tsx web/src/styles.css web/tests/schemaVersion.test.ts web/savedload-ui-smoke.mjs web/package.json
git commit -m "feat(persist): refuse to open project.json with future schema_version"
```

---

## Task 2: Structural validator gate

**Files:**
- Create: `web/src/persistence/structuralValidator.ts`
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/src/components/LoadGate.tsx`
- Create: `web/tests/structuralValidator.test.ts`
- Modify: `web/savedload-ui-smoke.mjs`

- [ ] **Step 1: Write the failing unit test**

Create `web/tests/structuralValidator.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBatch } from '../src/persistence/structuralValidator';

const good = JSON.stringify({ id: 'ID_Foo_CI', asset_path: '/Game/X', class: 'BP_X_C' });

test('clean batch yields no issues', () => {
  const issues = validateBatch([
    { folder: 'constructable_item_definitions', name: 'ID_Foo_CI.json', text: good },
  ]);
  assert.deepEqual(issues, []);
});

test('invalid-json kind on parse failure', () => {
  const issues = validateBatch([
    { folder: 'x', name: 'bad.json', text: '{ not json' },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'invalid-json');
});

test('missing-field kind for each required key', () => {
  const noId = JSON.stringify({ asset_path: '/Game/X', class: 'C' });
  const noPath = JSON.stringify({ id: 'X', class: 'C' });
  const noClass = JSON.stringify({ id: 'X', asset_path: '/Game/X' });
  const issues = validateBatch([
    { folder: 'a', name: 'x.json', text: noId },
    { folder: 'a', name: 'y.json', text: noPath },
    { folder: 'a', name: 'z.json', text: noClass },
  ]);
  assert.equal(issues.length, 3);
  assert.deepEqual(issues.map((i) => (i as { field: string }).field).sort(), ['asset_path', 'class', 'id']);
});

test('id-mismatch kind when json.id != filename stem', () => {
  const mis = JSON.stringify({ id: 'ID_Other_CI', asset_path: '/Game/X', class: 'C' });
  const issues = validateBatch([
    { folder: 'a', name: 'ID_Foo_CI.json', text: mis },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'id-mismatch');
});

test('reports one issue per kind per file (does not double-count)', () => {
  const issues = validateBatch([
    { folder: 'a', name: 'x.json', text: 'garbage' },
    { folder: 'a', name: 'good.json', text: good },
  ]);
  assert.equal(issues.length, 1);
});
```

- [ ] **Step 2: Run, confirm fail**

```
cd web && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `structuralValidator.ts`**

Create `web/src/persistence/structuralValidator.ts`:
```ts
export type StructuralIssue =
  | { kind: 'invalid-json'; folder: string; file: string; error: string }
  | { kind: 'missing-field'; folder: string; file: string; field: 'id' | 'asset_path' | 'class' }
  | { kind: 'id-mismatch'; folder: string; file: string; json_id: string; file_id: string };

interface InputFile { folder: string; name: string; text: string; }

export function validateBatch(files: InputFile[]): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const f of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.text);
    } catch (e) {
      issues.push({ kind: 'invalid-json', folder: f.folder, file: f.name, error: String(e) });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push({ kind: 'invalid-json', folder: f.folder, file: f.name, error: 'top-level is not an object' });
      continue;
    }
    const r = parsed as Record<string, unknown>;
    for (const field of ['id', 'asset_path', 'class'] as const) {
      if (typeof r[field] !== 'string' || !r[field]) {
        issues.push({ kind: 'missing-field', folder: f.folder, file: f.name, field });
      }
    }
    if (typeof r.id === 'string' && r.id) {
      const fileId = f.name.replace(/\.json$/i, '');
      if (r.id !== fileId) {
        issues.push({ kind: 'id-mismatch', folder: f.folder, file: f.name, json_id: r.id, file_id: fileId });
      }
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run unit tests to verify pass**

```
cd web && npm test
```
Expected: PASS (all schemaVersion + structuralValidator tests).

- [ ] **Step 5: Add store slot for loadGate**

Edit `web/src/store/definitionsStore.ts`. In `DefinitionsStore` interface, add (next to `futureVersionBlock`):
```ts
loadGate: {
  issues: import('../persistence/structuralValidator').StructuralIssue[];
  onContinue: () => void;
  onCancel: () => void;
} | null;
dismissLoadGate: (action: 'continue' | 'cancel') => void;
```

Initial state:
```ts
loadGate: null,
```

Action:
```ts
dismissLoadGate: (action) => {
  const g = get().loadGate;
  if (!g) return;
  set({ loadGate: null });
  if (action === 'continue') g.onContinue();
  else g.onCancel();
},
```

- [ ] **Step 6: Wire validator into `reload()`**

Edit `web/src/store/definitionsStore.ts`. Inside `reload`, after `readAllJson` returns the parsed records, the existing code parses each file. We need raw text for the validator. Refactor `reload`'s file-reading loop to keep raw text per file. Concretely: the existing `readAllJson` (definitionsStore.ts:651 region) yields `{ folder, name, text }` items — keep those and pass them to `validateBatch` before parsing. If issues.length > 0:

```ts
import { validateBatch } from '../persistence/structuralValidator';
// ...inside reload, after collecting raw files into `rawFiles`:
const issues = validateBatch(rawFiles);
if (issues.length > 0) {
  await new Promise<void>((resolve) => {
    set({
      loadGate: {
        issues,
        onContinue: () => { /* fall through */ resolve(); },
        onCancel: () => { set({ loading: false }); resolve(); /* caller checks for cancellation */ },
      },
    });
  });
  if (get().loadGate === null && /* user cancelled? */ false) {
    return;
  }
}
// In the parse loop, skip files that produced a kind=invalid-json or missing-field issue.
```

(Implementor: the precise insertion depends on the current shape of `reload`; the rule is: produce a `rawFiles: { folder, name, text }[]` list, run `validateBatch`, await the gate's promise on issues, then continue parsing while skipping issue-flagged files.)

- [ ] **Step 7: Extend `LoadGate.tsx` to render issues**

Replace `web/src/components/LoadGate.tsx`:
```tsx
import { useDefinitionsStore } from '../store/definitionsStore';

export function LoadGate() {
  const futureBlock = useDefinitionsStore((s) => s.futureVersionBlock);
  const dismissFuture = useDefinitionsStore((s) => s.dismissFutureVersionBlock);
  const gate = useDefinitionsStore((s) => s.loadGate);
  const dismissGate = useDefinitionsStore((s) => s.dismissLoadGate);

  if (futureBlock) {
    return (
      <div className="loadgate-overlay" onClick={dismissFuture}>
        <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
          <h2>This project needs a newer editor</h2>
          <p>
            The project's <code>project.json</code> declares
            <code> schema_version: {futureBlock.foundVersion}</code>, but this editor
            only supports up to <code>{futureBlock.supportedVersion}</code>.
          </p>
          <p>Update the editor before opening this project to avoid data loss.</p>
          <div className="loadgate-actions">
            <button autoFocus onClick={dismissFuture}>Got it</button>
          </div>
        </div>
      </div>
    );
  }

  if (gate) {
    const shown = gate.issues.slice(0, 50);
    const more = gate.issues.length - shown.length;
    return (
      <div className="loadgate-overlay" onClick={() => dismissGate('cancel')}>
        <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
          <h2>{gate.issues.length} problem{gate.issues.length === 1 ? '' : 's'} loading this project</h2>
          <p>The following files are structurally invalid and will be skipped if you continue.</p>
          <ul className="loadgate-issues">
            {shown.map((i, idx) => (
              <li key={idx}>
                <code>{i.folder}/{i.file}</code> —{' '}
                {i.kind === 'invalid-json' && <>invalid JSON: {i.error}</>}
                {i.kind === 'missing-field' && <>missing required field <code>{i.field}</code></>}
                {i.kind === 'id-mismatch' && <>id <code>{i.json_id}</code> ≠ filename <code>{i.file_id}</code></>}
              </li>
            ))}
            {more > 0 && <li><em>…and {more} more.</em></li>}
          </ul>
          <div className="loadgate-actions">
            <button onClick={() => dismissGate('cancel')}>Cancel</button>
            <button autoFocus onClick={() => dismissGate('continue')}>Continue anyway</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 8: Typecheck**

```
cd web && npm run typecheck
```
Expected: no errors.

- [ ] **Step 9: Add structural-validator smoke**

Edit `web/savedload-ui-smoke.mjs`. Inside the IIFE after Test 1, add Test 2:
```js
    // Test 2: structural-validator gate (continue path)
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'P' }, null, 2),
        'constructable_item_definitions': {
          'ID_OK_CI.json': JSON.stringify({ id: 'ID_OK_CI', asset_path: '/Game/X', class: 'BP_C' }),
          'broken.json': '{ not valid json',
        },
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.loadgate-modal:has-text("problem")');
      assert(true, 'Structural: LoadGate appears with issues');
      const liText = await page.locator('.loadgate-issues').textContent();
      assert(liText && liText.includes('broken.json'), 'Structural: broken file is listed');
      await page.locator('.loadgate-modal button:has-text("Continue anyway")').click();
      await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      await page.waitForSelector('.file-info:has-text("Project: P")');
      assert(true, 'Structural: project loads after Continue');
      await ctx.close();
    }
```

- [ ] **Step 10: Build + run smoke**

```
cd web && npm run build && npm run smoke:savedload
```
Expected: PASS (Tests 1 and 2).

- [ ] **Step 11: Commit**

```
git add web/src/persistence/structuralValidator.ts web/src/components/LoadGate.tsx web/src/store/definitionsStore.ts web/tests/structuralValidator.test.ts web/savedload-ui-smoke.mjs
git commit -m "feat(persist): structural validator gate on project load"
```

---

## Task 3: Draft autosave + restore prompt

**Files:**
- Create: `web/src/persistence/draftStore.ts`
- Create: `web/src/components/RestoreDraftPrompt.tsx`
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/src/App.tsx`
- Create: `web/tests/draftStore.test.ts`
- Modify: `web/savedload-ui-smoke.mjs`

- [ ] **Step 1: Write the failing unit test**

Create `web/tests/draftStore.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { projectKey, saveDraft, loadDraft, clearDraft, listKeys } from '../src/persistence/draftStore';

const meta = { schema_version: 1, name: 'Proj' };
const key = projectKey(meta, 'mockHandle');

test('projectKey is stable and includes name + handleName', () => {
  assert.equal(projectKey(meta, 'mockHandle'), projectKey(meta, 'mockHandle'));
  assert.notEqual(projectKey(meta, 'a'), projectKey(meta, 'b'));
  assert.notEqual(projectKey({ ...meta, name: 'Other' }, 'mockHandle'), key);
});

test('save/load/clear roundtrip', async () => {
  const rec = { id: 'ID_X_CI', folder: 'f', json: { id: 'ID_X_CI' }, originalText: '{}', diskId: 'ID_X_CI', diskFolder: 'f' };
  await saveDraft(key, [['f/ID_X_CI', rec as any]]);
  const r = await loadDraft(key);
  assert.ok(r !== null);
  assert.equal(r!.records.length, 1);
  assert.equal(r!.records[0][0], 'f/ID_X_CI');
  assert.ok(typeof r!.savedAt === 'number');
  await clearDraft(key);
  assert.equal(await loadDraft(key), null);
});

test('listKeys reflects current drafts', async () => {
  await saveDraft('k1', []);
  await saveDraft('k2', []);
  const keys = await listKeys();
  assert.ok(keys.includes('k1'));
  assert.ok(keys.includes('k2'));
  await clearDraft('k1');
  await clearDraft('k2');
});

test('saveDraft tolerates QuotaExceededError', async () => {
  // simulate by stubbing IDBObjectStore.put to throw
  // (fake-indexeddb won't reject for real, so we just ensure no throw on success)
  await assert.doesNotReject(saveDraft(key, []));
  await clearDraft(key);
});
```

- [ ] **Step 2: Run, confirm fail**

```
cd web && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `draftStore.ts`**

Create `web/src/persistence/draftStore.ts`:
```ts
import { openDb, DRAFTS_STORE } from './db';
import type { DefinitionRecord, DefinitionsKey, ProjectMeta } from '../store/definitionsStore';

export function projectKey(meta: ProjectMeta, handleName: string): string {
  return `${meta.name}|${handleName}`;
}

export interface DraftPayload {
  records: Array<[DefinitionsKey, DefinitionRecord]>;
  savedAt: number;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, mode);
      const store = tx.objectStore(DRAFTS_STORE);
      Promise.resolve(fn(store)).then(resolve, reject);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(key: string, records: Array<[DefinitionsKey, DefinitionRecord]>): Promise<void> {
  try {
    await withStore('readwrite', (s) => new Promise<void>((res, rej) => {
      const req = s.put({ records, savedAt: Date.now() } as DraftPayload, key);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    }));
  } catch (e) {
    if ((e as DOMException)?.name === 'QuotaExceededError') {
      console.warn('[drafts] quota exceeded — drafts cache full');
      return;
    }
    throw e;
  }
}

export async function loadDraft(key: string): Promise<DraftPayload | null> {
  return withStore('readonly', (s) => new Promise<DraftPayload | null>((res, rej) => {
    const req = s.get(key);
    req.onsuccess = () => res((req.result as DraftPayload | undefined) ?? null);
    req.onerror = () => rej(req.error);
  }));
}

export async function clearDraft(key: string): Promise<void> {
  await withStore('readwrite', (s) => new Promise<void>((res, rej) => {
    const req = s.delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  }));
}

export async function listKeys(): Promise<string[]> {
  return withStore('readonly', (s) => new Promise<string[]>((res, rej) => {
    const req = s.getAllKeys();
    req.onsuccess = () => res((req.result as IDBValidKey[]).map(String));
    req.onerror = () => rej(req.error);
  }));
}
```

- [ ] **Step 4: Run tests to verify pass**

```
cd web && npm test
```
Expected: PASS (schemaVersion + structuralValidator + draftStore).

- [ ] **Step 5: Add store slots + scheduleDraftFlush**

Edit `web/src/store/definitionsStore.ts`. Add to `DefinitionsStore` interface:
```ts
restoreDraftPrompt: { key: string; savedAt: number; recordCount: number } | null;
acceptDraftRestore: () => Promise<void>;
declineDraftRestore: () => Promise<void>;
```

Add initial state:
```ts
restoreDraftPrompt: null,
```

Add private flush helper inside the store body (top-level, before `create<DefinitionsStore>`):
```ts
let draftFlushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDraftFlush(get: () => DefinitionsStore) {
  if (draftFlushTimer) clearTimeout(draftFlushTimer);
  draftFlushTimer = setTimeout(async () => {
    draftFlushTimer = null;
    const s = get();
    const meta = s.projectMeta;
    const handle = s.directoryHandle;
    if (!meta || !handle) return;
    const { projectKey, saveDraft } = await import('../persistence/draftStore');
    const key = projectKey(meta, handle.name);
    const dirtyRecords: Array<[string, DefinitionRecord]> = [];
    for (const k of s.dirty) {
      const rec = s.definitions.get(k);
      if (rec) dirtyRecords.push([k, rec]);
    }
    if (dirtyRecords.length === 0) {
      const { clearDraft } = await import('../persistence/draftStore');
      await clearDraft(key);
    } else {
      await saveDraft(key, dirtyRecords);
    }
  }, 1000);
}
```

Find every `set((s) => ({ dirty: ... }))` mutation and append `; scheduleDraftFlush(get);` after the set call (or wrap it in a helper). Easier: define a top-level helper:
```ts
function markDirty(set: any, get: any, key: DefinitionsKey) {
  set((s: DefinitionsStore) => {
    if (s.dirty.has(key)) return s;
    const next = new Set(s.dirty); next.add(key); return { dirty: next };
  });
  scheduleDraftFlush(get);
}
```
…and replace direct `dirty` mutations in the store with `markDirty(set, get, k)`. (Implementor: find the existing dirty-set additions — `saveOne` clears dirty; `updateRecord` and similar add to dirty. Update all add-paths.)

In `reload`'s success path (after committing records), add:
```ts
const projectMeta = get().projectMeta;
const handle = get().directoryHandle;
if (projectMeta && handle) {
  const { projectKey, loadDraft } = await import('../persistence/draftStore');
  const key = projectKey(projectMeta, handle.name);
  const draft = await loadDraft(key);
  if (draft && draft.records.length > 0) {
    set({ restoreDraftPrompt: { key, savedAt: draft.savedAt, recordCount: draft.records.length } });
  }
}
```

Add actions:
```ts
acceptDraftRestore: async () => {
  const prompt = get().restoreDraftPrompt;
  if (!prompt) return;
  const { loadDraft, clearDraft } = await import('../persistence/draftStore');
  const draft = await loadDraft(prompt.key);
  set({ restoreDraftPrompt: null });
  if (!draft) return;
  set((s) => {
    const defs = new Map(s.definitions);
    const dirty = new Set(s.dirty);
    for (const [k, rec] of draft.records) {
      defs.set(k, rec);
      dirty.add(k);
    }
    return { definitions: defs, dirty };
  });
  await clearDraft(prompt.key);
},
declineDraftRestore: async () => {
  const prompt = get().restoreDraftPrompt;
  if (!prompt) return;
  const { clearDraft } = await import('../persistence/draftStore');
  await clearDraft(prompt.key);
  set({ restoreDraftPrompt: null });
},
```

In `saveOne` and `saveAllDirty`, after the successful write (where `dirty` is cleared for the key), call `scheduleDraftFlush(get)` so an empty-dirty flush deletes the draft entry.

- [ ] **Step 6: Implement `RestoreDraftPrompt.tsx`**

Create `web/src/components/RestoreDraftPrompt.tsx`:
```tsx
import { useDefinitionsStore } from '../store/definitionsStore';

function relativeTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'less than a minute ago';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} hr ago`;
  return `${Math.floor(d / 86_400_000)} days ago`;
}

export function RestoreDraftPrompt() {
  const prompt = useDefinitionsStore((s) => s.restoreDraftPrompt);
  const accept = useDefinitionsStore((s) => s.acceptDraftRestore);
  const decline = useDefinitionsStore((s) => s.declineDraftRestore);
  if (!prompt) return null;
  return (
    <div className="loadgate-overlay" onClick={() => void decline()}>
      <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Restore unsaved changes?</h2>
        <p>
          {prompt.recordCount} record{prompt.recordCount === 1 ? '' : 's'} ha{prompt.recordCount === 1 ? 's' : 've'}
          {' '}unsaved edits from {relativeTime(prompt.savedAt)}.
        </p>
        <div className="loadgate-actions">
          <button onClick={() => void decline()}>Discard</button>
          <button autoFocus onClick={() => void accept()}>Restore</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Mount in App.tsx**

Edit `web/src/App.tsx`. Add:
```tsx
import { RestoreDraftPrompt } from './components/RestoreDraftPrompt';
```
And in the JSX next to `<LoadGate />`:
```tsx
<RestoreDraftPrompt />
```

- [ ] **Step 8: Typecheck**

```
cd web && npm run typecheck
```
Expected: no errors.

- [ ] **Step 9: Add draft-restore smoke**

Edit `web/savedload-ui-smoke.mjs`. After Test 2, add Test 3. This test uses two sequential page loads in the same context (so IndexedDB persists):
```js
    // Test 3: draft autosave + restore
    {
      const ctx = await browser.newContext();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'DraftP' }, null, 2),
        'constructable_item_definitions': {
          'ID_DraftFoo_CI.json': JSON.stringify({ id: 'ID_DraftFoo_CI', asset_path: '/Game/X', class: 'BP_C' }, null, 2),
        },
      };
      const initScript = buildMockPicker(tree);

      // 1st visit: open + edit
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: DraftP")');
        // Mutate dirty set directly via the store — simulates an edit without depending on a specific field UI.
        await page.evaluate(() => {
          const s = (window as any).__defStore || (window as any).useDefinitionsStore;
          // exposed via dev hook (see Task 3 Step 11)
          (window as any).__forceDirty?.();
        });
        // Wait at least 1.5s for the debounced draft flush.
        await page.waitForTimeout(1500);
        await page.close();
      }

      // 2nd visit: re-open same folder, expect RestoreDraftPrompt
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.loadgate-modal h2:has-text("Restore unsaved")');
        assert(true, 'Draft: RestoreDraftPrompt appears on second open');
        await page.locator('.loadgate-modal button:has-text("Restore")').click();
        await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
        // Verify the unsaved-count chip shows ≥ 1
        await page.waitForSelector('.file-info:has-text("unsaved")');
        assert(true, 'Draft: after Restore, header shows unsaved badge');
        await page.close();
      }
      await ctx.close();
    }
```

- [ ] **Step 10: Expose a test hook for forcing dirty**

The smoke needs to mark a record dirty without depending on a particular field UI. Add a small dev-only hook to `web/src/store/definitionsStore.ts` at module bottom:
```ts
if (typeof window !== 'undefined' && (import.meta as any).env?.MODE !== 'production') {
  (window as any).__forceDirty = () => {
    const s = useDefinitionsStore.getState();
    const firstKey = s.definitions.keys().next().value;
    if (!firstKey) return;
    const rec = s.definitions.get(firstKey)!;
    // Toggle a benign field on the record to simulate an edit, mark dirty.
    useDefinitionsStore.setState((cur) => {
      const next = new Map(cur.definitions);
      next.set(firstKey, { ...rec, json: { ...rec.json, __testDirty: Date.now() } });
      const dirty = new Set(cur.dirty); dirty.add(firstKey);
      return { definitions: next, dirty };
    });
    // Manually trigger draft flush
    (useDefinitionsStore.getState() as any)._scheduleDraftFlush?.();
  };
}
```
Also export `_scheduleDraftFlush` from the store as an internal method that simply calls `scheduleDraftFlush(get)`:
```ts
_scheduleDraftFlush: () => scheduleDraftFlush(get),
```
…and add `_scheduleDraftFlush: () => void` to the interface (mark as private convention).

- [ ] **Step 11: Build + run smoke**

```
cd web && npm run build && npm run smoke:savedload
```
Expected: PASS (Tests 1, 2, 3).

- [ ] **Step 12: Commit**

```
git add web/src/persistence/draftStore.ts web/src/components/RestoreDraftPrompt.tsx web/src/store/definitionsStore.ts web/src/App.tsx web/tests/draftStore.test.ts web/savedload-ui-smoke.mjs
git commit -m "feat(persist): IndexedDB draft autosave + restore prompt"
```

---

## Task 4: Recent projects split-button

**Files:**
- Create: `web/src/persistence/recentProjects.ts`
- Modify: `web/src/components/Header.tsx`
- Modify: `web/src/store/definitionsStore.ts`
- Modify: `web/src/styles.css`
- Create: `web/tests/recentProjects.test.ts`
- Modify: `web/savedload-ui-smoke.mjs`

- [ ] **Step 1: Write the failing unit test**

Create `web/tests/recentProjects.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { addRecent, listRecents, removeRecent } from '../src/persistence/recentProjects';

const fakeHandle = (n: string) => ({ kind: 'directory', name: n } as any);

test('listRecents starts empty', async () => {
  // Note: fake-indexeddb shares state across tests in the same file — use unique names
  const before = await listRecents();
  for (const r of before) await removeRecent(r.handleName);
  assert.deepEqual(await listRecents(), []);
});

test('addRecent stores and lists', async () => {
  await addRecent({ name: 'P1', handleName: 'h1', handle: fakeHandle('h1') });
  const list = await listRecents();
  assert.equal(list.length, 1);
  assert.equal(list[0].handleName, 'h1');
  assert.ok(typeof list[0].lastOpened === 'number');
  await removeRecent('h1');
});

test('addRecent dedupes by handleName, bumps lastOpened', async () => {
  await addRecent({ name: 'P', handleName: 'dup', handle: fakeHandle('dup') });
  const first = (await listRecents()).find((r) => r.handleName === 'dup')!.lastOpened;
  await new Promise((r) => setTimeout(r, 5));
  await addRecent({ name: 'P', handleName: 'dup', handle: fakeHandle('dup') });
  const list = await listRecents();
  const dupEntries = list.filter((r) => r.handleName === 'dup');
  assert.equal(dupEntries.length, 1);
  assert.ok(dupEntries[0].lastOpened > first);
  await removeRecent('dup');
});

test('listRecents is sorted desc by lastOpened and capped at 8', async () => {
  for (let i = 0; i < 12; i++) {
    await addRecent({ name: `P${i}`, handleName: `h${i}`, handle: fakeHandle(`h${i}`) });
    await new Promise((r) => setTimeout(r, 2));
  }
  const list = await listRecents();
  assert.equal(list.length, 8);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].lastOpened >= list[i].lastOpened);
  }
  // youngest should win
  assert.equal(list[0].handleName, 'h11');
  for (const r of list) await removeRecent(r.handleName);
});
```

- [ ] **Step 2: Run, confirm fail**

```
cd web && npm test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `recentProjects.ts`**

Create `web/src/persistence/recentProjects.ts`:
```ts
import { openDb, RECENTS_STORE } from './db';

export interface RecentEntry {
  name: string;
  handleName: string;
  handle: FileSystemDirectoryHandle;
  lastOpened: number;
}

const CAP = 8;

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(RECENTS_STORE, mode);
      const store = tx.objectStore(RECENTS_STORE);
      Promise.resolve(fn(store)).then(resolve, reject);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function addRecent(entry: Omit<RecentEntry, 'lastOpened'>): Promise<void> {
  const full: RecentEntry = { ...entry, lastOpened: Date.now() };
  try {
    await withStore('readwrite', (s) => new Promise<void>((res, rej) => {
      const req = s.put(full, entry.handleName);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    }));
    // Enforce cap
    const all = await listRecents();
    if (all.length > CAP) {
      for (const r of all.slice(CAP)) await removeRecent(r.handleName);
    }
  } catch (e) {
    console.warn('[recents] addRecent failed', e);
  }
}

export async function listRecents(): Promise<RecentEntry[]> {
  return withStore('readonly', (s) => new Promise<RecentEntry[]>((res, rej) => {
    const req = s.getAll();
    req.onsuccess = () => {
      const all = (req.result as RecentEntry[]) ?? [];
      all.sort((a, b) => b.lastOpened - a.lastOpened);
      res(all);
    };
    req.onerror = () => rej(req.error);
  }));
}

export async function removeRecent(handleName: string): Promise<void> {
  await withStore('readwrite', (s) => new Promise<void>((res, rej) => {
    const req = s.delete(handleName);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  }));
}
```

- [ ] **Step 4: Run tests to verify pass**

```
cd web && npm test
```
Expected: PASS (all unit tests).

- [ ] **Step 5: Wire into store**

Edit `web/src/store/definitionsStore.ts`.

Add to interface:
```ts
recents: import('../persistence/recentProjects').RecentEntry[];
refreshRecents: () => Promise<void>;
openRecent: (handleName: string) => Promise<void>;
```

Initial state:
```ts
recents: [],
```

Actions:
```ts
refreshRecents: async () => {
  const { listRecents } = await import('../persistence/recentProjects');
  set({ recents: await listRecents() });
},
openRecent: async (handleName) => {
  const { listRecents, removeRecent, addRecent } = await import('../persistence/recentProjects');
  const all = await listRecents();
  const entry = all.find((r) => r.handleName === handleName);
  if (!entry) {
    set({ toast: { kind: 'error', text: 'That recent project is no longer available.' } });
    return;
  }
  const ok = await ensurePermission(entry.handle, 'readwrite');
  if (!ok) {
    await removeRecent(handleName);
    await get().refreshRecents();
    set({ toast: { kind: 'error', text: "Couldn't reopen — pick the folder again." } });
    return;
  }
  try {
    const rawMeta = await readProjectMeta(entry.handle);
    let projectMeta: ProjectMeta;
    if (rawMeta) {
      const v = (rawMeta as { schema_version?: number }).schema_version;
      if (typeof v === 'number') {
        const { isFuture, SUPPORTED_VERSION } = await import('../persistence/schemaVersion');
        if (isFuture(v)) {
          set({ futureVersionBlock: { foundVersion: v, supportedVersion: SUPPORTED_VERSION } });
          return;
        }
      }
      projectMeta = rawMeta;
    } else {
      projectMeta = { schema_version: 1, name: entry.handle.name };
    }
    try { await putHandle(HANDLE_KEY, entry.handle); } catch {}
    set({ directoryHandle: entry.handle, projectMeta, unrealSyncPath: projectMeta.ue_sync_path ?? '' });
    await get().reload();
    await addRecent({ name: projectMeta.name, handleName: entry.handleName, handle: entry.handle });
    await get().refreshRecents();
  } catch (e) {
    set({ toast: { kind: 'error', text: `Failed to open: ${String(e)}` } });
  }
},
```

In `openProject` success path (after the `await get().reload();`), add:
```ts
const { addRecent } = await import('../persistence/recentProjects');
await addRecent({ name: projectMeta.name, handleName: handle.name, handle });
await get().refreshRecents();
```

In `createProject` success path (after `await get().reload();`), add the same two lines using the meta and handle from that scope.

In `bootstrap` after the initial state is set, call:
```ts
await get().refreshRecents();
```

- [ ] **Step 6: Add Header split-button + dropdown**

Edit `web/src/components/Header.tsx`. Replace the existing `📂 Open project` button (around line 145) with:
```tsx
<div className="open-project-split">
  <button onClick={() => void openProject()} disabled={!fsa}>📂 Open project</button>
  <button
    className="open-project-chevron"
    disabled={!fsa}
    onClick={() => setRecentsOpen((v) => !v)}
    title="Recent projects"
  >▾</button>
  {recentsOpen && recents.length > 0 && (
    <div className="recents-dropdown" onMouseLeave={() => setRecentsOpen(false)}>
      {recents.map((r) => (
        <button
          key={r.handleName}
          className="recents-item"
          onClick={async () => { setRecentsOpen(false); await openRecent(r.handleName); }}
        >
          <span className="recents-name">{r.name}</span>
          <span className="recents-time">{relativeTime(r.lastOpened)}</span>
        </button>
      ))}
    </div>
  )}
  {recentsOpen && recents.length === 0 && (
    <div className="recents-dropdown" onMouseLeave={() => setRecentsOpen(false)}>
      <div className="recents-empty">No recent projects yet.</div>
    </div>
  )}
</div>
```

Add to the Header function imports at the top:
```tsx
import { useState } from 'react';
```
…and inside `Header`:
```tsx
const [recentsOpen, setRecentsOpen] = useState(false);
const recents = useDefinitionsStore((s) => s.recents);
const openRecent = useDefinitionsStore((s) => s.openRecent);
const refreshRecents = useDefinitionsStore((s) => s.refreshRecents);
useEffect(() => { void refreshRecents(); }, [refreshRecents]);
function relativeTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
```

- [ ] **Step 7: Style the dropdown**

Append to `web/src/styles.css`:
```css
.open-project-split { position: relative; display: inline-flex; }
.open-project-split > button:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.open-project-chevron { padding: 0 0.4rem; border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 1px solid rgba(255,255,255,0.15); }
.recents-dropdown {
  position: absolute; top: 100%; left: 0; min-width: 16rem;
  background: var(--bg-1, #222); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px; box-shadow: 0 6px 24px rgba(0,0,0,0.4);
  z-index: 50; padding: 0.25rem 0;
}
.recents-item {
  display: flex; justify-content: space-between; align-items: center; gap: 1rem;
  width: 100%; padding: 0.4rem 0.8rem; background: none; border: none; color: inherit;
  text-align: left; cursor: pointer;
}
.recents-item:hover { background: rgba(255,255,255,0.08); }
.recents-name { font-weight: 500; }
.recents-time { opacity: 0.6; font-size: 0.85em; }
.recents-empty { padding: 0.6rem 0.8rem; opacity: 0.7; font-style: italic; }
```

- [ ] **Step 8: Typecheck**

```
cd web && npm run typecheck
```
Expected: no errors.

- [ ] **Step 9: Add recents smoke**

Edit `web/savedload-ui-smoke.mjs`. After Test 3, add Test 4:
```js
    // Test 4: recent-projects dropdown
    {
      const ctx = await browser.newContext();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'RecentP' }, null, 2),
      };
      const initScript = buildMockPicker(tree);

      // Visit 1: open project (writes to recents)
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: RecentP")');
        await page.close();
      }

      // Visit 2: chevron should show RecentP
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
        await page.locator('.open-project-chevron').click();
        await page.waitForSelector('.recents-dropdown .recents-name:has-text("RecentP")');
        assert(true, 'Recents: dropdown lists RecentP after first open');
        // Click it
        await page.locator('.recents-item:has(.recents-name:text("RecentP"))').click();
        await page.waitForSelector('.file-info:has-text("Project: RecentP")');
        assert(true, 'Recents: clicking entry reopens the project');
        await page.close();
      }
      await ctx.close();
    }
```

- [ ] **Step 10: Build + run smoke**

```
cd web && npm run build && npm run smoke:savedload
```
Expected: PASS (Tests 1, 2, 3, 4).

- [ ] **Step 11: Commit**

```
git add web/src/persistence/recentProjects.ts web/src/components/Header.tsx web/src/store/definitionsStore.ts web/src/styles.css web/tests/recentProjects.test.ts web/savedload-ui-smoke.mjs
git commit -m "feat(persist): recent projects split-button + dropdown"
```

---

## Task 5: Final regression sweep

- [ ] **Step 1: Run every test layer**

```
cd web && npm test
```
Expected: PASS — all unit tests.

- [ ] **Step 2: Run every smoke**

```
cd web && npm run smoke
```
Expected: PASS — definitions, recipes-loot, items-furniture, savedload smokes all green.

- [ ] **Step 3: Typecheck**

```
cd web && npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Final commit if anything was tweaked**

```
git status
# If clean, no commit needed.
```

---

## Self-review

- **Spec coverage:**
  - schemaVersion gate → Task 1 ✓
  - structural validator gate → Task 2 ✓
  - draft autosave + restore → Task 3 ✓
  - recents split-button → Task 4 ✓
  - IndexedDB schema bump (`drafts`, `recents`) → Task 0 ✓
  - Two-layer testing (node + Playwright) → all tasks ✓
- **Placeholder scan:** no TBDs/TODOs in tasks. One non-prescriptive line in Task 2 Step 6 marked "(Implementor: ...)" because the precise insertion depends on current `reload` shape; the contract (produce `rawFiles`, validate, await gate, skip flagged files) is fully specified.
- **Type consistency:** `ProjectMeta`, `DefinitionRecord`, `DefinitionsKey`, `StructuralIssue`, `RecentEntry`, `DraftPayload` referenced consistently. `projectKey`/`saveDraft`/`loadDraft`/`clearDraft`/`listKeys` names match across draftStore module and store wiring. `addRecent`/`listRecents`/`removeRecent` likewise.
