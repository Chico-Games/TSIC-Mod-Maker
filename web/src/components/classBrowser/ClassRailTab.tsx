import { useMemo } from 'react';
import { useAppStore, type RailHome } from '../../store/appStore';
import { useAppSchemaStore } from '../../store/appSchemaStore';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { getFolderTheme } from '../folderTheme';
import { ClassBrowserTab } from './ClassBrowserTab';
import { configFor, labelFor, railFor } from './folderHomes';

/** A rail of definition folders on the left, the class browser for the chosen
 *  one on the right. Shared by the Items, Furniture and Systems tabs — they
 *  differ only in which folders belong to them. */
export function ClassRailTab({ home }: { home: RailHome }) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const classNodes = useAppSchemaStore((s) => s.classNodes);
  const chosen = useAppStore((s) => s.railFolder[home]);
  const setRailFolder = useAppStore((s) => s.setRailFolder);

  const rail = useMemo(() => railFor(home, definitions, classNodes), [home, definitions, classNodes]);
  const folder = chosen && rail.folders.includes(chosen) ? chosen : rail.folders[0] ?? null;
  const cfg = folder ? configFor(folder, rail.classOf.get(folder)) : null;

  return (
    <div className="vertical-subtab-layout">
      <nav className="vertical-subtab-rail" aria-label={`${home} categories`}>
        {rail.groups.map((g) => (
          <div key={g.label || 'main'} className="vertical-subtab-group">
            {g.label && <div className="vertical-subtab-group-label">{g.label}</div>}
            {g.folders.map((f) => {
              const theme = getFolderTheme(f);
              const n = rail.counts.get(f) ?? 0;
              return (
                <button
                  key={f}
                  className={`vertical-subtab ${folder === f ? 'active' : ''} ${n === 0 ? 'is-empty' : ''}`}
                  onClick={() => setRailFolder(home, f)}
                  style={{ borderLeft: `3px solid ${theme.color}` }}
                  title={`${f} — ${n} definition${n === 1 ? '' : 's'}`}
                >
                  <span aria-hidden>{theme.emoji}</span>
                  <span className="label">{labelFor(f)}</span>
                  <span className="vertical-subtab-count">{n}</span>
                </button>
              );
            })}
          </div>
        ))}
        {rail.folders.length === 0 && <div className="empty-state-mini">Nothing loaded.</div>}
      </nav>
      <div className="vertical-subtab-body">
        {folder && cfg
          ? <ClassBrowserTab key={folder} folder={folder} config={cfg} />
          : <div className="empty-state-mini">Nothing to show here yet.</div>}
      </div>
    </div>
  );
}
