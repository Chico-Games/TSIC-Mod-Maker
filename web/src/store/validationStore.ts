import { create } from 'zustand';
import type { DefinitionRecord, DefinitionsKey } from './definitionsStore';
import { describeInheritError, getExtendsId, type InheritError } from './inheritance';
import { resolveRecord } from './inheritedView';
import { useDefinitionsStore } from './definitionsStore';
import { useAppSchemaStore } from './appSchemaStore';
import {
  validateSchemaDrift,
  iterEnvelopes,
  type DriftIssue,
} from '../persistence/schemaDriftValidator';

export type ValidationIssue =
  | DriftIssue
  | {
      recordKey: DefinitionsKey;
      kind: 'dangling-definition-ref';
      path: string;
      assetClass: string;
      targetId: string;
    }
  | {
      /** The record's `extends` chain is broken — the game drops it. */
      recordKey: DefinitionsKey;
      kind: 'broken-extends';
      path: string;
      error: InheritError;
      /** Ready-made sentence ("extends "X", which does not exist"). */
      detail: string;
    };

type State = {
  issuesByKey: Map<DefinitionsKey, ValidationIssue[]>;
  lastBuiltAt: number;
  rebuild: () => void;
};

function buildDanglingRefIssues(): ValidationIssue[] {
  const defs = useDefinitionsStore.getState().definitions;
  const findKey = useDefinitionsStore.getState().findKeyById;
  const out: ValidationIssue[] = [];
  for (const [key, rec] of defs) {
    const props = rec.json?.properties;
    if (!props) continue;
    for (const env of iterEnvelopes(props)) {
      if (env?.type !== 'definition_ref') continue;
      const targetId = env.value;
      if (!targetId || typeof targetId !== 'string') continue;
      if (findKey(targetId)) continue;
      out.push({
        recordKey: key,
        kind: 'dangling-definition-ref',
        path: '',
        assetClass: typeof env.class === 'string' ? env.class : '',
        targetId,
      });
    }
  }
  return out;
}

/** Every record whose `extends` chain has an unknown parent, a cycle, or a
 *  parent of a different class. All three make the game drop the definition,
 *  so they are errors, not hints. A record downstream of a broken ancestor is
 *  reported too (it is dropped just the same). */
export function buildInheritanceIssues(
  defs: Map<DefinitionsKey, DefinitionRecord> = useDefinitionsStore.getState().definitions,
): Extract<ValidationIssue, { kind: 'broken-extends' }>[] {
  const out: Extract<ValidationIssue, { kind: 'broken-extends' }>[] = [];
  for (const [key, rec] of defs) {
    if (!getExtendsId(rec)) continue;
    const error = resolveRecord(rec, defs).error;
    if (!error) continue;
    out.push({
      recordKey: key,
      kind: 'broken-extends',
      path: 'properties.extends',
      error,
      detail: describeInheritError(rec.id, error),
    });
  }
  return out;
}

export const useValidationStore = create<State>((set) => ({
  issuesByKey: new Map(),
  lastBuiltAt: 0,
  rebuild: () => {
    const defs = useDefinitionsStore.getState().definitions;
    const { classNodes, propertyMeta } = useAppSchemaStore.getState();
    const drift = validateSchemaDrift(defs, classNodes, propertyMeta);
    const dangling = buildDanglingRefIssues();
    const map = new Map<DefinitionsKey, ValidationIssue[]>();
    const inheritance = buildInheritanceIssues(defs);
    for (const i of [...drift, ...dangling, ...inheritance]) {
      if (i.recordKey === '__and_more__') continue;
      const arr = map.get(i.recordKey) ?? [];
      arr.push(i);
      map.set(i.recordKey, arr);
    }
    set({ issuesByKey: map, lastBuiltAt: Date.now() });
  },
}));

let lastDefs: unknown = useDefinitionsStore.getState().definitions;
let lastClassNodes: unknown = useAppSchemaStore.getState().classNodes;
useDefinitionsStore.subscribe((s) => {
  if (s.definitions === lastDefs) return;
  lastDefs = s.definitions;
  useValidationStore.getState().rebuild();
});
useAppSchemaStore.subscribe((s) => {
  if (s.classNodes === lastClassNodes) return;
  lastClassNodes = s.classNodes;
  useValidationStore.getState().rebuild();
});
useValidationStore.getState().rebuild();
