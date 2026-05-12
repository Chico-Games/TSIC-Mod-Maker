import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';
import type { ClassNode, PropertyMeta } from '../store/appSchemaStore';
import type { AssetCatalogEntry } from './dataSource';

export type DriftIssue =
  | { recordKey: DefinitionsKey; kind: 'unknown-class'; className: string }
  | { recordKey: DefinitionsKey; kind: 'unknown-property'; parentType: string; propertyName: string }
  | { recordKey: DefinitionsKey; kind: 'missing-asset-ref'; path: string; assetClass: string }
  | { recordKey: DefinitionsKey; kind: 'asset-ref-guid-mismatch'; path: string; assetClass: string; expectedGuid: string; currentGuid: string };

const MAX_ISSUES = 200;

/** Strip a leading "U" from a class name. The schema uses "UItemDefinition";
 *  property keys drop the prefix ("ItemDefinition.id"). */
function bareName(className: string): string {
  return className.startsWith('U') ? className.slice(1) : className;
}

function parentChain(className: string, classNodes: Map<string, ClassNode>): string[] {
  const node = classNodes.get(className);
  return node ? [className, ...node.parents] : [className];
}

export function validateSchemaDrift(
  defs: Map<DefinitionsKey, DefinitionRecord>,
  classNodes: Map<string, ClassNode>,
  propertyMeta: Map<string, PropertyMeta>,
): DriftIssue[] {
  const out: DriftIssue[] = [];

  const push = (issue: DriftIssue): boolean => {
    if (out.length >= MAX_ISSUES) {
      out.push({ recordKey: '__and_more__', kind: 'unknown-class', className: '__and_more__' });
      return false;
    }
    out.push(issue);
    return true;
  };

  for (const [key, rec] of defs) {
    const className = rec.json?.class;
    if (typeof className !== 'string') continue;

    const fullName = className.startsWith('U') ? className : `U${className}`;
    if (!classNodes.has(fullName)) {
      if (!push({ recordKey: key, kind: 'unknown-class', className: fullName })) return out;
      continue;
    }

    // Property-level checks require propertyMeta to be populated. The source
    // export doesn't always ship .property-meta.json; when it's empty we can
    // only validate classes, not properties.
    if (propertyMeta.size === 0) continue;

    // Real records store game properties under a `properties` object. The
    // top-level keys (id, asset_path, class, parent_classes, properties)
    // are envelope fields, not game properties.
    const props = rec.json?.properties;
    if (!props || typeof props !== 'object') continue;

    const chain = parentChain(fullName, classNodes).map(bareName);
    for (const propName of Object.keys(props)) {
      const found = chain.some((c) => propertyMeta.has(`${c}.${propName}`));
      if (!found) {
        if (!push({
          recordKey: key,
          kind: 'unknown-property',
          parentType: bareName(fullName),
          propertyName: propName,
        })) return out;
      }
    }
  }
  return out;
}

/** Walk every "envelope" (object with a `type` field) reachable from a value,
 *  recursing into struct/array bodies. Used by validateAssetRefs and the
 *  asset-ref editor flow (Task 7.2). */
export function* iterEnvelopes(value: any): Generator<any> {
  if (value && typeof value === 'object') {
    if ('type' in value) {
      yield value;
      const inner = value.value;
      if (inner && (typeof inner === 'object')) yield* iterEnvelopes(inner);
    } else if (Array.isArray(value)) {
      for (const v of value) yield* iterEnvelopes(v);
    } else {
      for (const v of Object.values(value)) yield* iterEnvelopes(v);
    }
  }
}

export function validateAssetRefs(
  defs: Map<DefinitionsKey, DefinitionRecord>,
  catalogs: Map<string, AssetCatalogEntry[]>,
  expectedGuids: Record<string, string>,
): DriftIssue[] {
  const out: DriftIssue[] = [];
  for (const [key, rec] of defs) {
    const props = rec.json?.properties;
    if (!props) continue;
    for (const env of iterEnvelopes(props)) {
      if (env?.type !== 'soft_asset_ref') continue;
      const path = env.value;
      if (!path) continue;
      const cls = env.class as string;
      const entries = catalogs.get(cls);

      // No catalog for this class → no info to drift-check against. Skip.
      // (Real-world example: Material / SoundCue refs surfacing before the
      // exporter walks every referenced asset class.)
      if (!entries) continue;

      const entry = entries.find((e) => e.path === path);
      if (!entry) {
        out.push({ recordKey: key, kind: 'missing-asset-ref', path, assetClass: cls });
        continue;
      }
      const expected = expectedGuids[path];
      // Skip mismatch detection when either side is empty — guids are
      // unknown/unavailable (UE 5.x doesn't expose PackageGuid by default).
      if (expected && entry.package_guid && expected !== entry.package_guid) {
        out.push({
          recordKey: key, kind: 'asset-ref-guid-mismatch', path, assetClass: cls,
          expectedGuid: expected, currentGuid: entry.package_guid,
        });
      }
    }
  }
  return out;
}
