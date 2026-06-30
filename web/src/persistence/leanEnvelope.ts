// Lean ⇆ envelope conversion, driven by the export's `_schema.json`.
//
// The game ships **lean** JSON (raw values mirroring C++ FProperty types) — the
// runtime C++ reader uses reflection, so it needs no per-value type tags. This
// editor, however, renders **typed envelopes** (`{type, value, …}`). Rather than
// fork the format, we convert at the DataSource boundary: lean→envelope on read
// (so all existing editor code keeps working) and envelope→lean on write (so
// disk stays identical to what the game reads). The single source of truth for
// types is the pack's `_schema.json`.
//
// Round-trip guarantee: envelopeToLean(leanToEnvelope(x)) deep-equals x for any
// value the exporter produces. See leanEnvelope.test for the proof over real data.

export interface SchemaKind {
  kind: string;
  // present on container / ref / struct / enum kinds:
  element?: SchemaKind;
  key?: SchemaKind;
  value?: SchemaKind;
  name?: string;   // struct / enum type name
  class?: string;  // object / soft_object / definition_ref / class / soft_class target
}

export interface LeanSchema {
  classes: Record<string, { parents: string[]; properties: Record<string, SchemaKind> }>;
  structs: Record<string, { fields: Record<string, SchemaKind> }>;
  enums: Record<string, { members: Array<{ name: string; value: number }> }>;
}

/** `const UFoo` / `UFoo` → `Foo` ; `AActor` → `AActor`. Mirrors the editor's
 *  bare-name convention for definition_ref class matching. */
function bareClass(raw: string | undefined): string {
  let n = (raw ?? '').trim();
  if (n.startsWith('const ')) n = n.slice(6).trim();
  if (n.startsWith('U') && n.length > 1 && n[1] === n[1].toUpperCase()) return n.slice(1);
  return n;
}

/** Walk a class's property kind via its parent chain (child wins). */
function kindForProperty(
  schema: LeanSchema,
  className: string,
  prop: string,
): SchemaKind | null {
  const full = className.startsWith('U') ? className : `U${className}`;
  const node = schema.classes[full];
  const chain = node ? [full, ...node.parents] : [full];
  for (const c of chain) {
    const k = schema.classes[c]?.properties?.[prop];
    if (k) return k;
  }
  return null;
}

/** Build an empty-container / new-element skeleton envelope from a kind. Mirrors
 *  the `element_type` / `key_type` shapes the old exporter emitted, so the
 *  editor's "+ Add" seeding works identically.
 *
 *  When `schema` is supplied, struct skeletons carry a recursive `fields` map
 *  (built from `schema.structs[name].fields`). This is what lets the editor
 *  materialise a fully-fielded blank struct when a struct is appended to an
 *  array/set/map or when an empty struct slot is edited — without it, a
 *  freshly-added `{type:'struct'}` has no `value` keys and renders as
 *  "(empty struct) · 0 fields". `seen` guards against self-referential structs
 *  recursing forever. */
export function kindToSkeleton(
  kind: SchemaKind | null | undefined,
  schema?: LeanSchema,
  seen?: Set<string>,
): any {
  if (!kind) return null;
  switch (kind.kind) {
    case 'bool': case 'int': case 'float': case 'string':
    case 'name': case 'text':
    case 'gameplay_tag': case 'gameplay_tag_container':
      return { type: kind.kind };
    case 'enum':
      return { type: 'enum', enum_name: kind.name };
    case 'struct': {
      const out: any = { type: 'struct', struct_name: kind.name };
      const def = schema && kind.name ? schema.structs[kind.name] : undefined;
      // Expand the struct's fields once per type along a given branch; if the
      // type recurses into itself, stop at the cycle (the nested slot keeps a
      // bare `{type:'struct'}` skeleton, expanded lazily on demand).
      if (def && !seen?.has(kind.name!)) {
        const nextSeen = new Set(seen);
        nextSeen.add(kind.name!);
        const fields: Record<string, any> = {};
        for (const [fk, fkind] of Object.entries(def.fields)) {
          fields[fk] = kindToSkeleton(fkind, schema, nextSeen);
        }
        out.fields = fields;
      }
      return out;
    }
    case 'array': case 'set':
      return { type: 'array', element_type: kindToSkeleton(kind.element, schema, seen) };
    case 'map':
      return {
        type: 'map',
        key_type: kindToSkeleton(kind.key, schema, seen),
        value_type: kindToSkeleton(kind.value, schema, seen),
      };
    case 'definition_ref':
      return { type: 'definition_ref', class: bareClass(kind.class) };
    case 'object': case 'soft_object': case 'class': case 'soft_class':
      return { type: 'soft_asset_ref', class: bareClass(kind.class) || 'Object' };
    default:
      return null;
  }
}

/** Infer an envelope from a raw JS value when no schema kind is available
 *  (drift / unknown property). Keeps the value editable and round-trippable. */
function envelopeFromRawValue(value: any): any {
  if (typeof value === 'boolean') return { type: 'bool', value };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'int' : 'float', value };
  if (typeof value === 'string') return { type: 'string', value };
  if (Array.isArray(value)) {
    return { type: 'array', element_type: null, value: value.map((v) => leanToEnvelope(v, null, EMPTY)) };
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = leanToEnvelope(v, null, EMPTY);
    return { type: 'struct', struct_name: '', value: out, __inferred: true };
  }
  // null / undefined
  return { type: 'string', value: value ?? null };
}

const EMPTY: LeanSchema = { classes: {}, structs: {}, enums: {} };

/** Resolve an enum's members tolerating an `E` prefix mismatch. The exporter
 *  emits BOTH a C++-named entry (`EBiomeRole`) and a bare one (`BiomeRole`),
 *  and one of the two is often empty — so we UNION members across every name
 *  variant rather than picking one. */
function resolveEnumMembers(
  schema: LeanSchema,
  enumName: string | undefined,
): Array<{ name: string; value: number }> | undefined {
  if (!enumName) return undefined;
  const stripped = (enumName.startsWith('E') && enumName.length > 1 && enumName[1] === enumName[1].toUpperCase())
    ? enumName.slice(1)
    : null;
  const variants = [enumName, stripped, stripped ? null : `E${enumName}`].filter(Boolean) as string[];
  const merged = new Map<string, number>();
  for (const v of variants) {
    for (const m of schema.enums[v]?.members ?? []) {
      if (!merged.has(m.name)) merged.set(m.name, m.value);
    }
  }
  return merged.size ? [...merged].map(([name, value]) => ({ name, value })) : undefined;
}

/** Convert one lean value into a typed envelope, given its schema kind. */
export function leanToEnvelope(value: any, kind: SchemaKind | null, schema: LeanSchema): any {
  // No kind → infer from the raw value (drift-tolerant).
  if (!kind) return envelopeFromRawValue(value);

  // Null placeholder (exporter emits null for omitted nested slots) — preserve
  // it inside a typed envelope so positional round-trip is exact.
  if (value === null || value === undefined) {
    const skel = kindToSkeleton(kind, schema) ?? { type: 'string' };
    return { ...skel, value: null };
  }

  switch (kind.kind) {
    case 'bool': return { type: 'bool', value: !!value };
    case 'int': return { type: 'int', value };
    case 'float': return { type: 'float', value };
    case 'string': return { type: 'string', value };
    case 'name': return { type: 'name', value };
    case 'text': return { type: 'text', value };
    case 'gameplay_tag': return { type: 'gameplay_tag', value };
    case 'gameplay_tag_container':
      return { type: 'gameplay_tag_container', value: Array.isArray(value) ? value : [] };
    case 'enum': {
      // Lean dual format: {name, value:int}. Envelope carries the member name;
      // the int is recoverable from the schema on the way back.
      const name = (value && typeof value === 'object') ? value.name : value;
      return { type: 'enum', enum_name: kind.name, value: name };
    }
    case 'definition_ref':
      return { type: 'definition_ref', class: bareClass(kind.class), value };
    case 'object': case 'soft_object': case 'class': case 'soft_class':
      return { type: 'soft_asset_ref', class: bareClass(kind.class) || 'Object', value };
    case 'array': case 'set': {
      const el = kind.element ?? null;
      const arr = Array.isArray(value) ? value : [];
      return { type: 'array', element_type: kindToSkeleton(el, schema), value: arr.map((v) => leanToEnvelope(v, el, schema)) };
    }
    case 'map': {
      const entries = Array.isArray(value) ? value : [];
      return {
        type: 'map',
        key_type: kindToSkeleton(kind.key, schema),
        value_type: kindToSkeleton(kind.value, schema),
        value: entries.map((e: any) => ({
          key: leanToEnvelope(e?.key, kind.key ?? null, schema),
          value: leanToEnvelope(e?.value, kind.value ?? null, schema),
        })),
      };
    }
    case 'struct': {
      const def = kind.name ? schema.structs[kind.name] : undefined;
      const fields = def?.fields ?? {};
      const out: Record<string, any> = {};
      if (value && typeof value === 'object') {
        for (const [fk, fv] of Object.entries(value)) {
          out[fk] = leanToEnvelope(fv, fields[fk] ?? null, schema);
        }
      }
      return { type: 'struct', struct_name: kind.name ?? '', value: out };
    }
    default:
      return envelopeFromRawValue(value);
  }
}

/** Convert a typed envelope back into its lean value. `schema` is used to
 *  recover enum ints from member names. */
export function envelopeToLean(env: any, schema: LeanSchema): any {
  if (env === null || env === undefined) return env;
  if (typeof env !== 'object' || typeof env.type !== 'string') return env; // already lean
  if (env.value === null && env.type !== 'struct' && env.type !== 'array' && env.type !== 'set' && env.type !== 'map') {
    return null;
  }
  switch (env.type) {
    case 'bool': case 'int': case 'float': case 'string':
    case 'name': case 'text': case 'gameplay_tag':
      return env.value;
    case 'gameplay_tag_container':
      return Array.isArray(env.value) ? env.value : [];
    case 'definition_ref': case 'soft_asset_ref':
      return env.value;
    case 'enum': {
      const memberName = env.value;
      const members = resolveEnumMembers(schema, env.enum_name);
      const found = members?.find((m) => m.name === memberName);
      // Lean dual format. If the int is unknown, fall back to 0 (the exporter
      // never emits an enum without a resolvable member, so this is defensive).
      return { name: memberName, value: found ? found.value : 0 };
    }
    case 'array': case 'set':
      return (Array.isArray(env.value) ? env.value : []).map((v: any) => envelopeToLean(v, schema));
    case 'map':
      return (Array.isArray(env.value) ? env.value : []).map((e: any) => ({
        key: envelopeToLean(e?.key, schema),
        value: envelopeToLean(e?.value, schema),
      }));
    case 'struct': {
      const out: Record<string, any> = {};
      const fields = (env.value && typeof env.value === 'object') ? env.value : {};
      for (const [fk, fv] of Object.entries(fields)) out[fk] = envelopeToLean(fv, schema);
      return out;
    }
    default:
      return env.value;
  }
}

/** The `type` tags an envelope can carry. Checking membership (rather than
 *  "has any string `type` field") keeps a lean struct that happens to have a
 *  field named `type` (e.g. `{type: "Wood", count: 3}`) from being mistaken
 *  for an envelope. */
const ENVELOPE_TYPES = new Set([
  'bool', 'int', 'float', 'string', 'name', 'text',
  'gameplay_tag', 'gameplay_tag_container', 'enum', 'struct',
  'array', 'set', 'map', 'definition_ref', 'soft_asset_ref',
]);

/** Whether a `properties` map looks lean (no `{type}` envelopes). Used to make
 *  conversion idempotent — envelope packs (legacy) pass through untouched. */
export function isLeanProperties(props: Record<string, any> | null | undefined): boolean {
  if (!props || typeof props !== 'object') return false;
  for (const v of Object.values(props)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ENVELOPE_TYPES.has((v as any).type)) {
      return false; // found an envelope → not lean
    }
  }
  return true;
}

/** Convert a lean `properties` object to typed envelopes for `className`. */
export function leanPropsToEnvelope(
  props: Record<string, any>,
  className: string,
  schema: LeanSchema,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    out[k] = leanToEnvelope(v, kindForProperty(schema, className, k), schema);
  }
  return out;
}

/** Convert an envelope `properties` object back to lean. */
export function envelopePropsToLean(
  props: Record<string, any>,
  schema: LeanSchema,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    out[k] = envelopeToLean(v, schema);
  }
  return out;
}
