import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { humanizeAssetId } from './definitionsNaming';
import { getFolderTheme } from './folderTheme';
import { DefRefSlot } from './DefRefSlot';
import { ItemPalette } from './ItemPalette';
import { VirtualList } from './VirtualList';
import { HighlightedText } from './HighlightedText';
import { fuzzyRankMulti, type RankedHit } from '../search/fuzzy';
import { useJumpToDefinition } from './useJumpToDefinition';
import { UpgradeRecipeSection } from './UpgradeRecipeSection';

const FURNITURE_FOLDER = 'damageable_furniture_definitions';

interface FurnitureRow {
  key: DefinitionsKey;
  id: string;
  displayName: string;
}

function readDisplayName(json: any): string {
  const dn = json?.properties?.display_name;
  if (dn && typeof dn === 'object' && typeof dn.value === 'string' && dn.value) return dn.value;
  return humanizeAssetId(String(json?.id ?? ''));
}

export function FurnitureSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const jumpToDef = useJumpToDefinition();

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);

  const rows = useMemo<FurnitureRow[]>(() => {
    const out: FurnitureRow[] = [];
    for (const [k, rec] of definitions) {
      if (rec.folder !== FURNITURE_FOLDER) continue;
      out.push({ key: k, id: rec.id, displayName: readDisplayName(rec.json) });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  }, [definitions]);

  const filtered = useMemo<RankedHit<FurnitureRow>[]>(() => {
    return fuzzyRankMulti(rows, filter, (r) => [r.displayName, r.id]);
  }, [rows, filter]);

  if (selectedKey == null && rows.length > 0) setSelectedKey(rows[0].key);

  const selected = selectedKey ? definitions.get(selectedKey) : null;
  const props: any = selected?.json?.properties ?? {};
  const lootArrayEnvelope: any = props.loot_dropped_on_death;
  const lootEntries: any[] = lootArrayEnvelope?.type === 'array' && Array.isArray(lootArrayEnvelope.value)
    ? lootArrayEnvelope.value : [];

  const addLoot = () => {
    if (!selectedKey) return;
    const cur = lootArrayEnvelope?.type === 'array' ? lootArrayEnvelope : {
      type: 'array',
      element_type: { type: 'definition_ref', class: 'LootDefinition' },
      value: [],
    };
    const list = Array.isArray(cur.value) ? cur.value.slice() : [];
    list.push({ type: 'definition_ref', class: 'LootDefinition', value: '' });
    updateValueAtPath(selectedKey, ['properties', 'loot_dropped_on_death'], { ...cur, value: list });
  };
  const removeLoot = (i: number) => {
    if (!selectedKey || lootArrayEnvelope?.type !== 'array') return;
    const list = (lootArrayEnvelope.value as any[]).filter((_, idx) => idx !== i);
    updateValueAtPath(selectedKey, ['properties', 'loot_dropped_on_death'], { ...lootArrayEnvelope, value: list });
  };

  return (
    <div className="furniture-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Furniture</h3>
          <input
            type="text"
            value={filter}
            placeholder="search…"
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="rail-add-row">
            <button className="add-row" onClick={() => {
              let n = 1;
              while (findKeyById(`FD_NewFurniture${n}_DF`)) n++;
              const k = createDefinitionForClass('DamageableFurnitureDefinition', `FD_NewFurniture${n}_DF`);
              if (k) setSelectedKey(k);
            }}>＋ New furniture</button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state-mini">No furniture loaded.</div>
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
                style={{ borderLeft: `3px solid ${getFolderTheme(FURNITURE_FOLDER).color}` }}
                title={`${h.item.displayName} (${h.item.id})\nMiddle-click to open in Definitions`}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(h.item.id); } }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              >
                <span className="emoji" aria-hidden>🪑</span>
                <span className="label"><HighlightedText text={h.item.displayName} ranges={h.ranges} /></span>
              </button>
            )}
          />
        )}
      </aside>

      <section className="furniture-pane">
        {selected && selectedKey ? (
          <>
            <header className="station-header">
              <div className="station-title">
                <span aria-hidden>🪑</span>
                <h2>{readDisplayName(selected.json)}</h2>
                <span className="cls">{String(selected.json?.class ?? '').replace(/^U/, '')}</span>
              </div>
              <div className="station-sub">
                <span className="muted">id:</span> <code>{selected.id}</code>
                {' · '}
                <span className="muted">health:</span> {Number(props?.starting_health?.value ?? 0)}
              </div>
            </header>

            <section className="furniture-section">
              <div className="section-head">
                <h3>Death loot</h3>
                <button onClick={addLoot}>＋ loot table</button>
              </div>
              {lootEntries.length === 0 && <div className="muted">No loot tables.</div>}
              {lootEntries.map((_e, i) => (
                <div key={i} className="loot-entry">
                  <DefRefSlot
                    ownerKey={selectedKey}
                    path={['properties', 'loot_dropped_on_death', 'value', i]}
                    accept="loot-entry"
                    defaultClass="LootDefinition"
                    onRemove={() => removeLoot(i)}
                  />
                </div>
              ))}
            </section>

            <UpgradeRecipeSection
              hostKey={selectedKey}
              upgradedTargetClass={String(selected.json?.class ?? '').replace(/^U/, '')}
            />
          </>
        ) : (
          <div className="empty-state-mini">Pick a furniture from the rail.</div>
        )}
      </section>

      <ItemPalette folders={['loot_definitions', 'damageable_furniture_definitions', 'crafting_material_definitions']} title="Drop targets" />
    </div>
  );
}
