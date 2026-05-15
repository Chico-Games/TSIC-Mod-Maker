import { useEffect, useRef, type MouseEvent } from 'react';
import { TypeIcon } from './icons';
import type { ResolvedActor } from '../types';

type Props = {
  resolved: ResolvedActor;
  selected: boolean;
  onClick: (e: MouseEvent) => void;
};

function deriveName(r: ResolvedActor): string {
  const lo = r.layoutObject.value;
  switch (r.actorType) {
    case 'ProxyActor': {
      const ref = lo.furniture_definition?.value;
      if (ref) return `Proxy: ${ref}`;
      const qCount = lo.definition_filter.value.search_queries.value.length;
      return `Proxy: SearchQuery (${qCount} ${qCount === 1 ? 'tag' : 'tags'})`;
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

export function OutlinerRow({ resolved, selected, onClick }: Props) {
  const name = deriveName(resolved);
  const ref = useRef<HTMLDivElement | null>(null);
  const isError =
    resolved.status.kind !== 'ok' &&
    resolved.status.kind !== 'spawn-chance-skipped' &&
    resolved.status.kind !== 'filtered-by-tile-requirements';
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  return (
    <div
      ref={ref}
      className={`outliner-row${selected ? ' selected' : ''}`}
      onClick={onClick}
    >
      <TypeIcon kind={resolved.actorType} />
      <span className="outliner-row-name">{name}</span>
      {isError && <span className="outliner-row-error" title={resolved.status.kind} />}
    </div>
  );
}
