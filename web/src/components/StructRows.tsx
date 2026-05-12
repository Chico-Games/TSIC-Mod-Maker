import { useState } from 'react';
import { TypedField, FieldHead, orderByPin, type FieldProps } from './TypedValueEditor';
import { humanizeProperty } from './definitionsNaming';

// Recursive struct expander. Replaces the original `StructEditor` for the
// general case (the GameplayEffectsToApply specialization in TypedField
// still short-circuits to SmartEffectsView). Each nested field is recursed
// through TypedField so structs-of-structs (FTransform → translation/rotation/
// scale → x/y/z, AudioConfig → soft refs + scalars, etc.) all expand cleanly.
//
// Circular import note: this module statically imports TypedField from
// TypedValueEditor, which in turn renders StructRows for `case 'struct'`.
// ESM hoists both function bindings, so as long as nothing at module-load
// time *calls* the other side, the cycle resolves fine at render-time.

type Props = FieldProps;

export function StructRows(props: Props) {
  const {
    typed,
    onChange,
    label,
    onDelete,
    refAdapter,
    path,
    propertyName,
    parentTypeName,
    pinAdapter,
    ownerKey,
    pathFromRoot,
  } = props;
  const [open, setOpen] = useState(true);

  const fields: Record<string, any> =
    typed?.value && typeof typed.value === 'object' && !Array.isArray(typed.value)
      ? typed.value
      : {};
  const structName = typed?.struct_name ?? 'Struct';
  // Children inherit the struct's own name as their parentTypeName so that
  // property-meta lookups resolve against the inner struct (e.g.
  // FTransform.translation), not the outer record's class.
  const innerParent = typed?.struct_name || parentTypeName;

  // Resolve the property-meta entry for this struct's own slot on its parent
  // (e.g. RecipeRow.inputs → inputs' UPROPERTY meta). Drives the tooltip
  // and the per-property pin button rendered inside FieldHead.
  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;

  const setField = (key: string, next: any) => {
    onChange({ ...typed, value: { ...fields, [key]: next } });
  };

  // Pin-aware ordering: pinned child fields float to the top while keeping
  // their original insertion order, with the unpinned remainder following
  // (also in insertion order). Matches the legacy `StructEditor` behaviour
  // and the top-level `TypedPropertiesEditor` pin handling.
  const sortedKeys = orderByPin(Object.keys(fields), pinAdapter);

  return (
    <div className="def-field def-type-color-struct">
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
      >
        <FieldHead
          label={`${open ? '▾' : '▸'} ${label ?? ''}`.trim()}
          type={`struct · ${structName} · ${sortedKeys.length} fields`}
          meta={meta}
          propertyName={propertyName}
          pinAdapter={pinAdapter}
          controls={
            onDelete ? (
              <button
                type="button"
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="Remove"
              >
                ×
              </button>
            ) : null
          }
        />
      </div>
      {open && sortedKeys.length > 0 && (
        <div className="def-struct-body">
          {sortedKeys.map((k) => (
            <TypedField
              key={k}
              label={humanizeProperty(k)}
              typed={fields[k]}
              propertyName={k}
              parentTypeName={innerParent}
              onChange={(v) => setField(k, v)}
              refAdapter={refAdapter}
              path={[...path, k]}
              pathFromRoot={pathFromRoot ? [...pathFromRoot, 'value', k] : undefined}
              ownerKey={ownerKey}
              pinAdapter={pinAdapter}
            />
          ))}
        </div>
      )}
      {open && sortedKeys.length === 0 && (
        <div className="def-struct-empty">(empty struct)</div>
      )}
    </div>
  );
}
