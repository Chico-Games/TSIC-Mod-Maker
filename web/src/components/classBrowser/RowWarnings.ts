import type { DefinitionRecord } from '../../store/definitionsStore';
import type { WarningRule, WarningCtx } from './types';

/** Helper — read a typed-envelope value at a property path inside record.json.properties.
 *  Returns undefined if any path segment is missing. */
export function readPropertyValue(rec: DefinitionRecord, path: string[]): any {
  let cur: any = rec.json?.properties;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Walk every definition_ref envelope in a typed-envelope tree, calling visit(targetId).
 *  Used by the "unresolved refs" warning. */
export function forEachRef(node: any, visit: (id: string, path: (string|number)[]) => void, path: (string|number)[] = []): void {
  if (node == null || typeof node !== 'object') return;
  if (node.type === 'definition_ref') {
    if (typeof node.value === 'string' && node.value) visit(node.value, path);
    return;
  }
  if (node.type === 'array' && Array.isArray(node.value)) {
    node.value.forEach((v: any, i: number) => forEachRef(v, visit, [...path, i]));
    return;
  }
  if (node.type === 'map' && Array.isArray(node.value)) {
    node.value.forEach((entry: any, i: number) => {
      if (entry?.key) forEachRef(entry.key, visit, [...path, i, 'key']);
      if (entry?.value) forEachRef(entry.value, visit, [...path, i, 'value']);
    });
    return;
  }
  if (node.type === 'struct' && node.value && typeof node.value === 'object') {
    for (const [k, v] of Object.entries(node.value)) forEachRef(v, visit, [...path, k]);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (['type','value','class','element_type','key_type','value_type','struct_name'].includes(k)) continue;
    forEachRef(v, visit, [...path, k]);
  }
}

/** Derive the static-item partner id from a source item id.
 *  ID_Backpack_CM → FD_Backpack_SI; ID_Crossbow_EQ → FD_Crossbow_SI. */
export function deriveStaticPartnerId(sourceId: string): string {
  let base = sourceId;
  if (base.startsWith('ID_')) base = base.slice(3);
  // Strip a trailing _XX where XX is the class suffix (2-letter conventionally).
  base = base.replace(/_[A-Z]{2,3}$/, '');
  return `FD_${base}_SI`;
}

export const DEFAULT_WARNINGS: WarningRule[] = [
  {
    id: 'missing-display-name',
    severity: 'info',
    test: (rec) => {
      const dn = rec.json?.properties?.display_name;
      const v = dn?.value;
      return typeof v === 'string' && v.length > 0 ? null : 'no display_name';
    },
  },
  {
    id: 'missing-static-partner',
    severity: 'warn',
    test: (rec, ctx) => {
      // Only fires for records that have the slot at all; configured per-folder via hasStaticPartner.
      const slot = rec.json?.properties?.static_item_definition;
      if (!slot || slot.type !== 'definition_ref') return null;
      const v = slot.value;
      if (typeof v !== 'string' || !v) return 'no static partner';
      return ctx.findKeyById(v) ? null : `partner ${v} missing`;
    },
    fix: (rec, ctx) => {
      const newId = deriveStaticPartnerId(rec.id);
      // Make sure we don't collide with an existing record.
      let id = newId;
      let n = 2;
      while (ctx.findKeyById(id)) id = `${newId}_${n++}`;
      const newKey = ctx.createDefinitionForClass('StaticItemDefinition', id);
      if (!newKey) return;
      const ownerKey: any = `${rec.folder}/${rec.id}`;
      ctx.updateValueAtPath(ownerKey, ['properties', 'static_item_definition'], {
        type: 'definition_ref', class: 'StaticItemDefinition', value: id,
      });
    },
  },
  {
    id: 'unresolved-ref',
    severity: 'error',
    test: (rec, ctx) => {
      let unresolved = '';
      forEachRef(rec.json?.properties ?? {}, (id) => {
        if (unresolved) return;
        if (!ctx.findKeyById(id)) unresolved = id;
      });
      return unresolved ? `unresolved ref: ${unresolved}` : null;
    },
  },
];
