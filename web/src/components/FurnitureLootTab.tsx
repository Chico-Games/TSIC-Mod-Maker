import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { humanizeAssetId } from './definitionsNaming';
import { getFolderTheme } from './folderTheme';
import { TypedPropertiesEditor } from './TypedValueEditor';
import { useRefAdapter } from './useRefAdapter';
import { ItemPalette } from './ItemPalette';
import { VirtualList } from './VirtualList';
import { HighlightedText } from './HighlightedText';
import { fuzzyRankMulti, type RankedHit } from '../search/fuzzy';
import { useJumpToDefinition } from './useJumpToDefinition';

const LOOT_FOLDER = 'loot_definitions';

export function FurnitureLootTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);
  const jumpToDef = useJumpToDefinition();

  const refAdapter = useRefAdapter((id) => {
    const k = findKeyById(id);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  });

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);

  type LootRow = { key: DefinitionsKey; id: string; itemCount: number };
  const rows = useMemo<LootRow[]>(() => {
    const out: LootRow[] = [];
    for (const [k, rec] of definitions) {
      if (rec.folder !== LOOT_FOLDER) continue;
      const items = rec.json?.properties?.items_to_drop;
      const itemCount = items?.type === 'array' && Array.isArray(items.value) ? items.value.length : 0;
      out.push({ key: k, id: rec.id, itemCount });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }, [definitions]);

  const filtered = useMemo<RankedHit<LootRow>[]>(() => {
    return fuzzyRankMulti(rows, filter, (r) => [humanizeAssetId(r.id), r.id]);
  }, [rows, filter]);

  if (selectedKey == null && rows.length > 0) setSelectedKey(rows[0].key);

  const selected = selectedKey ? definitions.get(selectedKey) : null;
  const theme = getFolderTheme(LOOT_FOLDER);

  return (
    <div className="furniture-loot-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Loot tables</h3>
          <input
            type="text"
            value={filter}
            placeholder="search…"
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="rail-add-row">
            <button className="add-row" onClick={() => {
              let n = 1;
              while (findKeyById(`LD_New${n}`)) n++;
              const k = createDefinitionForClass('LootDefinition', `LD_New${n}`);
              if (k) setSelectedKey(k);
            }}>＋ New loot table</button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state-mini">No loot tables.</div>
        ) : (
          <VirtualList
            className="rail-body"
            items={filtered}
            rowHeight={30}
            keyOf={(h) => h.item.key}
            renderItem={(h) => (
              <button
                className={`rail-row ${selectedKey === h.item.key ? 'selected' : ''}`}
                onClick={() => setSelectedKey(h.item.key)}
                style={{ borderLeft: `3px solid ${theme.color}` }}
                title={`${h.item.id}\nMiddle-click to open in Definitions`}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(h.item.id); } }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              >
                <span className="emoji" aria-hidden>{theme.emoji}</span>
                <span className="label">
                  <HighlightedText text={humanizeAssetId(h.item.id)} ranges={h.ranges} />
                </span>
                <span className="muted small">{h.item.itemCount}</span>
              </button>
            )}
          />
        )}
      </aside>

      <section className="loot-pane">
        {selected && selectedKey ? (
          <>
            <header className="station-header">
              <div className="station-title">
                <span aria-hidden>{theme.emoji}</span>
                <h2>{humanizeAssetId(selected.id)}</h2>
                <span className="cls">{String(selected.json?.class ?? '').replace(/^U/, '')}</span>
              </div>
              <div className="station-sub">
                <span className="muted">id:</span> <code>{selected.id}</code>
              </div>
            </header>

            <TypedPropertiesEditor
              parentTypeName={String(selected.json?.class ?? '').replace(/^U/, '')}
              properties={selected.json?.properties ?? {}}
              showAllFields={false}
              onChange={(next) => updateValueAtPath(selectedKey, ['properties'], next)}
              refAdapter={refAdapter}
            />
          </>
        ) : (
          <div className="empty-state-mini">Pick a loot table from the rail.</div>
        )}
      </section>

      <ItemPalette folders={['crafting_material_definitions', 'consumable_definitions', 'constructable_item_definitions', 'ammo_definitions']} title="Items" />
    </div>
  );
}
