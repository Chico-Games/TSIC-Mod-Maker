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
