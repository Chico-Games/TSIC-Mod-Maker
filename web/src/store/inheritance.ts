// Pure model of the game's `extends` definition inheritance. No store imports —
// everything here takes the record (and a lookup) as arguments so it is unit
// testable and usable from both the store and the UI.
//
// The game's contract (all keys live inside `properties`):
//   "extends": "<id>"  single parent of the SAME class string, resolved
//                      recursively. Cycle / unknown parent / class mismatch make
//                      the game drop the definition.
//   absent key         inherit from the parent.
//   explicit null      clear to the class default (the child still "owns" it).
//   arrays/sets/maps   replace wholesale.
//   structs            deep-merge, child wins.
//   "abstract": true   merge source only, never registered in game.
//
// In the editor's working set every property value is a typed envelope
// (`{type, value, ...}`). `extends` / `abstract` have no schema kind, so they
// arrive as inferred `{type:'string'}` / `{type:'bool'}` envelopes; the readers
// below also accept the bare lean value so they work on either side of the
// lean⇆envelope boundary.

/** Property keys that steer the merge instead of carrying data. They are never
 *  inherited: a child of an abstract parent is not itself abstract. */
export const INHERIT_DIRECTIVES: ReadonlySet<string> = new Set(['extends', 'abstract']);

/** The minimum a record must expose for inheritance to be resolved. */
export interface InheritRec {
  id: string;
  json: any;
}

export type InheritLookup = (id: string) => InheritRec | null | undefined;

export type InheritErrorKind = 'unknown-parent' | 'cycle' | 'class-mismatch';

export interface InheritError {
  kind: InheritErrorKind;
  /** Record whose own `extends` is the broken link (the record itself, or one
   *  of its ancestors). */
  atId: string;
  /** The id that link points at. */
  parentId: string;
  /** class-mismatch only: the two class strings that differ. */
  childClass?: string;
  parentClass?: string;
}

export interface ResolvedInheritance {
  /** Merged envelope `properties`: ancestors first, the record last. The
   *  record's own directives (`extends`, `abstract`) are kept; ancestors'
   *  directives are dropped. */
  properties: Record<string, any>;
  /** For every key of `properties`: 'own' when the record authors it, else the
   *  id of the nearest ancestor that does. */
  origin: Record<string, string>;
  /** Own keys that ALSO exist somewhere up the chain, mapped to the id of the
   *  nearest ancestor that authors them — i.e. real overrides. */
  overrides: Record<string, string>;
  /** Ancestor ids, nearest first. Stops at the last ancestor that resolved. */
  ancestorChain: string[];
  /** The record's own `extends` target (whether or not it resolves). */
  parentId: string | null;
  error: InheritError | null;
}

/** Unwrap a scalar that may be an envelope or already lean. */
function scalar(v: any): any {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return v.value;
  return v;
}

/** The id this record extends, or null. Empty strings count as "none". */
export function getExtendsId(rec: InheritRec | null | undefined): string | null {
  const v = scalar(rec?.json?.properties?.extends);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Whether the record is an abstract merge source (never registered in game). */
export function isAbstract(rec: InheritRec | null | undefined): boolean {
  return scalar(rec?.json?.properties?.abstract) === true;
}

function isStructEnv(v: any): boolean {
  return !!v && typeof v === 'object' && v.type === 'struct'
    && !!v.value && typeof v.value === 'object' && !Array.isArray(v.value);
}

/** Merge one child value over one parent value. Structs deep-merge field by
 *  field; everything else (scalars, arrays, sets, maps, and an explicit null
 *  "clear") is taken from the child wholesale. Never mutates its inputs. */
export function mergeInheritedValue(parent: any, child: any): any {
  if (child === undefined) return parent;
  if (!isStructEnv(parent) || !isStructEnv(child)) return child;
  const value: Record<string, any> = { ...parent.value };
  for (const [k, v] of Object.entries(child.value)) {
    value[k] = k in parent.value ? mergeInheritedValue(parent.value[k], v) : v;
  }
  // Child's envelope metadata wins (struct_name etc.), parent's fills gaps.
  return { ...parent, ...child, value };
}

/** Resolve a record against its `extends` chain.
 *
 *  On a broken chain the merge stops at the break: everything that resolved up
 *  to that point is still merged in (so the grid stays useful while the user
 *  fixes the link) and `error` says what is wrong and where. */
export function resolveInherited(rec: InheritRec, lookup: InheritLookup): ResolvedInheritance {
  const ownProps: Record<string, any> = rec?.json?.properties ?? {};
  const parentId = getExtendsId(rec);
  const origin: Record<string, string> = {};
  if (!parentId) {
    for (const k of Object.keys(ownProps)) origin[k] = 'own';
    return { properties: ownProps, origin, overrides: {}, ancestorChain: [], parentId: null, error: null };
  }

  // Walk up, collecting the ancestors nearest-first.
  const chain: InheritRec[] = [];
  const seen = new Set<string>([rec.id]);
  let error: InheritError | null = null;
  let cursor: InheritRec = rec;
  for (;;) {
    const nextId = getExtendsId(cursor);
    if (!nextId) break;
    if (seen.has(nextId)) {
      error = { kind: 'cycle', atId: cursor.id, parentId: nextId };
      break;
    }
    const parent = lookup(nextId);
    if (!parent) {
      error = { kind: 'unknown-parent', atId: cursor.id, parentId: nextId };
      break;
    }
    const childClass = String(cursor.json?.class ?? '');
    const parentClass = String(parent.json?.class ?? '');
    if (childClass !== parentClass) {
      error = { kind: 'class-mismatch', atId: cursor.id, parentId: nextId, childClass, parentClass };
      break;
    }
    seen.add(nextId);
    chain.push(parent);
    cursor = parent;
  }

  // Merge root-first so nearer ancestors win.
  const properties: Record<string, any> = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const anc = chain[i];
    for (const [k, v] of Object.entries(anc.json?.properties ?? {})) {
      if (INHERIT_DIRECTIVES.has(k)) continue;
      properties[k] = k in properties ? mergeInheritedValue(properties[k], v) : v;
      origin[k] = anc.id;
    }
  }
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(ownProps)) {
    if (k in properties && !INHERIT_DIRECTIVES.has(k)) {
      overrides[k] = origin[k];
      properties[k] = mergeInheritedValue(properties[k], v);
    } else {
      properties[k] = v;
    }
    origin[k] = 'own';
  }

  return {
    properties,
    origin,
    overrides,
    ancestorChain: chain.map((r) => r.id),
    parentId,
    error,
  };
}

/** Ids of the records that directly extend `id`, in iteration order. */
export function childrenOf(id: string, records: Iterable<InheritRec>): string[] {
  const out: string[] = [];
  if (!id) return out;
  for (const r of records) {
    if (getExtendsId(r) === id) out.push(r.id);
  }
  return out;
}

/** Rewrite `properties.extends` from `oldId` to `newId` on a record's JSON,
 *  preserving whichever shape (envelope or lean string) it was authored in.
 *  Returns the same object when nothing changed. Used by rename. */
export function retargetExtends(json: any, oldId: string, newId: string): any {
  const cur = json?.properties?.extends;
  if (scalar(cur) !== oldId) return json;
  const next = cur && typeof cur === 'object' ? { ...cur, value: newId } : newId;
  return { ...json, properties: { ...json.properties, extends: next } };
}

/** Human sentence for a broken chain, phrased from `selfId`'s point of view. */
export function describeInheritError(selfId: string, e: InheritError): string {
  const via = e.atId === selfId ? '' : ` (via ancestor ${e.atId})`;
  switch (e.kind) {
    case 'unknown-parent':
      return `extends "${e.parentId}", which does not exist${via}`;
    case 'cycle':
      return `extends chain loops back to "${e.parentId}"${via}`;
    case 'class-mismatch':
      return `extends "${e.parentId}" of a different class (${e.parentClass || '?'} vs ${e.childClass || '?'})${via}`;
  }
}
