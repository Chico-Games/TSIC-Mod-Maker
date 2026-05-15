import { useState } from 'react';
import * as THREE from 'three';
import type { FieldProps } from './TypedValueEditor';
import { FieldHead } from './TypedValueEditor';

/** Dedicated editor for Unreal's FTransform (struct_name === 'Transform') and
 *  for the inner FVector/FQuat/FRotator structs. Renders compact X/Y/Z rows
 *  with clear labels — replacing the generic StructRows expansion so the user
 *  isn't peeking through three nested struct shells to find the actual numbers.
 *
 *  Conventions match Unreal:
 *  - Translation in cm, world-space relative to the actor's parent.
 *  - Scale is a per-axis multiplier. Order: T * R * S (same as three.js).
 *  - Rotation may be stored as FQuat (xyzw, 4 components) or FRotator
 *    (pitch/yaw/roll in degrees, 3 components). FQuat is the canonical
 *    Unreal storage shape — a quaternion needs four numbers to encode a
 *    3D rotation. We show the raw components and a read-only Euler
 *    (pitch/yaw/roll, degrees) preview for sanity-checking.
 */

function readFloat(env: any): number {
  return Number(env?.value ?? 0);
}

function writeFloat(env: any, n: number): any {
  return { ...(env ?? { type: 'float' }), value: n };
}

function VectorRow({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: any; // Vector envelope: {type:'struct', struct_name:'Vector', value:{x,y,z}}
  onChange: (next: any) => void;
  unit?: string;
}) {
  const v = value?.value ?? {};
  const setComponent = (key: 'x' | 'y' | 'z', next: number) => {
    onChange({ ...value, value: { ...v, [key]: writeFloat(v?.[key], next) } });
  };
  return (
    <div className="tf-row">
      <span className="tf-row-label">{label}{unit ? <span className="tf-unit"> ({unit})</span> : null}</span>
      <div className="tf-fields">
        {(['x', 'y', 'z'] as const).map((k) => (
          <label key={k} className="tf-axis">
            <span className={`tf-axis-label tf-axis-${k}`}>{k.toUpperCase()}</span>
            <input
              type="number"
              step="any"
              value={readFloat(v?.[k])}
              onChange={(e) => setComponent(k, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function QuatRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: any; // {type:'struct', struct_name:'Quat', value:{x,y,z,w}}
  onChange: (next: any) => void;
}) {
  const v = value?.value ?? {};
  const setComponent = (key: 'x' | 'y' | 'z' | 'w', next: number) => {
    onChange({ ...value, value: { ...v, [key]: writeFloat(v?.[key], next) } });
  };
  // Read-only Euler preview (degrees). Three.js Y-up, but the angles are a
  // rough orientation reference for users used to reading pitch/yaw/roll.
  const q = new THREE.Quaternion(
    readFloat(v?.x), readFloat(v?.y), readFloat(v?.z), readFloat(v?.w) || 1,
  );
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  return (
    <div className="tf-row">
      <span className="tf-row-label">
        {label}
        <span className="tf-unit"> (Quat — 4 components: axis vector + scalar)</span>
      </span>
      <div className="tf-fields">
        {(['x', 'y', 'z', 'w'] as const).map((k) => (
          <label key={k} className="tf-axis">
            <span className={`tf-axis-label tf-axis-${k}`}>{k.toUpperCase()}</span>
            <input
              type="number"
              step="any"
              value={readFloat(v?.[k])}
              onChange={(e) => setComponent(k, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <div className="tf-euler-preview">
        Euler (deg, read-only):
        {' '}P {toDeg(e.x).toFixed(1)}
        {' '}Y {toDeg(e.y).toFixed(1)}
        {' '}R {toDeg(e.z).toFixed(1)}
      </div>
    </div>
  );
}

function RotatorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: any; // {type:'struct', struct_name:'Rotator', value:{pitch,yaw,roll}}
  onChange: (next: any) => void;
}) {
  const v = value?.value ?? {};
  const setComponent = (key: 'pitch' | 'yaw' | 'roll', next: number) => {
    onChange({ ...value, value: { ...v, [key]: writeFloat(v?.[key], next) } });
  };
  return (
    <div className="tf-row">
      <span className="tf-row-label">{label}<span className="tf-unit"> (Rotator — degrees)</span></span>
      <div className="tf-fields">
        {(['pitch', 'yaw', 'roll'] as const).map((k) => (
          <label key={k} className="tf-axis">
            <span className="tf-axis-label">{k[0].toUpperCase()}</span>
            <input
              type="number"
              step="any"
              value={readFloat(v?.[k])}
              onChange={(e) => setComponent(k, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function TransformEditor(props: FieldProps) {
  const {
    typed,
    onChange,
    label,
    onDelete,
    propertyName,
    parentTypeName,
    refAdapter,
    pinAdapter,
  } = props;
  const [open, setOpen] = useState(true);

  const fields: Record<string, any> = typed?.value && typeof typed.value === 'object' ? typed.value : {};
  const translation = fields.translation;
  const rotation = fields.rotation;
  const scale3d = fields.scale3_d;

  const setField = (key: string, next: any) =>
    onChange({ ...typed, value: { ...fields, [key]: next } });

  const meta = propertyName ? refAdapter.getPropertyMeta(parentTypeName, propertyName) : null;

  return (
    <div className="def-field def-type-color-struct tf-editor">
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <FieldHead
          label={`${open ? '▾' : '▸'} ${label ?? 'Transform'}`}
          type="Transform"
          meta={meta}
          propertyName={propertyName}
          pinAdapter={pinAdapter}
          controls={
            onDelete ? (
              <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Remove">
                ×
              </button>
            ) : null
          }
        />
      </div>
      {open && (
        <div className="tf-body">
          {translation
            ? <VectorRow label="Translation" value={translation} onChange={(v) => setField('translation', v)} unit="cm" />
            : <div className="tf-empty">(no translation)</div>}
          {rotation?.struct_name === 'Quat'
            ? <QuatRow label="Rotation" value={rotation} onChange={(v) => setField('rotation', v)} />
            : rotation?.struct_name === 'Rotator'
              ? <RotatorRow label="Rotation" value={rotation} onChange={(v) => setField('rotation', v)} />
              : <div className="tf-empty">(no rotation)</div>}
          {scale3d
            ? <VectorRow label="Scale" value={scale3d} onChange={(v) => setField('scale3_d', v)} />
            : <div className="tf-empty">(no scale)</div>}
        </div>
      )}
    </div>
  );
}
