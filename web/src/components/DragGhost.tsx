import { useDefinitionsStore } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import type { DragSource } from '../dnd/dispatch';

export function DragGhost({ source }: { source: DragSource }) {
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const definitions = useDefinitionsStore((s) => s.definitions);

  if (source.type === 'palette-item') {
    const key = findKeyById(source.value);
    const rec = key ? definitions.get(key) : null;
    const theme = rec ? getFolderTheme(rec.folder) : { emoji: '📦', color: '#5fb3ff' };
    return (
      <div className="ghost-chip" style={{ borderLeft: `3px solid ${theme.color}` }}>
        <span className="item-emoji" aria-hidden>{theme.emoji}</span>
        <span>{humanizeAssetId(source.value)}</span>
        <span className="ghost-type" style={{ color: theme.color }}>{source.class}</span>
      </div>
    );
  }
  if (source.type === 'recipe-card') {
    const rec = definitions.get(source.key);
    if (!rec) return null;
    return (
      <div className="ghost-chip" style={{ borderLeft: `3px solid #e8c45e` }}>
        <span className="item-emoji" aria-hidden>📋</span>
        <span>{humanizeAssetId(rec.id)}</span>
      </div>
    );
  }
  if (source.type === 'slot') {
    const rec = definitions.get(source.ownerKey);
    if (!rec) return null;
    let cur: any = rec.json;
    for (const seg of source.path) cur = cur?.[seg as any];
    const value = cur && typeof cur === 'object' && cur.type === 'definition_ref' ? String(cur.value ?? '') : '';
    if (!value) return null;
    const theme = getFolderTheme(findKeyByIdSync(value) ? definitions.get(findKeyByIdSync(value)!)!.folder : '');
    return (
      <div className="ghost-chip" style={{ borderLeft: `3px solid ${theme.color}` }}>
        <span className="item-emoji" aria-hidden>{theme.emoji}</span>
        <span>{humanizeAssetId(value)}</span>
      </div>
    );
  }
  return null;
}

function findKeyByIdSync(id: string): string | null {
  return useDefinitionsStore.getState().findKeyById(id);
}
