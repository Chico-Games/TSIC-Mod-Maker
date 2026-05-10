import { useAppStore, FURNITURE_SUBTAB_FOLDER, type FurnitureSubTab } from '../store/appStore';
import { ClassBrowserTab } from './classBrowser/ClassBrowserTab';
import { CONFIGS } from './classBrowser/configs';
import { getFolderTheme } from './folderTheme';

const SUB_TABS: Array<{ id: FurnitureSubTab; folder: string }> = (Object.keys(FURNITURE_SUBTAB_FOLDER) as FurnitureSubTab[])
  .map((id) => ({ id, folder: FURNITURE_SUBTAB_FOLDER[id] }));

export function FurnitureTab() {
  const sub = useAppStore((s) => s.furnitureSubTab);
  const setSub = useAppStore((s) => s.setFurnitureSubTab);
  const folder = FURNITURE_SUBTAB_FOLDER[sub];
  const cfg = CONFIGS[folder];

  return (
    <div className="vertical-subtab-layout">
      <nav className="vertical-subtab-rail">
        {SUB_TABS.map((t) => {
          const c = CONFIGS[t.folder];
          const theme = getFolderTheme(t.folder);
          return (
            <button
              key={t.id}
              className={`vertical-subtab ${sub === t.id ? 'active' : ''}`}
              onClick={() => setSub(t.id)}
              style={{ borderLeft: `3px solid ${theme.color}` }}
            >
              <span aria-hidden>{c?.emoji ?? theme.emoji}</span>
              <span className="label">{c?.label ?? t.folder}</span>
            </button>
          );
        })}
      </nav>
      <div className="vertical-subtab-body">
        {cfg ? <ClassBrowserTab folder={folder} config={cfg} /> : <div className="empty-state-mini">Missing config for {folder}</div>}
      </div>
    </div>
  );
}
