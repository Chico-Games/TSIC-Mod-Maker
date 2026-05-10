import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { ItemPalette } from './ItemPalette';
import { TypedPropertiesEditor } from './TypedValueEditor';
import { useRefAdapter } from './useRefAdapter';
import { HighlightedText } from './HighlightedText';
import { fuzzyRank } from '../search/fuzzy';

const LSP_FOLDER = 'loot_spawn_point_definitions';

interface BiomeRow {
  biome: string;
  floorKey: DefinitionsKey | null;
  furnitureKey: DefinitionsKey | null;
}

const NAME_RE = /^LSP_(.+?)_(Floor|Furniture)$/;

export function BiomeSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
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

  const [filter, setFilter] = useState('');
  const [selectedBiome, setSelectedBiome] = useState<string | null>(null);

  const biomes = useMemo<BiomeRow[]>(() => {
    const map = new Map<string, BiomeRow>();
    for (const [k, rec] of definitions) {
      if (rec.folder !== LSP_FOLDER) continue;
      const m = rec.id.match(NAME_RE);
      if (!m) continue;
      const biome = m[1];
      const which = m[2] as 'Floor' | 'Furniture';
      let row = map.get(biome);
      if (!row) {
        row = { biome, floorKey: null, furnitureKey: null };
        map.set(biome, row);
      }
      if (which === 'Floor') row.floorKey = k;
      else row.furnitureKey = k;
    }
    return [...map.values()].sort((a, b) => a.biome.localeCompare(b.biome));
  }, [definitions]);

  const filtered = useMemo(() => {
    return fuzzyRank(biomes, filter, (b) => b.biome);
  }, [biomes, filter]);

  if (selectedBiome == null && biomes.length > 0) setSelectedBiome(biomes[0].biome);

  const selected = selectedBiome ? biomes.find((b) => b.biome === selectedBiome) ?? null : null;
  const floorRec = selected?.floorKey ? definitions.get(selected.floorKey) : null;
  const furnRec = selected?.furnitureKey ? definitions.get(selected.furnitureKey) : null;

  return (
    <div className="biome-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Biomes</h3>
          <input
            type="text"
            value={filter}
            placeholder="search…"
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="rail-add-row">
            <button className="add-row" onClick={() => {
              let n = 1;
              while (findKeyById(`LSP_New${n}_Floor`) || findKeyById(`LSP_New${n}_Furniture`)) n++;
              const stem = `New${n}`;
              const floorKey = createDefinitionForClass('LootSpawnPointDefinition', `LSP_${stem}_Floor`);
              const furnKey = createDefinitionForClass('LootSpawnPointDefinition', `LSP_${stem}_Furniture`);
              if (floorKey || furnKey) setSelectedBiome(stem);
            }} title="Mint a Floor + Furniture LSP pair for a new biome">＋ New biome</button>
          </div>
        </div>
        <div className="rail-body">
          {filtered.map((h) => (
            <button
              key={h.item.biome}
              className={`rail-row ${selectedBiome === h.item.biome ? 'selected' : ''}`}
              onClick={() => setSelectedBiome(h.item.biome)}
              style={{ borderLeft: '3px solid #f0d77a' }}
              title={`${h.item.biome}\nMiddle-click to open Floor/Furniture LSP in Definitions`}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                const target = h.item.floorKey ?? h.item.furnitureKey;
                if (!target) return;
                const rec = definitions.get(target);
                if (!rec) return;
                selectFolder(rec.folder);
                selectDefinition(target);
                setTab('definitions');
              }}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            >
              <span className="emoji" aria-hidden>✨</span>
              <span className="label"><HighlightedText text={h.item.biome} ranges={h.ranges} /></span>
              <span className="muted small">
                {h.item.floorKey ? '🟫' : '·'}{h.item.furnitureKey ? '🪑' : '·'}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-state-mini">No biomes loaded.</div>}
        </div>
      </aside>

      <section className="biome-pane">
        {selected ? (
          <>
            <header className="station-header">
              <div className="station-title">
                <span aria-hidden>✨</span>
                <h2>{selected.biome}</h2>
              </div>
            </header>

            <div className="biome-cols">
              <section className="biome-col">
                <h3>Floor (LSP_{selected.biome}_Floor)</h3>
                {floorRec && selected.floorKey ? (
                  <TypedPropertiesEditor
                    parentTypeName={String(floorRec.json?.class ?? '').replace(/^U/, '')}
                    properties={floorRec.json?.properties ?? {}}
                    showAllFields={false}
                    onChange={(next) => updateValueAtPath(selected.floorKey!, ['properties'], next)}
                    refAdapter={refAdapter}
                  />
                ) : (
                  <div className="muted">No LSP_{selected.biome}_Floor asset.</div>
                )}
              </section>

              <section className="biome-col">
                <h3>Furniture (LSP_{selected.biome}_Furniture)</h3>
                {furnRec && selected.furnitureKey ? (
                  <TypedPropertiesEditor
                    parentTypeName={String(furnRec.json?.class ?? '').replace(/^U/, '')}
                    properties={furnRec.json?.properties ?? {}}
                    showAllFields={false}
                    onChange={(next) => updateValueAtPath(selected.furnitureKey!, ['properties'], next)}
                    refAdapter={refAdapter}
                  />
                ) : (
                  <div className="muted">No LSP_{selected.biome}_Furniture asset.</div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="empty-state-mini">Pick a biome from the rail.</div>
        )}
      </section>

      <ItemPalette folders={['loot_definitions']} title="Loot tables" />
    </div>
  );
}
