import * as THREE from 'three';
import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { StatusBillboard } from './StatusBillboard';
import { NameBillboard } from './NameBillboard';
import type { ResolvedActor } from '../types';

/** Three short coloured line segments along +X (red), +Y (green), +Z (blue)
 *  in the parent's local frame. Drawn at every actor pivot so the user can
 *  verify position/rotation composition without guessing. Sized in cm
 *  (Unreal units) so it's readable next to typical asset bounds. */
function PivotGizmo({ length = 60 }: { length?: number }) {
  return (
    <group>
      <axesHelper args={[length]} />
    </group>
  );
}

const TINT_BY_TYPE: Record<string, string> = {
  ProxyActor: '#cccccc',
  Layout: '#5588ff',
  EnemySpawnPoint: '#ff5555',
  LootSpawnPoint: '#ffcc44',
  VisualHelper: '#888888',
};

const ERROR_TINT = '#ff3333';
const NO_BOUNDS_TINT = '#ff9933'; // catalog miss — looked up a mesh path but no bounds

/** Spawn-point types are not meshes — Unreal renders them as billboard
 *  markers in the editor. Mirror that with a small fixed-size sphere so
 *  they're visually distinct from proxies that *should* have bounds. */
const MARKER_TYPES = new Set(['EnemySpawnPoint', 'LootSpawnPoint', 'VisualHelper']);

function readVector(env: any): [number, number, number] {
  const v = env?.value;
  return [v?.x?.value ?? 0, v?.y?.value ?? 0, v?.z?.value ?? 0];
}

function readRotator(env: any): [number, number, number] {
  const v = env?.value;
  // Exporter emits Unreal's FQuat with x/y/z/w fields.
  if (env?.struct_name === 'Quat' && v?.w !== undefined) {
    const q = new THREE.Quaternion(
      v?.x?.value ?? 0, v?.y?.value ?? 0, v?.z?.value ?? 0, v?.w?.value ?? 1,
    );
    const e = new THREE.Euler().setFromQuaternion(q);
    return [e.x, e.y, e.z];
  }
  // Fallback for FRotator (Pitch/Yaw/Roll in degrees).
  const pitch = (v?.pitch?.value ?? 0) * Math.PI / 180;
  const yaw = (v?.yaw?.value ?? 0) * Math.PI / 180;
  const roll = (v?.roll?.value ?? 0) * Math.PI / 180;
  return [pitch, yaw, roll];
}

export function LayoutObjectMesh({ resolved, index }: { resolved: ResolvedActor; index: number }) {
  const selectedIndices = useLayoutEditorStore((s) => s.selectedIndices);
  const setSelection = useLayoutEditorStore((s) => s.setSelection);

  const t = resolved.transform.value;
  const translation = readVector(t.translation);
  const rotation = readRotator(t.rotation as any);
  const scale = readVector(t.scale3_d);

  const isOk = resolved.status.kind === 'ok';
  const isMarker = MARKER_TYPES.has(resolved.actorType);
  const selected = selectedIndices.includes(index);

  let size: [number, number, number] = [100, 100, 100];
  let pivotOffset: [number, number, number] = [0, 0, 0];
  let placeholderKind: 'bounds' | 'no-bounds' | 'marker' | 'error' = 'error';
  if (resolved.status.kind === 'ok') {
    if (resolved.status.bounds) {
      placeholderKind = 'bounds';
      const b = resolved.status.bounds;
      size = [
        Math.max(10, b.max[0] - b.min[0]),
        Math.max(10, b.max[1] - b.min[1]),
        Math.max(10, b.max[2] - b.min[2]),
      ];
      pivotOffset = [
        (b.min[0] + b.max[0]) / 2,
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2,
      ];
    } else if (isMarker) {
      placeholderKind = 'marker';
    } else {
      placeholderKind = 'no-bounds';
    }
  }
  // Markers (spawn points, visual helpers) get a fixed small size so they
  // don't read as missing-data placeholders.
  if (placeholderKind === 'marker') {
    size = [40, 40, 40];
  }
  const tint =
    placeholderKind === 'bounds' ? (TINT_BY_TYPE[resolved.actorType] ?? '#aaa')
    : placeholderKind === 'marker' ? (TINT_BY_TYPE[resolved.actorType] ?? '#aaa')
    : placeholderKind === 'no-bounds' ? NO_BOUNDS_TINT
    : ERROR_TINT;

  // Recurse for nested layouts. Children of a nested Layout actor are not
  // individually addressable in the current selection model (selection is
  // indexed into the SELECTED layout's `layout_objects`, not the inner
  // layout's). Pass the owning top-level `index` down so clicks on any
  // descendant select the parent Layout actor — matching the Outliner,
  // which only lists top-level entries.
  if (resolved.children && resolved.children.length > 0) {
    return (
      <group
        position={translation}
        rotation={rotation as any}
        scale={scale}
        onClick={(e) => { e.stopPropagation(); setSelection([index]); }}
      >
        {/* axes at the parent Layout actor's pivot — verifies that
            children are correctly composed onto this transform. */}
        <PivotGizmo length={120} />
        {resolved.children.map((child, ci) => (
          <LayoutObjectMesh key={ci} resolved={child} index={index} />
        ))}
        <NameBillboard resolved={resolved} position={[0, 0, 200]} selected={selected} />
      </group>
    );
  }

  return (
    <group
      position={translation}
      rotation={rotation as any}
      scale={scale}
      onClick={(e) => { e.stopPropagation(); setSelection([index]); }}
    >
      <mesh position={pivotOffset}>
        {placeholderKind === 'marker'
          ? <sphereGeometry args={[size[0] / 2, 12, 8]} />
          : <boxGeometry args={size} />}
        <meshStandardMaterial
          color={tint}
          transparent
          opacity={isOk ? 0.6 : 0.4}
          wireframe={placeholderKind === 'marker'}
        />
      </mesh>
      {selected && (
        <mesh position={pivotOffset}>
          <boxGeometry args={[size[0] * 1.05, size[1] * 1.05, size[2] * 1.05]} />
          <meshBasicMaterial color="#ffeb3b" wireframe />
        </mesh>
      )}
      {/* axes at every actor's pivot — visually verifies position +
          rotation composition for leaf actors (proxies, spawn points,
          markers). Sized 40cm so it's visible but not dominant. */}
      <PivotGizmo length={40} />
      <NameBillboard
        resolved={resolved}
        position={[pivotOffset[0], pivotOffset[1], pivotOffset[2] + size[2] / 2 + 120]}
        selected={selected}
      />
      <StatusBillboard
        resolved={resolved}
        position={[pivotOffset[0], pivotOffset[1], pivotOffset[2] + size[2] / 2 + 50]}
      />
    </group>
  );
}
