import { useState } from 'react';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { useJumpToDefinition } from '../useJumpToDefinition';
import { getFolderTheme } from '../folderTheme';
import { humanizeAssetId } from '../definitionsNaming';

export function WhereUsedPanel({ assetId }: { assetId: string }) {
  const referencedBy = useDefinitionsStore((s) => s.referencedBy);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const jumpToDef = useJumpToDefinition();
  const [open, setOpen] = useState(false);

  const incoming = referencedBy(assetId);
  if (incoming.length === 0) {
    return (
      <details className="where-used">
        <summary>Where used <span className="muted">(0)</span></summary>
        <div className="empty-state-mini">No incoming references.</div>
      </details>
    );
  }
  // Group by owner folder.
  const grouped = new Map<string, typeof incoming>();
  for (const ref of incoming) {
    const list = grouped.get(ref.ownerFolder) ?? [];
    list.push(ref);
    grouped.set(ref.ownerFolder, list);
  }
  return (
    <details className="where-used" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Where used <span className="muted">({incoming.length})</span></summary>
      {[...grouped.entries()].map(([folder, refs]) => {
        const theme = getFolderTheme(folder);
        return (
          <div key={folder} className="where-used-group">
            <div className="where-used-group-h" style={{ borderLeft: `3px solid ${theme.color}` }}>
              <span aria-hidden>{theme.emoji}</span> {folder} <span className="muted">({refs.length})</span>
            </div>
            {refs.map((ref) => {
              const rec = definitions.get(ref.ownerKey);
              if (!rec) return null;
              return (
                <button
                  key={`${ref.ownerKey}-${ref.path.join('/')}`}
                  className="where-used-row"
                  onClick={() => jumpToDef(rec.id)}
                  title={ref.path.join(' / ')}
                >
                  <span className="label">{humanizeAssetId(rec.id)}</span>
                  <code className="muted small">{ref.path.slice(1).join('.')}</code>
                </button>
              );
            })}
          </div>
        );
      })}
    </details>
  );
}
