// Typed-envelope bridge.
//
// The editor holds every definition as typed envelopes in memory
// (`{type:'float', value: 1.1}`, `{type:'struct', value:{…}}`, `{type:'array', value:[…]}`)
// and flattens them back to plain JSON on save. The AI engine is a port of the C++ and
// reads the PLAIN shape, exactly as the game does off disk. This module is the only place
// that knows about the difference.

const SCALAR_TYPES = new Set([
  'bool', 'int', 'float', 'string', 'name', 'text', 'gameplay_tag', 'definition_ref', 'enum',
]);

export function isEnvelope(v: any): boolean {
  return v != null && typeof v === 'object' && !Array.isArray(v) && typeof v.type === 'string';
}

/** Envelope tree -> the plain JSON the game (and the sim) reads. */
export function plainOf(node: any): any {
  if (Array.isArray(node)) return node.map(plainOf);
  if (!isEnvelope(node)) {
    if (node != null && typeof node === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) out[k] = plainOf(v);
      return out;
    }
    return node;
  }

  const t = node.type as string;
  if (SCALAR_TYPES.has(t)) return node.value;
  if (t === 'gameplay_tag_container') return node.value;
  if (t === 'array' || t === 'set') return (node.value ?? []).map(plainOf);
  if (t === 'map') {
    // Maps serialise as a list of {key, value} pairs, and several AI definitions
    // (day_section_overrides) genuinely want an object keyed by the tag.
    const entries = (node.value ?? []) as Array<{ key: any; value: any }>;
    const allStringKeys = entries.every((e) => typeof plainOf(e.key) === 'string');
    if (allStringKeys) {
      const out: Record<string, any> = {};
      for (const e of entries) out[plainOf(e.key)] = plainOf(e.value);
      return out;
    }
    return entries.map((e) => ({ key: plainOf(e.key), value: plainOf(e.value) }));
  }
  if (t === 'struct') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node.value ?? {})) out[k] = plainOf(v);
    return out;
  }
  return node.value;
}

/** A whole record, plain: `{ id, class, properties }`. */
export function plainDefinition(json: any): any {
  if (!json) return json;
  return { ...json, properties: plainOf(json.properties ?? {}) };
}

/**
 * Translate a plain path (`['sight','range']`) into the real path through the envelope
 * tree (`['properties','sight','value','range','value']`). Returns null when any hop is
 * missing — that means the value is inherited, not authored here.
 */
export function envelopePath(json: any, plainPath: (string | number)[]): (string | number)[] | null {
  const out: (string | number)[] = ['properties'];
  let cursor = json?.properties;
  for (const step of plainPath) {
    if (cursor == null) return null;
    if (isEnvelope(cursor)) {
      const t = cursor.type as string;
      if (t === 'struct') {
        if (!(step in (cursor.value ?? {}))) return null;
        out.push('value', step);
        cursor = cursor.value[step];
        continue;
      }
      if (t === 'array' || t === 'set') {
        const list = cursor.value ?? [];
        if (typeof step !== 'number' || step >= list.length) return null;
        out.push('value', step);
        cursor = list[step];
        continue;
      }
      if (t === 'map') {
        const entries = (cursor.value ?? []) as Array<{ key: any; value: any }>;
        const index = entries.findIndex((e) => plainOf(e.key) === step);
        if (index < 0) return null;
        out.push('value', index, 'value');
        cursor = entries[index].value;
        continue;
      }
      return null;
    }
    // Plain container (the record root, or an `__inferred` object).
    if (!(step in cursor)) return null;
    out.push(step);
    cursor = cursor[step];
  }
  if (!isEnvelope(cursor)) return null;
  out.push('value');
  return out;
}

/** The envelope sitting at a plain path, or undefined when not authored here. */
export function envelopeAt(json: any, plainPath: (string | number)[]): any {
  let cursor = json?.properties;
  for (const step of plainPath) {
    if (cursor == null) return undefined;
    if (isEnvelope(cursor)) {
      const t = cursor.type as string;
      if (t === 'struct') cursor = cursor.value?.[step];
      else if (t === 'array' || t === 'set') cursor = cursor.value?.[step as number];
      else if (t === 'map') {
        const entries = (cursor.value ?? []) as Array<{ key: any; value: any }>;
        cursor = entries.find((e) => plainOf(e.key) === step)?.value;
      } else return undefined;
      continue;
    }
    cursor = cursor[step];
  }
  return cursor;
}

/** Wrap a plain value in an envelope, matching `template`'s type when one is available. */
export function wrapLike(template: any, value: any): any {
  if (isEnvelope(template)) {
    const t = template.type as string;
    if (SCALAR_TYPES.has(t)) {
      const next = { ...template, value };
      if (t === 'int') next.value = Math.round(value);
      return next;
    }
  }
  // No template: infer. Whole numbers stay ints so the saved JSON matches how the rest of
  // the file is authored.
  if (typeof value === 'number') {
    return { type: Number.isInteger(value) ? 'int' : 'float', value };
  }
  if (typeof value === 'boolean') return { type: 'bool', value };
  if (typeof value === 'string') return { type: 'string', value };
  return toEnvelope(value);
}

/** Best-effort plain -> envelope for values with no template (new JSON pasted in). */
export function toEnvelope(value: any): any {
  if (value == null) return { type: 'string', value: '' };
  if (Array.isArray(value)) {
    return { type: 'array', element_type: null, value: value.map(toEnvelope) };
  }
  if (typeof value === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) fields[k] = toEnvelope(v);
    return { type: 'struct', struct_name: '', value: fields, __inferred: true };
  }
  if (typeof value === 'number') {
    return { type: Number.isInteger(value) ? 'int' : 'float', value };
  }
  if (typeof value === 'boolean') return { type: 'bool', value };
  return { type: 'string', value: String(value) };
}

/**
 * Build the envelope tree needed to author `plainPath` locally on `json`, using
 * `templateJson` (a base profile that DOES author it) for the types.
 *
 * This is what makes editing an inherited perception value safe: instead of reaching into
 * the shared base and retuning every enemy that extends it, we mint a local override with
 * the right envelope types and write the value there.
 *
 * Returns `{ path, value }` for the shallowest node that has to be replaced.
 */
export function buildLocalOverride(
  json: any,
  templateJson: any,
  plainPath: (string | number)[],
  value: any,
): { path: (string | number)[]; value: any } | null {
  if (plainPath.length === 0) return null;

  // Walk down as far as the record already authors, then synthesise the rest.
  let depth = 0;
  let node = json?.properties;
  const realPath: (string | number)[] = ['properties'];

  while (depth < plainPath.length) {
    const step = plainPath[depth];
    const next = isEnvelope(node) && node.type === 'struct' ? node.value?.[step] : node?.[step];
    if (next === undefined) break;
    if (isEnvelope(node) && node.type === 'struct') realPath.push('value', step);
    else realPath.push(step);
    node = next;
    depth += 1;
  }

  if (depth === plainPath.length) {
    // Fully authored already — just set the leaf value, keeping its type.
    return { path: [...realPath, 'value'], value: wrapLike(node, value).value };
  }

  // Synthesise from `plainPath[depth]` down, taking types from the template.
  const templateLeaf = envelopeAt(templateJson, plainPath);
  let built: any = wrapLike(templateLeaf, value);
  for (let i = plainPath.length - 1; i > depth; i -= 1) {
    const parentTemplate = envelopeAt(templateJson, plainPath.slice(0, i));
    built = {
      type: 'struct',
      struct_name: isEnvelope(parentTemplate) ? (parentTemplate.struct_name ?? '') : '',
      value: { [plainPath[i]]: built },
      __inferred: true,
    };
  }

  if (isEnvelope(node) && node.type === 'struct') {
    // Merge into the existing struct rather than replacing it — the record may author
    // sibling fields we must not drop.
    return {
      path: [...realPath, 'value', plainPath[depth]],
      value: built,
    };
  }
  return { path: [...realPath, plainPath[depth]], value: built };
}
