import { useLayoutEditorStore } from '../../../store/layoutEditorStore';
import { StatusBillboard } from './StatusBillboard';
import type { ResolvedActor } from '../types';

const TINT_BY_TYPE: Record<string, string> = {
  ProxyActor: '#cccccc',
  Layout: '#5588ff',
  EnemySpawnPoint: '#ff5555',
  LootSpawnPoint: '#ffcc44',
  VisualHelper: '#888888',
};

const ERROR_TINT = '#ff3333';

function readVector(env: any): [number, number, number] {
  const v = env?.value;
  return [v?.x?.value ?? 0, v?.y?.value ?? 0, v?.z?.value ?? 0];
}

function readRotator(env: any): [number, number, number] {
  // Three uses radians; Unreal uses degrees. Convert.
  const v = env?.value;
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
  const rotation = readRotator(t.rotation);
  const scale = readVector(t.scale3_d);

  const isOk = resolved.status.kind === 'ok';
  const tint = isOk ? (TINT_BY_TYPE[resolved.actorType] ?? '#aaa') : ERROR_TINT;
  const selected = selectedIndices.includes(index);

  let size: [number, number, number] = [100, 100, 100];
  if (resolved.status.kind === 'ok' && resolved.status.bounds) {
    const b = resolved.status.bounds;
    size = [
      Math.max(10, b.max[0] - b.min[0]),
      Math.max(10, b.max[1] - b.min[1]),
      Math.max(10, b.max[2] - b.min[2]),
    ];
  }

  // Recurse for nested layouts.
  if (resolved.children && resolved.children.length > 0) {
    return (
      <group position={translation} rotation={rotation as any} scale={scale}>
        {resolved.children.map((child, ci) => (
          <LayoutObjectMesh key={ci} resolved={child} index={index * 1000 + ci} />
        ))}
        <StatusBillboard resolved={resolved} position={[0, size[2] + 50, 0]} />
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
      <mesh>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={tint}
          transparent
          opacity={isOk ? 0.6 : 0.4}
          wireframe={resolved.actorType === 'EnemySpawnPoint' || resolved.actorType === 'LootSpawnPoint'}
        />
      </mesh>
      {selected && (
        <mesh>
          <boxGeometry args={[size[0] * 1.05, size[1] * 1.05, size[2] * 1.05]} />
          <meshBasicMaterial color="#ffeb3b" wireframe />
        </mesh>
      )}
      <StatusBillboard resolved={resolved} position={[0, size[2] + 50, 0]} />
    </group>
  );
}
