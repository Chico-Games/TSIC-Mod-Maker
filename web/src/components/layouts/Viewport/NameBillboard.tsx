import { Html } from '@react-three/drei';
import type { ResolvedActor } from '../types';

function deriveName(r: ResolvedActor): string {
  const lo = r.layoutObject.value;
  switch (r.actorType) {
    case 'ProxyActor': {
      const ref = lo.furniture_definition?.value;
      if (ref) return `Proxy: ${ref}`;
      const qCount = lo.definition_filter.value.search_queries.value.length;
      return `Proxy: SearchQuery (${qCount})`;
    }
    case 'Layout':
      return `Layout: ${lo.layout_definition?.value ?? '(unset)'}`;
    case 'EnemySpawnPoint':
      return `EnemySpawn: ${lo.enemy_spawn_point_definition?.value ?? '(unset)'}`;
    case 'LootSpawnPoint':
      return `LootSpawn: ${lo.loot_spawn_point_definition?.value ?? '(unset)'}`;
    case 'VisualHelper':
      return 'Visual Helper';
  }
}

const CLS_BY_TYPE: Record<string, string> = {
  ProxyActor: 'nb-proxy',
  Layout: 'nb-layout',
  EnemySpawnPoint: 'nb-enemy',
  LootSpawnPoint: 'nb-loot',
  VisualHelper: 'nb-visual',
};

export function NameBillboard({
  resolved,
  position,
  selected,
}: {
  resolved: ResolvedActor;
  position: [number, number, number];
  selected: boolean;
}) {
  const name = deriveName(resolved);
  const cls = CLS_BY_TYPE[resolved.actorType] ?? '';
  return (
    <Html position={position} center distanceFactor={500} sprite>
      <div className={`name-billboard ${cls}${selected ? ' selected' : ''}`}>{name}</div>
    </Html>
  );
}
