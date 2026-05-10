import { useAppStore } from '../../store/appStore';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { getFolderTheme } from '../folderTheme';
import { AssetTitle } from '../AssetTitle';
import { TypedPropertiesEditor } from '../TypedValueEditor';
import { useRefAdapter } from '../useRefAdapter';
import { WhereUsedPanel } from './WhereUsedPanel';

interface Props {
  assetKey: DefinitionsKey | null;
  pinned: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onRenamed?: (newKey: DefinitionsKey) => void;
}

export function DetailPane({ assetKey, pinned, onPin, onUnpin, onRenamed }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);

  const refAdapter = useRefAdapter((id) => {
    const k = findKeyById(id);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  });

  const selected = assetKey ? definitions.get(assetKey) : null;
  if (!selected || !assetKey) {
    return <div className="detail-pane empty"><div className="empty-state-mini">Pick a record from the rail.</div></div>;
  }
  const theme = getFolderTheme(selected.folder);

  return (
    <div className={`detail-pane ${pinned ? 'pinned' : ''}`}>
      <header className="station-header">
        <div className="station-title">
          <span aria-hidden>{theme.emoji}</span>
          <AssetTitle assetKey={assetKey} onRenamed={(k) => onRenamed?.(k)} />
          <span className="cls">{String(selected.json?.class ?? '').replace(/^U/, '')}</span>
          {(() => {
            const cls = String(selected.json?.class ?? '');
            const setRSub = useAppStore.getState().setRecipesSubTab;
            const setTabFn = useAppStore.getState().setTab;
            const selectDef = useDefinitionsStore.getState().selectDefinition;
            if (cls === 'UDamageableFurnitureDefinition') {
              return <button className="cross-link" onClick={() => { setTabFn('recipes-loot'); setRSub('furniture'); selectDef(assetKey); }}>↗ Edit recipes/loot</button>;
            }
            if (cls === 'UCraftingStationDefinition' || cls === 'UProductionStationDefinition' || cls === 'UPlantableDefinition') {
              return <button className="cross-link" onClick={() => { setTabFn('recipes-loot'); setRSub('stations'); selectDef(assetKey); useAppStore.getState().selectStation(assetKey); }}>↗ Edit recipes/loot</button>;
            }
            return null;
          })()}
          {!pinned && onPin && (
            <button className="pin-btn" title="Pin this record to the right" onClick={onPin}>📌 Pin</button>
          )}
          {pinned && onUnpin && (
            <button className="pin-btn pinned" title="Unpin" onClick={onUnpin}>📌 Unpin</button>
          )}
        </div>
        <div className="station-sub">
          <span className="muted">id:</span> <code>{selected.id}</code>
        </div>
      </header>

      <TypedPropertiesEditor
        parentTypeName={String(selected.json?.class ?? '').replace(/^U/, '')}
        properties={selected.json?.properties ?? {}}
        showAllFields={false}
        onChange={(next) => updateValueAtPath(assetKey, ['properties'], next)}
        refAdapter={refAdapter}
        ownerKey={assetKey}
      />
      <WhereUsedPanel assetId={selected.id} />
    </div>
  );
}
