import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { useAppSchemaStore } from '../store/appSchemaStore';
import { ItemPalette } from './ItemPalette';
import { TypedPropertiesEditor } from './TypedValueEditor';
import { useRefAdapter } from './useRefAdapter';
import { HighlightedText } from './HighlightedText';
import { useHybridSearch } from '../search/hybrid';
import { inferAcceptedFolders } from '../inferFolders';
import { SearchBox } from './SearchBox';

const LSP_FOLDER = 'loot_spawn_point_definitions';
const BD_FOLDER = 'biome_definitions';

interface BiomeRow {
  biome: string;
  bdKey: DefinitionsKey | null;
  floorKey: DefinitionsKey | null;
  furnitureKey: DefinitionsKey | null;
  /** True when this biome has Floor/Furniture LSPs but no BiomeDefinition
   *  envelope yet — surfaced in the rail with a warning glyph so it's
   *  obvious which biomes still need migration to the BD-based source of
   *  truth. */
  orphanLsp: boolean;
}

const LSP_NAME_RE = /^LSP_(.+?)_(Floor|Furniture)$/;
const BD_NAME_RE = /^BD_(.+)$/;

export function BiomeSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const createDefinition = useDefinitionsStore((s) => s.createDefinition);
  const classNodes = useAppSchemaStore((s) => s.classNodes);
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
    // Pass 1 — BiomeDefinition envelopes are the source of truth. Each
    // BD_<Name>.json seeds a row keyed by its stem.
    for (const [k, rec] of definitions) {
      if (rec.folder !== BD_FOLDER) continue;
      const m = rec.id.match(BD_NAME_RE);
      if (!m) continue;
      const biome = m[1];
      if (!map.has(biome)) {
        map.set(biome, { biome, bdKey: k, floorKey: null, furnitureKey: null, orphanLsp: false });
      }
    }
    // Pass 2 — enrich with LSP_<Name>_{Floor,Furniture} pairs. LSPs that
    // don't have a matching BD become "orphan" rows so unmigrated biomes
    // are still visible.
    for (const [k, rec] of definitions) {
      if (rec.folder !== LSP_FOLDER) continue;
      const m = rec.id.match(LSP_NAME_RE);
      if (!m) continue;
      const biome = m[1];
      const which = m[2] as 'Floor' | 'Furniture';
      let row = map.get(biome);
      if (!row) {
        row = { biome, bdKey: null, floorKey: null, furnitureKey: null, orphanLsp: true };
        map.set(biome, row);
      }
      if (which === 'Floor') row.floorKey = k;
      else row.furnitureKey = k;
    }
    return [...map.values()].sort((a, b) => a.biome.localeCompare(b.biome));
  }, [definitions]);

  // Biomes don't have a single asset key (each is a Floor + Furniture
  // pair) — pass the floor key as the semantic key so 'desert' →
  // matches the LSP_Desert_Floor embedding.
  const filtered = useHybridSearch(
    biomes,
    filter,
    (b) => [b.biome],
    { semanticKey: (b) => b.floorKey ?? b.furnitureKey ?? null },
  );

  if (selectedBiome == null && biomes.length > 0) setSelectedBiome(biomes[0].biome);

  const selected = selectedBiome ? biomes.find((b) => b.biome === selectedBiome) ?? null : null;
  const floorRec = selected?.floorKey ? definitions.get(selected.floorKey) : null;
  const furnRec = selected?.furnitureKey ? definitions.get(selected.furnitureKey) : null;

  const paletteAutoFolders = useMemo<Set<string> | null>(() => {
    if (!floorRec && !furnRec) return null;
    const lookups = { records: definitions, findKeyById, classNodes };
    const a = floorRec ? inferAcceptedFolders(floorRec, lookups) : null;
    const b = furnRec ? inferAcceptedFolders(furnRec, lookups) : null;
    if (!a && !b) return null;
    const out = new Set<string>();
    if (a) for (const f of a) out.add(f);
    if (b) for (const f of b) out.add(f);
    return out;
  }, [definitions, findKeyById, classNodes, floorRec, furnRec]);

  return (
    <div className="biome-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Biomes</h3>
          <SearchBox value={filter} onChange={setFilter} placeholder="search…" />
          <div className="rail-add-row">
            <button className="add-row" onClick={() => {
              let n = 1;
              while (
                findKeyById(`BD_New${n}`) ||
                findKeyById(`LSP_New${n}_Floor`) ||
                findKeyById(`LSP_New${n}_Furniture`)
              ) n++;
              const stem = `New${n}`;
              // 1. Mint the BiomeDefinition envelope. This is the new
              //    source of truth for biome rows.
              const bdTemplate = {
                id: `BD_${stem}`,
                asset_path: `/Game/WorldGeneration/Biomes/${stem}/BD_${stem}`,
                class: 'UBiomeDefinition',
                parent_classes: ['UPrimaryDataAsset', 'UDataAsset', 'UObject'],
                properties: {
                  biome_tag_name: { type: 'name', value: `Tile.Biome.${stem}` },
                  display_name: { type: 'text', value: stem },
                  role: { type: 'enum', value: 'EBiomeRole::Environmental' },
                  map_color: { type: 'linear_color', value: '(R=0.5,G=0.5,B=0.5,A=1.0)' },
                  maze_openness: { type: 'float', value: 0.5 },
                  loot_multiplier: { type: 'float', value: 1.0 },
                  floor_lsp: {
                    type: 'soft_asset_ref',
                    value: `/Game/WorldGeneration/SpawnPoints/Items/${stem}/LSP_${stem}_Floor`,
                  },
                  furniture_lsp: {
                    type: 'soft_asset_ref',
                    value: `/Game/WorldGeneration/SpawnPoints/Items/${stem}/LSP_${stem}_Furniture`,
                  },
                },
              };
              const bdKey = createDefinition(BD_FOLDER, `BD_${stem}`, bdTemplate, { select: false });
              // 2. Mint the matching Floor + Furniture LSP pair.
              const floorKey = createDefinitionForClass('LootSpawnPointDefinition', `LSP_${stem}_Floor`);
              const furnKey = createDefinitionForClass('LootSpawnPointDefinition', `LSP_${stem}_Furniture`);
              if (bdKey || floorKey || furnKey) setSelectedBiome(stem);
            }} title="Mint a BiomeDefinition + Floor/Furniture LSP triple for a new biome">＋ New biome</button>
          </div>
        </div>
        <div className="rail-body">
          {filtered.map((h) => (
            <button
              key={h.item.biome}
              className={`rail-row ${selectedBiome === h.item.biome ? 'selected' : ''}`}
              onClick={() => setSelectedBiome(h.item.biome)}
              style={{
                borderLeft: '3px solid #f0d77a',
                ...(h.item.orphanLsp ? { opacity: 0.85 } : {}),
              }}
              title={
                h.item.orphanLsp
                  ? `${h.item.biome}\n⚠ No BiomeDefinition (BD_${h.item.biome}) — legacy LSP-only biome.\nMiddle-click to open in Definitions`
                  : `${h.item.biome}\nMiddle-click to open BD/LSP in Definitions`
              }
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                const target = h.item.bdKey ?? h.item.floorKey ?? h.item.furnitureKey;
                if (!target) return;
                const rec = definitions.get(target);
                if (!rec) return;
                selectFolder(rec.folder);
                selectDefinition(target);
                setTab('definitions');
              }}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            >
              <span className="emoji" aria-hidden>{h.item.orphanLsp ? '⚠️' : '✨'}</span>
              <span className="label"><HighlightedText text={h.item.biome} ranges={h.ranges} /></span>
              <span className="muted small">
                {h.item.bdKey ? '📘' : '·'}{h.item.floorKey ? '🟫' : '·'}{h.item.furnitureKey ? '🪑' : '·'}
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
                    ownerKey={selected.floorKey}
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
                    ownerKey={selected.furnitureKey}
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

      <ItemPalette
        folders={['loot_definitions']}
        title="Loot tables"
        autoFolders={paletteAutoFolders}
      />
    </div>
  );
}
