# Schema/Data Split — Design

**Date:** 2026-05-12
**Status:** Approved (pre-implementation)

## Motivation

`web/public/base-definitions/` today bundles three things with different lifecycles into one tree:

1. **Engine schema** — `.class-hierarchy.json`, `.property-meta.json`. Generated from C++ headers by `Tools/Export/scan_property_meta.py`. Changes only when C++ changes; never per-project.
2. **Starter dataset** — every `*.json` data file. A sensible default authors can fork.
3. **Project envelope** — `project.json` (synthesised in bundled-defaults mode).

`createProject({seedFromBundled: true})` then copies the sidecars **into each new project folder** (`definitionsStore.ts:1329-1349`), and `loadFromDirectory()` reads schema **from the project folder** (`definitionsStore.ts:696-710`). The consequence: every project carries a private copy of the schema that silently goes stale relative to the running app build. The bundled-defaults mode is also a stripped-down branch — no drafts, no recents, no LoadGate — that the user has to consciously upgrade via Save As before persistence kicks in.

This design separates the three concerns so:
- Schema lives once, in the app build.
- Project folders carry only data + `project.json`. No sidecars.
- "Starter project" is just a read-only HTTP-backed project that flows through the same persistence machinery as a picked folder.

## Architecture

Four units, each with one job, plus a slimmer `definitionsStore`:

```
web/
├─ public/
│  ├─ schema/                              ← NEW. App-level engine schema
│  │   ├─ class-hierarchy.json
│  │   └─ property-meta.json
│  └─ starter-project/                     ← RENAMED from base-definitions/
│      ├─ manifest.json                    ← no `sidecars` field anymore
│      └─ <folder>/*.json                  ← data only
├─ scripts/
│  └─ sync-base-definitions.mjs            ← split-output (schema + starter)
└─ src/
    ├─ store/
    │   ├─ appSchemaStore.ts               ← NEW. classNodes, propertyMeta, enumMeta, propertySchema, idTemplates, pinnedProperties
    │   └─ definitionsStore.ts             ← slimmed; data + projectMeta + dirty only
    ├─ persistence/
    │   ├─ dataSource.ts                   ← NEW. DataSource interface + HttpDataSource + FsaDataSource
    │   └─ schemaDriftValidator.ts         ← NEW. detect unknown-class / unknown-property at load
    └─ components/
        ├─ LoadGate.tsx                    ← extended: third mode "drift"
        └─ Header.tsx                      ← Save disabled when ds.readOnly, "Starter project" entry in recents
```

The active `DataSource` is stored on `definitionsStore` alongside `projectMeta`. `directoryHandle` becomes a property of `FsaDataSource`, not the store.

## Module specs

### `appSchemaStore.ts` (new)

Zustand store. Single responsibility: own engine schema.

Fields:
- `classNodes: Map<string, ClassNode>`
- `hierarchySidecar: any | null`
- `propertyMeta: Map<string, PropertyMeta>`
- `enumMeta: Map<string, EnumMember[]>`
- `propertySchema: Map<string, {element_type?, key_type?, value_type?}>` — note: this is sniffed from records today, but moves here because every consumer of `propertyMeta` also reads `propertySchema`. Will be rebuilt by `definitionsStore` after each load and pushed into `appSchemaStore`.
- `idTemplates: Map<string, {prefix, suffix}>` — same as above; sniffed per-load and pushed.
- `pinnedProperties: Set<string>` — already localStorage-backed, stays.
- `loaded: boolean`

Actions:
- `loadSchema(): Promise<void>` — fetches `/schema/class-hierarchy.json` and `/schema/property-meta.json` once. Idempotent. Throws on failure (app refuses to boot — schema is required).
- `setPerLoadDerived({propertySchema, idTemplates})` — called by `definitionsStore` after each successful load.
- Lookup helpers move here: `getPropertyMeta`, `lookupContainerType`, `lookupArrayElementClass`, `getEnumMembers`, `folderForClass`, `togglePinnedProperty`.

App boots with `<SchemaGate>` wrapping `<App>`:
- `useEffect(() => { appSchemaStore.loadSchema(); }, [])`
- Render `null` (or a loading placeholder) until `loaded`.
- On error, render a fatal panel — schema is non-optional.

### `dataSource.ts` (new)

```ts
export interface DataSourceManifest {
  folders: string[];
  files: Array<{ folder: string; ids: string[] }>;
}

export interface DataSource {
  readonly kind: 'http' | 'fsa';
  readonly readOnly: boolean;
  /** Stable display label, e.g. "Starter project" or the picked folder name. */
  readonly displayName: string;
  readManifest(): Promise<DataSourceManifest>;
  readFile(folder: string, id: string): Promise<string>;
  writeFile?(folder: string, id: string, text: string): Promise<void>;
  deleteFile?(folder: string, id: string): Promise<void>;
  renameFile?(fromFolder: string, fromId: string, toFolder: string, toId: string): Promise<void>;
  /** Read project.json from the root. Returns null when absent. */
  readProjectMeta(): Promise<ProjectMeta | null>;
  /** Write project.json to the root. Only on writable sources. */
  writeProjectMeta?(meta: ProjectMeta): Promise<void>;
}
```

**`HttpDataSource(baseUrl: string)`** — backs the Starter project.
- `kind: 'http'`, `readOnly: true`.
- `readManifest()` fetches `${baseUrl}/manifest.json`.
- `readFile(folder, id)` fetches `${baseUrl}/${folder}/${id}.json`.
- `readProjectMeta()` returns a synthesised `{schema_version: 1, name: 'Starter project'}` — no HTTP `project.json` is required.
- Write methods omitted entirely (interface marks them optional).

**`FsaDataSource(handle: FileSystemDirectoryHandle)`** — backs picked projects.
- `kind: 'fsa'`, `readOnly: false`.
- `readManifest()` discovers folders by walking `handle.entries()`, **ignoring any `.class-hierarchy.json` / `.property-meta.json` it encounters** and ignoring layout folders.
- `readFile` / `writeFile` / `deleteFile` / `renameFile` go through the FSA handle.
- `readProjectMeta()` reads `project.json` from root; returns `null` if absent.
- `writeProjectMeta()` writes `project.json`.

### `schemaDriftValidator.ts` (new)

```ts
export type DriftIssue =
  | { recordKey: DefinitionsKey; kind: 'unknown-class'; className: string }
  | { recordKey: DefinitionsKey; kind: 'unknown-property'; parentType: string; propertyName: string };

export function validateSchemaDrift(
  defs: Map<DefinitionsKey, DefinitionRecord>,
  classNodes: Map<string, ClassNode>,
  propertyMeta: Map<string, PropertyMeta>,
): DriftIssue[];
```

Walks every record's typed envelope (root + nested struct fields). For each `class` field encountered, asserts membership in `classNodes`. For each leaf property, asserts existence of `${parentType}.${propertyName}` in `propertyMeta` against the record's class or any ancestor in its parent chain.

Capped at 200 issues to keep LoadGate UI tractable; further issues collapse into a single "and N more" entry.

### `definitionsStore.ts` (slimmed)

Removed fields: `classNodes`, `hierarchySidecar`, `propertyMeta`, `enumMeta`, `propertySchema`, `idTemplates`, `pinnedProperties` (all now in `appSchemaStore`).

Removed actions: `loadBundledDefaults` (replaced by `openStarterProject`), the schema lookup helpers (moved to `appSchemaStore`).

New / changed fields:
- `dataSource: DataSource | null` (replaces `directoryHandle: FileSystemDirectoryHandle | null` as the source-of-truth — the handle, when present, lives inside the active `FsaDataSource`).
- `projectMeta: ProjectMeta` — non-null always (synthesised for Starter).

New / changed actions:
- `openStarterProject()` — sets `dataSource = new HttpDataSource('/starter-project')` and runs `loadFromDataSource`.
- `openProject()` — pops directory picker → `FsaDataSource` → `loadFromDataSource`.
- `bootstrap()` — saved handle (with permission) → `FsaDataSource`; otherwise → `openStarterProject`.
- `saveOne` / `saveAllDirty` — guard on `dataSource.readOnly`; refuse to run.
- `saveAs()` — pops picker → new `FsaDataSource` → write every record + fresh `project.json` → swap.
- `forgetDirectory()` → renamed `switchToStarter()`; clears saved handle, opens Starter.

`loadFromDataSource(ds)` (private, single funnel):

1. `manifest = await ds.readManifest()`
2. Fetch every file in parallel with concurrency cap.
3. `projectMeta = (await ds.readProjectMeta()) ?? synthesised`.
4. Run existing `structuralValidator` (already in place).
5. Run new `validateSchemaDrift(defs, appSchema.classNodes, appSchema.propertyMeta)`.
6. If drift issues → set `loadGate: {mode: 'drift', issues, onContinue, onCancel}`, abort commit.
7. On Continue (or no issues): commit records, rebuild `referencedByIndex`, push `propertySchema` + `idTemplates` into `appSchemaStore`, prompt draft restore if applicable, refresh recents.

## Recents and drafts for the Starter project

- `recentProjects.ts` (existing) grows a permanent synthetic entry for Starter at the bottom of the list. `openRecent('Starter project')` is wired to `openStarterProject()`.
- `draftStore.ts` (existing) keys drafts by `projectKey(meta, handleName)`. For Starter, `handleName === 'starter-project'`; `projectKey` returns `'Starter project|starter-project'`. Drafts persist across reloads identically to a picked project.
- The Restore prompt fires for Starter on next visit if drafts exist.

## UI changes

- Header `↺ Bundled defaults` button → `↺ Starter project`. Same action (now `switchToStarter`).
- Header Save / Save current / Save all buttons → disabled when `dataSource.readOnly` (tooltip: "Use Save As to write Starter project changes to disk").
- Header Sync-to-Unreal button → disabled when `dataSource.readOnly` (no `ue_sync_path` on Starter).
- `DefinitionsTab` toolbar — `"No directory selected"` label is gone; always shows the active `dataSource.displayName` (which is "Starter project" or the picked folder name).
- `LoadGate` — third mode `'drift'`. Lists each `DriftIssue` grouped by `kind`. Continue commits + records remain accessible; Cancel switches back to the previous source (or Starter on first load).

## Sync script

`web/scripts/sync-base-definitions.mjs` renames to `sync-bundled.mjs` and emits two trees:

| Pass | Source | Destination |
|---|---|---|
| Schema | `$TSIC_DEFINITIONS_SRC/.class-hierarchy.json`, `.property-meta.json` | `web/public/schema/{class-hierarchy,property-meta}.json` |
| Starter | `$TSIC_DEFINITIONS_SRC/<folder>/*.json` (excluding layout folders) | `web/public/starter-project/<folder>/*.json` + `manifest.json` |

`manifest.json` loses the `sidecars: {hierarchy, propertyMeta}` field. The `HttpDataSource` no longer needs it.

`package.json` scripts:
- `sync-defaults` runs the new script (same name).
- `dev` and `build` continue to invoke `sync-defaults` first.
- `TSIC_DEFINITIONS_SRC` override env var unchanged.

## Data flow summary

```
Boot:
  appSchemaStore.loadSchema()         ── fetch /schema/*.json
  ↓
  definitionsStore.bootstrap()
    saved FSA handle? ──yes──→ FsaDataSource(handle) ──→ loadFromDataSource
    │
    └─no─→ HttpDataSource('/starter-project') ──→ loadFromDataSource

loadFromDataSource(ds):
  ds.readManifest() → ds.readFile(...)  (records)
  ds.readProjectMeta()                  (or synthesise)
  structuralValidator → loadGate(structural)?
  schemaDriftValidator → loadGate(drift)?
  commit: defs, projectMeta, dataSource
  push derived → appSchemaStore.setPerLoadDerived
  draftStore.loadDraft → RestoreDraftPrompt?
  refreshRecents()

Save:
  dataSource.readOnly ──yes──→ buttons disabled
  │
  └─no─→ ds.writeFile(folder, id, text)  for each dirty record

Save As:
  pick folder → new FsaDataSource(handle)
  write every record + project.json via the new ds
  swap active dataSource, upgrade projectMeta.name, addRecent
```

## Migration / one-time effects

- Existing project folders on the user's disk that contain `.class-hierarchy.json` / `.property-meta.json`: app silently ignores them. The user removes them manually if they want (or leaves them — no harm).
- `web/public/base-definitions/` directory is removed by the next `sync-defaults` run (or by hand; it's gitignored).
- IndexedDB `drafts` and `recents` stores: untouched. Drafts keyed against the old `name = handle.name` legacy projects still work because that synthesised name is preserved.

## Out of scope

- Splitting `definitionsStore` into more zustand stores (data, dirty, selection). Outside this design's goal.
- Per-record `class_version` migration. Schema drift today is detected, not migrated.
- A "Reset Starter project" button (clearing Starter drafts). Possible follow-up.
- Bundling schema into the JS module (Approach B). Decided against on bundle-size grounds.

## Testing

**Unit (vitest)**
- `HttpDataSource` against mocked `fetch`: manifest, file reads, refuses writes (no `writeFile` method exposed).
- `FsaDataSource` against an in-memory FSA mock: read/write/delete/rename; **asserts sidecar files are skipped during `readManifest`**.
- `schemaDriftValidator`: fixture records vs. crafted partial schema; asserts both kinds of issue and the 200-issue cap.
- `appSchemaStore.loadSchema`: mocked fetch; populates fields; throws on 404.

**Integration (extend `web/definitions-ui-smoke.mjs`)**
- Boot → Starter loads → schema state populated → recents contains "Starter project" entry.
- Open FSA folder with stale `.class-hierarchy.json` → loads cleanly, no error toast, schema unchanged.
- Open FSA folder containing a record whose `class` is unknown → LoadGate appears in drift mode → click Continue → record visible.
- Save As from Starter → assert new folder contains only data files + `project.json` (no sidecars).
- Save / Save all disabled while Starter active.

**Existing tests to touch**
- `web/data-smoke.mjs` (if it fetches `base-definitions/`) → updated paths.
- `web/definitions-ui-smoke.mjs`, `web/debug-semantic.mjs` → updated paths.
- README "Bundled defaults" section rewritten as "Starter project" + schema split.
