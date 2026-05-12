import { Html } from '@react-three/drei';
import type { ResolvedActor } from '../types';

function statusText(r: ResolvedActor): { text: string; cls: string } | null {
  switch (r.status.kind) {
    case 'ok':
      return null;
    case 'not-configured':
      return { text: 'No definition or queries', cls: 'sb-error' };
    case 'filtered-by-tile-requirements':
      return { text: 'Filtered by tile requirements', cls: 'sb-info' };
    case 'spawn-chance-skipped':
      return { text: `Spawn chance (${r.status.over.toFixed(2)} - ${r.status.under.toFixed(2)})`, cls: 'sb-info' };
    case 'no-matches':
      return { text: 'No matching definitions', cls: 'sb-error' };
    case 'missing-mesh':
      return { text: `Missing mesh: ${r.status.chosenDefinitionId}`, cls: 'sb-error' };
    case 'cycle':
      return { text: `Layout cycle: ${r.status.path.join(' -> ')}`, cls: 'sb-error' };
  }
}

export function StatusBillboard({ resolved, position }: { resolved: ResolvedActor; position: [number, number, number] }) {
  const s = statusText(resolved);
  if (!s) return null;
  return (
    <Html position={position} center distanceFactor={500} sprite>
      <div className={`status-billboard ${s.cls}`}>{s.text}</div>
    </Html>
  );
}
