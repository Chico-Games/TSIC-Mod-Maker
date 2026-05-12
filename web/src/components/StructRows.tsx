import { useState } from 'react';
import { TypedField, type FieldProps } from './TypedValueEditor';
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

  const setField = (key: string, next: any) => {
    onChange({ ...typed, value: { ...fields, [key]: next } });
  };

  // Keys are presented in their natural (insertion) order to keep XYZ
  // axes / translation/rotation/scale clusters together. The outer
  // TypedPropertiesEditor handles pin-sorting; inside a struct, ordering
  // by the exporter's emit order reads better than alphabetical.
  const keys = Object.keys(fields);

  return (
    <div className="def-field def-type-color-struct">
      <div
        className="def-field-head"
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
      >
        <span className="def-chevron">{open ? '▾' : '▸'}</span>
        <span className="def-field-label">
          {label !== undefined && <>{label} </>}
          <span className="def-type">struct · {structName} · {keys.length} fields</span>
        </span>
        {onDelete && (
          <div className="def-field-controls">
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
          </div>
        )}
      </div>
      {open && keys.length > 0 && (
        <div className="def-struct-body">
          {keys.map((k) => (
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
      {open && keys.length === 0 && (
        <div className="def-struct-empty">(empty struct)</div>
      )}
    </div>
  );
}
