import { useEffect, useRef } from 'react';
import { useAppStore, ITEMS_SUBTAB_FOLDER, type ItemsSubTab } from '../store/appStore';
import { useDefinitionsStore } from '../store/definitionsStore';
import { ClassBrowserTab } from './classBrowser/ClassBrowserTab';
import { CONFIGS } from './classBrowser/configs';
import { deriveStaticPartnerId } from './classBrowser/RowWarnings';
import { getFolderTheme } from './folderTheme';

const SUB_TABS: Array<{ id: ItemsSubTab; folder: string }> = (Object.keys(ITEMS_SUBTAB_FOLDER) as ItemsSubTab[])
  .map((id) => ({ id, folder: ITEMS_SUBTAB_FOLDER[id] }));

export function ItemsTab() {
  const sub = useAppStore((s) => s.itemsSubTab);
  const setSub = useAppStore((s) => s.setItemsSubTab);
  const folder = ITEMS_SUBTAB_FOLDER[sub];
  const cfg = CONFIGS[folder];

  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const setToast = useDefinitionsStore((s) => s.setToast);
  const loadedAt = useDefinitionsStore((s) => s.loadedAt);

  const didAutoCreateForVersionRef = useRef<number | null>(null);

  useEffect(() => {
    if (definitions.size === 0) return;
    if (didAutoCreateForVersionRef.current === loadedAt) return;
    didAutoCreateForVersionRef.current = loadedAt;

    let minted = 0;
    let replacedBroken = 0;

    for (const [folder, cfg] of Object.entries(CONFIGS)) {
      if (!cfg.hasStaticPartner) continue;
      for (const [k, rec] of definitions) {
        if (rec.folder !== folder) continue;
        const slot = rec.json?.properties?.static_item_definition;
        if (!slot || slot.type !== 'definition_ref') continue;
        const cur = slot.value;
        const resolved = typeof cur === 'string' && cur && findKeyById(cur);
        if (resolved) continue;

        // Mint a new partner.
        let baseId = deriveStaticPartnerId(rec.id);
        let id = baseId;
        let n = 2;
        while (findKeyById(id)) id = `${baseId}_${n++}`;
        const newKey = createDefinitionForClass('StaticItemDefinition', id);
        if (!newKey) continue;
        updateValueAtPath(k, ['properties', 'static_item_definition'], {
          type: 'definition_ref', class: 'StaticItemDefinition', value: id,
        });
        minted++;
        if (typeof cur === 'string' && cur.length > 0) replacedBroken++;
      }
    }
    if (minted > 0) {
      const suffix = replacedBroken > 0 ? ` (${replacedBroken} replacing broken refs)` : '';
      setToast({ kind: 'info', text: `Created ${minted} missing static-item partners${suffix}` });
    }
  }, [definitions, loadedAt, findKeyById, createDefinitionForClass, updateValueAtPath, setToast]);

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
