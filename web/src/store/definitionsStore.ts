import { create } from 'zustand';
import { deleteHandle, ensurePermission, getHandle, putHandle } from '../handleStore';
import { fuzzyMatch } from '../search/fuzzy';
import { buildReferencedByIndex, reindexRecord } from './referencedByIndex';
import { isFuture, SUPPORTED_VERSION } from '../persistence/schemaVersion';
import { validateBatch, type StructuralIssue } from '../persistence/structuralValidator';
import { clearDraft, loadDraft, projectKey, saveDraft } from '../persistence/draftStore';

// One JSON file in the Definitions tree. We keep the parsed object plus the
// pristine copy and a serialized "original" string so per-record dirty state
// can be detected without an expensive deep-equal on every edit.
export interface DefinitionRecord {
  folder: string;          // e.g. "consumable_definitions"
  id: string;              // asset name, also the filename stem
  json: any;               // mutable parsed JSON
  originalText: string;    // raw text loaded from disk
  /** The filename id this record was loaded with — used to clean up the
   *  old file on disk after a rename. Equal to `id` until the user
   *  edits the bare-name input. */
  diskId: string;
  /** The folder this record was loaded from — same purpose as diskId
   *  but for class-change relocations. */
  diskFolder: string;
}

export type DefinitionsKey = string; // `${folder}/${id}`

// Class-hierarchy entry. Loaded from the .class-hierarchy.json sidecar when
// present, otherwise derived from the union of every record's class+parent_classes.
export interface ClassNode {
  /** U-prefixed class name (e.g. "UConsumableDefinition"). */
  name: string;
  /** U-prefixed parent chain leaf-first. */
  parents: string[];
  /** Folder this class lives in, or null if no instances exist on disk. */
  folder: string | null;
}

/** One enum member from the `.property-meta.json` sidecar's `enums`
 *  section. The bare name comes straight from the .h; `display_name` is
 *  the optional UMETA(DisplayName="…") override. */
export interface EnumMember {
  name: string;
  display_name?: string;
}

/** One entry from the `.property-meta.json` sidecar produced by
 *  `Tools/Export/scan_property_meta.py`. Carries the UPROPERTY tooltip,
 *  Category, clamp bounds, and the element class for arrays of TObjectPtr.
 *  Any field can be null when the .h didn't supply it.
 */
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

export interface ProjectMeta {
  schema_version: number;
  name: string;
  description?: string;
  ue_sync_path?: string;
  created_at?: string;
}

export interface DefinitionsStore {
  // Persistence
  directoryHandle: FileSystemDirectoryHandle | null;
  /** Metadata loaded from project.json at the folder root. Null when no
   *  project.json was found (legacy folder) or when using bundled defaults. */
  projectMeta: ProjectMeta | null;
  /** True once we've attempted to auto-load on app start (whether it
   *  succeeded or not). Used to avoid double-loads. */
  bootstrapped: boolean;
  /** Whether the user has opted into auto-loading on startup. */
  autoLoadEnabled: boolean;

  // Data
  definitions: Map<DefinitionsKey, DefinitionRecord>;
  /** Per-record dirty flag — present means the record differs from disk. */
  dirty: Set<DefinitionsKey>;
  /** Reverse-reference index, lazily built once after each loadAll(). */
  referencedByIndex: import('./referencedByIndex').ReferencedByIndex;
  /** Folders discovered in the directory, in original order. */
  folders: string[];
  /** Last time loadAll completed. */
  loadedAt: number | null;
  /** Loading flag for spinner UI. */
  loading: boolean;
  /** Last error encountered. */
  errorText: string | null;
  /** Class-hierarchy nodes keyed by U-prefixed name. Built from the sidecar
   *  if present, otherwise from each record's class + parent_classes. */
  classNodes: Map<string, ClassNode>;
  /** Cached parsed `.class-hierarchy.json` payload — kept so that mutations
   *  (createDefinition, deleteDefinition) can rebuild classNodes without
   *  losing the sidecar's authoritative parent chains. */
  hierarchySidecar: any | null;

  /** Schema index built from every record's typed envelopes, keyed by the
   *  dotted "type path" (no numeric indexes). Stores element_type for
   *  array/set containers and key_type/value_type for maps. Lets the editor
   *  fill in the element shape for an empty container by stealing it from
   *  any sibling asset that has a non-empty value. */
  propertySchema: Map<string, { element_type?: any; key_type?: any; value_type?: any }>;
  /** Per-property metadata from the `.property-meta.json` sidecar — keyed
   *  by `${ParentTypeName}.${snake_property_name}`. Both the b-stripped
   *  and full snake form are registered; lookups can use either. */
  propertyMeta: Map<string, PropertyMeta>;
  /** Pinned property names. When a property in the editor matches a name
   *  in this set, it floats to the top of the property list — regardless
   *  of grouping. Persisted to localStorage so the choice is sticky. */
  pinnedProperties: Set<string>;
  /** Enum metadata from the `.property-meta.json` sidecar — keyed by the
   *  bare enum name (no `E` prefix), matching the `enum_name` field that
   *  the JSON exporter writes. */
  enumMeta: Map<string, EnumMember[]>;
  /** Per-class id naming template, derived on load from observed asset
   *  names: `{prefix, suffix}` strings (possibly empty). Lets the editor
   *  expose only the bare stem for the `id` field while reconstructing
   *  the full `prefix_stem_suffix` form on save / new-asset creation. */
  idTemplates: Map<string, { prefix: string; suffix: string }>;

  // Selection
  selectedFolder: string | null;
  selectedKey: DefinitionsKey | null;
  filter: string;

  // Toast
  toast: { kind: 'info' | 'error'; text: string } | null;

  /** When non-null, the user opened a project.json with a too-new
   *  schema_version and we refuse to load it. UI mounts <LoadGate>. */
  futureVersionBlock: { foundVersion: number; supportedVersion: number } | null;
  /** When non-null, the load preflight found structural issues. UI mounts
   *  <LoadGate> in issues mode; the user picks Continue or Cancel. */
  loadGate: {
    issues: StructuralIssue[];
    onContinue: () => void;
    onCancel: () => void;
  } | null;
  /** When non-null, a draft was found in IndexedDB for the just-opened
   *  project. The user is asked to Restore or Discard. */
  restoreDraftPrompt: { key: string; savedAt: number; recordCount: number } | null;

  // Actions
  setToast: (t: { kind: 'info' | 'error'; text: string } | null) => void;
  dismissFutureVersionBlock: () => void;
  dismissLoadGate: (action: 'continue' | 'cancel') => void;
  acceptDraftRestore: () => Promise<void>;
  declineDraftRestore: () => Promise<void>;
  setAutoLoad: (enabled: boolean) => void;
  selectFolder: (f: string | null) => void;
  selectDefinition: (k: DefinitionsKey | null) => void;
  setFilter: (q: string) => void;

  openProject: () => Promise<void>;
  pickDirectory: () => Promise<void>;
  /** Create a new project in an existing (possibly empty) directory. Optionally
   *  seeds the folder with the bundled default tree. */
  createProject: (options: {
    handle: FileSystemDirectoryHandle;
    name: string;
    ueSyncPath?: string;
    seedFromBundled?: boolean;
  }) => Promise<void>;
  forgetDirectory: () => Promise<void>;
  /** Try to restore last picked directory + auto-load if enabled.
   *  If no saved handle exists, fall back to loading bundled defaults
   *  from `web/public/base-definitions/`. */
  bootstrap: () => Promise<void>;
  reload: () => Promise<void>;
  /** Load the bundled default Definitions tree from
   *  `web/public/base-definitions/` (manifest + each file). Discards any
   *  current directory handle so the next Save prompts Save As. */
  loadBundledDefaults: () => Promise<void>;
  /** Pick a folder and write the entire current working set to it as
   *  Save As. Replaces the saved directory handle. */
  saveAs: () => Promise<void>;
  /** Walk every loaded asset for `definition_ref` envelopes whose
   *  value is set but doesn't resolve. For each missing target whose
   *  class is known, mint a blank asset of that class. Returns the
   *  count of newly created records. Idempotent — runs at the end of
   *  load paths so the dataset is always self-consistent. */
  autoCreateMissingRefs: () => { created: number; skipped: number };

  /** Update a single property on a definition (deep path). */
  updateValueAtPath: (key: DefinitionsKey, path: (string | number)[], value: any) => void;
  /** Replace the entire JSON object for a definition (used by raw-JSON editor). */
  replaceJson: (key: DefinitionsKey, json: any) => void;

  /** Save a single record back to disk. */
  saveOne: (key: DefinitionsKey) => Promise<void>;
  /** Save every dirty record. */
  saveAllDirty: () => Promise<{ saved: number; failed: number }>;
  /** Discard unsaved changes for one record. */
  revertOne: (key: DefinitionsKey) => void;

  /** Save all dirty, then POST to the TSICEditorSync endpoint to apply
   *  changes to UE. Returns the plain-text report. */
  syncToUnreal: () => Promise<{ ok: boolean; report: string }>;
  /** Absolute path to the on-disk Definitions folder. Stored in projectMeta
   *  when a project is open; falls back to localStorage for legacy folders. */
  unrealSyncPath: string;
  /** Update the sync path. When a project is open, also persists to project.json. */
  setUnrealSyncPath: (path: string) => Promise<void>;

  /** Export the whole working set as a downloadable ZIP. */
  exportZip: () => Promise<Blob>;

  /** Find the storage key for a bare asset name (cross-reference resolver).
   *  Returns null if not found in any folder. */
  findKeyById: (assetId: string) => DefinitionsKey | null;

  /** Look up which records reference a given asset id. Returns [] when the
   *  asset isn't referenced or the index hasn't been built yet. */
  referencedBy: (assetId: string) => import('./referencedByIndex').IncomingRef[];

  /** Resolve a definition_ref class name (no leading U) to its folder. */
  folderForClass: (bareClassName: string) => string | null;

  /** Look up the container element/key/value type at a given property path
   *  (no numeric segments). Returns null when no other loaded asset has a
   *  non-null type for the same slot. Used by the typed editor to seed +Add
   *  with the right shape for empty arrays/maps. */
  lookupContainerType: (
    path: (string | number)[],
    slot: 'element_type' | 'key_type' | 'value_type',
  ) => any | null;

  /** Look up the UPROPERTY metadata for a property. `parentTypeName` is
   *  either the asset class (no `U` prefix) or the enclosing struct name.
   *  Walks the class parent chain so a property defined on `UItemDefinition`
   *  is found when the asset is a `UConsumableDefinition`. */
  getPropertyMeta: (
    parentTypeName: string | null | undefined,
    propertyName: string,
  ) => PropertyMeta | null;

  /** When meta has an `element_class` for the given property, return the
   *  bare class name (no `U`) — used to seed empty arrays whose
   *  element_type is null and where the schema sniff also turned up
   *  nothing. Returns null when meta has no class. */
  lookupArrayElementClass: (
    parentTypeName: string | null | undefined,
    propertyName: string,
  ) => string | null;

  /** Update an asset's `class` (and parent_classes) — the file is moved to
   *  the new class's folder on the next save. */
  changeClass: (key: DefinitionsKey, newClass: string) => void;

  /** Toggle whether a property name is pinned. Pinned names float to the
   *  top of the typed-property editor on every asset that has them. */
  togglePinnedProperty: (name: string) => void;

  /** All members of an enum (bare name; `E` prefix dropped by the
   *  exporter). Returns null when the sidecar has nothing for it. */
  getEnumMembers: (enumName: string | null | undefined) => EnumMember[] | null;

  /** Rename an asset to a new bare stem. The store reconstructs the
   *  full `prefix_stem_suffix` id by consulting idTemplates, updates
   *  json.id and json.asset_path, and queues a file rename on save.
   *  Returns the new storage key, or null if the rename was rejected
   *  (empty stem, no change, or id collision). */
  renameAsset: (key: DefinitionsKey, newBareName: string) => DefinitionsKey | null;

  /** Return all asset ids whose leaf class is exactly `bareClassName`, or any
   *  class that has it in its parent chain. The result is sorted by id. */
  assetsOfClass: (bareClassName: string) => string[];

  /** Item ↔ StaticItem pair lookup. Given a record key, return the key
   *  of its corresponding partner: an Item asset returns the StaticItem
   *  named in its `static_item_definition` property; a StaticItem
   *  returns the first Item whose `static_item_definition` points back.
   *  Returns null when no partner is loaded. */
  findItemStaticPair: (key: DefinitionsKey) => DefinitionsKey | null;

  /** Create a new definition for the given bare class name (e.g. "ConsumableDefinition").
   *  Picks the folder for that class and copies a template from an existing
   *  asset of the same class so the typed envelope shape is preserved. Returns
   *  the new key, or null if no template/folder is known. */
  createDefinitionForClass: (bareClassName: string, id: string) => DefinitionsKey | null;

  /** Create a brand-new definition in the given folder. Returns its key.
   *  By default the new record is selected (so the form jumps to it); pass
   *  `select: false` when creating from inside another asset's editor (e.g.
   *  the inline + New flow inside a definition_ref dropdown) to preserve the
   *  caller's current selection. */
  createDefinition: (
    folder: string,
    id: string,
    template?: any,
    opts?: { select?: boolean },
  ) => DefinitionsKey | null;

  /** Duplicate an existing definition with a new id. Returns the new key. */
  duplicateDefinition: (sourceKey: DefinitionsKey, newId: string) => DefinitionsKey | null;

  /** Delete a definition (in-memory + on-disk if dirHandle present). */
  deleteDefinition: (key: DefinitionsKey) => Promise<void>;

  /** Global search — returns up to `limit` matches by id, asset_path, or any
   *  string property value. Uses token-aware fuzzy ranking; the
   *  `ranges` array tells the renderer which substrings of `id` to
   *  highlight (snippet highlighting falls back to substring). */
  searchAll: (query: string, limit?: number) => Array<{
    key: DefinitionsKey;
    folder: string;
    id: string;
    matchPath: string;
    snippet: string;
    ranges: Array<[number, number]>;
  }>;

  /** Find every reference whose target asset name doesn't exist in the
   *  loaded dataset. Returns a list of issues. */
  findOrphanReferences: () => Array<{
    key: DefinitionsKey;
    folder: string;
    id: string;
    refPath: string;
    refValue: string;
  }>;

  /** Sweep every loaded asset for missing Item↔StaticItem partners.
   *  Returns one issue per ItemDefinition with no/orphan
   *  static_item_definition, and per StaticItemDefinition that no
   *  ItemDefinition references. */
  findItemStaticOrphans: () => Array<{
    key: DefinitionsKey;
    folder: string;
    id: string;
    issue: 'item-missing-static' | 'static-missing-item';
    detail: string;
  }>;

  /** All definition_refs originating from `key`. */
  outgoingReferences: (key: DefinitionsKey) => Array<{
    refClass: string;
    refValue: string;
    refPath: string;
    targetKey: DefinitionsKey | null;
  }>;

  /** All assets that contain a definition_ref pointing at the asset for `key`. */
  incomingReferences: (key: DefinitionsKey) => Array<{
    sourceKey: DefinitionsKey;
    sourceFolder: string;
    sourceId: string;
    refClass: string;
    refPath: string;
  }>;
}

const LS_AUTOLOAD = 'tsic.def.autoload.v1';
const LS_PINNED = 'tsic.def.pinned.v1';
const HANDLE_KEY = 'definitions-root';

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_PINNED);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function savePinned(set: Set<string>) {
  try {
    localStorage.setItem(LS_PINNED, JSON.stringify([...set]));
  } catch { /* noop */ }
}

function key(folder: string, id: string): DefinitionsKey {
  return `${folder}/${id}`;
}

/** Walk a JSON value looking for the first string that contains `q` (already
 *  lowercased). Returns its dotted path and the value, or null. Skips type
 *  metadata keys on typed envelopes ({type, class, ...}) so users see hits
 *  on actual values not on `"definition_ref"` etc. */
function walkForString(
  v: any,
  q: string,
  pathPrefix: (string | number)[] = [],
): { path: string; value: string } | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    if (v.toLowerCase().includes(q)) return { path: pathPrefix.join('.') || '(root)', value: v };
    return null;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = walkForString(v[i], q, [...pathPrefix, i]);
      if (r) return r;
    }
    return null;
  }
  if (typeof v === 'object') {
    const skipMeta = isTypedEnvelope(v);
    for (const k of Object.keys(v)) {
      if (skipMeta && ENVELOPE_META_KEYS.has(k)) continue;
      const r = walkForString(v[k], q, [...pathPrefix, k]);
      if (r) return r;
    }
  }
  return null;
}

/** Walk every typed envelope (`{type, value, ...}`) reachable from `root`,
 *  invoking `cb(typed, path)`. Recurses into struct/array/map/set values,
 *  skipping non-envelope-shaped objects and the meta keys on each envelope. */
function walkTypedEnvelopes(
  root: any,
  pathPrefix: (string | number)[],
  cb: (typed: any, path: (string | number)[]) => void,
): void {
  if (root == null) return;
  if (isTypedEnvelope(root)) {
    cb(root, pathPrefix);
    const t = root.type as string;
    const inner = root.value;
    if (t === 'array' || t === 'set') {
      if (Array.isArray(inner)) {
        for (let i = 0; i < inner.length; i++) {
          walkTypedEnvelopes(inner[i], [...pathPrefix, i], cb);
        }
      }
      return;
    }
    if (t === 'map') {
      if (Array.isArray(inner)) {
        for (let i = 0; i < inner.length; i++) {
          const entry = inner[i];
          if (entry && typeof entry === 'object') {
            walkTypedEnvelopes(entry.key, [...pathPrefix, i, 'key'], cb);
            walkTypedEnvelopes(entry.value, [...pathPrefix, i, 'value'], cb);
          }
        }
      }
      return;
    }
    if (t === 'struct') {
      if (inner && typeof inner === 'object') {
        for (const k of Object.keys(inner)) {
          walkTypedEnvelopes(inner[k], [...pathPrefix, k], cb);
        }
      }
      return;
    }
    return;
  }
  // Not a typed envelope — recurse into plain objects/arrays so the top-level
  // `properties` map (whose values are envelopes) gets visited.
  if (Array.isArray(root)) {
    for (let i = 0; i < root.length; i++) {
      walkTypedEnvelopes(root[i], [...pathPrefix, i], cb);
    }
    return;
  }
  if (typeof root === 'object') {
    for (const k of Object.keys(root)) {
      walkTypedEnvelopes(root[k], [...pathPrefix, k], cb);
    }
  }
}

/** Walk a record's JSON, removing every reference to `deletedId`.
 *  Returns the new JSON plus stats. Standalone def_refs lose their
 *  value (kept as empty so the slot stays in the editor); array
 *  entries that ARE def_refs to the id get spliced out; map entries
 *  whose key is a def_ref to the id are removed. The function is
 *  pure — it deep-copies on first mutation so untouched branches
 *  share structure with the input. */
function scrubRefsToId(
  root: any,
  deletedId: string,
): { next: any; changed: boolean; removedCount: number } {
  let removedCount = 0;
  let changed = false;
  function walk(node: any): any {
    if (node == null) return node;
    if (Array.isArray(node)) {
      // Filter out array entries that ARE def_refs to deletedId, then
      // recurse into the rest.
      const filtered: any[] = [];
      let arrChanged = false;
      for (const item of node) {
        if (
          item && typeof item === 'object' &&
          item.type === 'definition_ref' &&
          String(item.value ?? '') === deletedId
        ) {
          arrChanged = true;
          changed = true;
          removedCount++;
          continue;
        }
        // Map entries are { key, value } objects — drop the whole
        // entry when the key resolves to the deleted id.
        if (
          item && typeof item === 'object' &&
          item.key && typeof item.key === 'object' &&
          item.key.type === 'definition_ref' &&
          String(item.key.value ?? '') === deletedId
        ) {
          arrChanged = true;
          changed = true;
          removedCount++;
          continue;
        }
        const w = walk(item);
        if (w !== item) arrChanged = true;
        filtered.push(w);
      }
      return arrChanged ? filtered : node;
    }
    if (typeof node === 'object') {
      // Standalone def_ref envelope pointing at the deleted id —
      // clear the value (keep the envelope so the slot still renders).
      if (
        node.type === 'definition_ref' &&
        String(node.value ?? '') === deletedId
      ) {
        changed = true;
        removedCount++;
        return { ...node, value: '' };
      }
      let objChanged = false;
      const out: any = Array.isArray(node) ? [...node] : { ...node };
      for (const k of Object.keys(node)) {
        const w = walk(node[k]);
        if (w !== node[k]) {
          out[k] = w;
          objChanged = true;
        }
      }
      return objChanged ? out : node;
    }
    return node;
  }
  const next = walk(root);
  return { next, changed, removedCount };
}

/** Walk a record's JSON, rewriting every `definition_ref` whose
 *  `value` equals `oldId` to point at `newId`. Returns the updated
 *  JSON (structure-shared on untouched branches) plus stats. Used by
 *  `renameAsset` to keep references consistent without forcing the
 *  user to find every consumer manually. */
function retargetRefs(
  root: any,
  oldId: string,
  newId: string,
): { next: any; changed: boolean; touchedCount: number } {
  let touchedCount = 0;
  let changed = false;
  function walk(node: any): any {
    if (node == null) return node;
    if (Array.isArray(node)) {
      let arrChanged = false;
      const out: any[] = [];
      for (const item of node) {
        const w = walk(item);
        if (w !== item) arrChanged = true;
        out.push(w);
      }
      return arrChanged ? out : node;
    }
    if (typeof node === 'object') {
      if (
        node.type === 'definition_ref' &&
        String(node.value ?? '') === oldId
      ) {
        changed = true;
        touchedCount++;
        return { ...node, value: newId };
      }
      let objChanged = false;
      const out: any = { ...node };
      for (const k of Object.keys(node)) {
        const w = walk(node[k]);
        if (w !== node[k]) {
          out[k] = w;
          objChanged = true;
        }
      }
      return objChanged ? out : node;
    }
    return node;
  }
  const next = walk(root);
  return { next, changed, touchedCount };
}

function setIn(target: any, path: (string | number)[], value: any): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(target)) {
    const idx = Number(head);
    const copy = target.slice();
    copy[idx] = setIn(copy[idx], rest, value);
    return copy;
  }
  const obj = target == null ? {} : { ...target };
  obj[head as string] = setIn(obj[head as string], rest, value);
  return obj;
}

function loadAutoLoadFlag(): boolean {
  try {
    const raw = localStorage.getItem(LS_AUTOLOAD);
    if (raw == null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

function saveAutoLoadFlag(v: boolean) {
  try {
    localStorage.setItem(LS_AUTOLOAD, v ? '1' : '0');
  } catch { /* noop */ }
}

/** Folders that match `^layout` (layout_definitions, layout_object_definitions)
 *  are skipped on load and on save. They're authored in UE; the editor has
 *  no useful way to manipulate them. */
function isLayoutFolder(name: string): boolean {
  return /^layout/.test(name);
}

/** Derive the folder name a class would live in when classNodes has no entry
 *  for it (mirrors `Tools/Export/lib/naming.py:class_to_folder`). */
function folderForBareClass(bareClassName: string): string {
  const snake = bareClassName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (snake.endsWith('_definition')) return `${snake}s`;
  return snake;
}

/** Decide which folder a record should live in given its current class.
 *  Falls back to the record's existing folder when classNodes hasn't seen
 *  the class — that way an unknown-class record stays put rather than
 *  spilling into a derived folder it doesn't belong in. */
function computeTargetFolder(
  rec: DefinitionRecord,
  classNodes: Map<string, ClassNode>,
): string {
  const cls = String(rec.json?.class ?? '');
  if (!cls) return rec.folder;
  const node = classNodes.get(cls) ?? classNodes.get(cls.replace(/^U/, ''));
  if (node?.folder) return node.folder;
  // No node entry. Derive only if the class follows the U-prefix convention.
  if (cls.startsWith('U') && cls.length > 1 && cls[1] === cls[1].toUpperCase()) {
    return folderForBareClass(cls.slice(1));
  }
  return rec.folder;
}

async function readAllJson(
  rootHandle: FileSystemDirectoryHandle,
): Promise<{
  folders: string[];
  defs: Map<DefinitionsKey, DefinitionRecord>;
  rawFiles: Array<{ folder: string; name: string; text: string }>;
  hierarchySidecar: any | null;
  propertyMetaSidecar: any | null;
}> {
  const folders: string[] = [];
  const defs = new Map<DefinitionsKey, DefinitionRecord>();
  const rawFiles: Array<{ folder: string; name: string; text: string }> = [];
  let hierarchySidecar: any | null = null;
  let propertyMetaSidecar: any | null = null;
  // @ts-ignore - .entries() is part of the File System Access API but TS lib
  // typings sometimes lag.
  for await (const [name, entry] of rootHandle.entries()) {
    if ((entry as any).kind === 'file') {
      if (name === '.class-hierarchy.json') {
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          hierarchySidecar = JSON.parse(await file.text());
        } catch (e) {
          console.warn('[definitions] failed to read .class-hierarchy.json', e);
        }
      } else if (name === '.property-meta.json') {
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          propertyMetaSidecar = JSON.parse(await file.text());
        } catch (e) {
          console.warn('[definitions] failed to read .property-meta.json', e);
        }
      }
      continue;
    }
    if ((entry as any).kind !== 'directory') continue;
    if (name.startsWith('.')) continue;
    if (isLayoutFolder(name)) continue;
    folders.push(name);
    const folderHandle = entry as FileSystemDirectoryHandle;
    // @ts-ignore
    for await (const [fileName, fileEntry] of folderHandle.entries()) {
      if ((fileEntry as any).kind !== 'file') continue;
      if (!fileName.toLowerCase().endsWith('.json')) continue;
      let text: string;
      try {
        const file = await (fileEntry as FileSystemFileHandle).getFile();
        text = await file.text();
      } catch (e) {
        console.warn(`[definitions] failed to read ${name}/${fileName}`, e);
        continue;
      }
      rawFiles.push({ folder: name, name: fileName, text });
      try {
        const json = JSON.parse(text);
        const id = fileName.replace(/\.json$/i, '');
        defs.set(key(name, id), {
          folder: name,
          id,
          json,
          originalText: text,
          diskId: id,
          diskFolder: name,
        });
      } catch {
        // Parse error: file is collected in rawFiles for the validator to
        // surface; we just don't add it to defs.
      }
    }
  }
  folders.sort();
  return { folders, defs, rawFiles, hierarchySidecar, propertyMetaSidecar };
}

/** Build the propertyMeta map from the `.property-meta.json` sidecar.
 *  The sidecar payload is `{ schema_version, properties: { key: meta } }`
 *  — we just lift `properties` into a Map for O(1) lookups. */
function buildPropertyMeta(sidecar: any | null): Map<string, PropertyMeta> {
  const out = new Map<string, PropertyMeta>();
  if (!sidecar || typeof sidecar !== 'object') return out;
  const props = sidecar.properties;
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    if (v && typeof v === 'object') {
      out.set(k, v as PropertyMeta);
    }
  }
  return out;
}

function buildEnumMeta(sidecar: any | null): Map<string, EnumMember[]> {
  const out = new Map<string, EnumMember[]>();
  if (!sidecar || typeof sidecar !== 'object') return out;
  const enums = sidecar.enums;
  if (!enums || typeof enums !== 'object') return out;
  for (const [k, v] of Object.entries(enums)) {
    if (Array.isArray(v)) {
      out.set(k, v as EnumMember[]);
    }
  }
  return out;
}

/** Inspect every loaded record to extract its (prefix, stem, suffix)
 *  triple, then derive a per-class `{prefix, suffix}` template by
 *  majority vote. Lets the editor expose only the bare stem of the id
 *  while reconstructing the full form on save. Classes the user
 *  hasn't seen yet fall back to empty strings. */
const _ID_PREFIX_RE = /^([A-Z]{2,4}_)/;
const _ID_SUFFIX_RE = /(_[A-Z]{2,3})$/;

export function splitAssetId(id: string): { prefix: string; stem: string; suffix: string } {
  if (!id) return { prefix: '', stem: '', suffix: '' };
  let stem = id;
  let prefix = '';
  let suffix = '';
  const pm = stem.match(_ID_PREFIX_RE);
  if (pm) {
    prefix = pm[1];
    stem = stem.slice(prefix.length);
  }
  const sm = stem.match(_ID_SUFFIX_RE);
  if (sm) {
    suffix = sm[1];
    stem = stem.slice(0, -suffix.length);
  }
  return { prefix, stem: stem || id, suffix };
}

function buildIdTemplates(
  defs: Map<DefinitionsKey, DefinitionRecord>,
): Map<string, { prefix: string; suffix: string }> {
  // For each class, count (prefix, suffix) pairs; the most popular wins.
  const counts = new Map<string, Map<string, number>>(); // class → "prefix|suffix" → count
  for (const rec of defs.values()) {
    const cls = String(rec.json?.class ?? '');
    if (!cls) continue;
    const bare = cls.replace(/^U/, '');
    const { prefix, suffix } = splitAssetId(rec.id);
    const tag = `${prefix}|${suffix}`;
    let m = counts.get(bare);
    if (!m) {
      m = new Map();
      counts.set(bare, m);
    }
    m.set(tag, (m.get(tag) ?? 0) + 1);
  }
  const out = new Map<string, { prefix: string; suffix: string }>();
  for (const [cls, m] of counts) {
    let best = '|';
    let bestN = 0;
    for (const [tag, n] of m) {
      if (n > bestN) {
        best = tag;
        bestN = n;
      }
    }
    const [prefix, suffix] = best.split('|');
    out.set(cls, { prefix, suffix });
  }
  return out;
}

/** Keys we treat as type metadata (not searchable, not editable freeform). */
const ENVELOPE_META_KEYS = new Set([
  'type', 'class', 'enum_name', 'struct_name', 'element_type', 'key_type', 'value_type', 'fields',
]);

/** True if `v` looks like a typed-envelope dict ({type: string, ...}). */
function isTypedEnvelope(v: any): boolean {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof v.type === 'string'
  );
}

/** Build a fresh blank record from an existing typed-envelope template.
 *  Re-uses the template's properties shape (so element_type/struct fields
 *  carry through) and resets the id/asset_path/class. Top-level metadata is
 *  preserved. */
function blankFromTypedTemplate(
  template: any,
  newId: string,
  folder: string,
  className: string,
): any {
  const out = JSON.parse(JSON.stringify(template));
  if (out && typeof out === 'object') {
    out.id = newId;
    out.class = className;
    if (typeof out.asset_path === 'string') {
      const segs = out.asset_path.split('/');
      segs[segs.length - 1] = newId;
      out.asset_path = segs.join('/');
    } else {
      out.asset_path = `/Game/Definitions/${folder}/${newId}`;
    }
    // Strip typed-envelope `value` payloads but keep the type skeleton — the
    // user fills in real values via the editor. Recursive walk; structs keep
    // their field shape.
    if (out.properties && typeof out.properties === 'object') {
      for (const k of Object.keys(out.properties)) {
        out.properties[k] = blankifyTypedValue(out.properties[k]);
      }
    }
  }
  return out;
}

function blankifyTypedValue(typed: any): any {
  if (!isTypedEnvelope(typed)) return typed;
  const t = typed.type as string;
  if (t === 'bool') return { type: 'bool', value: false };
  if (t === 'int') return { type: 'int', value: 0 };
  if (t === 'float') return { type: 'float', value: 0 };
  if (t === 'string' || t === 'name' || t === 'text') return { type: t, value: '' };
  if (t === 'gameplay_tag') return { type: 'gameplay_tag', value: '' };
  if (t === 'gameplay_tag_container') return { type: 'gameplay_tag_container', value: [] };
  if (t === 'definition_ref') {
    return { type: 'definition_ref', class: typed.class ?? '', value: '' };
  }
  if (t === 'enum') {
    return { type: 'enum', enum_name: typed.enum_name ?? '', value: '' };
  }
  if (t === 'array' || t === 'set') {
    return { type: t, element_type: typed.element_type ?? null, value: [] };
  }
  if (t === 'map') {
    return { type: 'map', key_type: typed.key_type ?? null, value_type: typed.value_type ?? null, value: [] };
  }
  if (t === 'struct') {
    const fields: Record<string, any> = {};
    if (typed.value && typeof typed.value === 'object' && !Array.isArray(typed.value)) {
      for (const [k, sub] of Object.entries(typed.value)) {
        fields[k] = blankifyTypedValue(sub);
      }
    }
    return { type: 'struct', struct_name: typed.struct_name ?? '', value: fields };
  }
  return typed;
}

/** Walk every typed envelope reachable from `root` using string-only paths
 *  (numeric array/map indexes are skipped). The walker is structurally
 *  identical to walkTypedEnvelopes but the path it produces is suitable as
 *  a lookup key in the cross-asset property-schema index. */
function walkTypedEnvelopesByName(
  root: any,
  pathPrefix: string[],
  cb: (typed: any, path: string[]) => void,
): void {
  if (root == null) return;
  if (isTypedEnvelope(root)) {
    cb(root, pathPrefix);
    const t = root.type as string;
    const inner = root.value;
    if (t === 'array' || t === 'set') {
      if (Array.isArray(inner)) {
        for (const item of inner) walkTypedEnvelopesByName(item, pathPrefix, cb);
      }
      return;
    }
    if (t === 'map') {
      if (Array.isArray(inner)) {
        for (const entry of inner) {
          if (entry && typeof entry === 'object') {
            walkTypedEnvelopesByName(entry.key, [...pathPrefix, 'key'], cb);
            walkTypedEnvelopesByName(entry.value, [...pathPrefix, 'value'], cb);
          }
        }
      }
      return;
    }
    if (t === 'struct') {
      if (inner && typeof inner === 'object') {
        for (const k of Object.keys(inner)) {
          walkTypedEnvelopesByName(inner[k], [...pathPrefix, k], cb);
        }
      }
      return;
    }
    return;
  }
  if (Array.isArray(root)) {
    for (const item of root) walkTypedEnvelopesByName(item, pathPrefix, cb);
    return;
  }
  if (typeof root === 'object') {
    for (const k of Object.keys(root)) {
      walkTypedEnvelopesByName(root[k], [...pathPrefix, k], cb);
    }
  }
}

/** Build the property-schema index from every loaded record. */
function buildPropertySchema(
  defs: Map<DefinitionsKey, DefinitionRecord>,
): Map<string, { element_type?: any; key_type?: any; value_type?: any }> {
  const idx = new Map<string, { element_type?: any; key_type?: any; value_type?: any }>();
  for (const rec of defs.values()) {
    walkTypedEnvelopesByName(rec.json?.properties ?? {}, [], (typed, path) => {
      if (!isTypedEnvelope(typed)) return;
      if (typed.type === 'array' || typed.type === 'set') {
        if (typed.element_type) {
          const k = path.join('.');
          const cur = idx.get(k) ?? {};
          if (!cur.element_type) cur.element_type = typed.element_type;
          idx.set(k, cur);
        }
      } else if (typed.type === 'map') {
        if (typed.key_type || typed.value_type) {
          const k = path.join('.');
          const cur = idx.get(k) ?? {};
          if (typed.key_type && !cur.key_type) cur.key_type = typed.key_type;
          if (typed.value_type && !cur.value_type) cur.value_type = typed.value_type;
          idx.set(k, cur);
        }
      }
    });
  }
  return idx;
}

/** Build classNodes from the .class-hierarchy.json sidecar payload + records.
 *  Sidecar wins for parent chains (it's the source of truth from UE), but
 *  records can fill in folder mappings the sidecar didn't see. */
function buildClassNodes(
  defs: Map<DefinitionsKey, DefinitionRecord>,
  sidecar: any | null,
): Map<string, ClassNode> {
  const nodes = new Map<string, ClassNode>();

  // 1) Seed from the sidecar (authoritative for parent chains).
  if (sidecar?.classes && typeof sidecar.classes === 'object') {
    for (const [name, info] of Object.entries<any>(sidecar.classes)) {
      const parents = Array.isArray(info?.parents) ? info.parents.map(String) : [];
      const folder = typeof info?.folder === 'string' ? info.folder : null;
      nodes.set(name, { name, parents, folder });
    }
  }

  // 2) Overlay from records — records can introduce classes the sidecar
  //    omitted, and they confirm the folder for each class. If a class has
  //    a sidecar entry already, prefer the sidecar's parent chain.
  for (const rec of defs.values()) {
    const cls = rec.json?.class;
    if (typeof cls !== 'string' || !cls) continue;
    const parents = Array.isArray(rec.json?.parent_classes)
      ? rec.json.parent_classes.map(String)
      : [];
    const existing = nodes.get(cls);
    if (existing) {
      if (!existing.folder && rec.folder) existing.folder = rec.folder;
      if (existing.parents.length === 0 && parents.length > 0) {
        existing.parents = parents;
      }
    } else {
      nodes.set(cls, { name: cls, parents, folder: rec.folder });
    }
  }
  return nodes;
}

async function writeFile(
  rootHandle: FileSystemDirectoryHandle,
  folder: string,
  filename: string,
  contents: string,
): Promise<void> {
  const folderHandle = await rootHandle.getDirectoryHandle(folder, { create: true });
  const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(contents);
  await writable.close();
}

function serializeDefinition(rec: DefinitionRecord): string {
  // Match the exporter's formatting: 2-space indent, sorted keys at top level
  // would be ideal but the exporter writes properties dict in source order.
  // Stick with stable JSON.stringify preserving insertion order.
  return JSON.stringify(rec.json, null, 2) + '\n';
}

/** Read project.json from a directory handle, returns null when absent. */
async function readProjectMeta(
  handle: FileSystemDirectoryHandle,
): Promise<ProjectMeta | null> {
  try {
    const fileHandle = await handle.getFileHandle('project.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as ProjectMeta;
  } catch {
    return null;
  }
}

/** Write project.json into a directory handle. */
async function writeProjectMeta(
  handle: FileSystemDirectoryHandle,
  meta: ProjectMeta,
): Promise<void> {
  const fileHandle = await handle.getFileHandle('project.json', { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(JSON.stringify(meta, null, 2) + '\n');
  await writable.close();
}

export const useDefinitionsStore = create<DefinitionsStore>((set, get) => ({
  directoryHandle: null,
  projectMeta: null,
  bootstrapped: false,
  autoLoadEnabled: loadAutoLoadFlag(),

  definitions: new Map(),
  dirty: new Set(),
  referencedByIndex: new Map(),
  folders: [],
  loadedAt: null,
  loading: false,
  errorText: null,
  classNodes: new Map(),
  hierarchySidecar: null,
  propertySchema: new Map(),
  propertyMeta: new Map(),
  pinnedProperties: loadPinned(),
  enumMeta: new Map(),
  idTemplates: new Map(),

  selectedFolder: null,
  selectedKey: null,
  filter: '',

  toast: null,
  futureVersionBlock: null,
  loadGate: null,
  restoreDraftPrompt: null,

  setToast: (t) => set({ toast: t }),
  dismissFutureVersionBlock: () => set({ futureVersionBlock: null }),
  dismissLoadGate: (action) => {
    const g = get().loadGate;
    if (!g) return;
    set({ loadGate: null });
    if (action === 'continue') g.onContinue();
    else g.onCancel();
  },
  acceptDraftRestore: async () => {
    const prompt = get().restoreDraftPrompt;
    if (!prompt) return;
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
    // The draft now lives in-memory as the active dirty set. Don't clear
    // it from IndexedDB until the user successfully saves — that way a
    // second crash before save still has a draft to restore from.
  },
  declineDraftRestore: async () => {
    const prompt = get().restoreDraftPrompt;
    if (!prompt) return;
    set({ restoreDraftPrompt: null });
    await clearDraft(prompt.key);
  },
  setAutoLoad: (enabled) => {
    saveAutoLoadFlag(enabled);
    set({ autoLoadEnabled: enabled });
  },
  selectFolder: (f) => set({ selectedFolder: f, selectedKey: null }),
  selectDefinition: (k) => set({ selectedKey: k }),
  setFilter: (q) => set({ filter: q }),

  openProject: async () => {
    const w = window as any;
    if (!w.showDirectoryPicker) {
      set({
        toast: {
          kind: 'error',
          text: 'This browser lacks the File System Access API. Use Chrome / Edge / Brave.',
        },
      });
      return;
    }
    try {
      const handle: FileSystemDirectoryHandle = await w.showDirectoryPicker({
        mode: 'readwrite',
      });
      const ok = await ensurePermission(handle, 'readwrite');
      if (!ok) {
        set({ toast: { kind: 'error', text: 'Permission denied for that directory.' } });
        return;
      }
      // Persisting the handle to IndexedDB can fail (e.g., when the handle
      // is a mock or DataCloneError occurs). The directory still works for
      // this session; just skip the persistence step in that case.
      try {
        await putHandle(HANDLE_KEY, handle);
      } catch (e) {
        console.warn('[definitions] could not persist directory handle', e);
      }
      // Read project.json if present; fall back to folder name as name.
      const rawMeta = await readProjectMeta(handle);
      let projectMeta: ProjectMeta;
      if (rawMeta) {
        const v = (rawMeta as { schema_version?: number }).schema_version;
        if (typeof v === 'number' && isFuture(v)) {
          set({ futureVersionBlock: { foundVersion: v, supportedVersion: SUPPORTED_VERSION } });
          return;
        }
        projectMeta = rawMeta;
      } else {
        // Legacy folder without project.json — migrate localStorage sync path
        // into a transient in-memory meta (not persisted until user saves settings).
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
      set({
        directoryHandle: handle,
        projectMeta,
        unrealSyncPath: projectMeta.ue_sync_path ?? '',
        errorText: null,
      });
      await get().reload();
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        set({ toast: { kind: 'error', text: String(e) } });
      }
    }
  },

  // Alias for one release — calls openProject.
  pickDirectory: async () => {
    await get().openProject();
  },

  createProject: async ({ handle, name, ueSyncPath, seedFromBundled = true }) => {
    const ok = await ensurePermission(handle, 'readwrite');
    if (!ok) {
      set({ toast: { kind: 'error', text: 'Permission denied for that directory.' } });
      return;
    }

    const meta: ProjectMeta = {
      schema_version: 1,
      name,
      ...(ueSyncPath ? { ue_sync_path: ueSyncPath } : {}),
      created_at: new Date().toISOString(),
    };

    // Write project.json first.
    await writeProjectMeta(handle, meta);

    if (seedFromBundled) {
      // Mirror web/public/base-definitions/ into the handle.
      const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
      const manifestUrl = `${baseUrl}base-definitions/manifest.json`;
      const manifestResp = await fetch(manifestUrl);
      if (!manifestResp.ok) {
        set({ toast: { kind: 'error', text: `Failed to fetch bundled manifest: ${manifestResp.status}` } });
        return;
      }
      const manifest = await manifestResp.json() as {
        folders: string[];
        files: { folder: string; ids: string[] }[];
        sidecars: { hierarchy: boolean; propertyMeta: boolean };
      };

      // Write sidecars.
      if (manifest.sidecars?.hierarchy) {
        try {
          const r = await fetch(`${baseUrl}base-definitions/.class-hierarchy.json`);
          if (r.ok) {
            const text = await r.text();
            const fh = await handle.getFileHandle('.class-hierarchy.json', { create: true });
            const wr = await (fh as any).createWritable();
            await wr.write(text);
            await wr.close();
          }
        } catch (e) { console.warn('[definitions] failed to seed .class-hierarchy.json', e); }
      }
      if (manifest.sidecars?.propertyMeta) {
        try {
          const r = await fetch(`${baseUrl}base-definitions/.property-meta.json`);
          if (r.ok) {
            const text = await r.text();
            const fh = await handle.getFileHandle('.property-meta.json', { create: true });
            const wr = await (fh as any).createWritable();
            await wr.write(text);
            await wr.close();
          }
        } catch (e) { console.warn('[definitions] failed to seed .property-meta.json', e); }
      }

      // Write every definition file, concurrency-capped.
      const allFiles: { folder: string; id: string }[] = [];
      for (const f of manifest.files || []) {
        if (isLayoutFolder(f.folder)) continue;
        for (const id of f.ids) allFiles.push({ folder: f.folder, id });
      }
      const concurrency = 8;
      let nextIdx = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        for (;;) {
          const i = nextIdx++;
          if (i >= allFiles.length) return;
          const { folder, id } = allFiles[i];
          try {
            const url = `${baseUrl}base-definitions/${folder}/${id}.json`;
            const r = await fetch(url);
            if (!r.ok) { console.warn(`seed fetch ${folder}/${id} → ${r.status}`); continue; }
            const text = await r.text();
            const folderHandle = await handle.getDirectoryHandle(folder, { create: true });
            const fh = await folderHandle.getFileHandle(`${id}.json`, { create: true });
            const wr = await (fh as any).createWritable();
            await wr.write(text);
            await wr.close();
          } catch (e) { console.warn(`seed write ${folder}/${id} failed`, e); }
        }
      });
      await Promise.all(workers);
    }

    try { await putHandle(HANDLE_KEY, handle); } catch (e) {
      console.warn('[definitions] could not persist directory handle', e);
    }

    set({
      directoryHandle: handle,
      projectMeta: meta,
      unrealSyncPath: meta.ue_sync_path ?? '',
      errorText: null,
    });
    await get().reload();
  },

  forgetDirectory: async () => {
    await deleteHandle(HANDLE_KEY);
    set({
      directoryHandle: null,
      projectMeta: null,
      unrealSyncPath: '',
      definitions: new Map(),
      classNodes: new Map(),
      hierarchySidecar: null,
      propertySchema: new Map(),
      propertyMeta: new Map(),
      enumMeta: new Map(),
      idTemplates: new Map(),
      dirty: new Set(),
      folders: [],
      selectedFolder: null,
      selectedKey: null,
      loadedAt: null,
      toast: { kind: 'info', text: 'Forgot the saved project.' },
    });
  },

  bootstrap: async () => {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });
    // Test hatch: setting `localStorage.tsic.def.skipBundled.v1 = '1'`
    // suppresses both the saved-handle and the bundled-default auto-loads
    // so the smoke harness can drive the store from a clean state.
    let skipAuto = false;
    try { skipAuto = localStorage.getItem('tsic.def.skipBundled.v1') === '1'; } catch { /* noop */ }
    try {
      const handle = await getHandle<FileSystemDirectoryHandle>(HANDLE_KEY);
      if (handle) {
        // Don't auto-prompt for permission — only auto-load if it's already
        // granted. Otherwise user clicks the "Reconnect" button.
        const anyH = handle as any;
        const status = typeof anyH.queryPermission === 'function'
          ? await anyH.queryPermission({ mode: 'readwrite' })
          : 'granted';
        // Load project.json so projectMeta is available even before reload().
        const projectMeta = status === 'granted'
          ? await readProjectMeta(handle)
          : null;
        const resolvedMeta = projectMeta ?? { schema_version: 1, name: handle.name };
        set({
          directoryHandle: handle,
          projectMeta: resolvedMeta,
          unrealSyncPath: resolvedMeta.ue_sync_path ?? (() => {
            try { return localStorage.getItem('tsic.def.syncpath.v1') ?? ''; }
            catch { return ''; }
          })(),
        });
        if (status === 'granted' && get().autoLoadEnabled && !skipAuto) {
          await get().reload();
          return;
        }
      }
      if (skipAuto) return;
      // No saved handle (or no permission) — fall back to bundled defaults
      // so the user lands on a working tree immediately.
      if (get().autoLoadEnabled) {
        await get().loadBundledDefaults();
      }
    } catch (e) {
      console.warn('[definitions] bootstrap failed', e);
    }
  },

  loadBundledDefaults: async () => {
    set({ loading: true, errorText: null });
    try {
      const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
      const manifestUrl = `${baseUrl}base-definitions/manifest.json`;
      const manifestResp = await fetch(manifestUrl);
      if (!manifestResp.ok) {
        throw new Error(`manifest ${manifestResp.status}`);
      }
      const manifest = await manifestResp.json() as {
        folders: string[];
        files: { folder: string; ids: string[] }[];
        sidecars: { hierarchy: boolean; propertyMeta: boolean };
      };
      const folders = (manifest.folders || []).filter((f) => !isLayoutFolder(f)).sort();
      const defs = new Map<DefinitionsKey, DefinitionRecord>();
      // Pull every file in parallel, but cap concurrency so we don't open
      // ~2200 sockets at once.
      const concurrency = 32;
      const allFiles: { folder: string; id: string }[] = [];
      for (const f of manifest.files || []) {
        if (isLayoutFolder(f.folder)) continue;
        for (const id of f.ids) allFiles.push({ folder: f.folder, id });
      }
      let nextIdx = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        for (;;) {
          const i = nextIdx++;
          if (i >= allFiles.length) return;
          const { folder, id } = allFiles[i];
          try {
            const url = `${baseUrl}base-definitions/${folder}/${id}.json`;
            const r = await fetch(url);
            if (!r.ok) {
              console.warn(`[definitions] bundled fetch ${folder}/${id} → ${r.status}`);
              continue;
            }
            const text = await r.text();
            const json = JSON.parse(text);
            defs.set(key(folder, id), {
              folder, id, json, originalText: text, diskId: id, diskFolder: folder,
            });
          } catch (e) {
            console.warn(`[definitions] bundled load ${folder}/${id} failed`, e);
          }
        }
      });
      await Promise.all(workers);
      // Sidecars (optional).
      let hierarchySidecar: any | null = null;
      let propertyMetaSidecar: any | null = null;
      if (manifest.sidecars?.hierarchy) {
        try {
          const r = await fetch(`${baseUrl}base-definitions/.class-hierarchy.json`);
          if (r.ok) hierarchySidecar = await r.json();
        } catch (e) { console.warn('[definitions] bundled hierarchy load failed', e); }
      }
      if (manifest.sidecars?.propertyMeta) {
        try {
          const r = await fetch(`${baseUrl}base-definitions/.property-meta.json`);
          if (r.ok) propertyMetaSidecar = await r.json();
        } catch (e) { console.warn('[definitions] bundled property-meta load failed', e); }
      }
      const classNodes = buildClassNodes(defs, hierarchySidecar);
      const propertySchema = buildPropertySchema(defs);
      const propertyMeta = buildPropertyMeta(propertyMetaSidecar);
      const enumMeta = buildEnumMeta(propertyMetaSidecar);
      const idTemplates = buildIdTemplates(defs);
      // Forget any saved handle — the user is now editing the bundled tree
      // and must Save As to commit edits to a real folder.
      try { await deleteHandle(HANDLE_KEY); } catch { /* noop */ }
      set({
        directoryHandle: null,
        projectMeta: null,
        folders,
        definitions: defs,
        classNodes,
        propertySchema,
        propertyMeta,
        enumMeta,
        idTemplates,
        hierarchySidecar,
        dirty: new Set(),
        selectedFolder: folders[0] ?? null,
        selectedKey: null,
        loadedAt: Date.now(),
        loading: false,
        toast: { kind: 'info', text: `Loaded ${defs.size} bundled definitions across ${folders.length} folders. Save As… to write changes to disk.` },
      });
      {
        const idx = buildReferencedByIndex(get().definitions);
        set({ referencedByIndex: idx });
      }
      get().autoCreateMissingRefs();
    } catch (e) {
      set({
        loading: false,
        errorText: String(e),
        toast: { kind: 'error', text: `Bundled load failed: ${String(e)}` },
      });
    }
  },

  saveAs: async () => {
    const w = window as any;
    if (!w.showDirectoryPicker) {
      set({ toast: { kind: 'error', text: 'This browser lacks the File System Access API. Use Chrome / Edge / Brave.' } });
      return;
    }
    try {
      const handle: FileSystemDirectoryHandle = await w.showDirectoryPicker({ mode: 'readwrite' });
      const ok = await ensurePermission(handle, 'readwrite');
      if (!ok) {
        set({ toast: { kind: 'error', text: 'Permission denied for that directory.' } });
        return;
      }
      // Write every loaded record (regardless of dirty state) so the new
      // folder is a complete copy.
      const { definitions, classNodes } = get();
      let saved = 0;
      let failed = 0;
      const newDefs = new Map<DefinitionsKey, DefinitionRecord>();
      for (const [k, rec] of definitions) {
        if (isLayoutFolder(rec.folder)) {
          newDefs.set(k, rec);
          continue;
        }
        const text = serializeDefinition(rec);
        try {
          const targetFolder = computeTargetFolder(rec, classNodes);
          await writeFile(handle, targetFolder, `${rec.id}.json`, text);
          const newKey = key(targetFolder, rec.id);
          newDefs.set(newKey, {
            ...rec,
            folder: targetFolder,
            originalText: text,
            diskId: rec.id,
            diskFolder: targetFolder,
          });
          saved++;
        } catch (e) {
          console.warn(`[definitions] save-as failed ${k}`, e);
          failed++;
        }
      }
      try { await putHandle(HANDLE_KEY, handle); } catch (e) {
        console.warn('[definitions] could not persist directory handle', e);
      }
      set({
        directoryHandle: handle,
        definitions: newDefs,
        dirty: new Set(),
        toast: {
          kind: failed === 0 ? 'info' : 'error',
          text: failed === 0
            ? `Save As: wrote ${saved} files.`
            : `Save As: wrote ${saved}, failed ${failed}. See console.`,
        },
      });
      {
        const idx = buildReferencedByIndex(get().definitions);
        set({ referencedByIndex: idx });
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        set({ toast: { kind: 'error', text: String(e) } });
      }
    }
  },

  reload: async () => {
    const { directoryHandle } = get();
    if (!directoryHandle) return;
    set({ loading: true, errorText: null });
    try {
      const ok = await ensurePermission(directoryHandle, 'readwrite');
      if (!ok) throw new Error('Permission denied');
      const { folders, defs, rawFiles, hierarchySidecar, propertyMetaSidecar } =
        await readAllJson(directoryHandle);
      // Pre-commit structural check. If anything is malformed, hand
      // control to the LoadGate; only proceed if the user clicks Continue.
      const issues = validateBatch(rawFiles);
      if (issues.length > 0) {
        const proceed = await new Promise<boolean>((resolve) => {
          set({
            loadGate: {
              issues,
              onContinue: () => resolve(true),
              onCancel: () => resolve(false),
            },
          });
        });
        if (!proceed) {
          // User cancelled the load. Back out of the project entirely so
          // the header doesn't show a half-loaded state.
          set({
            loading: false,
            directoryHandle: null,
            projectMeta: null,
            unrealSyncPath: '',
            toast: { kind: 'info', text: 'Load cancelled.' },
          });
          return;
        }
        // Surface what got skipped so the user sees a paper trail in the
        // toast log even after dismissing the modal.
        const skipped = issues.filter((i) => i.kind === 'invalid-json' || i.kind === 'missing-field').length;
        if (skipped > 0) {
          set({ toast: { kind: 'info', text: `Skipped ${skipped} malformed file${skipped === 1 ? '' : 's'}.` } });
        }
      }
      const classNodes = buildClassNodes(defs, hierarchySidecar);
      const propertySchema = buildPropertySchema(defs);
      const propertyMeta = buildPropertyMeta(propertyMetaSidecar);
      const enumMeta = buildEnumMeta(propertyMetaSidecar);
      const idTemplates = buildIdTemplates(defs);
      // Preserve current selection if still valid.
      const cur = get();
      const selectedFolder = cur.selectedFolder && folders.includes(cur.selectedFolder)
        ? cur.selectedFolder
        : folders[0] ?? null;
      const selectedKey = cur.selectedKey && defs.has(cur.selectedKey)
        ? cur.selectedKey
        : null;
      set({
        folders,
        definitions: defs,
        classNodes,
        propertySchema,
        propertyMeta,
        enumMeta,
        idTemplates,
        hierarchySidecar,
        dirty: new Set(),
        selectedFolder,
        selectedKey,
        loadedAt: Date.now(),
        loading: false,
        toast: { kind: 'info', text: `Loaded ${defs.size} definitions across ${folders.length} folders.` },
      });
      {
        const idx = buildReferencedByIndex(get().definitions);
        set({ referencedByIndex: idx });
      }
      // Self-heal dangling refs by minting blank assets where the
      // class is known. Toast inside autoCreateMissingRefs replaces
      // the "Loaded N definitions" toast on success.
      get().autoCreateMissingRefs();
      // Surface any IndexedDB draft for this project so the user can
      // recover from a previous tab crash. Skipped when no project meta
      // (bundled defaults loads call loadBundledDefaults, not reload).
      {
        const meta = get().projectMeta;
        const handle = get().directoryHandle;
        if (meta && handle) {
          try {
            const draft = await loadDraft(projectKey(meta, handle.name));
            if (draft && draft.records.length > 0) {
              set({
                restoreDraftPrompt: {
                  key: projectKey(meta, handle.name),
                  savedAt: draft.savedAt,
                  recordCount: draft.records.length,
                },
              });
            }
          } catch (e) {
            console.warn('[drafts] failed to read draft', e);
          }
        }
      }
    } catch (e) {
      set({
        loading: false,
        errorText: String(e),
        toast: { kind: 'error', text: `Load failed: ${String(e)}` },
      });
    }
  },

  updateValueAtPath: (k, path, value) => {
    const cur = get();
    const rec = cur.definitions.get(k);
    if (!rec) return;
    const nextJson = setIn(rec.json, path, value);
    const nextRec: DefinitionRecord = { ...rec, json: nextJson };
    const nextDefs = new Map(cur.definitions);
    nextDefs.set(k, nextRec);
    const nextDirty = new Set(cur.dirty);
    if (JSON.stringify(nextJson, null, 2) + '\n' !== rec.originalText) {
      nextDirty.add(k);
    } else {
      nextDirty.delete(k);
    }
    set({ definitions: nextDefs, dirty: nextDirty });
    const updated = get().definitions.get(k);
    if (updated) {
      const idx = get().referencedByIndex;
      reindexRecord(idx, k, updated.folder, updated.json?.properties);
      set({ referencedByIndex: new Map(idx) });   // new Map ref so subscribers re-render
    }
  },

  replaceJson: (k, json) => {
    const cur = get();
    const rec = cur.definitions.get(k);
    if (!rec) return;
    const nextRec: DefinitionRecord = { ...rec, json };
    const nextDefs = new Map(cur.definitions);
    nextDefs.set(k, nextRec);
    const nextDirty = new Set(cur.dirty);
    if (JSON.stringify(json, null, 2) + '\n' !== rec.originalText) {
      nextDirty.add(k);
    } else {
      nextDirty.delete(k);
    }
    set({ definitions: nextDefs, dirty: nextDirty });
    const updated = get().definitions.get(k);
    if (updated) {
      const idx = get().referencedByIndex;
      reindexRecord(idx, k, updated.folder, updated.json?.properties);
      set({ referencedByIndex: new Map(idx) });
    }
  },

  saveOne: async (k) => {
    const { directoryHandle, definitions } = get();
    if (!directoryHandle) {
      set({ toast: { kind: 'error', text: 'No target directory selected.' } });
      return;
    }
    const rec = definitions.get(k);
    if (!rec) return;
    if (isLayoutFolder(rec.folder)) {
      set({ toast: { kind: 'info', text: `Skipped ${rec.folder}/ (layout folders are read-only).` } });
      return;
    }
    const ok = await ensurePermission(directoryHandle, 'readwrite');
    if (!ok) {
      set({ toast: { kind: 'error', text: 'Write permission denied.' } });
      return;
    }
    const text = serializeDefinition(rec);
    try {
      const targetFolder = computeTargetFolder(rec, get().classNodes);
      await writeFile(directoryHandle, targetFolder, `${rec.id}.json`, text);
      // Clean up the old on-disk file if EITHER the folder OR the
      // filename changed (class swap, asset rename, or both).
      const folderChanged = targetFolder !== rec.diskFolder;
      const idChanged = rec.id !== rec.diskId;
      if ((folderChanged || idChanged) && rec.originalText) {
        try {
          const oldHandle = await directoryHandle.getDirectoryHandle(rec.diskFolder);
          await oldHandle.removeEntry(`${rec.diskId}.json`);
        } catch (e) {
          console.warn('[definitions] could not remove old file after rename/relocate', e);
        }
      }
      const newKey = key(targetFolder, rec.id);
      const nextRec: DefinitionRecord = {
        ...rec,
        folder: targetFolder,
        originalText: text,
        diskId: rec.id,
        diskFolder: targetFolder,
      };
      const nextDefs = new Map(definitions);
      if (newKey !== k) nextDefs.delete(k);
      nextDefs.set(newKey, nextRec);
      const nextDirty = new Set(get().dirty);
      nextDirty.delete(k);
      nextDirty.delete(newKey);
      const nextFolders = get().folders.includes(targetFolder)
        ? get().folders
        : [...get().folders, targetFolder].sort();
      set({
        definitions: nextDefs,
        dirty: nextDirty,
        folders: nextFolders,
        selectedKey: get().selectedKey === k ? newKey : get().selectedKey,
        selectedFolder: get().selectedKey === k ? targetFolder : get().selectedFolder,
        toast: {
          kind: 'info',
          text: targetFolder === rec.diskFolder && !idChanged
            ? `Saved ${rec.id}.json`
            : `Saved ${rec.id}.json (was ${rec.diskFolder}/${rec.diskId}.json).`,
        },
      });
    } catch (e) {
      set({ toast: { kind: 'error', text: `Save failed: ${String(e)}` } });
    }
  },

  saveAllDirty: async () => {
    const { directoryHandle, definitions, dirty, classNodes, folders } = get();
    if (!directoryHandle) return { saved: 0, failed: 0 };
    const ok = await ensurePermission(directoryHandle, 'readwrite');
    if (!ok) {
      set({ toast: { kind: 'error', text: 'Write permission denied.' } });
      return { saved: 0, failed: 0 };
    }
    let saved = 0;
    let failed = 0;
    const nextDefs = new Map(definitions);
    const nextDirty = new Set(dirty);
    let nextFolders = folders;
    let nextSelectedKey = get().selectedKey;
    let nextSelectedFolder = get().selectedFolder;
    for (const k of dirty) {
      const rec = definitions.get(k);
      if (!rec) continue;
      if (isLayoutFolder(rec.folder)) {
        nextDirty.delete(k);
        continue;
      }
      const text = serializeDefinition(rec);
      try {
        const targetFolder = computeTargetFolder(rec, classNodes);
        await writeFile(directoryHandle, targetFolder, `${rec.id}.json`, text);
        const folderChanged = targetFolder !== rec.diskFolder;
        const idChanged = rec.id !== rec.diskId;
        if ((folderChanged || idChanged) && rec.originalText) {
          try {
            const oldHandle = await directoryHandle.getDirectoryHandle(rec.diskFolder);
            await oldHandle.removeEntry(`${rec.diskId}.json`);
          } catch (e) {
            console.warn('[definitions] could not remove old file after rename/relocate', e);
          }
        }
        const newKey = key(targetFolder, rec.id);
        if (newKey !== k) nextDefs.delete(k);
        nextDefs.set(newKey, {
          ...rec,
          folder: targetFolder,
          originalText: text,
          diskId: rec.id,
          diskFolder: targetFolder,
        });
        if (!nextFolders.includes(targetFolder)) {
          nextFolders = [...nextFolders, targetFolder].sort();
        }
        if (nextSelectedKey === k) {
          nextSelectedKey = newKey;
          nextSelectedFolder = targetFolder;
        }
        nextDirty.delete(k);
        saved++;
      } catch (e) {
        console.warn(`[definitions] save failed ${k}`, e);
        failed++;
      }
    }
    set({
      definitions: nextDefs,
      dirty: nextDirty,
      folders: nextFolders,
      selectedKey: nextSelectedKey,
      selectedFolder: nextSelectedFolder,
      toast: {
        kind: failed === 0 ? 'info' : 'error',
        text:
          failed === 0
            ? `Saved ${saved} files.`
            : `Saved ${saved}, failed ${failed}. See console.`,
      },
    });
    return { saved, failed };
  },

  revertOne: (k) => {
    const cur = get();
    const rec = cur.definitions.get(k);
    if (!rec) return;
    try {
      const json = JSON.parse(rec.originalText);
      const nextRec: DefinitionRecord = { ...rec, json };
      const nextDefs = new Map(cur.definitions);
      nextDefs.set(k, nextRec);
      const nextDirty = new Set(cur.dirty);
      nextDirty.delete(k);
      set({
        definitions: nextDefs,
        dirty: nextDirty,
        toast: { kind: 'info', text: `Reverted ${rec.id}.json` },
      });
    } catch (e) {
      set({ toast: { kind: 'error', text: `Revert failed: ${String(e)}` } });
    }
  },

  syncToUnreal: async () => {
    const { saveAllDirty: doSave } = get();
    await doSave();
    const path = get().unrealSyncPath?.trim();
    if (!path) {
      const report = "Set the Unreal Definitions folder path first (Settings → Sync path).";
      set({ toast: { kind: 'error', text: report } });
      return { ok: false, report };
    }
    try {
      const resp = await fetch('http://localhost:13378/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitions_dir: path, force: false }),
      });
      const report = await resp.text();
      const ok = resp.ok && !report.includes('FAILED') && !report.includes('ERROR:');
      set({ toast: { kind: ok ? 'info' : 'error', text: report } });
      return { ok, report };
    } catch (e) {
      const report = `Could not reach Unreal Editor sync server at http://localhost:13378.\n` +
        `Is the editor running with the TSICEditorSync module loaded?\n\n` +
        `Network error: ${String(e)}`;
      set({ toast: { kind: 'error', text: report } });
      return { ok: false, report };
    }
  },

  unrealSyncPath: (() => {
    try { return localStorage.getItem('tsic.def.syncpath.v1') ?? ''; }
    catch { return ''; }
  })(),

  setUnrealSyncPath: async (p: string) => {
    const { directoryHandle, projectMeta } = get();
    const nextMeta: ProjectMeta | null = projectMeta
      ? { ...projectMeta, ue_sync_path: p }
      : null;
    set({ unrealSyncPath: p, projectMeta: nextMeta });
    // Persist to project.json when a project is open.
    if (directoryHandle && nextMeta) {
      try {
        await writeProjectMeta(directoryHandle, nextMeta);
      } catch (e) {
        console.warn('[definitions] could not write project.json', e);
      }
    } else {
      // Fall back to localStorage for legacy/no-project-json folders.
      try { localStorage.setItem('tsic.def.syncpath.v1', p); } catch { /* noop */ }
    }
  },

  findKeyById: (assetId) => {
    const { definitions } = get();
    if (!assetId) return null;
    for (const [k, rec] of definitions) {
      if (rec.id === assetId) return k;
    }
    return null;
  },

  referencedBy: (assetId) => get().referencedByIndex.get(assetId) ?? [],

  folderForClass: (bareClassName) => {
    if (!bareClassName) return null;
    const { classNodes } = get();
    const node = classNodes.get(`U${bareClassName}`) ?? classNodes.get(bareClassName);
    return node?.folder ?? null;
  },

  lookupContainerType: (path, slot) => {
    const { propertySchema } = get();
    const k = path.filter((s) => typeof s === 'string').join('.');
    const entry = propertySchema.get(k);
    return entry ? (entry as any)[slot] ?? null : null;
  },

  getPropertyMeta: (parentTypeName, propertyName) => {
    if (!propertyName) return null;
    const { propertyMeta, classNodes } = get();
    const candidates: string[] = [];
    if (parentTypeName) {
      const bare = parentTypeName.replace(/^U/, '');
      candidates.push(bare);
      // Walk class parent chain so a property declared on UItemDefinition is
      // found when the asset is a UConsumableDefinition. Struct names (`F…`)
      // won't have a node and just fall through.
      const node = classNodes.get(`U${bare}`) ?? classNodes.get(bare);
      if (node?.parents) {
        for (const p of node.parents) {
          candidates.push(p.replace(/^U/, ''));
        }
      }
    }
    // Try the b-stripped form too — the .h scanner registers both, but if
    // the editor is asked about a name like `b_foo` and the meta only has
    // `foo`, the alternate form lets us match.
    const propAlternates = [propertyName];
    if (/^b_[a-z]/.test(propertyName)) {
      propAlternates.push(propertyName.slice(2));
    }
    for (const cls of candidates) {
      for (const p of propAlternates) {
        const hit = propertyMeta.get(`${cls}.${p}`);
        if (hit) return hit;
      }
    }
    return null;
  },

  lookupArrayElementClass: (parentTypeName, propertyName) => {
    const meta = get().getPropertyMeta(parentTypeName, propertyName);
    return meta?.element_class ?? null;
  },

  getEnumMembers: (enumName) => {
    if (!enumName) return null;
    const { enumMeta } = get();
    const bare = enumName.replace(/^E/, '');
    return enumMeta.get(bare) ?? enumMeta.get(enumName) ?? null;
  },

  renameAsset: (k, newBareName) => {
    // Asset ids never carry whitespace — the user types the
    // humanized form ("Baked Potato") in either the asset title or
    // the Definitions-tab name input; we strip every whitespace run
    // here so callers don't have to.
    const stem = newBareName.replace(/\s+/g, '');
    if (!stem) return null;
    const cur = get();
    const rec = cur.definitions.get(k);
    if (!rec) return null;
    const cls = String(rec.json?.class ?? '');
    const bareCls = cls.replace(/^U/, '');
    // Use the per-class template when available; otherwise preserve the
    // record's existing prefix/suffix so renames don't accidentally drop
    // them.
    const tmpl = cur.idTemplates.get(bareCls);
    const existing = splitAssetId(rec.id);
    const prefix = tmpl?.prefix ?? existing.prefix;
    const suffix = tmpl?.suffix ?? existing.suffix;
    const fullId = `${prefix}${stem}${suffix}`;
    if (fullId === rec.id) return k;
    const newKey = key(rec.folder, fullId);
    if (cur.definitions.has(newKey)) {
      set({ toast: { kind: 'error', text: `${fullId}.json already exists.` } });
      return null;
    }
    const nextJson = { ...rec.json, id: fullId };
    if (typeof rec.json?.asset_path === 'string') {
      const segs = rec.json.asset_path.split('/');
      segs[segs.length - 1] = fullId;
      nextJson.asset_path = segs.join('/');
    }
    const nextRec: DefinitionRecord = {
      ...rec,
      id: fullId,
      json: nextJson,
    };
    const nextDefs = new Map(cur.definitions);
    nextDefs.delete(k);
    nextDefs.set(newKey, nextRec);
    const nextDirty = new Set(cur.dirty);
    nextDirty.delete(k);
    if (JSON.stringify(nextJson, null, 2) + '\n' !== rec.originalText) {
      nextDirty.add(newKey);
    }
    // Cascade: any other asset with a definition_ref pointing at the
    // OLD id is rewritten to point at the new id, so the rename is
    // self-consistent across the project (no dangling refs).
    let cascadedAssets = 0;
    let cascadedRefs = 0;
    for (const [refKey, refRec] of nextDefs) {
      if (refKey === newKey) continue;
      const out = retargetRefs(refRec.json, rec.id, fullId);
      if (out.changed) {
        nextDefs.set(refKey, { ...refRec, json: out.next });
        nextDirty.add(refKey);
        cascadedAssets++;
        cascadedRefs += out.touchedCount;
      }
    }
    set({
      definitions: nextDefs,
      dirty: nextDirty,
      selectedKey: cur.selectedKey === k ? newKey : cur.selectedKey,
      toast: {
        kind: 'info',
        text: cascadedAssets > 0
          ? `Renamed to ${fullId} — retargeted ${cascadedRefs} ref${cascadedRefs === 1 ? '' : 's'} across ${cascadedAssets} asset${cascadedAssets === 1 ? '' : 's'}.`
          : `Renamed to ${fullId} — old file removed on save.`,
      },
    });
    return newKey;
  },

  togglePinnedProperty: (name) => {
    if (!name) return;
    const cur = get().pinnedProperties;
    const next = new Set(cur);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    savePinned(next);
    set({ pinnedProperties: next });
  },

  changeClass: (k, newClass) => {
    const cur = get();
    const rec = cur.definitions.get(k);
    if (!rec) return;
    const want = newClass.startsWith('U') ? newClass : `U${newClass}`;
    if (rec.json?.class === want) return;
    const node = cur.classNodes.get(want) ?? cur.classNodes.get(want.slice(1));
    const parents = node?.parents ? [...node.parents] : Array.isArray(rec.json?.parent_classes)
      ? rec.json.parent_classes
      : [];
    // Find a template asset of the new class to learn its expected
    // property shape. We retain only the current properties whose
    // name AND envelope `type` match the template — anything else
    // would be unreadable by the new class. The template's missing
    // properties are added with blank values so the typed editor
    // immediately shows the full schema.
    let template: any = null;
    for (const r of cur.definitions.values()) {
      if (r === rec) continue;
      if (String(r.json?.class ?? '') === want) { template = r.json; break; }
    }
    if (!template) {
      for (const r of cur.definitions.values()) {
        if (r === rec) continue;
        const parentChain = r.json?.parent_classes;
        if (Array.isArray(parentChain) && parentChain.includes(want)) { template = r.json; break; }
      }
    }
    // Additive merge: retain every property from the source that
    // type-matches the new class's expected shape (so type-incompat
    // properties are replaced with the new template's blank), append
    // any template properties the source lacked, and KEEP everything
    // else as-is. The user can clean up unwanted leftovers manually
    // — destructive deletion on class swap loses too much work.
    const oldProps: Record<string, any> = (rec.json?.properties ?? {}) as any;
    const mergedProps: Record<string, any> = { ...oldProps };
    let kept = Object.keys(oldProps).length;
    let added = 0;
    let replaced = 0;
    if (template?.properties && typeof template.properties === 'object') {
      const tmplProps = template.properties as Record<string, any>;
      for (const [name, tmplVal] of Object.entries(tmplProps)) {
        const oldVal = oldProps[name];
        if (!oldVal) {
          mergedProps[name] = blankifyTypedValue(tmplVal);
          added++;
        } else if (
          typeof oldVal === 'object' && typeof tmplVal === 'object' &&
          (oldVal as any).type !== (tmplVal as any).type
        ) {
          mergedProps[name] = blankifyTypedValue(tmplVal);
          replaced++;
          kept--; // we replaced one we initially counted as kept
        }
      }
    }
    const nextJson = { ...rec.json, class: want, parent_classes: parents, properties: mergedProps };
    const nextRec: DefinitionRecord = { ...rec, json: nextJson };
    const nextDefs = new Map(cur.definitions);
    nextDefs.set(k, nextRec);
    const nextDirty = new Set(cur.dirty);
    if (JSON.stringify(nextJson, null, 2) + '\n' !== rec.originalText) {
      nextDirty.add(k);
    } else {
      nextDirty.delete(k);
    }
    const targetFolder = node?.folder ?? folderForBareClass(want.slice(1));
    const moveNote = targetFolder && targetFolder !== rec.folder
      ? ` — file moves to ${targetFolder}/ on save.`
      : '.';
    const propNote = template
      ? ` Kept ${kept}, added ${added}${replaced ? `, replaced ${replaced} mismatched` : ''} propert${kept + added + replaced === 1 ? 'y' : 'ies'}.`
      : '';
    set({
      definitions: nextDefs,
      dirty: nextDirty,
      toast: {
        kind: 'info',
        text: `Class set to ${want}${moveNote}${propNote}`,
      },
    });
  },

  findItemStaticPair: (k) => {
    const { definitions, classNodes } = get();
    const rec = definitions.get(k);
    if (!rec) return null;
    const cls = String(rec.json?.class ?? '');
    const isStaticItem = (className: string): boolean => {
      if (className === 'UStaticItemDefinition') return true;
      const node = classNodes.get(className);
      return !!node?.parents?.includes('UStaticItemDefinition');
    };
    const isItem = (className: string): boolean => {
      if (className === 'UItemDefinition') return true;
      const node = classNodes.get(className);
      return !!node?.parents?.includes('UItemDefinition');
    };
    // Item → walk its static_item_definition typed envelope to the target id.
    if (isItem(cls)) {
      const ref = rec.json?.properties?.static_item_definition;
      const refValue = ref && typeof ref === 'object' ? String(ref.value ?? '') : '';
      if (!refValue) return null;
      for (const [tk, trec] of definitions) {
        if (trec.id === refValue) return tk;
      }
      return null;
    }
    // StaticItem → look for any Item whose static_item_definition points here.
    if (isStaticItem(cls)) {
      for (const [tk, trec] of definitions) {
        const tcls = String(trec.json?.class ?? '');
        if (!isItem(tcls)) continue;
        const sref = trec.json?.properties?.static_item_definition;
        const sval = sref && typeof sref === 'object' ? String(sref.value ?? '') : '';
        if (sval === rec.id) return tk;
      }
    }
    return null;
  },

  assetsOfClass: (bareClassName) => {
    if (!bareClassName) return [];
    const { definitions } = get();
    const want = `U${bareClassName}`;
    const out: string[] = [];
    for (const rec of definitions.values()) {
      const cls = String(rec.json?.class ?? '');
      if (!cls) continue;
      if (cls === want) {
        out.push(rec.id);
        continue;
      }
      const parents = rec.json?.parent_classes;
      if (Array.isArray(parents) && parents.includes(want)) {
        out.push(rec.id);
      }
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  },

  createDefinitionForClass: (bareClassName, id) => {
    if (!bareClassName || !id) return null;
    const cur = get();
    // Find the folder that holds this class. Fall back to a derived folder
    // name from the class (e.g. ConsumableDefinition → consumable_definitions)
    // if the sidecar doesn't know it.
    const wantClass = `U${bareClassName}`;
    let folder = cur.classNodes.get(wantClass)?.folder ?? cur.classNodes.get(bareClassName)?.folder;
    if (!folder) {
      // class_to_folder: trim trailing 'Definition' suffix only if there are
      // multiple words, then snake_case + add `_definitions` suffix.
      const snake = bareClassName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      folder = snake.endsWith('_definition') ? `${snake}s` : `${snake}_definitions`;
    }
    // Pick a template from any existing asset of the same (or descendant) class
    // so the typed-envelope shape is preserved on disk.
    let template: any = null;
    for (const rec of cur.definitions.values()) {
      const cls = String(rec.json?.class ?? '');
      if (cls === wantClass) {
        template = rec.json;
        break;
      }
    }
    if (!template) {
      for (const rec of cur.definitions.values()) {
        const parents = rec.json?.parent_classes;
        if (Array.isArray(parents) && parents.includes(wantClass)) {
          template = rec.json;
          break;
        }
      }
    }
    const blank = template
      ? blankFromTypedTemplate(template, id, folder, wantClass)
      : {
          id,
          asset_path: `/Game/Definitions/${folder}/${id}`,
          class: wantClass,
          parent_classes: [],
          properties: {},
        };
    return get().createDefinition(folder, id, blank, { select: false });
  },

  createDefinition: (folder, id, template, opts) => {
    const cur = get();
    if (!folder || !id) return null;
    if (!cur.folders.includes(folder)) {
      // Allow creating in a brand new folder.
      set({ folders: [...cur.folders, folder].sort() });
    }
    const k = key(folder, id);
    if (cur.definitions.has(k)) {
      set({ toast: { kind: 'error', text: `${id}.json already exists.` } });
      return null;
    }
    const blank = template ?? {
      id,
      asset_path: `/Game/Definitions/${folder}/${id}`,
      class: '',
      parent_classes: [],
      properties: {},
    };
    // Force the id to match the filename.
    const json = { ...blank, id };
    const rec: DefinitionRecord = {
      folder,
      id,
      json,
      // Empty original means the file doesn't exist on disk yet — any state
      // is "dirty".
      originalText: '',
      diskId: id,
      diskFolder: folder,
    };
    const nextDefs = new Map(cur.definitions);
    nextDefs.set(k, rec);
    const nextDirty = new Set(cur.dirty);
    nextDirty.add(k);
    const select = opts?.select ?? true;
    set({
      definitions: nextDefs,
      dirty: nextDirty,
      ...(select ? { selectedFolder: folder, selectedKey: k } : {}),
      // Refresh the class + schema indexes so the new asset shows up in
      // dropdowns and any non-empty containers it carries seed +Add for
      // future edits.
      classNodes: buildClassNodes(nextDefs, cur.hierarchySidecar),
      propertySchema: buildPropertySchema(nextDefs),
      toast: { kind: 'info', text: `Created ${id}.json (unsaved).` },
    });
    {
      const idx = get().referencedByIndex;
      reindexRecord(idx, k, rec.folder, rec.json?.properties);
      set({ referencedByIndex: new Map(idx) });
    }
    return k;
  },

  duplicateDefinition: (sourceKey, newId) => {
    const cur = get();
    const src = cur.definitions.get(sourceKey);
    if (!src) return null;
    if (!newId) return null;
    const newKey = key(src.folder, newId);
    if (cur.definitions.has(newKey)) {
      set({ toast: { kind: 'error', text: `${newId}.json already exists.` } });
      return null;
    }
    const cloned = JSON.parse(JSON.stringify(src.json));
    if (cloned && typeof cloned === 'object') {
      cloned.id = newId;
      // Try to swap the trailing asset name in asset_path too.
      if (typeof cloned.asset_path === 'string' && cloned.asset_path.endsWith(src.id)) {
        cloned.asset_path = cloned.asset_path.slice(0, -src.id.length) + newId;
      }
    }
    const rec: DefinitionRecord = {
      folder: src.folder,
      id: newId,
      json: cloned,
      originalText: '',
      diskId: newId,
      diskFolder: src.folder,
    };
    const nextDefs = new Map(cur.definitions);
    nextDefs.set(newKey, rec);
    const nextDirty = new Set(cur.dirty);
    nextDirty.add(newKey);
    set({
      definitions: nextDefs,
      dirty: nextDirty,
      classNodes: buildClassNodes(nextDefs, cur.hierarchySidecar),
      propertySchema: buildPropertySchema(nextDefs),
      selectedKey: newKey,
      toast: { kind: 'info', text: `Duplicated to ${newId}.json (unsaved).` },
    });
    {
      const idx = get().referencedByIndex;
      reindexRecord(idx, newKey, rec.folder, rec.json?.properties);
      set({ referencedByIndex: new Map(idx) });
    }
    return newKey;
  },

  deleteDefinition: async (k) => {
    const { directoryHandle, definitions, dirty } = get();
    const rec = definitions.get(k);
    if (!rec) return;
    // Remove from disk if it was ever saved (originalText non-empty means it
    // existed on disk).
    if (directoryHandle && rec.originalText) {
      try {
        const ok = await ensurePermission(directoryHandle, 'readwrite');
        if (!ok) {
          set({ toast: { kind: 'error', text: 'Write permission denied.' } });
          return;
        }
        const folderHandle = await directoryHandle.getDirectoryHandle(rec.folder);
        await folderHandle.removeEntry(`${rec.id}.json`);
      } catch (e) {
        set({ toast: { kind: 'error', text: `Delete failed: ${String(e)}` } });
        return;
      }
    }
    // Cascade: every other asset that references the deleted id must
    // be cleaned up so autoCreateMissingRefs doesn't silently revive
    // the asset on next reload. We scrub each typed envelope:
    //   • a standalone def_ref → set value to '' (keeps the slot but
    //     unbound)
    //   • an array entry that IS a def_ref to the id → splice it out
    //   • a map entry whose key resolves to the id → splice it out
    // The owning record gets marked dirty so the cleanup persists.
    const deletedId = rec.id;
    const nextDefs = new Map(definitions);
    nextDefs.delete(k);
    const nextDirty = new Set(dirty);
    nextDirty.delete(k);
    let scrubbedAssets = 0;
    let scrubbedRefs = 0;
    const scrubbedKeys: DefinitionsKey[] = [];
    for (const [refKey, refRec] of nextDefs) {
      const cleaned = scrubRefsToId(refRec.json, deletedId);
      if (cleaned.changed) {
        nextDefs.set(refKey, { ...refRec, json: cleaned.next });
        nextDirty.add(refKey);
        scrubbedAssets++;
        scrubbedRefs += cleaned.removedCount;
        scrubbedKeys.push(refKey);
      }
    }
    const cur = get();
    set({
      definitions: nextDefs,
      dirty: nextDirty,
      classNodes: buildClassNodes(nextDefs, cur.hierarchySidecar),
      propertySchema: buildPropertySchema(nextDefs),
      selectedKey: cur.selectedKey === k ? null : cur.selectedKey,
      toast: {
        kind: 'info',
        text: scrubbedAssets > 0
          ? `Deleted ${rec.id}.json — cleaned ${scrubbedRefs} ref${scrubbedRefs === 1 ? '' : 's'} from ${scrubbedAssets} asset${scrubbedAssets === 1 ? '' : 's'}.`
          : `Deleted ${rec.id}.json`,
      },
    });
    {
      const idx = get().referencedByIndex;
      // Drop every entry contributed by the deleted record itself.
      for (const [targetId, list] of idx) {
        const filtered = list.filter((r) => r.ownerKey !== k);
        if (filtered.length === 0) idx.delete(targetId);
        else if (filtered.length !== list.length) idx.set(targetId, filtered);
      }
      // Re-walk each cascade-scrubbed record so stale entries pointing at
      // other targets get pruned too.
      const defsAfter = get().definitions;
      for (const sk of scrubbedKeys) {
        const sr = defsAfter.get(sk);
        if (sr) reindexRecord(idx, sk, sr.folder, sr.json?.properties);
      }
      set({ referencedByIndex: new Map(idx) });
    }
  },

  autoCreateMissingRefs: () => {
    const { definitions, classNodes } = get();
    const known = new Set<string>();
    for (const rec of definitions.values()) known.add(rec.id);
    // Collect missing (class, value) pairs once before mutating; then
    // create each unique target. Using a map keyed by value+class so a
    // ref appearing in many assets only mints one new file.
    const missing = new Map<string, { cls: string; value: string }>();
    for (const rec of definitions.values()) {
      walkTypedEnvelopes(rec.json?.properties ?? {}, [], (typed) => {
        if (typed.type !== 'definition_ref') return;
        const cls = String(typed.class ?? '');
        const value = typed.value;
        if (!cls || !value || typeof value !== 'string') return;
        if (known.has(value)) return;
        // Only mint when the target's class is known to the loaded
        // hierarchy — guards against engine refs (e.g. ScpAbilitySet)
        // that live outside the export.
        const knownClass =
          classNodes.has(`U${cls}`) || classNodes.has(cls);
        if (!knownClass) return;
        missing.set(`${cls}:${value}`, { cls, value });
      });
    }
    let created = 0;
    let skipped = 0;
    for (const { cls, value } of missing.values()) {
      const k = get().createDefinitionForClass(cls, value);
      if (k) {
        created++;
        known.add(value);
      } else {
        skipped++;
      }
    }
    if (created > 0) {
      set({ toast: {
        kind: 'info',
        text: `Auto-created ${created} missing asset${created === 1 ? '' : 's'} from dangling refs.`,
      } });
    }
    return { created, skipped };
  },

  searchAll: (query, limit = 200) => {
    const { definitions } = get();
    const q = query.trim();
    if (!q) return [];
    type Hit = { key: DefinitionsKey; folder: string; id: string; matchPath: string; snippet: string; ranges: Array<[number, number]>; score: number };
    const idHits: Hit[] = [];
    const valueHits: Hit[] = [];
    const qLower = q.toLowerCase();
    for (const [k, rec] of definitions) {
      // Token-aware fuzzy match on the id first (highest signal).
      const idMatch = fuzzyMatch(rec.id, q);
      if (idMatch) {
        idHits.push({
          key: k, folder: rec.folder, id: rec.id,
          matchPath: 'id', snippet: rec.id,
          ranges: idMatch.ranges, score: idMatch.score + 1000,
        });
        continue;
      }
      // Substring fall-through for values inside the JSON. Fuzzy on
      // every leaf string would be too slow on a 2000-record set.
      const found = walkForString(rec.json, qLower);
      if (found) {
        const idx = found.value.toLowerCase().indexOf(qLower);
        const ranges: Array<[number, number]> = idx >= 0
          ? [[idx, idx + qLower.length]]
          : [];
        valueHits.push({
          key: k, folder: rec.folder, id: rec.id,
          matchPath: found.path, snippet: found.value,
          ranges, score: 100 - found.path.length * 0.5,
        });
      }
    }
    idHits.sort((a, b) => b.score - a.score);
    valueHits.sort((a, b) => b.score - a.score);
    const out = [...idHits, ...valueHits].slice(0, limit);
    // Strip the score field — not part of the public type.
    return out.map(({ score: _drop, ...rest }) => rest);
  },

  findOrphanReferences: () => {
    const { definitions, classNodes } = get();
    const known = new Set<string>();
    for (const rec of definitions.values()) known.add(rec.id);
    const issues: Array<{ key: DefinitionsKey; folder: string; id: string; refPath: string; refValue: string }> = [];
    // Walk every typed envelope. Any `definition_ref` whose `value` is set but
    // doesn't resolve to a known asset id is an orphan. Refs to classes that
    // don't exist in the loaded set (e.g. ScpAbilitySet) are skipped — they
    // live outside the Definitions tree.
    for (const [k, rec] of definitions) {
      walkTypedEnvelopes(rec.json?.properties ?? {}, ['properties'], (typed, path) => {
        if (typed.type !== 'definition_ref') return;
        const refClass = String(typed.class ?? '');
        const refValue = typed.value;
        if (!refValue || typeof refValue !== 'string') return;
        // Only flag classes we actually have in the loaded set — avoids noise
        // from out-of-tree refs (engine assets stripped during export).
        const knownClass =
          classNodes.has(`U${refClass}`) || classNodes.has(refClass);
        if (!knownClass) return;
        if (known.has(refValue)) return;
        issues.push({
          key: k,
          folder: rec.folder,
          id: rec.id,
          refPath: path.join('.'),
          refValue,
        });
      });
    }
    return issues;
  },

  findItemStaticOrphans: () => {
    const { definitions, classNodes } = get();
    const out: Array<{
      key: DefinitionsKey;
      folder: string;
      id: string;
      issue: 'item-missing-static' | 'static-missing-item';
      detail: string;
    }> = [];
    const isStaticItem = (className: string): boolean => {
      if (className === 'UStaticItemDefinition') return true;
      const node = classNodes.get(className);
      return !!node?.parents?.includes('UStaticItemDefinition');
    };
    const isItem = (className: string): boolean => {
      if (className === 'UItemDefinition') return true;
      const node = classNodes.get(className);
      return !!node?.parents?.includes('UItemDefinition');
    };
    // Index every Item's static_item_definition target so the reverse
    // sweep below is O(N) total instead of O(N*M).
    const itemPointers = new Set<string>();
    for (const rec of definitions.values()) {
      const cls = String(rec.json?.class ?? '');
      if (!isItem(cls)) continue;
      const ref = rec.json?.properties?.static_item_definition;
      const target = ref && typeof ref === 'object' ? String(ref.value ?? '') : '';
      if (target) itemPointers.add(target);
      else {
        out.push({
          key: `${rec.folder}/${rec.id}`,
          folder: rec.folder,
          id: rec.id,
          issue: 'item-missing-static',
          detail: 'static_item_definition is empty',
        });
        continue;
      }
      // If the target is set but doesn't resolve to a loaded asset, flag it too.
      let resolved = false;
      for (const t of definitions.values()) {
        if (t.id === target) { resolved = true; break; }
      }
      if (!resolved) {
        out.push({
          key: `${rec.folder}/${rec.id}`,
          folder: rec.folder,
          id: rec.id,
          issue: 'item-missing-static',
          detail: `points at unloaded ${target}`,
        });
      }
    }
    for (const rec of definitions.values()) {
      const cls = String(rec.json?.class ?? '');
      if (!isStaticItem(cls)) continue;
      if (!itemPointers.has(rec.id)) {
        out.push({
          key: `${rec.folder}/${rec.id}`,
          folder: rec.folder,
          id: rec.id,
          issue: 'static-missing-item',
          detail: 'no ItemDefinition references this StaticItem',
        });
      }
    }
    return out;
  },

  outgoingReferences: (k) => {
    const { definitions } = get();
    const rec = definitions.get(k);
    if (!rec) return [];
    const out: Array<{ refClass: string; refValue: string; refPath: string; targetKey: DefinitionsKey | null }> = [];
    walkTypedEnvelopes(rec.json?.properties ?? {}, ['properties'], (typed, path) => {
      if (typed.type !== 'definition_ref') return;
      const refClass = String(typed.class ?? '');
      const refValue = typed.value;
      if (!refValue || typeof refValue !== 'string') return;
      let targetKey: DefinitionsKey | null = null;
      for (const [tk, trec] of definitions) {
        if (trec.id === refValue) {
          targetKey = tk;
          break;
        }
      }
      out.push({
        refClass,
        refValue,
        refPath: path.join('.'),
        targetKey,
      });
    });
    // Sort: resolved first, then by class+value.
    out.sort((a, b) => {
      if (!!a.targetKey !== !!b.targetKey) return a.targetKey ? -1 : 1;
      const c = a.refClass.localeCompare(b.refClass);
      return c !== 0 ? c : a.refValue.localeCompare(b.refValue);
    });
    return out;
  },

  incomingReferences: (k) => {
    const { definitions } = get();
    const target = definitions.get(k);
    if (!target) return [];
    const targetId = target.id;
    const out: Array<{ sourceKey: DefinitionsKey; sourceFolder: string; sourceId: string; refClass: string; refPath: string }> = [];
    for (const [sk, rec] of definitions) {
      if (sk === k) continue;
      walkTypedEnvelopes(rec.json?.properties ?? {}, ['properties'], (typed, path) => {
        if (typed.type !== 'definition_ref') return;
        if (typed.value !== targetId) return;
        out.push({
          sourceKey: sk,
          sourceFolder: rec.folder,
          sourceId: rec.id,
          refClass: String(typed.class ?? ''),
          refPath: path.join('.'),
        });
      });
    }
    out.sort((a, b) =>
      a.sourceFolder.localeCompare(b.sourceFolder) || a.sourceId.localeCompare(b.sourceId),
    );
    return out;
  },

  exportZip: async () => {
    // Minimal pure-JS ZIP writer (store-only; no compression). Each file
    // becomes one local-file-header + the bytes, followed by a central
    // directory and end-of-central-directory record. Good enough for this
    // export — total dataset is a few MB of JSON.
    const enc = new TextEncoder();
    const { definitions } = get();
    const files: { path: string; data: Uint8Array; crc: number }[] = [];
    for (const rec of definitions.values()) {
      const data = enc.encode(serializeDefinition(rec));
      files.push({
        path: `${rec.folder}/${rec.id}.json`,
        data,
        crc: crc32(data),
      });
    }
    return makeZip(files);
  },
}));

// CRC-32 — table-based, IEEE polynomial. Used for ZIP per-file checksum.
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files: { path: string; data: Uint8Array; crc: number }[]): Blob {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const local = new Uint8Array(30 + nameBytes.length + f.data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header signature
    dv.setUint16(4, 20, true); // version
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 0, true); // compression: store
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    dv.setUint32(14, f.crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra
    local.set(nameBytes, 30);
    local.set(f.data, 30 + nameBytes.length);
    localChunks.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, f.crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);
    centralSize += central.length;

    offset += local.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  // Concatenate into a single ArrayBuffer to dodge typing inconsistencies
  // between Uint8Array<ArrayBufferLike> and BlobPart.
  let total = 0;
  for (const c of localChunks) total += c.length;
  for (const c of centralChunks) total += c.length;
  total += eocd.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of localChunks) { out.set(c, off); off += c.length; }
  for (const c of centralChunks) { out.set(c, off); off += c.length; }
  out.set(eocd, off);
  return new Blob([out as BlobPart], { type: 'application/zip' });
}

// ---------------------------------------------------------------------------
// Draft autosave: debounce flushes of the dirty set into IndexedDB so a tab
// crash doesn't lose unsaved work. Subscribes to the store's dirty slice
// rather than threading scheduleDraftFlush() through every mutation path.
// ---------------------------------------------------------------------------
let draftFlushTimer: ReturnType<typeof setTimeout> | null = null;
const DRAFT_DEBOUNCE_MS = 1000;

function scheduleDraftFlush() {
  if (typeof window === 'undefined') return;
  if (draftFlushTimer) clearTimeout(draftFlushTimer);
  draftFlushTimer = setTimeout(async () => {
    draftFlushTimer = null;
    const s = useDefinitionsStore.getState();
    const meta = s.projectMeta;
    const handle = s.directoryHandle;
    if (!meta || !handle) return;
    const k = projectKey(meta, handle.name);
    if (s.dirty.size === 0) {
      try { await clearDraft(k); } catch { /* noop */ }
      return;
    }
    const recs: Array<[DefinitionsKey, DefinitionRecord]> = [];
    for (const dk of s.dirty) {
      const rec = s.definitions.get(dk);
      if (rec) recs.push([dk, rec]);
    }
    try { await saveDraft(k, recs); } catch { /* noop */ }
  }, DRAFT_DEBOUNCE_MS);
}

if (typeof window !== 'undefined') {
  let lastDirty: Set<DefinitionsKey> = useDefinitionsStore.getState().dirty;
  useDefinitionsStore.subscribe((state) => {
    if (state.dirty !== lastDirty) {
      lastDirty = state.dirty;
      scheduleDraftFlush();
    }
  });
}

// Test hooks used by the savedload smoke to mark a record dirty + flush
// the draft cache synchronously, bypassing the 1-second debounce. Tiny
// enough that we don't gate them on env — they only run when called.
if (typeof window !== 'undefined') {
  (window as any).__forceDirty = () => {
    const s = useDefinitionsStore.getState();
    const firstKey = s.definitions.keys().next().value;
    if (!firstKey) return;
    const rec = s.definitions.get(firstKey)!;
    useDefinitionsStore.setState((cur) => {
      const nextDefs = new Map(cur.definitions);
      nextDefs.set(firstKey, { ...rec, json: { ...rec.json, __testDirty: Date.now() } });
      const nextDirty = new Set(cur.dirty);
      nextDirty.add(firstKey);
      return { definitions: nextDefs, dirty: nextDirty };
    });
  };
  (window as any).__flushDraftsNow = async () => {
    if (draftFlushTimer) { clearTimeout(draftFlushTimer); draftFlushTimer = null; }
    const s = useDefinitionsStore.getState();
    const meta = s.projectMeta;
    const handle = s.directoryHandle;
    if (!meta || !handle) return;
    const k = projectKey(meta, handle.name);
    const recs: Array<[DefinitionsKey, DefinitionRecord]> = [];
    for (const dk of s.dirty) {
      const rec = s.definitions.get(dk);
      if (rec) recs.push([dk, rec]);
    }
    if (recs.length === 0) await clearDraft(k);
    else await saveDraft(k, recs);
  };
}
