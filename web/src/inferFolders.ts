// Walks a record's typed-envelope properties and returns the folders
// that house every class the record references. One-level hop: for an
// asset with an upgrade_recipe → recipe → input.key_type chain, we
// follow the upgrade_recipe so the palette suggests the recipe's
// input classes without the user clicking the recipe card first.

import type { ClassNode } from './store/appSchemaStore';
import type { DefinitionRecord, DefinitionsKey } from './store/definitionsStore';

interface Lookups {
  records: Map<DefinitionsKey, DefinitionRecord>;
  findKeyById: (id: string) => DefinitionsKey | null;
  classNodes: Map<string, ClassNode>;
}

function folderForClass(bareOrU: string, classNodes: Map<string, ClassNode>): string | null {
  if (!bareOrU) return null;
  const u = bareOrU.startsWith('U') ? bareOrU : `U${bareOrU}`;
  const node = classNodes.get(u) ?? classNodes.get(bareOrU);
  return node?.folder ?? null;
}

/** Walk every typed envelope in `node`. For each invocation, append
 *  the class declared by the envelope (when it's a def_ref or a
 *  container with a typed element/key/value) to `classes`, AND the
 *  resolved id (when a def_ref's value is non-empty) to `followIds`. */
function walk(node: any, classes: Set<string>, followIds: Set<string>): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, classes, followIds);
    return;
  }
  if (typeof node !== 'object') return;
  if (node.type === 'definition_ref') {
    if (node.class) classes.add(String(node.class));
    const v = String(node.value ?? '');
    if (v) followIds.add(v);
  }
  if (node.type === 'array' || node.type === 'set') {
    if (node.element_type) walk(node.element_type, classes, followIds);
  }
  if (node.type === 'map') {
    if (node.key_type) walk(node.key_type, classes, followIds);
    if (node.value_type) walk(node.value_type, classes, followIds);
  }
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'class' || k === 'enum_name' || k === 'struct_name') continue;
    walk(node[k], classes, followIds);
  }
}

/** Given a selected record, return the set of folders the items
 *  palette should chip-on by default. Returns null when no record is
 *  selected (palette falls back to prop-supplied defaults). */
export function inferAcceptedFolders(
  rec: DefinitionRecord | undefined | null,
  lookups: Lookups,
): Set<string> | null {
  if (!rec) return null;
  const classes = new Set<string>();
  const direct: Set<string> = new Set();
  walk(rec.json?.properties ?? {}, classes, direct);

  // One hop: follow each ref the record sets and collect ITS classes
  // too. Bounded to one level so we don't fan out into the whole graph.
  for (const id of direct) {
    const k = lookups.findKeyById(id);
    if (!k) continue;
    const linked = lookups.records.get(k);
    if (!linked) continue;
    const dummy = new Set<string>();
    walk(linked.json?.properties ?? {}, classes, dummy);
  }

  const folders = new Set<string>();
  for (const cls of classes) {
    const f = folderForClass(cls, lookups.classNodes);
    if (f) folders.add(f);
  }
  return folders;
}
