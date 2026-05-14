# Open Default Project — design

Bake the default Definitions tree into the app as an always-loaded, versioned baseline. Re-frame project saves as overlays (diffs vs default) that gracefully rebase when the default evolves. Give the dev team an in-app way to "Publish as new Default Project version" so the bundled default can be updated without external scripts.

## Goals

- The default project is always the underlying baseline for any open project. A project on disk only contains files that differ from the default.
- Defaults are versioned (auto-incremented integer + optional human label). When the bundled default advances, existing projects silently rebase onto it; the user's overlay always wins on conflict.
- Devs can update the default in-app: open default → edit → "Publish as new Default Project version" → directory picker → writes back into `web/public/starter-project/` on disk and bumps the version.
- Mod.io publishing keeps producing a delta ZIP; no version pin in `mod.json` — consumers rebase against whatever default they have.
- Existing full-tree projects on disk are migrated transparently to the overlay format the first time they're saved.

## Non-goals

- Renaming the on-disk folder `web/public/starter-project/` (high churn for low gain — name stays; only user-facing strings change).
- A full conflict-resolution UI for the silent-rebase case (a non-overridden default file changes, then the user overrides it — the overlay wins, no prompt).
- Cross-default-version interop in `mod.json` (consumers rebase against their own default).
- Reference-scrubbing on default publish (dangling refs handled gracefully at load time).
- Network/cloud sync of the default project.

## Terminology

User-facing UI shifts from "bundled / starter / sample defaults" to **Default Project**.

- "Open Default Project" replaces "Load Bundled Defaults".
- "Publish as new Default Project version" is the new dev-only action.
- "Default project location" is the new Settings field.

Internal renames (kept conservative):
- `loadBundledDefaults` → `loadDefaultProject`. Keep `openStarterProject` as a thin alias that calls the new function (back-compat for `recents` keyed on `'starter-project'`).
- `mod.json`'s `base.source: 'starter-project'` → `'default-project'`.
- Folder path `web/public/starter-project/` is **not** renamed.

## On-disk formats

### Default Project (`web/public/starter-project/`)

The default tree on disk gains a top-level `default.json` next to `manifest.json`:

```json
{
  "schema_version": 1,
  "version": 4,
  "label": "2026-05 winter pass",
  "published_at": "2026-05-14T11:56:54.841Z"
}
```

- `version` (integer) is monotonically non-decreasing. The "Publish as new Default Project version" action bumps it by 1.
- `label` is an optional free-text string the dev types when publishing. May be empty.
- `published_at` is an ISO timestamp.

`manifest.json` keeps its current shape (folders + files). The action that publishes a new version regenerates both files.

### Overlay project (a user's project folder on disk)

Same layout as today — `project.json` + per-folder subdirectories — but only **diff files** are written:

- A definition that exists in the default and the user has not changed: **not on disk**.
- A definition that exists in the default and the user has overridden: written as the full overridden JSON at `<folder>/<id>.json`.
- A definition that does **not** exist in the default but was added by the user: written at `<folder>/<id>.json`.
- A definition that exists in the default but the user removed from their project: written as an **empty placeholder file** at `<folder>/<id>.json` (a zero-byte file or a single-line marker; see Open questions).

`project.json` gains one new field:

```json
{
  "schema_version": 2,
  "name": "My Mod",
  "based_on_default_version": 3,
  "created_at": "2026-05-10T…"
}
```

- `based_on_default_version` records the integer version of the default this project was last opened/saved against. Used only for telemetry / diagnostics — silent rebase means we always load against the current default — but kept on disk so we can later (a) report drift, (b) support pinned-version opens if a user ever needs it.
- `schema_version` bumps from `1` to `2` to mark the overlay format.

## Module / data-flow architecture

```
HTTP starter-project/  ──┐
                         │
FSA "default source" ────┴──►  defaultProjectStore  ──► overlayLoader  ──► definitionsStore
   (when set in settings)         (loads + caches             (layers overlay
                                   manifest, default.json,     records on top of
                                   all default records as      default records,
                                   a Map<key, json>)           applies tombstones)

definitionsStore ──► overlaySaver ──► dataSource.writeFile (only dirty records)
                                  └── dataSource.deleteFile (for placeholders / un-overrides)
                                  └── project.json update
```

### New: `web/src/persistence/defaultProject.ts`

Pure module. Loads the default into memory.

```ts
export interface DefaultProjectMeta {
  schema_version: number;
  version: number;
  label: string;
  published_at: string;
}
export interface DefaultProject {
  meta: DefaultProjectMeta;
  records: Map<DefinitionsKey, any>;   // parsed JSON
  texts: Map<DefinitionsKey, string>;  // canonical re-serialised text (for diffing)
}
export async function loadDefaultProjectFromHttp(baseUrl: string): Promise<DefaultProject>;
export async function loadDefaultProjectFromFsa(handle: FileSystemDirectoryHandle): Promise<DefaultProject>;
```

A small `DefaultProjectSource` discriminated union is consumed by the bootstrap path so the rest of the code is source-agnostic:

```ts
type DefaultProjectSource =
  | { kind: 'http'; baseUrl: string }
  | { kind: 'fsa'; handle: FileSystemDirectoryHandle };
```

### New: `web/src/persistence/overlay.ts`

Pure module. Composes default + overlay into the working set.

```ts
export interface OverlayLoadResult {
  definitions: Map<DefinitionsKey, DefinitionRecord>;
  folders: string[];
  basedOn: number;       // default version we layered on top of (the current default)
  pinnedAt: number | null; // project.based_on_default_version (telemetry)
}
export function composeWorkingSet(
  def: DefaultProject,
  overlay: { records: Map<DefinitionsKey, any>; tombstones: Set<DefinitionsKey> },
): OverlayLoadResult;
```

Rules:
1. Start from `def.records`.
2. Apply overlay overrides (key-by-key replacement).
3. Apply tombstones (remove from working set).
4. The resulting `originalText` for an unchanged-from-default record is the default's canonical text (so a re-edit can detect "back to default"). For overridden records, `originalText` is the overlay file's text.

A separate `computeOverlay(def, defs)` helper does the reverse direction for saves: returns `{ overridden, added, removed }` keyed on `${folder}/${id}`.

### New: `web/src/persistence/defaultPublisher.ts`

```ts
export async function publishAsNewDefaultVersion(
  targetHandle: FileSystemDirectoryHandle,
  workingSet: Map<DefinitionsKey, DefinitionRecord>,
  current: DefaultProject,
  opts: { label?: string },
): Promise<DefaultProjectMeta>;
```

Steps performed (in order):
1. Validate `targetHandle` smells like a starter-project tree (must contain a `manifest.json`; refuse otherwise).
2. Strip any tombstone placeholders from the working set: collect their `<folder>/<id>` keys to delete on disk.
3. Drop any default-side files that are no longer present in the working set.
4. For every other record, serialise canonically and write to `<targetHandle>/<folder>/<id>.json`.
5. Regenerate `manifest.json` (folders + ids derived from what was just written).
6. Increment `current.meta.version` by 1 and write `default.json` (with optional `label`, fresh `published_at`).
7. Return the new meta.

No reference-scrubbing pass. Dangling refs are handled at load time everywhere.

### Changes to `definitionsStore.ts`

Bootstrap & load:
- `loadBundledDefaults` → `loadDefaultProject`. Reads `defaultProjectSource` setting; uses FSA when configured, else HTTP.
- New action: `openDefaultProject()` (renamed from `openStarterProject`; the old name stays as an alias).
- `loadFromDataSource` is refactored to take a `DefaultProject` parameter and use `composeWorkingSet`. Any non-FSA source (HTTP, ZIP) is treated as a full-tree source (no overlay layering) — these are read-only paths for browsing mods, opening the bundled default, etc.

Save:
- `saveOne` / `saveAllDirty` write only dirty records — already true today. New: also write empty placeholder files for records the user deleted that exist in the current default (tracked by a new `tombstones: Set<DefinitionsKey>` field in the store). Conversely, when a record is reverted to match the default exactly, the saved file is deleted on disk via `dataSource.deleteFile`.
- `saveAs`: writes the **overlay** to the target folder, not the full tree. Stamps `project.json.based_on_default_version` with the current default version. Writes only overrides/additions + tombstones.

Flatten export:
- New action: `exportFlattenedZip()` — produces a full-tree ZIP (default + overlay merged) so the user has a self-contained snapshot. The function name is suggestive; the action lives in the existing `exportZip` slot or beside it.

Default-source setting:
- New persisted setting: `defaultProjectSource` — either `'http'` (the unset/default value, points at the build's `/starter-project/`) or `'fsa'` (with an `FileSystemDirectoryHandle` stored in IndexedDB).
- New actions: `setDefaultProjectSource(handle)`, `clearDefaultProjectSource()`.
- The "Publish as new Default Project version" UI uses this handle as the picker's `startIn` value when set, so the picker opens at the right folder; user still confirms.

### Changes to mod.io packer

- `packer.ts` `baseSource` constant flips from `'starter-project'` to `'default-project'`.
- The `mod.json` `base` field becomes `{ source: 'default-project' }` only — the `version: null` key is dropped entirely (per "no pinning" decision).
- `loadStarterCatalog` is renamed `defaultCatalogFromLoaded(d: DefaultProject): StarterCatalog` and accepts the already-loaded default in memory; it no longer issues HTTP. The HTTP path moves to `defaultProject.ts::loadDefaultProjectFromHttp`. `modIoStore` passes the loaded `DefaultProject` directly when invoking the packer.

## User-visible flows

### A) Open Default Project (any user)

1. App boot. No saved project handle. `loadDefaultProject` runs.
2. `defaultProjectSource` is HTTP by default. Fetches `manifest.json`, `default.json`, and every listed file from `/starter-project/`.
3. Working set is the default itself, with `definitions` populated, `dirty` empty, and `directoryHandle` null.
4. Any edit dirties the record. "Save" prompts Save As (no handle yet). Saving creates an overlay project.

### B) Open existing overlay project

1. User picks the project folder (or it's auto-restored from `recents`).
2. `loadDefaultProject` loads current default into memory.
3. Walk the target folder. For each `<folder>/<id>.json`:
   - If size is 0 (placeholder): add to tombstones.
   - Otherwise: parse and add to overrides.
4. `composeWorkingSet(default, overlay)` produces the in-memory definitions.
5. `project.json.based_on_default_version` is compared to `default.meta.version`. If older, log to console and (silently) consider the project rebased. No prompt.
6. Subsequent saves write to the project folder per the rules above.

### C) Open legacy (full-tree, v1) project

1. Read `project.json`. `schema_version === 1` (or missing): treat as legacy.
2. Load it the old way (no overlay composition; the folder is the working set).
3. The first time the user saves after migration, we write `project.json.schema_version = 2`, stamp `based_on_default_version`, and migrate by **deleting** files from the folder that match the default exactly (so the folder becomes an overlay). One-time toast: "Migrated to overlay format. Files identical to the default project were removed from disk."

### D) Publish as new Default Project version (dev only)

1. Visible when the Settings toggle "Show developer actions" is on (off by default; persisted in localStorage).
2. User confirms (modal: shows current default version, asks for optional label, warns "this writes to the target folder").
3. Directory picker opens (with `startIn` set to the `defaultProjectSource` handle if configured).
4. We validate the picked folder contains a `manifest.json`. If not, error toast.
5. `publishAsNewDefaultVersion` runs. On success: toast shows new version + label.
6. The user commits the diff via git in their checkout.

### E) Mod.io publish

Unchanged externally. Internally, the packer now reads the in-memory `DefaultProject.texts` map instead of re-fetching, and `mod.json` carries `base.source: 'default-project'` and no `version` field.

### F) Flatten to full copy (export)

1. User picks "Export full snapshot…" from a menu.
2. We materialise `default ∪ overlay` into a ZIP (existing `exportZip` mechanism reused with a different input).
3. Browser downloads the ZIP.

## Edge cases & error handling

- **Empty placeholder file on disk but the default no longer has that key.** Tombstone is a no-op: ignore it on load, delete it on next save.
- **Override file on disk byte-identical to the default.** Loaded as a normal override; the next save (or a one-time pass) removes it from disk to avoid drift. We do this lazily on save, not on load, so a passive open doesn't mutate the user's folder.
- **Override file on disk but the default no longer has that key.** Treated as a user-added file. (We do not know the override was "an override" — only that it exists. That's fine; the saved overlay is preserved.)
- **Dangling references in default after publish** (a deleted definition is still referenced elsewhere). Handled at load time — the editor already self-heals via `autoCreateMissingRefs`; the spec for that path doesn't change. The game runtime is expected to be tolerant as well.
- **`default.json` missing on the HTTP-bundled default during transition.** Fall back to `version: 0`, `label: ''`, `published_at: epoch`. Logged with a warning.
- **Publish target validation.** If the picked folder lacks `manifest.json`, error and abort. If it contains `manifest.json` but is missing `default.json`, treat as `version: 0` and proceed (we'll create `default.json` as part of the write).

## Testing

Unit:
- `composeWorkingSet`: default + overlay + tombstones produce the right working set; tombstones remove keys; overrides replace records; added records appear.
- `computeOverlay`: round-trip through `composeWorkingSet` is idempotent.
- `defaultPublisher`: writes expected files, removes orphans, increments version, regenerates manifest.
- `legacy migration`: a folder with files identical to the default has them removed after the first save.

Integration / smoke:
- Boot, open default, edit one record, Save As to a temp folder. Verify only that one record is on disk + `project.json` with `based_on_default_version` set.
- Boot, open that overlay folder. Verify working set matches what was saved.
- Open the same overlay folder against a default with `version` bumped (mock the HTTP fetch) — verify silent rebase: untouched-by-overlay default changes flow through; override stays.
- Place an empty placeholder; verify the tombstoned key is absent from the working set.
- Mod.io publish: verify `mod.json` has `base.source: 'default-project'` and no `version` field.

UI smoke (Playwright via existing harness):
- "Open Default Project" menu item present and labelled correctly.
- Settings → "Default project location" picker round-trips.
- Dev-only "Publish as new Default Project version" hidden by default, visible behind dev toggle.

## Migration (one-shot)

- Bump `ProjectMeta.schema_version` to `2`.
- On open of a `schema_version: 1` project: load as full tree (current behaviour), set an internal `legacy: true` flag.
- On first save: write `project.json` with `schema_version: 2`, compute overlay, delete files identical to default from disk, write the rest. Toast the user.
- Open older overlays (still v2) normally.

## Rollout

- This branch (the one already in progress) implements the overlay model. Existing user data is migrated lazily on first save — no big-bang upgrade.
- The HTTP-bundled `default.json` is added in the same commit set as the code that reads it (so a fresh app boot never sees the file missing in a coherent build).
- Mod.io changes (`base.source` rename, version field removal) ship in the same release.

## Open questions

- **Placeholder format.** Zero-byte file vs a one-line `{ "$tombstone": true }` marker? Zero-byte is simpler and unambiguous; a JSON marker is visible/grep-able. Recommend zero-byte; revisit if it confuses someone.
- **Flatten export filename / placement.** Bundled in the same "Export…" menu or a separate item? Cosmetic; resolve during implementation.
