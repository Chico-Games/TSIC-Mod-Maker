// UI for the game's `extends` definition inheritance in the generic property
// grid: the per-record banner, the per-row provenance tags, and the hook the
// grid uses to learn which rows are inherited. The merge model itself lives in
// `store/inheritance.ts`.

import { useMemo, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import {
  describeInheritError,
  getExtendsId,
  isAbstract,
  INHERIT_DIRECTIVES,
  type ResolvedInheritance,
} from '../store/inheritance';
import { childIdsOf, inheritanceView, resolveRecord, resolvedProps } from '../store/inheritedView';
import { humanizeAssetId } from './definitionsNaming';
import { useJumpToDefinition } from './useJumpToDefinition';
import '../styles-inherit.css';

/** What the grid needs to know about the record it is drawing. */
export interface InheritedGrid {
  /** Bare id of the record being edited. */
  id: string;
  resolved: ResolvedInheritance;
  /** Friendly name for an ancestor id (display_name, else humanized id). */
  nameOf: (id: string) => string;
}

function displayNameOf(id: string, defs: ReturnType<typeof useDefinitionsStore.getState>['definitions']): string {
  const rec = inheritanceView(defs).byId.get(id);
  const dn = rec ? resolvedProps(rec, defs).display_name?.value : null;
  return typeof dn === 'string' && dn ? dn : humanizeAssetId(id);
}

/** Resolve inheritance for the record a grid is editing.
 *
 *  Returns null unless `properties` is that record's own top-level
 *  `properties` object AND the record extends something — so grids that edit
 *  a nested bag, a detached draft, or an ordinary record behave exactly as
 *  before. */
export function useInheritedGrid(
  ownerKey: string | undefined,
  properties: Record<string, any> | null | undefined,
): InheritedGrid | null {
  const definitions = useDefinitionsStore((s) => s.definitions);
  return useMemo(() => {
    if (!ownerKey) return null;
    const rec = definitions.get(ownerKey);
    if (!rec || rec.json?.properties !== properties) return null;
    if (!getExtendsId(rec)) return null;
    return {
      id: rec.id,
      resolved: resolveRecord(rec, definitions),
      nameOf: (id: string) => displayNameOf(id, definitions),
    };
  }, [ownerKey, properties, definitions]);
}

const CHILD_PREVIEW = 6;

/** Compact strip above the grid: what this record inherits from (with
 *  overridden / inherited counts), what extends it, and any broken link. */
export function InheritanceBanner({
  ownerKey,
  properties,
}: {
  ownerKey: string | undefined;
  properties: Record<string, any> | null | undefined;
}) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const jump = useJumpToDefinition();
  const [showAllChildren, setShowAllChildren] = useState(false);

  const rec = ownerKey ? definitions.get(ownerKey) : undefined;
  const info = useMemo(() => {
    if (!rec || rec.json?.properties !== properties) return null;
    const children = childIdsOf(rec.id, definitions);
    const extendsId = getExtendsId(rec);
    const abstract = isAbstract(rec);
    if (!extendsId && children.length === 0 && !abstract) return null;
    const resolved = extendsId ? resolveRecord(rec, definitions) : null;
    let overridden = 0;
    let inherited = 0;
    let ownOnly = 0;
    if (resolved) {
      for (const [k, from] of Object.entries(resolved.origin)) {
        if (INHERIT_DIRECTIVES.has(k)) continue;
        if (from !== 'own') inherited++;
        else if (k in resolved.overrides) overridden++;
        else ownOnly++;
      }
    }
    return { children, extendsId, abstract, resolved, overridden, inherited, ownOnly };
  }, [rec, properties, definitions]);

  if (!rec || !info) return null;
  const { children, extendsId, abstract, resolved, overridden, inherited, ownOnly } = info;
  const view = inheritanceView(definitions);
  const exists = (id: string) => view.byId.has(id);
  const shownChildren = showAllChildren ? children : children.slice(0, CHILD_PREVIEW);

  // Ancestors are labelled by display name; children by humanized id, because
  // a child usually INHERITS its display name and would read the same as this
  // record ("Aircon" extended by "Aircon").
  const chip = (id: string, as: 'ancestor' | 'child') => (
    <button
      key={id}
      type="button"
      className={`inh-chip ${exists(id) ? '' : 'missing'}`}
      title={exists(id) ? `${id} — click to open` : `${id} — not in this project`}
      disabled={!exists(id)}
      onClick={() => jump(id)}
    >
      {as === 'ancestor' ? displayNameOf(id, definitions) : humanizeAssetId(id)}
      <span className="inh-chip-id">{id}</span>
    </button>
  );

  return (
    <div className={`inh-banner ${resolved?.error ? 'has-error' : ''}`} data-testid="inheritance-banner">
      {extendsId && resolved && (
        <div className="inh-banner-line">
          <span className="inh-banner-label">Inherits from</span>
          {chip(extendsId, 'ancestor')}
          {resolved.ancestorChain.slice(1).map((id) => (
            <span key={id} className="inh-chain-step">
              <span className="inh-arrow" aria-hidden>←</span>
              {chip(id, 'ancestor')}
            </span>
          ))}
          <span className="inh-counts">
            <b>{overridden}</b> overridden · <b>{inherited}</b> inherited
            {ownOnly > 0 && <> · <b>{ownOnly}</b> added here</>}
          </span>
        </div>
      )}
      {resolved?.error && (
        <div className="inh-banner-line inh-error" role="alert">
          ⚠ {rec.id} {describeInheritError(rec.id, resolved.error)} — the game will drop this definition.
        </div>
      )}
      {abstract && (
        <div className="inh-banner-line">
          <span className="inh-badge">abstract</span>
          <span className="inh-muted">Merge source only — never registered in game.</span>
        </div>
      )}
      {children.length > 0 && (
        <div className="inh-banner-line">
          <span className="inh-banner-label">
            Extended by {children.length}
          </span>
          {shownChildren.map((id) => chip(id, 'child'))}
          {children.length > CHILD_PREVIEW && (
            <button type="button" className="inh-more" onClick={() => setShowAllChildren((v) => !v)}>
              {showAllChildren ? 'show fewer' : `+${children.length - CHILD_PREVIEW} more`}
            </button>
          )}
          <span className="inh-muted">Edits here flow into {children.length === 1 ? 'it' : 'them'} unless overridden.</span>
        </div>
      )}
    </div>
  );
}

/** Thin provenance line drawn above an inherited or overriding row. */
export function InheritedRowTag({
  kind,
  fromName,
  fromId,
  onAction,
  onJump,
}: {
  kind: 'inherited' | 'override';
  fromName: string;
  fromId: string;
  onAction: () => void;
  onJump?: (id: string) => void;
}) {
  return (
    <div className={`inh-tag inh-tag-${kind}`}>
      <span className="inh-tag-text">
        {kind === 'inherited' ? 'inherited from ' : 'overrides '}
        <button
          type="button"
          className="inh-tag-link"
          title={`${fromId} — click to open`}
          onClick={() => onJump?.(fromId)}
        >
          {fromName}
        </button>
      </span>
      <button
        type="button"
        className="inh-tag-action"
        title={
          kind === 'inherited'
            ? 'Copy the inherited value into this definition so it can be edited here'
            : 'Remove this override — the value will come from the parent again'
        }
        onClick={onAction}
      >
        {kind === 'inherited' ? 'Override' : 'Reset to inherited'}
      </button>
    </div>
  );
}
