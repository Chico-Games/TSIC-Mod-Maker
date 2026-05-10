import { useMemo, useState } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { useDefinitionsStore } from '../store/definitionsStore';
import type { DefinitionsKey } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { RecipeCard } from './RecipeCard';
import { ItemPalette } from './ItemPalette';
import { HighlightedText } from './HighlightedText';

type StationGroup = 'crafting' | 'production' | 'plantable';

const STATION_FOLDERS: Record<StationGroup, string[]> = {
  crafting: ['crafting_station_definitions'],
  production: ['production_station_definitions'],
  plantable: ['plantable_definitions'],
};
const GROUP_LABEL: Record<StationGroup, string> = {
  crafting: 'Crafting',
  production: 'Production',
  plantable: 'Plantable',
};
const GROUP_EMOJI: Record<StationGroup, string> = {
  crafting: '🛠️',
  production: '🏭',
  plantable: '🌿',
};

interface StationRow {
  key: DefinitionsKey;
  id: string;
  folder: string;
  group: StationGroup;
  displayName: string;
  arrValue: string;
}

function readDisplayName(json: any): string {
  const dn = json?.properties?.display_name;
  if (dn && typeof dn === 'object' && typeof dn.value === 'string' && dn.value) return dn.value;
  return humanizeAssetId(String(json?.id ?? ''));
}

function readArrRef(json: any): string {
  const r = json?.properties?.available_recipe_rules_definition;
  return r && typeof r === 'object' ? String(r.value ?? '') : '';
}

export function StationsSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);

  const stations = useMemo<StationRow[]>(() => {
    const out: StationRow[] = [];
    for (const [k, rec] of definitions) {
      let group: StationGroup | null = null;
      for (const [g, folders] of Object.entries(STATION_FOLDERS) as [StationGroup, string[]][]) {
        if (folders.includes(rec.folder)) { group = g; break; }
      }
      if (!group) continue;
      out.push({
        key: k,
        id: rec.id,
        folder: rec.folder,
        group,
        displayName: readDisplayName(rec.json),
        arrValue: readArrRef(rec.json),
      });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  }, [definitions]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return stations;
    return stations.filter((s) =>
      s.id.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q),
    );
  }, [stations, filter]);

  const grouped = useMemo(() => {
    const g: Record<StationGroup, StationRow[]> = { crafting: [], production: [], plantable: [] };
    for (const s of filtered) g[s.group].push(s);
    return g;
  }, [filtered]);

  // Default-select first station the first render of each load.
  if (selectedKey == null && stations.length > 0) {
    setSelectedKey(stations[0].key);
  }

  const selectedStation = selectedKey ? definitions.get(selectedKey) : null;
  const selectedRow = selectedKey ? stations.find((s) => s.key === selectedKey) ?? null : null;
  const selectedArrKey = selectedRow?.arrValue ? findKeyById(selectedRow.arrValue) : null;
  const selectedArr = selectedArrKey ? definitions.get(selectedArrKey) : null;

  type RecipeRef = { class: string; value: string };
  const recipeRefs = useMemo<RecipeRef[]>(() => {
    if (!selectedArr) return [];
    const arr: any = selectedArr.json?.properties?.production_machine_rules?.value?.recipes;
    if (!arr || arr.type !== 'array' || !Array.isArray(arr.value)) return [];
    return (arr.value as any[])
      .filter((e: any) => e && typeof e === 'object' && e.type === 'definition_ref')
      .map((e: any) => ({ class: String(e.class ?? ''), value: String(e.value ?? '') }));
  }, [selectedArr]);

  type ResolvedRecipeRef = { class: string; value: string; key: DefinitionsKey };
  const recipeKeys = useMemo<ResolvedRecipeRef[]>(() => {
    return recipeRefs
      .map((r) => ({ ...r, key: findKeyById(r.value) }))
      .filter((r): r is ResolvedRecipeRef => !!r.key);
  }, [recipeRefs, findKeyById]);

  /** When the user clicks +New recipe: pick a class based on station group,
   *  create the asset, append to ARR. */
  const onNewRecipe = () => {
    if (!selectedRow || !selectedArr || !selectedArrKey) return;
    const recipeClass =
      selectedRow.group === 'plantable' ? 'PlantRecipeDefinition' : 'CraftRecipeDefinition';
    // Build a fresh id by stem.
    const baseStem = humanizeAssetId(selectedRow.id).replace(/\s+/g, '');
    let stem = `New${baseStem}Recipe`;
    let n = 1;
    while (findKeyById(`RD_${stem}_CR`) || findKeyById(`RD_${stem}_PL`)) {
      stem = `New${baseStem}Recipe${++n}`;
    }
    const tag = recipeClass === 'PlantRecipeDefinition' ? 'PL' : 'CR';
    const id = `RD_${stem}_${tag}`;
    const newKey = createDefinitionForClass(recipeClass, id);
    if (!newKey) return;
    // Append the ref to ARR.
    const path = ['properties', 'production_machine_rules', 'value', 'recipes'];
    const cur: any = selectedArr.json?.properties?.production_machine_rules?.value?.recipes;
    let nextArray: any;
    if (cur && cur.type === 'array') {
      const list = Array.isArray(cur.value) ? cur.value.slice() : [];
      list.push({ type: 'definition_ref', class: recipeClass, value: id });
      nextArray = { ...cur, value: list };
    } else {
      nextArray = {
        type: 'array',
        element_type: { type: 'definition_ref', class: recipeClass },
        value: [{ type: 'definition_ref', class: recipeClass, value: id }],
      };
    }
    updateValueAtPath(selectedArrKey, path, nextArray);
  };

  return (
    <div className="stations-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Stations</h3>
          <input
            type="text"
            value={filter}
            placeholder="search…"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="rail-body">
          {(Object.keys(grouped) as StationGroup[]).map((g) => (
            <div key={g} className="rail-group">
              <div className="rail-group-header">
                <span aria-hidden>{GROUP_EMOJI[g]}</span> {GROUP_LABEL[g]} <span className="muted">({grouped[g].length})</span>
              </div>
              {grouped[g].map((s) => (
                <StationRailRow
                  key={s.key}
                  row={s}
                  selected={selectedKey === s.key}
                  onSelect={() => setSelectedKey(s.key)}
                  highlight={filter}
                />
              ))}
            </div>
          ))}
          {stations.length === 0 && (
            <div className="empty-state-mini">No stations loaded.</div>
          )}
        </div>
      </aside>

      <section className="recipes-pane">
        {selectedStation && selectedRow ? (
          <>
            <header className="station-header">
              <div className="station-title">
                <span aria-hidden>{GROUP_EMOJI[selectedRow.group]}</span>
                <h2>{selectedRow.displayName}</h2>
                <span className="cls">{String(selectedStation.json?.class ?? '').replace(/^U/, '')}</span>
              </div>
              <div className="station-sub">
                <span className="muted">id:</span> <code>{selectedRow.id}</code>
                {' · '}
                <span className="muted">ARR:</span> {selectedRow.arrValue ? <code>{selectedRow.arrValue}</code> : <em>none</em>}
              </div>
            </header>
            {selectedArr ? (
              <div className="recipe-stack">
                {recipeKeys.map((r) => (
                  <RecipeCard key={r.key} recipeKey={r.key} arrKey={selectedArrKey!} />
                ))}
                {recipeKeys.length === 0 && (
                  <div className="empty-state-mini">No recipes in this ARR yet.</div>
                )}
                <div className="recipe-stack-footer">
                  <button onClick={onNewRecipe}>＋ New recipe</button>
                </div>
              </div>
            ) : (
              <div className="empty-state-mini">
                This station has no <code>available_recipe_rules_definition</code> set, or it does not resolve.
              </div>
            )}
          </>
        ) : (
          <div className="empty-state-mini">Pick a station from the rail.</div>
        )}
      </section>

      <ItemPalette />
    </div>
  );
}

function StationRailRow({ row, selected, onSelect, highlight }: { row: StationRow; selected: boolean; onSelect: () => void; highlight: string }) {
  const dndCtx = useDndContext();
  const activeType = (dndCtx.active?.data?.current as any)?.type;
  // Only recipe cards can drop on a station row — block other drags from
  // accidentally landing here.
  const { setNodeRef, isOver } = useDroppable({
    id: `station-row:${row.key}`,
    data: { type: 'station-row', stationKey: row.key } as any,
    disabled: activeType !== 'recipe-card',
  });
  const theme = getFolderTheme(row.folder);
  return (
    <button
      ref={setNodeRef}
      className={`rail-row ${selected ? 'selected' : ''} ${isOver ? 'over' : ''}`}
      onClick={onSelect}
      style={{ borderLeft: `3px solid ${theme.color}` }}
    >
      <span className="emoji" aria-hidden>{theme.emoji}</span>
      <span className="label"><HighlightedText text={row.displayName} query={highlight} /></span>
    </button>
  );
}
