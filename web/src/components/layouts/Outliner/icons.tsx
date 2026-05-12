import type { ELayoutActorType } from '../types';

export function TypeIcon({ kind }: { kind: ELayoutActorType }) {
  const c = kind === 'Layout' ? '#5af' :
            kind === 'EnemySpawnPoint' ? '#f55' :
            kind === 'LootSpawnPoint' ? '#fc4' :
            kind === 'VisualHelper' ? '#aaa' :
            '#ccc';
  if (kind === 'Layout') {
    return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="3" width="10" height="8" stroke={c} fill="none"/><rect x="4" y="5" width="6" height="4" stroke={c} fill="none"/></svg>;
  }
  if (kind === 'EnemySpawnPoint') {
    return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" stroke={c} fill="none"/><line x1="7" y1="2" x2="7" y2="12" stroke={c}/></svg>;
  }
  if (kind === 'LootSpawnPoint') {
    return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="7,2 12,5 12,11 7,12 2,11 2,5" stroke={c} fill="none"/></svg>;
  }
  if (kind === 'VisualHelper') {
    return <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7 Q7 2 12 7 Q7 12 2 7" stroke={c} fill="none"/><circle cx="7" cy="7" r="1" fill={c}/></svg>;
  }
  return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="3" width="8" height="8" stroke={c} fill="none"/></svg>;
}
