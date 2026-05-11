# Save/Load Improvements — Design

**Date:** 2026-05-11
**Status:** Approved (pre-implementation)

## Motivation

The editor's save/load is already strong: File System Access API, IndexedDB-pinned handles, `project.json`, bundled-defaults fallback, sync-to-Unreal. Four gaps remain — surfaced by comparing against the sibling LevelEditor project — that improve durability and onboarding without changing the file format:

1. **Validation gate on load** — malformed or structurally-invalid records silently degrade behavior. Catch them at import time with a continue-anyway dialog.
2. **Schema version enforcement** — `project.json` already carries `schema_version: 1`; nothing reads it. A future-version folder opened by an old editor can corrupt data on save.
3. **Local-draft autosave** — a tab crash loses every dirty record. Snapshot dirty records to IndexedDB so the next open can offer to restore.
4. **Recent projects** — re-picking the folder on every cold start is friction. A split-button with a dropdown of recents shortens that path.

LevelEditor's RLE compression and Blob/download primary-save flow are explicitly out of scope.

## Architecture

Four new pure modules under `web/src/persistence/` + small wiring in `definitionsStore` + two new modals + a Header split-button. The four modules each own one storage concern with a single-purpose interface; they're React-free and unit-testable with `node:test`.

```
web/src/
├─ store/definitionsStore.ts      ← extended; existing public API unchanged
├─ persistence/
│   ├─ schemaVersion.ts           ← NEW. version compare + parse
│   ├─ structuralValidator.ts     ← NEW. pre-load JSON checks
│   ├─ draftStore.ts              ← NEW. IndexedDB-backed dirty cache
│   └─ recentProjects.ts          ← NEW. IndexedDB-backed recent list
└─ components/
    ├─ Header.tsx                 ← split-button + dropdown for recents
    ├─ LoadGate.tsx               ← NEW. modal: validator issues / future-version
    └─ RestoreDraftPrompt.tsx     ← NEW. modal: restore unsaved drafts
```

IndexedDB layout (shared db `tsic-handles`):
- `kv` — existing (current directory handle)
- `drafts` — NEW (one entry per project key)
- `recents` — NEW (cloned handles + metadata)

## Module specs

### `schemaVersion.ts`

```ts
export const SUPPORTED_VERSION = 1;
export function isSupported(v: number): boolean;     // v <= SUPPORTED_VERSION
export function isFuture(v: number): boolean;        // v >  SUPPORTED_VERSION
export function parseMeta(raw: unknown):
  | { ok: true; meta: ProjectMeta }
  | { ok: false; reason: 'malformed' | 'no-version' };
```

`openProject` calls `parseMeta` on the loaded `project.json`; if `isFuture(meta.schema_version)`, it sets a `futureVersionBlock` slot and aborts before `reload`. `<LoadGate>` reads that slot. Legacy folders (no `project.json`) keep the existing migration path; treated as v1.

### `structuralValidator.ts`

```ts
export type StructuralIssue =
  | { kind: 'invalid-json'; folder: string; file: string; error: string }
  | { kind: 'missing-field'; folder: string; file: string; field: 'id' | 'asset_path' | 'class' }
  | { kind: 'id-mismatch'; folder: string; file: string; json_id: string; file_id: string };

export function validateBatch(
  files: Array<{ folder: string; name: string; text: string }>,
): StructuralIssue[];
```

Called inside `reload()` *before* records are committed. If `issues.length > 0`, store sets `loadGate: { issues, pendingCommit }` and stops. `<LoadGate>` renders the list (max 50 + "and N more") with **Continue anyway** (commit valid, drop bad, toast) and **Cancel** (no commit). Bundled defaults bypass.

### `draftStore.ts`

```ts
export function projectKey(meta: ProjectMeta, handleName: string): string;
export function saveDraft(key: string, records: Array<[DefinitionsKey, DefinitionRecord]>): Promise<void>;
export function loadDraft(key: string): Promise<{ records: Array<[DefinitionsKey, DefinitionRecord]>; savedAt: number } | null>;
export function clearDraft(key: string): Promise<void>;
export function listKeys(): Promise<string[]>;
```

`definitionsStore` gets a private `scheduleDraftFlush()`, debounced 1s, called wherever `dirty` is mutated. Serializes only records in `dirty` (minimal). On successful `openProject` / `reload`, the store calls `loadDraft(key)`; if non-null, mounts `<RestoreDraftPrompt>` with **Restore** (merge into definitions, re-add to dirty) or **Discard** (calls `clearDraft`). `saveAllDirty` / `saveOne` call `clearDraft` on success.

Quota: `QuotaExceededError` from IndexedDB is caught, console-warned, toast "Drafts cache full — saves still work normally." Saves continue normally.

### `recentProjects.ts`

```ts
export type RecentEntry = {
  name: string;            // projectMeta.name or handle.name
  handleName: string;      // dedupe key
  handle: FileSystemDirectoryHandle;
  lastOpened: number;      // epoch ms
};
export function addRecent(entry: Omit<RecentEntry, 'lastOpened'>): Promise<void>;
export function listRecents(): Promise<RecentEntry[]>;  // desc by lastOpened, cap 8
export function removeRecent(handleName: string): Promise<void>;
```

`openProject` / `createProject` add on success. Header replaces `📂 Open project` with a split: main button keeps existing picker; chevron ▾ opens a dropdown listing recents (name + relative time). Clicking calls `tryOpenRecent`: `ensurePermission` first; on success, set handle and `reload`; on failure, `removeRecent` + toast "Couldn't reopen — pick the folder again." Dropdown closes on outside click.

## Data flow

```
openProject
  → showDirectoryPicker
  → readProjectMeta → schemaVersion.isFuture? → LoadGate (refuse) → STOP
  → reload
    → readAllJson
    → structuralValidator.validateBatch
    → issues > 0 ? LoadGate (errors + continue/cancel) → Continue: commit valid, drop bad
    → commit to store
    → loadDraft(key) → non-null? RestoreDraftPrompt
    → recentProjects.addRecent(entry)

edit field
  → markDirty(key)
  → scheduleDraftFlush() [debounced 1s] → draftStore.saveDraft

saveAllDirty / saveOne (success)
  → draftStore.clearDraft

Open project ▾
  → listRecents → render dropdown
  → click entry → tryOpenRecent → (same as openProject from "readProjectMeta")
```

## Error handling

| Failure | Behavior |
|---|---|
| IndexedDB quota for drafts | Catch `QuotaExceededError`, console.warn, toast. Saves continue. |
| Recent handle permission denied | `removeRecent` + toast, no state change. |
| Recent handle invalidated | Same as permission-denied. |
| Future `schema_version` | LoadGate refusal modal. No records committed. Handle dropped. |
| Structural issues, user cancels | No records committed. Store unchanged. |
| Draft restore but class hierarchy changed | Restore best-effort; Validations tab flags new orphans. |

## Testing strategy (TDD)

**Layer 1 — `node:test` units** in `web/tests/*.test.mjs`:
- `schemaVersion.test.mjs` — valid / malformed / missing-version / future
- `structuralValidator.test.mjs` — each `StructuralIssue` kind + clean batch returns `[]`
- `draftStore.test.mjs` — uses `fake-indexeddb` (new dev dep); save→load→clear roundtrip + quota handling
- `recentProjects.test.mjs` — dedupe + cap-at-8 + ordering

**Layer 2 — Playwright smoke** `web/savedload-ui-smoke.mjs`:
- Future-version refusal: mock picker → `project.json { schema_version: 999 }` → LoadGate refusal, no load
- Structural gate: malformed JSON in mock tree → LoadGate lists it → Continue → records minus bad + toast
- Draft restore: edit a field → reload → RestoreDraftPrompt → Restore → field still dirty
- Recent dropdown: open + create two projects → reload page → dropdown lists both → click most-recent reopens

**TDD per feature:** write failing node test → implement module → write failing smoke → wire store/UI → both green → commit. Each of the four features is its own commit.

**package.json** gains:
- `"test": "node --test web/tests/"`
- `"smoke:savedload": "node web/savedload-ui-smoke.mjs"`
- existing `smoke` script chains the new smoke at the end

## Out of scope

- RLE / any compression — data isn't dense-cell shaped
- Blob/download as primary save — FSA flow is strictly better
- Cross-project draft inbox UI
- Read-only mode for future-version folders
- User-configurable strict-load setting
