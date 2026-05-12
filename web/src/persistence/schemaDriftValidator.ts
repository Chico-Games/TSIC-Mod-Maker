import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';
import type { ClassNode, PropertyMeta } from '../store/appSchemaStore';

export type DriftIssue =
  | { recordKey: DefinitionsKey; kind: 'unknown-class'; className: string }
  | { recordKey: DefinitionsKey; kind: 'unknown-property'; parentType: string; propertyName: string };

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
