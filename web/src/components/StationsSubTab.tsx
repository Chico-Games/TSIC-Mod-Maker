import { useEffect, useMemo, useState } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { useDefinitionsStore } from '../store/definitionsStore';
import type { DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { RecipeCard } from './RecipeCard';
import { ItemPalette } from './ItemPalette';
import { HighlightedText } from './HighlightedText';
import { fuzzyRankMulti } from '../search/fuzzy';
import { useJumpToDefinition } from './useJumpToDefinition';
import { UpgradeRecipeSection } from './UpgradeRecipeSection';

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
  /** How many recipes this station's ARR resolves. Pre-computed so the
   *  rail row can display the count without re-walking the store. */
  recipeCount: number;
  /** Family key — stations sharing this key (different tiers of the
   *  same item) collapse into one rail entry with quick-swap pills. */
  familyKey: string;
  /** Tier extracted from the id's `Tier\d+` segment; 0 when the id
   *  has no explicit tier. */
  tier: number;
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

/** Strip the trailing `_XX` exporter tag and any inline `Tier\d+`
 *  segment so two stations that only differ by tier hash to the same
 *  key. The result is purely advisory — used to group rail entries. */
function familyKey(id: string): string {
  const noTag = id.replace(/_[A-Z]{2,3}$/, '');
  const noTier = noTag.replace(/Tier\d+/g, '');
  return noTier;
}

function tierFromId(id: string): number {
  const m = id.match(/Tier(\d+)/);
  return m ? Number(m[1]) : 0;
}

function familyDisplayName(rows: StationRow[]): string {
  // Use the lowest-tier station's display name with the "Tier N" trail
  // stripped. Falls back to humanizing the family key.
  const base = rows[0];
  const cleaned = base.displayName.replace(/\s*Tier\s*\d+/i, '').trim();
  return cleaned || humanizeAssetId(base.familyKey);
}

export function StationsSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);

  const [filter, setFilter] = useState('');
  const selectedKey = useAppStore((s) => s.selectedStationKey);
  const setSelectedKey = useAppStore((s) => s.selectStation);
  const selectedRecipeKey = useAppStore((s) => s.selectedRecipeKey);
  const selectRecipe = useAppStore((s) => s.selectRecipe);

  const stations = useMemo<StationRow[]>(() => {
    const out: StationRow[] = [];
    for (const [k, rec] of definitions) {
      let group: StationGroup | null = null;
      for (const [g, folders] of Object.entries(STATION_FOLDERS) as [StationGroup, string[]][]) {
        if (folders.includes(rec.folder)) { group = g; break; }
      }
      if (!group) continue;
      const arrValue = readArrRef(rec.json);
      let recipeCount = 0;
      if (arrValue) {
        const arrK = findKeyById(arrValue);
        if (arrK) {
          const arrRec = definitions.get(arrK);
          const arr: any = arrRec?.json?.properties?.production_machine_rules?.value?.recipes;
          if (arr?.type === 'array' && Array.isArray(arr.value)) recipeCount = arr.value.length;
        }
      }
      out.push({
        key: k,
        id: rec.id,
        folder: rec.folder,
        group,
        displayName: readDisplayName(rec.json),
        arrValue,
        recipeCount,
        familyKey: familyKey(rec.id),
        tier: tierFromId(rec.id),
      });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  }, [definitions, findKeyById]);

  type RankedRow = { row: StationRow; ranges: ReadonlyArray<readonly [number, number]> };
  const filtered = useMemo<RankedRow[]>(() => {
    const ranked = fuzzyRankMulti(stations, filter, (s) => [s.displayName, s.id]);
    return ranked.map((r) => ({ row: r.item, ranges: r.ranges }));
  }, [stations, filter]);

  /** Within each station-type, collect tier-related entries into
   *  families so the rail collapses "Tier 1/2/3" into one selectable
   *  group with quick-swap pills. Single-member families render as a
   *  plain row. Sort families by best-match score (rank order) within
   *  the group so search results stay near the top. */
  type RankedFamily = {
    familyKey: string;
    members: RankedRow[];
    bestRank: number; // index in `filtered` of the best member
  };
  const families = useMemo(() => {
    const byGroup: Record<StationGroup, RankedFamily[]> = { crafting: [], production: [], plantable: [] };
    const byKey = new Map<string, RankedFamily>();
    filtered.forEach((r, idx) => {
      const compositeKey = `${r.row.group}::${r.row.familyKey}`;
      let fam = byKey.get(compositeKey);
      if (!fam) {
        fam = { familyKey: r.row.familyKey, members: [], bestRank: idx };
        byKey.set(compositeKey, fam);
        byGroup[r.row.group].push(fam);
      }
      fam.members.push(r);
    });
    // Sort each family's members by tier ascending (no-tier last).
    for (const list of Object.values(byGroup)) {
      list.sort((a, b) => a.bestRank - b.bestRank);
      for (const fam of list) {
        fam.members.sort((a, b) => {
          const at = a.row.tier || 99;
          const bt = b.row.tier || 99;
          if (at !== bt) return at - bt;
          return a.row.displayName.localeCompare(b.row.displayName);
        });
      }
    }
    return byGroup;
  }, [filtered]);

  // Default-select the first station the first time this tab mounts
  // with data loaded. Skipped if the user already picked one.
  useEffect(() => {
    if (selectedKey == null && stations.length > 0) {
      setSelectedKey(stations[0].key);
    }
  }, [selectedKey, stations, setSelectedKey]);

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

  /** + New station of the given group. Mints a fresh
   *  {Crafting,Production,Plantable}Station and an empty ARR for it,
   *  links the two, then selects the new station. */
  const onNewStation = (group: StationGroup) => {
    const cls =
      group === 'crafting' ? 'CraftingStationDefinition' :
      group === 'production' ? 'ProductionStationDefinition' :
      'PlantableDefinition';
    const tag =
      group === 'crafting' ? 'CS' :
      group === 'production' ? 'PS' :
      'PL';
    let stem = `New${cls.replace(/Definition$/, '')}`;
    let n = 1;
    while (findKeyById(`FD_${stem}_${tag}`)) stem = `New${cls.replace(/Definition$/, '')}${++n}`;
    const stationId = `FD_${stem}_${tag}`;
    const stationKey = createDefinitionForClass(cls, stationId);
    if (!stationKey) return;
    // Mint an empty ARR and point the station at it.
    const arrId = `ARR_${stem}`;
    const arrKey = createDefinitionForClass('AvailableRecipeRulesDefinition', arrId);
    if (arrKey) {
      const recipeRefClass = group === 'plantable' ? 'PlantRecipeDefinition' : 'CraftRecipeDefinition';
      updateValueAtPath(arrKey, ['properties', 'production_machine_rules'], {
        type: 'struct',
        struct_name: 'ProductionMachineRules',
        value: {
          recipes: { type: 'array', element_type: { type: 'definition_ref', class: recipeRefClass }, value: [] },
        },
      });
    }
    updateValueAtPath(stationKey, ['properties', 'available_recipe_rules_definition'], {
      type: 'definition_ref',
      class: 'AvailableRecipeRulesDefinition',
      value: arrId,
    });
    setSelectedKey(stationKey);
  };

  /** + Tier — mint the next tier of an existing family by cloning the
   *  highest-tier station's id and bumping the number. Always creates
   *  a fresh ARR linked to it. */
  const onNewTier = (family: typeof families.crafting[number]) => {
    if (family.members.length === 0) return;
    const top = family.members[family.members.length - 1].row;
    const nextTier = (top.tier || 0) + 1;
    // Build new id: replace TierN with Tier(N+1) or append TierN
    // when the source had no tier marker.
    let newId = top.id;
    if (/Tier\d+/.test(newId)) {
      newId = newId.replace(/Tier\d+/, `Tier${nextTier}`);
    } else {
      const m = newId.match(/^(.+?)(_[A-Z]{2,3})$/);
      newId = m ? `${m[1]}Tier${nextTier}${m[2]}` : `${newId}Tier${nextTier}`;
    }
    if (findKeyById(newId)) return;
    const cls = String(definitions.get(top.key)?.json?.class ?? '').replace(/^U/, '');
    const stationKey = createDefinitionForClass(cls, newId);
    if (!stationKey) return;
    const arrId = `ARR_${newId.replace(/^FD_/, '').replace(/_[A-Z]{2,3}$/, '')}`;
    const arrKey = createDefinitionForClass('AvailableRecipeRulesDefinition', arrId);
    if (arrKey) {
      const recipeRefClass = top.group === 'plantable' ? 'PlantRecipeDefinition' : 'CraftRecipeDefinition';
      updateValueAtPath(arrKey, ['properties', 'production_machine_rules'], {
        type: 'struct',
        struct_name: 'ProductionMachineRules',
        value: {
          recipes: { type: 'array', element_type: { type: 'definition_ref', class: recipeRefClass }, value: [] },
        },
      });
    }
    updateValueAtPath(stationKey, ['properties', 'available_recipe_rules_definition'], {
      type: 'definition_ref',
      class: 'AvailableRecipeRulesDefinition',
      value: arrId,
    });
    setSelectedKey(stationKey);
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
          <div className="rail-add-row">
            <button className="add-row" onClick={() => onNewStation('crafting')} title="New crafting station">＋ Crafting</button>
            <button className="add-row" onClick={() => onNewStation('production')} title="New production station">＋ Production</button>
            <button className="add-row" onClick={() => onNewStation('plantable')} title="New plantable station">＋ Plantable</button>
          </div>
        </div>
        <div className="rail-body">
          {(Object.keys(families) as StationGroup[]).map((g) => {
            const fams = families[g];
            const total = fams.reduce((n, f) => n + f.members.length, 0);
            if (total === 0) return null;
            return (
              <div key={g} className="rail-group">
                <div className="rail-group-header">
                  <span aria-hidden>{GROUP_EMOJI[g]}</span> {GROUP_LABEL[g]} <span className="muted">({total})</span>
                </div>
                {fams.map((fam) =>
                  fam.members.length === 1 ? (
                    <StationRailRow
                      key={fam.members[0].row.key}
                      row={fam.members[0].row}
                      ranges={fam.members[0].ranges}
                      selected={selectedKey === fam.members[0].row.key}
                      onSelect={() => setSelectedKey(fam.members[0].row.key)}
                    />
                  ) : (
                    <StationFamilyRow
                      key={fam.familyKey}
                      members={fam.members}
                      selectedKey={selectedKey}
                      onSelect={(k) => setSelectedKey(k)}
                      onAddTier={() => onNewTier(fam)}
                    />
                  ),
                )}
              </div>
            );
          })}
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
            <UpgradeRecipeSection
              hostKey={selectedRow.key}
              upgradedTargetClass={String(selectedStation.json?.class ?? '').replace(/^U/, '')}
            />
            {selectedArr ? (
              <div className="recipe-stack">
                {recipeKeys.map((r) => (
                  <RecipeCard
                    key={r.key}
                    recipeKey={r.key}
                    arrKey={selectedArrKey!}
                    selected={selectedRecipeKey === r.key}
                    onSelect={() => selectRecipe(selectedRecipeKey === r.key ? null : r.key)}
                  />
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

function StationRailRow({ row, selected, onSelect, ranges }: { row: StationRow; selected: boolean; onSelect: () => void; ranges: ReadonlyArray<readonly [number, number]> }) {
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
  const jumpToDef = useJumpToDefinition();
  return (
    <button
      ref={setNodeRef}
      className={`rail-row ${selected ? 'selected' : ''} ${isOver ? 'over' : ''}`}
      onClick={onSelect}
      style={{ borderLeft: `3px solid ${theme.color}` }}
      title={`${row.displayName} (${row.id})\nMiddle-click to open in Definitions`}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(row.id); } }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
    >
      <span className="emoji" aria-hidden>{theme.emoji}</span>
      <span className="label"><HighlightedText text={row.displayName} ranges={ranges} /></span>
      {row.recipeCount > 0 && (
        <span className="rail-count" title={`${row.recipeCount} recipe${row.recipeCount === 1 ? '' : 's'}`}>{row.recipeCount}</span>
      )}
    </button>
  );
}

/** Quick-swap row: stations sharing a family key (e.g. tier variants
 *  of the same bench) collapse into one entry with tier pills. The
 *  member whose row is currently selected highlights, and clicking a
 *  different pill swaps the selection without changing the rail's
 *  scroll position. */
function StationFamilyRow({
  members,
  selectedKey,
  onSelect,
  onAddTier,
}: {
  members: Array<{ row: StationRow; ranges: ReadonlyArray<readonly [number, number]> }>;
  selectedKey: DefinitionsKey | null;
  onSelect: (k: DefinitionsKey) => void;
  onAddTier?: () => void;
}) {
  const theme = getFolderTheme(members[0].row.folder);
  const familyName = familyDisplayName(members.map((m) => m.row));
  const selectedMember = members.find((m) => m.row.key === selectedKey);
  const familySelected = !!selectedMember;
  const totalRecipes = members.reduce((n, m) => n + m.row.recipeCount, 0);
  return (
    <div
      className={`rail-family ${familySelected ? 'selected' : ''}`}
      style={{ borderLeft: `3px solid ${theme.color}` }}
    >
      <button
        className="rail-family-head"
        onClick={() => onSelect(selectedMember?.row.key ?? members[0].row.key)}
        title={members.map((m) => m.row.displayName).join(' · ')}
      >
        <span className="emoji" aria-hidden>{theme.emoji}</span>
        <span className="label">
          <HighlightedText text={familyName} ranges={selectedMember?.ranges ?? members[0].ranges} />
        </span>
        {totalRecipes > 0 && <span className="rail-count">{totalRecipes}</span>}
      </button>
      <div className="rail-family-tiers">
        {members.map((m) => {
          const tier = m.row.tier;
          const label = tier > 0 ? `T${tier}` : 'base';
          const isSel = selectedKey === m.row.key;
          return (
            <button
              key={m.row.key}
              className={`tier-pill ${isSel ? 'selected' : ''}`}
              onClick={() => onSelect(m.row.key)}
              title={`${m.row.displayName} · ${m.row.recipeCount} recipe${m.row.recipeCount === 1 ? '' : 's'}`}
            >
              {label}
              {m.row.recipeCount > 0 && <span className="tier-pill-count">{m.row.recipeCount}</span>}
            </button>
          );
        })}
        {onAddTier && (
          <button className="tier-pill tier-pill-add" onClick={onAddTier} title="Mint the next tier">＋</button>
        )}
      </div>
    </div>
  );
}
