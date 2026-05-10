import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { humanizeAssetId } from './definitionsNaming';
import { ItemPalette } from './ItemPalette';
import { TypedPropertiesEditor } from './TypedValueEditor';
import { useRefAdapter } from './useRefAdapter';
import { HighlightedText } from './HighlightedText';
import { fuzzyRankMulti, type RankedHit } from '../search/fuzzy';
import { useJumpToDefinition } from './useJumpToDefinition';

const ENEMY_FOLDER = 'enemy_definitions';

function readDisplayName(json: any): string {
  const dn = json?.properties?.display_name;
  if (dn && typeof dn === 'object' && typeof dn.value === 'string' && dn.value) return dn.value;
  return humanizeAssetId(String(json?.id ?? ''));
}

export function EnemiesSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);
  const jumpToDef = useJumpToDefinition();

  const refAdapter = useRefAdapter((assetId) => {
    const k = findKeyById(assetId);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  });

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);

  const rows = useMemo(() => {
    const out: { key: DefinitionsKey; id: string; displayName: string }[] = [];
    for (const [k, rec] of definitions) {
      if (rec.folder !== ENEMY_FOLDER) continue;
      out.push({ key: k, id: rec.id, displayName: readDisplayName(rec.json) });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  }, [definitions]);

  type EnemyRow = { key: DefinitionsKey; id: string; displayName: string };
  const filtered = useMemo<RankedHit<EnemyRow>[]>(
    () => fuzzyRankMulti(rows, filter, (r) => [r.displayName, r.id]),
    [rows, filter],
  );

  if (selectedKey == null && rows.length > 0) setSelectedKey(rows[0].key);

  const selected = selectedKey ? definitions.get(selectedKey) : null;
  const props: any = selected?.json?.properties ?? {};

  return (
    <div className="enemies-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Enemies</h3>
          <input
            type="text"
            value={filter}
            placeholder="search…"
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="rail-add-row">
            <button className="add-row" onClick={() => {
              let n = 1;
              while (findKeyById(`ED_New${n}`)) n++;
              const k = createDefinitionForClass('EnemyDefinition', `ED_New${n}`);
              if (k) setSelectedKey(k);
            }}>＋ New enemy</button>
          </div>
        </div>
        <div className="rail-body">
          {filtered.map((h) => (
            <button
              key={h.item.key}
              className={`rail-row ${selectedKey === h.item.key ? 'selected' : ''}`}
              onClick={() => setSelectedKey(h.item.key)}
              style={{ borderLeft: '3px solid #ef6c6c' }}
              title={`${h.item.displayName} (${h.item.id})\nMiddle-click to open in Definitions`}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(h.item.id); } }}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            >
              <span className="emoji" aria-hidden>👹</span>
              <span className="label"><HighlightedText text={h.item.displayName} ranges={h.ranges} /></span>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-state-mini">No enemies loaded.</div>}
        </div>
      </aside>

      <section className="enemies-pane">
        {selected && selectedKey ? (
          <>
            <header className="station-header">
              <div className="station-title">
                <span aria-hidden>👹</span>
                <h2>{readDisplayName(selected.json)}</h2>
                <span className="cls">{String(selected.json?.class ?? '').replace(/^U/, '')}</span>
              </div>
              <div className="station-sub">
                <span className="muted">id:</span> <code>{selected.id}</code>
              </div>
            </header>

            <TypedPropertiesEditor
              parentTypeName={String(selected.json?.class ?? '').replace(/^U/, '')}
              properties={props}
              showAllFields={false}
              onChange={(next) => updateValueAtPath(selectedKey, ['properties'], next)}
              refAdapter={refAdapter}
              ownerKey={selectedKey}
            />
          </>
        ) : (
          <div className="empty-state-mini">Pick an enemy from the rail.</div>
        )}
      </section>

      <ItemPalette folders={['crafting_material_definitions', 'consumable_definitions', 'ammo_definitions']} title="Drops" />
    </div>
  );
}
