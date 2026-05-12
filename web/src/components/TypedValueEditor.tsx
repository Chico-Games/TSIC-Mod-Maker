import { useMemo, useState } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { humanizeAssetId, humanizeProperty, isNoisyProperty } from './definitionsNaming';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import { WideToggle } from './WideToggle';
import { NumberSlider } from './NumberSlider';
import { getFolderTheme } from './folderTheme';
import { isClassCompatible, type DragSource, type DropTarget } from '../dnd/dispatch';
import type { EnumMember, PropertyMeta } from '../store/definitionsStore';
import { PropertyTooltip } from './PropertyTooltip';
import { SmartEffectsView } from './classBrowser/SmartEffectsView';
import { StructRows } from './StructRows';
import { TagPicker } from './pickers/TagPicker';

// Schema-aware editor for typed-envelope values produced by the UE exporter.
// Every property value is `{ type: "...", value: ..., ...extras }` — see
// Tools/Export/run_export.py for the producer side. The renderer here knows
// how to draw each `type` tag with the appropriate widget (text, number,
// boolean toggle, definition-ref dropdown, struct field grid, array of typed
// elements, map of typed key/value pairs, etc.).

export type TypedValue =
  | { type: 'bool'; value: boolean }
  | { type: 'int'; value: number }
  | { type: 'float'; value: number }
  | { type: 'string'; value: string }
  | { type: 'name'; value: string }
  | { type: 'text'; value: string }
  | { type: 'gameplay_tag'; value: string }
  | { type: 'gameplay_tag_container'; value: string[] }
  | { type: 'definition_ref'; class: string; value: string }
  | { type: 'enum'; enum_name?: string; value: string }
  | { type: 'array'; element_type: TypedValue | null; value: TypedValue[] }
  | { type: 'set'; element_type: TypedValue | null; value: TypedValue[] }
  | {
      type: 'map';
      key_type: TypedValue | null;
      value_type: TypedValue | null;
      value: Array<{ key: TypedValue; value: TypedValue }>;
    }
  | {
      type: 'struct';
      struct_name?: string;
      fields?: Record<string, TypedValue>; // skeleton for empty containers
      value: Record<string, TypedValue>;
    };

export interface RefAdapter {
  /** All asset ids matching the requested class (incl. subclasses). */
  options: (className: string) => string[];
  /** Whether `assetId` exists in the loaded set. */
  resolves: (assetId: string) => boolean;
  /** Jump to that asset in the editor. */
  navigate: (assetId: string) => void;
  /** Create a new asset of the given class with the given id, then select it. */
  createNew: (className: string, id: string) => string | null;
  /** Look up the type skeleton for an array element / map key / map value at
   *  a given property path, sniffed from any sibling asset that has a
   *  non-empty value at the same path. Used to seed +Add when this asset's
   *  own envelope has element_type/key_type/value_type === null. */
  lookupContainerType: (
    path: (string | number)[],
    slot: 'element_type' | 'key_type' | 'value_type',
  ) => any | null;
  /** UPROPERTY metadata from the .property-meta.json sidecar. */
  getPropertyMeta: (
    parentTypeName: string | null | undefined,
    propertyName: string,
  ) => PropertyMeta | null;
  /** Element class for an array of TObjectPtr<UFoo>, sourced from .property-meta. */
  lookupArrayElementClass: (
    parentTypeName: string | null | undefined,
    propertyName: string,
  ) => string | null;
  /** Member list for a UENUM, sourced from .property-meta. Null when the
   *  enum is unknown — the editor falls back to a free text input. */
  getEnumMembers: (enumName: string | null | undefined) => EnumMember[] | null;
  /** Folder name (e.g. "consumable_definitions") for a loaded asset id —
   *  used to surface the folderTheme emoji + accent color in dropdown
   *  options for definition_ref pickers. */
  folderForId: (assetId: string) => string | null;
}

export interface FieldProps {
  label?: string;
  /** Raw property name (snake_case) — used as a meta-lookup key and for
   *  bool-variant decisions. Top-level fields supply this; deeply-nested
   *  fields without a known property name (e.g. an array element) leave
   *  it undefined. */
  propertyName?: string;
  /** The struct or class name this field is nested in. Top-level
   *  property-grid passes the asset's class; struct editors push their
   *  struct_name down. */
  parentTypeName?: string;
  typed: any;
  onChange: (next: any) => void;
  onDelete?: () => void;
  refAdapter: RefAdapter;
  /** Crumb path used for stable React keys at deeper nesting. */
  path: (string | number)[];
  /** When provided, the editor draws a small pin/unpin affordance next to
   *  the property label. Names are global — pinning "weight" pins it on
   *  every asset that has a property called "weight". */
  pinAdapter?: PinAdapter;
  /** Owning record key (folder/id). When set together with `pathFromRoot`,
   *  the def_ref editor registers as a DnD drop target so the user can
   *  drop palette items directly on any property-grid ref. */
  ownerKey?: string;
  /** Path from the asset's JSON root to this field (e.g.
   *  `['properties', 'items_to_drop', 'value', 0, 'value', 'item_to_drop']`).
   *  Used by the def_ref drop target when wiring DnD. */
  pathFromRoot?: (string | number)[];
}

export interface PinAdapter {
  isPinned: (propertyName: string) => boolean;
  toggle: (propertyName: string) => void;
}

/** Resolve the type-color CSS variable for a typed envelope. The actual
 *  colors live in styles.css; we only emit the class hook here so theme
 *  swaps don't require touching this file. */
function typeColorClass(typed: any): string {
  if (!typed || typeof typed !== 'object') return '';
  switch (typed.type) {
    case 'bool': return 'def-type-color-bool';
    case 'int':
    case 'float': return 'def-type-color-number';
    case 'string':
    case 'name':
    case 'text': return 'def-type-color-string';
    case 'enum': return 'def-type-color-enum';
    case 'gameplay_tag':
    case 'gameplay_tag_container': return 'def-type-color-tag';
    case 'definition_ref': return 'def-type-color-ref';
    case 'struct': return 'def-type-color-struct';
    case 'array':
    case 'set': return 'def-type-color-array';
    case 'map': return 'def-type-color-map';
    default: return '';
  }
}

function isTypedEnvelope(v: any): boolean {
  return v != null && typeof v === 'object' && !Array.isArray(v) && typeof v.type === 'string';
}

/** Strip the concrete `value` from a typed envelope and recurse — used to
 *  capture the schema for new array/map elements when the user appends. */
function skeleton(typed: any): any {
  if (!isTypedEnvelope(typed)) return null;
  const out: any = { type: typed.type };
  for (const k of ['class', 'struct_name', 'enum_name'] as const) {
    if (k in typed) out[k] = typed[k];
  }
  for (const k of ['element_type', 'key_type', 'value_type'] as const) {
    if (k in typed) out[k] = typed[k];
  }
  if (typed.type === 'struct' && typed.value && typeof typed.value === 'object') {
    out.fields = {} as Record<string, any>;
    for (const [fk, fv] of Object.entries(typed.value)) {
      out.fields[fk] = skeleton(fv);
    }
  }
  return out;
}

/** Build a fresh blank typed envelope from a skeleton. */
function blankFromSkeleton(skel: any): any {
  if (!isTypedEnvelope(skel)) return { type: 'string', value: '' };
  const t = skel.type;
  if (t === 'bool') return { type: 'bool', value: false };
  if (t === 'int') return { type: 'int', value: 0 };
  if (t === 'float') return { type: 'float', value: 0 };
  if (t === 'string' || t === 'name' || t === 'text') return { type: t, value: '' };
  if (t === 'gameplay_tag') return { type: 'gameplay_tag', value: '' };
  if (t === 'gameplay_tag_container') return { type: 'gameplay_tag_container', value: [] };
  if (t === 'definition_ref') return { type: 'definition_ref', class: skel.class ?? '', value: '' };
  if (t === 'enum') return { type: 'enum', enum_name: skel.enum_name ?? '', value: '' };
  if (t === 'array' || t === 'set') return { type: t, element_type: skel.element_type ?? null, value: [] };
  if (t === 'map') {
    return {
      type: 'map',
      key_type: skel.key_type ?? null,
      value_type: skel.value_type ?? null,
      value: [],
    };
  }
  if (t === 'struct') {
    const fields: Record<string, any> = {};
    const fieldSkel = skel.fields ?? skel.value ?? {};
    if (fieldSkel && typeof fieldSkel === 'object') {
      for (const [k, v] of Object.entries(fieldSkel)) {
        fields[k] = blankFromSkeleton(v);
      }
    }
    return { type: 'struct', struct_name: skel.struct_name ?? '', value: fields };
  }
  return { type: 'string', value: '' };
}

function PinToggle({
  propertyName,
  pinAdapter,
}: {
  propertyName?: string;
  pinAdapter?: PinAdapter;
}) {
  if (!propertyName || !pinAdapter) return null;
  const pinned = pinAdapter.isPinned(propertyName);
  return (
    <button
      type="button"
      className={`def-pin-btn ${pinned ? 'pinned' : ''}`}
      title={pinned ? 'Unpin from top' : 'Pin to top'}
      onClick={(e) => {
        e.stopPropagation();
        pinAdapter.toggle(propertyName);
      }}
    >
      {pinned ? '📌' : '📍'}
    </button>
  );
}

export function FieldHead({
  label,
  type,
  controls,
  meta,
  propertyName,
  pinAdapter,
}: {
  label?: string;
  type: string;
  controls?: React.ReactNode;
  meta?: PropertyMeta | null;
  propertyName?: string;
  pinAdapter?: PinAdapter;
}) {
  return (
    <div className="def-field-head">
      <PropertyTooltip meta={meta}>
        <span className="def-field-label">
          <PinToggle propertyName={propertyName} pinAdapter={pinAdapter} />
          {label !== undefined && <>{label} </>}
          <span className="def-type">{type}</span>
        </span>
      </PropertyTooltip>
      {controls && <div className="def-field-controls">{controls}</div>}
    </div>
  );
}

function PrimitiveRow({
  label,
  type,
  children,
  onDelete,
  meta,
  className,
  propertyName,
  pinAdapter,
}: {
  label?: string;
  type: string;
  children: React.ReactNode;
  onDelete?: () => void;
  meta?: PropertyMeta | null;
  className?: string;
  propertyName?: string;
  pinAdapter?: PinAdapter;
}) {
  return (
    <div className={`def-field def-field-row ${className ?? ''}`.trim()}>
      {label !== undefined && (
        <PropertyTooltip meta={meta}>
          <span className="def-field-label">
            <PinToggle propertyName={propertyName} pinAdapter={pinAdapter} />
            {label} <span className="def-type">{type}</span>
          </span>
        </PropertyTooltip>
      )}
      {children}
      {onDelete && (
        <button type="button" className="danger" onClick={onDelete} title="Remove">
          ×
        </button>
      )}
    </div>
  );
}

function BoolEditor({
  label,
  typed,
  onChange,
  onDelete,
  propertyName,
  parentTypeName,
  refAdapter,
  pinAdapter,
}: FieldProps) {
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  const variant: 'yes-no' | 'on-off' = propertyName && /^b_apply_/.test(propertyName)
    ? 'on-off'
    : 'yes-no';
  return (
    <PrimitiveRow
      label={label}
      type="bool"
      onDelete={onDelete}
      meta={meta}
      className="def-type-color-bool"
      propertyName={propertyName}
      pinAdapter={pinAdapter}
    >
      <WideToggle
        value={!!typed.value}
        onChange={(v) => onChange({ ...typed, value: v })}
        variant={variant}
        title={meta?.tooltip ?? undefined}
      />
    </PrimitiveRow>
  );
}

function NumberEditor({
  label,
  typed,
  onChange,
  onDelete,
  propertyName,
  parentTypeName,
  refAdapter,
  pinAdapter,
}: FieldProps) {
  const isInt = typed.type === 'int';
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  const min = numericBound(meta?.clamp_min) ?? numericBound(meta?.ui_min);
  const max = numericBound(meta?.clamp_max) ?? numericBound(meta?.ui_max);
  const hasBounds = min !== null && max !== null && max > min;
  return (
    <PrimitiveRow
      label={label}
      type={typed.type}
      onDelete={onDelete}
      meta={meta}
      className="def-type-color-number"
      propertyName={propertyName}
      pinAdapter={pinAdapter}
    >
      {hasBounds ? (
        <NumberSlider
          value={Number.isFinite(typed.value) ? typed.value : (min as number)}
          onChange={(n) => onChange({ ...typed, value: n })}
          min={min as number}
          max={max as number}
          isInt={isInt}
          title={meta?.tooltip ?? undefined}
        />
      ) : (
        <input
          type="number"
          step={isInt ? 1 : 'any'}
          value={Number.isFinite(typed.value) ? typed.value : 0}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange({ ...typed, value: 0 });
            const n = isInt ? parseInt(raw, 10) : Number(raw);
            onChange({ ...typed, value: Number.isFinite(n) ? n : 0 });
          }}
        />
      )}
    </PrimitiveRow>
  );
}

function numericBound(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function StringLikeEditor({
  label,
  typed,
  onChange,
  onDelete,
  propertyName,
  parentTypeName,
  refAdapter,
  pinAdapter,
}: FieldProps) {
  const v = (typed.value ?? '') as string;
  const long = v.length > 60 || v.includes('\n');
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  return (
    <PrimitiveRow
      label={label}
      type={typed.type}
      onDelete={onDelete}
      meta={meta}
      className="def-type-color-string"
      propertyName={propertyName}
      pinAdapter={pinAdapter}
    >
      {long ? (
        <textarea
          rows={Math.min(8, Math.max(2, v.split('\n').length))}
          value={v}
          onChange={(e) => onChange({ ...typed, value: e.target.value })}
        />
      ) : (
        <input
          type="text"
          value={v}
          onChange={(e) => onChange({ ...typed, value: e.target.value })}
        />
      )}
    </PrimitiveRow>
  );
}

/** Pull the bare enum-member name out of any of the forms the JSON
 *  exporter emits: a plain `"FlatHeal"`, a Python repr like
 *  `"<EConsumableEffectType.FLAT_HEAL: 1>"`, or `"EConsumableEffectType::FlatHeal"`. */
function extractEnumMemberName(raw: string): string {
  if (!raw) return '';
  const repr = /<[^.]*\.([A-Za-z0-9_]+):/.exec(raw);
  if (repr) return repr[1];
  const colon = /::([A-Za-z0-9_]+)\s*$/.exec(raw);
  if (colon) return colon[1];
  return raw;
}

/** Title-case a CamelCase / SNAKE_CASE / dash-separated identifier into a
 *  display label. Converts "TriggeringGameplayEffect" → "Triggering
 *  Gameplay Effect" and "FLAT_HEAL" → "Flat Heal". */
function humanizeEnumMember(name: string): string {
  if (!name) return name;
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function EnumEditor({
  label,
  typed,
  onChange,
  onDelete,
  propertyName,
  parentTypeName,
  refAdapter,
  pinAdapter,
}: FieldProps) {
  const enumName = typed.enum_name as string | undefined;
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  const members = enumName ? refAdapter.getEnumMembers(enumName) : null;
  const rawValue = String(typed.value ?? '');
  const memberKey = extractEnumMemberName(rawValue);

  const options = useMemo<SelectOption[]>(() => {
    if (!members) return [];
    const opts = members.map((m) => ({
      value: m.name,
      label: m.display_name ?? humanizeEnumMember(m.name),
      hint: m.name,
    }));
    // Preserve the current value when it doesn't match any known member —
    // surface it at the top so the user can still edit without losing it.
    if (memberKey && !members.some((m) => m.name === memberKey)) {
      opts.unshift({ value: memberKey, label: humanizeEnumMember(memberKey), hint: memberKey });
    }
    return opts;
  }, [members, memberKey]);

  const enumLabel = enumName ? ` (${enumName})` : '';

  return (
    <PrimitiveRow
      label={label}
      type={`enum${enumLabel}`}
      onDelete={onDelete}
      meta={meta}
      className="def-type-color-enum"
      propertyName={propertyName}
      pinAdapter={pinAdapter}
    >
      {members ? (
        <SearchableSelect
          value={memberKey}
          options={options}
          placeholder="— Pick member —"
          allowEmpty={false}
          onChange={(v) => onChange({ ...typed, value: v })}
        />
      ) : (
        <input
          type="text"
          value={rawValue}
          onChange={(e) => onChange({ ...typed, value: e.target.value })}
          placeholder="EnumMember"
        />
      )}
    </PrimitiveRow>
  );
}

function GameplayTagEditor({
  label,
  typed,
  onChange,
  onDelete,
  propertyName,
  parentTypeName,
  refAdapter,
  pinAdapter,
}: FieldProps) {
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  return (
    <PrimitiveRow
      label={label}
      type="gameplay_tag"
      onDelete={onDelete}
      meta={meta}
      className="def-type-color-tag"
      propertyName={propertyName}
      pinAdapter={pinAdapter}
    >
      <input
        type="text"
        value={typed.value ?? ''}
        onChange={(e) => onChange({ ...typed, value: e.target.value })}
        placeholder="Some.Tag.Name"
      />
    </PrimitiveRow>
  );
}

function GameplayTagContainerEditor({
  label,
  typed,
  onChange,
  onDelete,
  propertyName,
  parentTypeName,
  refAdapter,
  pinAdapter,
}: FieldProps) {
  const tags: string[] = Array.isArray(typed.value) ? typed.value : [];
  const [draft, setDraft] = useState('');
  const setTags = (next: string[]) => onChange({ ...typed, value: next });
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  return (
    <div className="def-field def-type-color-tag">
      <FieldHead
        label={label}
        type={`gameplay_tag_container · ${tags.length}`}
        meta={meta}
        propertyName={propertyName}
        pinAdapter={pinAdapter}
        controls={
          onDelete ? (
            <button type="button" className="danger" onClick={onDelete} title="Remove">
              ×
            </button>
          ) : null
        }
      />
      <div className="def-array-strings">
        {tags.length === 0 && <div className="def-empty">(empty)</div>}
        {tags.map((tag, i) => (
          <div key={i} className="def-array-row">
            <input
              type="text"
              value={tag}
              onChange={(e) => {
                const next = tags.slice();
                next[i] = e.target.value;
                setTags(next);
              }}
            />
            <button
              type="button"
              className="danger"
              onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
        <div className="def-array-row">
          <input
            type="text"
            placeholder="Some.Tag.Name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                setTags([...tags, draft.trim()]);
                setDraft('');
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!draft.trim()) return;
              setTags([...tags, draft.trim()]);
              setDraft('');
            }}
          >
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}

function DefinitionRefEditor({
  label,
  typed,
  onChange,
  onDelete,
  propertyName,
  parentTypeName,
  refAdapter,
  pinAdapter,
  ownerKey,
  pathFromRoot,
}: FieldProps) {
  const className = String(typed.class ?? '');
  const value = String(typed.value ?? '');
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;

  // Class-aware drop target. Only registers when the field knows its
  // ownerKey + pathFromRoot (i.e. when the editor was rendered inside
  // a TypedPropertiesEditor that received an `ownerKey`). Falls back
  // to a no-op droppable on the legacy code paths.
  const dnd = useDndContext();
  const activeData = dnd.active?.data?.current as DragSource | undefined;
  const accepts = useMemo(() => {
    if (!activeData) return true;
    if (!className) return true;
    if (activeData.type === 'palette-item') return isClassCompatible(activeData.class, className);
    if (activeData.type === 'slot') return isClassCompatible(activeData.class ?? '', className);
    return false;
  }, [activeData, className]);
  const droppableEnabled = !!ownerKey && !!pathFromRoot;
  const dropId = droppableEnabled ? `defref-drop:${ownerKey}:${pathFromRoot!.join('.')}` : `defref-noop:${className}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: droppableEnabled
      ? ({
          type: 'def-ref',
          ownerKey: ownerKey!,
          path: pathFromRoot!,
          expectedClass: className,
        } satisfies DropTarget as any)
      : undefined,
    disabled: !droppableEnabled || !accepts,
  });

  const options = useMemo<SelectOption[]>(() => {
    const ids = refAdapter.options(className);
    const decorate = (id: string): SelectOption => {
      const folder = refAdapter.folderForId(id);
      const theme = folder ? getFolderTheme(folder) : null;
      const baseLabel = humanizeAssetId(id);
      return {
        value: id,
        label: theme ? `${theme.emoji} ${baseLabel}` : baseLabel,
        hint: id,
        ...(theme ? { color: theme.color } : {}),
      };
    };
    const list: SelectOption[] = ids.map(decorate);
    // If the current value isn't in the option list (unknown class, or asset
    // outside the loaded set), keep it as a leading entry so it's not lost.
    if (value && !ids.includes(value)) {
      list.unshift(decorate(value));
    }
    return list;
  }, [refAdapter, className, value]);

  const resolves = !!value && refAdapter.resolves(value);

  return (
    <div
      ref={setNodeRef}
      className={`def-field def-type-color-ref ${isOver ? 'def-ref-over' : ''} ${activeData && droppableEnabled && !accepts ? 'def-ref-rejects' : ''}`}
      title={droppableEnabled && className ? `Accepts ${className}` : undefined}
    >
      <FieldHead
        label={label}
        type={`definition_ref · ${className || '?'} · ${options.length} known`}
        meta={meta}
        propertyName={propertyName}
        pinAdapter={pinAdapter}
        controls={
          onDelete ? (
            <button type="button" className="danger" onClick={onDelete} title="Remove">
              ×
            </button>
          ) : null
        }
      />
      <div className="def-ref-row">
        <SearchableSelect
          value={value}
          options={options}
          placeholder="— None —"
          triggerClassName="def-ref-select"
          triggerTitle={value}
          onChange={(v) => onChange({ ...typed, value: v })}
          {...(className
            ? {
                onCreateNew: (id: string) => {
                  const created = refAdapter.createNew(className, id);
                  if (created) onChange({ ...typed, value: created });
                },
                createLabel: className,
              }
            : {})}
        />
        {resolves && (
          <button
            type="button"
            className="def-ref-go"
            title={`Go to ${value}`}
            onClick={() => refAdapter.navigate(value)}
          >
            →
          </button>
        )}
      </div>
    </div>
  );
}

function StructEditor({
  label,
  typed,
  onChange,
  onDelete,
  refAdapter,
  path,
  propertyName,
  parentTypeName,
  pinAdapter,
  ownerKey,
  pathFromRoot,
}: FieldProps) {
  const fields = (typed.value ?? {}) as Record<string, any>;
  const keys = Object.keys(fields);
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  // Children are nested inside this struct — push struct_name down so their
  // meta lookups resolve against InventoryRules, GameplayEffectsToApply, etc.
  const innerParent = typed.struct_name || parentTypeName;
  return (
    <div className="def-field def-type-color-struct">
      <FieldHead
        label={label}
        type={`struct · ${typed.struct_name ?? '?'} · ${keys.length} fields`}
        meta={meta}
        propertyName={propertyName}
        pinAdapter={pinAdapter}
        controls={
          onDelete ? (
            <button type="button" className="danger" onClick={onDelete} title="Remove">
              ×
            </button>
          ) : null
        }
      />
      <div className="def-object-fields">
        {keys.length === 0 && <div className="def-empty">(empty struct)</div>}
        {orderByPin(keys, pinAdapter).map((k) => (
          <TypedField
            key={k}
            label={humanizeProperty(k)}
            typed={fields[k]}
            propertyName={k}
            parentTypeName={innerParent}
            onChange={(v) =>
              onChange({ ...typed, value: { ...fields, [k]: v } })
            }
            refAdapter={refAdapter}
            path={[...path, k]}
            pathFromRoot={pathFromRoot ? [...pathFromRoot, 'value', k] : undefined}
            ownerKey={ownerKey}
            pinAdapter={pinAdapter}
          />
        ))}
      </div>
    </div>
  );
}

/** Sort property names so pinned ones come first (in original order),
 *  followed by the rest (in original order). Stable sort by category. */
export function orderByPin(keys: string[], pinAdapter?: PinAdapter): string[] {
  if (!pinAdapter) return keys;
  const pinned = keys.filter((k) => pinAdapter.isPinned(k));
  const rest = keys.filter((k) => !pinAdapter.isPinned(k));
  return [...pinned, ...rest];
}

/** Resolve a UPROPERTY EditCondition reference (e.g. "bApplyHealPerSecond"
 *  or just "ApplyHealPerSecond") against a typed-envelope property map.
 *  Snake-cases the candidate names and returns the bool envelope's value
 *  when found, or `null` when the gate property is missing entirely. */
function readGateValue(properties: Record<string, any>, cond: string): boolean | null {
  if (!cond || !properties) return null;
  const candidates = new Set<string>();
  const snakeCond = cond.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  candidates.add(snakeCond);
  if (snakeCond.startsWith('b_')) candidates.add(snakeCond.slice(2));
  else candidates.add(`b_${snakeCond}`);
  for (const name of candidates) {
    const v = properties[name];
    if (v && typeof v === 'object' && 'value' in v) return Boolean(v.value);
  }
  return null;
}

function ContainerEditor({
  label,
  typed,
  onChange,
  onDelete,
  refAdapter,
  path,
  propertyName,
  parentTypeName,
  pinAdapter,
  ownerKey,
  pathFromRoot,
}: FieldProps) {
  // Handles both array and set — they share the same shape.
  const arr: any[] = Array.isArray(typed.value) ? typed.value : [];
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  // Prefer this envelope's own element_type; if null (empty array exported
  // with no instances), sniff one from any other asset's same-path
  // container; if still null, consult .property-meta.json for the
  // declared element_class and synthesize a definition_ref skeleton.
  let elementType = typed.element_type ?? refAdapter.lookupContainerType(path, 'element_type');
  if (!elementType && propertyName) {
    const elementClass = refAdapter.lookupArrayElementClass(parentTypeName, propertyName);
    if (elementClass) {
      elementType = { type: 'definition_ref', class: elementClass, value: '' };
    }
  }
  return (
    <div className="def-field def-type-color-array">
      <FieldHead
        label={label}
        type={`${typed.type} · ${arr.length}`}
        meta={meta}
        propertyName={propertyName}
        pinAdapter={pinAdapter}
        controls={
          <>
            <button
              type="button"
              onClick={() => {
                const seed = arr.length > 0
                  ? blankFromSkeleton(skeleton(arr[0]))
                  : elementType
                    ? blankFromSkeleton(elementType)
                    : { type: 'string', value: '' };
                onChange({ ...typed, value: [...arr, seed] });
              }}
              title="Append item"
            >
              + Add
            </button>
            {onDelete && (
              <button type="button" className="danger" onClick={onDelete} title="Remove">
                ×
              </button>
            )}
          </>
        }
      />
      <div className="def-array-items">
        {arr.length === 0 && <div className="def-empty">(empty)</div>}
        {arr.map((item, i) => (
          <div className="def-array-item" key={i}>
            <div className="def-array-item-head">
              <span className="def-array-idx">[{i}]</span>
              <div className="def-field-controls">
                <button
                  type="button"
                  disabled={i === 0}
                  title="Move up"
                  onClick={() => {
                    if (i === 0) return;
                    const next = arr.slice();
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange({ ...typed, value: next });
                  }}
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={i === arr.length - 1}
                  title="Move down"
                  onClick={() => {
                    if (i === arr.length - 1) return;
                    const next = arr.slice();
                    [next[i], next[i + 1]] = [next[i + 1], next[i]];
                    onChange({ ...typed, value: next });
                  }}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className="danger"
                  title="Remove"
                  onClick={() => onChange({ ...typed, value: arr.filter((_, idx) => idx !== i) })}
                >
                  ×
                </button>
              </div>
            </div>
            <TypedField
              typed={item}
              parentTypeName={parentTypeName}
              onChange={(v) => {
                const next = arr.slice();
                next[i] = v;
                onChange({ ...typed, value: next });
              }}
              refAdapter={refAdapter}
              path={[...path, i]}
              pathFromRoot={pathFromRoot ? [...pathFromRoot, 'value', i] : undefined}
              ownerKey={ownerKey}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function MapEditor({
  label,
  typed,
  onChange,
  onDelete,
  refAdapter,
  path,
  propertyName,
  parentTypeName,
  pinAdapter,
  ownerKey,
  pathFromRoot,
}: FieldProps) {
  const entries: Array<{ key: any; value: any }> = Array.isArray(typed.value) ? typed.value : [];
  const keyType = typed.key_type ?? refAdapter.lookupContainerType(path, 'key_type');
  const valueType = typed.value_type ?? refAdapter.lookupContainerType(path, 'value_type');
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;
  return (
    <div className="def-field def-type-color-map">
      <FieldHead
        label={label}
        type={`map · ${entries.length}`}
        meta={meta}
        propertyName={propertyName}
        pinAdapter={pinAdapter}
        controls={
          <>
            <button
              type="button"
              onClick={() => {
                const seedKey = entries.length > 0
                  ? blankFromSkeleton(skeleton(entries[0].key))
                  : keyType
                    ? blankFromSkeleton(keyType)
                    : { type: 'string', value: '' };
                const seedVal = entries.length > 0
                  ? blankFromSkeleton(skeleton(entries[0].value))
                  : valueType
                    ? blankFromSkeleton(valueType)
                    : { type: 'string', value: '' };
                onChange({ ...typed, value: [...entries, { key: seedKey, value: seedVal }] });
              }}
              title="Append entry"
            >
              + Add
            </button>
            {onDelete && (
              <button type="button" className="danger" onClick={onDelete} title="Remove">
                ×
              </button>
            )}
          </>
        }
      />
      <div className="def-map-entries">
        {entries.length === 0 && <div className="def-empty">(empty map)</div>}
        {entries.map((entry, i) => (
          <div className="def-map-entry" key={i}>
            <div className="def-array-item-head">
              <span className="def-array-idx">[{i}]</span>
              <div className="def-field-controls">
                <button
                  type="button"
                  className="danger"
                  title="Remove entry"
                  onClick={() => onChange({ ...typed, value: entries.filter((_, idx) => idx !== i) })}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="def-map-kv">
              <TypedField
                label="key"
                typed={entry.key}
                parentTypeName={parentTypeName}
                onChange={(v) => {
                  const next = entries.slice();
                  next[i] = { ...next[i], key: v };
                  onChange({ ...typed, value: next });
                }}
                refAdapter={refAdapter}
                path={[...path, i, 'key']}
                pathFromRoot={pathFromRoot ? [...pathFromRoot, 'value', i, 'key'] : undefined}
                ownerKey={ownerKey}
              />
              <TypedField
                label="value"
                typed={entry.value}
                parentTypeName={parentTypeName}
                onChange={(v) => {
                  const next = entries.slice();
                  next[i] = { ...next[i], value: v };
                  onChange({ ...typed, value: next });
                }}
                refAdapter={refAdapter}
                path={[...path, i, 'value']}
                pathFromRoot={pathFromRoot ? [...pathFromRoot, 'value', i, 'value'] : undefined}
                ownerKey={ownerKey}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UnknownTypeEditor({ label, typed, onChange, onDelete }: FieldProps) {
  // Defensive fallback — display the raw JSON for hand-editing.
  const [text, setText] = useState(() => JSON.stringify(typed, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="def-field">
      <FieldHead
        label={label}
        type={`unknown(${typed?.type ?? '?'})`}
        controls={
          onDelete ? (
            <button type="button" className="danger" onClick={onDelete} title="Remove">
              ×
            </button>
          ) : null
        }
      />
      <textarea
        rows={Math.min(20, Math.max(4, text.split('\n').length))}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setErr(null);
          } catch (ex) {
            setErr((ex as Error).message);
          }
        }}
      />
      {err && <div className="def-raw-err">{err}</div>}
    </div>
  );
}

export function TypedField(props: FieldProps) {
  const { typed } = props;
  if (!isTypedEnvelope(typed)) {
    return <UnknownTypeEditor {...props} />;
  }
  switch (typed.type) {
    case 'bool':
      return <BoolEditor {...props} />;
    case 'int':
    case 'float':
      return <NumberEditor {...props} />;
    case 'string':
    case 'name':
    case 'text':
      return <StringLikeEditor {...props} />;
    case 'enum':
      return <EnumEditor {...props} />;
    case 'gameplay_tag': {
      const meta = props.propertyName
        ? props.refAdapter.getPropertyMeta(props.parentTypeName, props.propertyName)
        : null;
      return (
        <PrimitiveRow
          label={props.label}
          type="gameplay_tag"
          onDelete={props.onDelete}
          meta={meta}
          className="def-type-color-tag"
          propertyName={props.propertyName}
          pinAdapter={props.pinAdapter}
        >
          <TagPicker
            multi={false}
            value={typed.value ?? ''}
            onChange={(v) => props.onChange({ ...typed, value: v })}
          />
        </PrimitiveRow>
      );
    }
    case 'gameplay_tag_container': {
      const meta = props.propertyName
        ? props.refAdapter.getPropertyMeta(props.parentTypeName, props.propertyName)
        : null;
      const tags: string[] = Array.isArray(typed.value) ? typed.value : [];
      return (
        <div className="def-field def-type-color-tag">
          <FieldHead
            label={props.label}
            type={`gameplay_tag_container · ${tags.length}`}
            meta={meta}
            propertyName={props.propertyName}
            pinAdapter={props.pinAdapter}
            controls={
              props.onDelete ? (
                <button type="button" className="danger" onClick={props.onDelete} title="Remove">
                  ×
                </button>
              ) : null
            }
          />
          <TagPicker
            multi={true}
            value={tags}
            onChange={(v) => props.onChange({ ...typed, value: v })}
          />
        </div>
      );
    }
    case 'definition_ref':
      return <DefinitionRefEditor {...props} />;
    case 'struct':
      if (typed?.struct_name === 'GameplayEffectsToApply') {
        return (
          <SmartEffectsView
            envelope={typed}
            onChange={(next) => props.onChange(next)}
          />
        );
      }
      return <StructRows {...props} />;
    case 'array':
    case 'set':
      return <ContainerEditor {...props} />;
    case 'map':
      return <MapEditor {...props} />;
    default:
      return <UnknownTypeEditor {...props} />;
  }
}

/** Top-level grid for the `properties` map: every key is a property name and
 *  every value is a typed envelope. Renders one TypedField per property.
 *  When `showAllFields` is false, properties matching the noisy hide-list
 *  (engine config, audio/vfx, interaction prompts, etc.) are hidden behind
 *  a small "(N hidden)" footer to keep the form focused on gameplay data.
 *
 *  `propertySearch` (when non-empty) further filters the visible properties
 *  by case-insensitive substring against both the humanized label and the
 *  raw snake-case name.
 *
 *  `groupBy` reorders the rendered list:
 *   - `default`  : alphabetical by raw name (current behavior)
 *   - `type`     : grouped under the typed-envelope `type` tag
 *   - `category` : grouped under UPROPERTY Category from .property-meta */
export function TypedPropertiesEditor({
  properties,
  onChange,
  refAdapter,
  showAllFields,
  parentTypeName,
  propertySearch = '',
  groupBy = 'default',
  pinAdapter,
  ownerKey,
}: {
  properties: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  refAdapter: RefAdapter;
  showAllFields: boolean;
  parentTypeName?: string;
  propertySearch?: string;
  groupBy?: 'default' | 'type' | 'category';
  pinAdapter?: PinAdapter;
  /** Owning record key — when supplied, every nested def_ref editor
   *  registers as a DnD drop target so palette items / slot drags
   *  land directly on it. */
  ownerKey?: string;
}) {
  const allKeys = Object.keys(properties ?? {}).sort();
  const noisyFiltered = showAllFields ? allKeys : allKeys.filter((k) => !isNoisyProperty(k));
  const q = propertySearch.trim().toLowerCase();
  const searchFiltered = q
    ? noisyFiltered.filter((k) =>
        humanizeProperty(k).toLowerCase().includes(q) || k.toLowerCase().includes(q),
      )
    : noisyFiltered;

  // EditCondition gating: when a property's .property-meta entry names a
  // sibling bool that's currently false, hide the property. Pinned
  // properties skip the gate so users can still see them. Show-all-fields
  // also bypasses the gate (it's the same idea — surface what the .h has).
  const isGatedOff = (k: string) => {
    if (showAllFields) return false;
    if (pinAdapter?.isPinned(k)) return false;
    const meta = refAdapter.getPropertyMeta(parentTypeName, k);
    const cond = meta?.edit_condition;
    if (!cond) return false;
    const gate = readGateValue(properties, cond);
    return gate === false;
  };

  const visible = searchFiltered.filter((k) => !isGatedOff(k));
  const hiddenCount = allKeys.length - visible.length;

  // Pinned keys float into their own group at the top, regardless of
  // grouping mode. Computing them once here keeps the rest of the
  // bucketing logic ignorant of pin state.
  const pinnedKeys = pinAdapter ? visible.filter((k) => pinAdapter.isPinned(k)) : [];
  const unpinnedKeys = pinAdapter ? visible.filter((k) => !pinAdapter.isPinned(k)) : visible;

  const groups: Array<{ label: string; keys: string[] }> = useMemo(() => {
    if (groupBy === 'default') return [{ label: '', keys: unpinnedKeys }];
    const buckets = new Map<string, string[]>();
    for (const k of unpinnedKeys) {
      let label = '';
      if (groupBy === 'type') {
        const t = properties?.[k]?.type;
        label = typeof t === 'string' ? t : 'unknown';
      } else {
        const meta = refAdapter.getPropertyMeta(parentTypeName, k);
        label = meta?.category ?? 'Uncategorized';
      }
      const arr = buckets.get(label);
      if (arr) arr.push(k);
      else buckets.set(label, [k]);
    }
    return [...buckets.entries()]
      .map(([label, keys]) => ({ label, keys }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [groupBy, unpinnedKeys, properties, refAdapter, parentTypeName]);

  const renderField = (k: string) => (
    // data-prop-path here marks each TOP-LEVEL property row so that the
    // ClassBrowser's EchoPublishingPane can pick up the clicked field path
    // and broadcast it to rail rows. We deliberately do NOT add this
    // attribute inside nested struct/array editors — only the top-level
    // properties of a record are echoed.
    <div key={k} data-prop-path={JSON.stringify(['properties', k])}>
      <TypedField
        label={humanizeProperty(k)}
        typed={properties[k]}
        propertyName={k}
        parentTypeName={parentTypeName}
        onChange={(v) => onChange({ ...properties, [k]: v })}
        refAdapter={refAdapter}
        path={[k]}
        pathFromRoot={ownerKey ? ['properties', k] : undefined}
        ownerKey={ownerKey}
        pinAdapter={pinAdapter}
      />
    </div>
  );

  return (
    <div className="def-properties">
      {visible.length === 0 && allKeys.length === 0 && (
        <div className="def-empty">(no properties)</div>
      )}
      {visible.length === 0 && allKeys.length > 0 && (
        <div className="def-empty">(no matches — clear the search or toggle "Show all fields")</div>
      )}
      {pinnedKeys.length > 0 && (
        <div className="def-group def-group-pinned">
          <div className="def-group-head">Pinned</div>
          {pinnedKeys.map(renderField)}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label || '__'} className="def-group">
          {g.label && groupBy !== 'default' && (
            <div className="def-group-head">{g.label}</div>
          )}
          {g.keys.map(renderField)}
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="def-hidden-note">
          {hiddenCount} field{hiddenCount === 1 ? '' : 's'} hidden — toggle{' '}
          <em>Show all fields</em> in the toolbar
          {q ? ' or clear the property search' : ''} to reveal them.
        </div>
      )}
    </div>
  );
}
