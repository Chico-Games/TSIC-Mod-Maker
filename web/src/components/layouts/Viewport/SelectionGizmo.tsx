import { TransformControls } from '@react-three/drei';
import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { useDefinitionsStore } from '../../../store/definitionsStore';

export function SelectionGizmo() {
  const layoutKey = useLayoutEditorStore((s) => s.selectedLayoutKey);
  const selected = useLayoutEditorStore((s) => s.selectedIndices);
  const gizmoMode = useLayoutEditorStore((s) => s.gizmoMode);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const definitions = useDefinitionsStore((s) => s.definitions);

  const targetRef = useRef<THREE.Object3D>(null);

  useEffect(() => {
    if (!layoutKey || selected.length !== 1 || !targetRef.current) return;
    const idx = selected[0];
    const rec = definitions.get(layoutKey);
    const lo = rec?.json?.properties?.layout_objects?.value?.[idx];
    if (!lo) return;
    const t = lo.value.transform.value;
    targetRef.current.position.set(
      t.translation.value.x.value, t.translation.value.y.value, t.translation.value.z.value);
    const r = t.rotation;
    if (r.struct_name === 'Quat' && r.value?.w !== undefined) {
      targetRef.current.quaternion.set(
        r.value.x?.value ?? 0, r.value.y?.value ?? 0, r.value.z?.value ?? 0, r.value.w?.value ?? 1,
      );
    } else {
      targetRef.current.rotation.set(
        (r.value?.pitch?.value ?? 0) * Math.PI / 180,
        (r.value?.yaw?.value ?? 0) * Math.PI / 180,
        (r.value?.roll?.value ?? 0) * Math.PI / 180,
      );
    }
    targetRef.current.scale.set(
      t.scale3_d.value.x.value, t.scale3_d.value.y.value, t.scale3_d.value.z.value);
  }, [layoutKey, selected, definitions]);

  if (!layoutKey || selected.length !== 1) return null;
  const idx = selected[0];

  const onDragEnd = () => {
    if (!targetRef.current) return;
    const rec = definitions.get(layoutKey);
    const lo = rec?.json?.properties?.layout_objects?.value?.[idx];
    if (!lo) return;
    const t = lo.value.transform;

    const next = JSON.parse(JSON.stringify(t));
    const o = targetRef.current;
    next.value.translation.value.x.value = o.position.x;
    next.value.translation.value.y.value = o.position.y;
    next.value.translation.value.z.value = o.position.z;
    if (next.value.rotation.struct_name === 'Quat') {
      next.value.rotation.value.x.value = o.quaternion.x;
      next.value.rotation.value.y.value = o.quaternion.y;
      next.value.rotation.value.z.value = o.quaternion.z;
      next.value.rotation.value.w.value = o.quaternion.w;
    } else {
      next.value.rotation.value.pitch.value = o.rotation.x * 180 / Math.PI;
      next.value.rotation.value.yaw.value = o.rotation.y * 180 / Math.PI;
      next.value.rotation.value.roll.value = o.rotation.z * 180 / Math.PI;
    }
    next.value.scale3_d.value.x.value = o.scale.x;
    next.value.scale3_d.value.y.value = o.scale.y;
    next.value.scale3_d.value.z.value = o.scale.z;

    updateValueAtPath(layoutKey, ['properties', 'layout_objects', 'value', idx, 'value', 'transform'], next);
  };

  return (
    <>
      <object3D ref={targetRef} />
      <TransformControls
        object={(targetRef.current ?? undefined) as any}
        mode={gizmoMode}
        onMouseUp={onDragEnd}
      />
    </>
  );
}
