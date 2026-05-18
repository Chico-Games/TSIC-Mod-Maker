import { useEffect, useMemo, useRef, useState } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { useDefinitionsStore } from '../store/definitionsStore';
import type { DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { useAppSchemaStore } from '../store/appSchemaStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { RecipeCard } from './RecipeCard';
import { ItemPalette } from './ItemPalette';
import { HighlightedText } from './HighlightedText';
import { useHybridSearch } from '../search/hybrid';
import { useJumpToDefinition } from './useJumpToDefinition';
import { UpgradeRecipeSection } from './UpgradeRecipeSection';
import { buildUpgradeChains, familyKey as nameFamilyKey } from '../upgradeChains';
import { AssetTitle } from './AssetTitle';
import { AddPicker } from './AddPicker';
import { SearchBox } from './SearchBox';
import { inferAcceptedFolders } from '../inferFolders';

type StationGroup = 'crafting' | 'production' | 'shop' | 'plantable';

const STATION_FOLDERS: Record<StationGroup, string[]> = {
  crafting: ['crafting_station_definitions'],
  production: ['production_station_definitions'],
  shop: ['shop_definitions'],
  plantable: ['plantable_definitions'],
};
const GROUP_LABEL: Record<StationGroup, string> = {
  crafting: 'Crafting',
  production: 'Production',
  shop: 'Shops',
  plantable: 'Plantable',
};
const GROUP_EMOJI: Record<StationGroup, string> = {
  crafting: '🛠️',
  production: '🏭',
  shop: '🏪',
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
  const deleteDefinition = useDefinitionsStore((s) => s.deleteDefinition);
  const classNodes = useAppSchemaStore((s) => s.classNodes);

  const [filter, setFilter] = useState('');
  const selectedKey = useAppStore((s) => s.selectedStationKey);
  const setSelectedKey = useAppStore((s) => s.selectStation);
  const selectedRecipeKey = useAppStore((s) => s.selectedRecipeKey);
  const selectRecipe = useAppStore((s) => s.selectRecipe);

  // Phase 1: classify every loaded record as crafting / production /
  // plantable; Phase 2 below joins these with the upgrade-chain index
  // so tier numbers come from the chain rather than name regexes.
  const stationGroupOf = useMemo(() => {
    const m = new Map<string, StationGroup>();
    for (const [k, rec] of definitions) {
      for (const [g, folders] of Object.entries(STATION_FOLDERS) as [StationGroup, string[]][]) {
        if (folders.includes(rec.folder)) { m.set(k, g); break; }
      }
    }
    return m;
  }, [definitions]);

  const chainIndex = useMemo(() => {
    return buildUpgradeChains(definitions, (rec) => {
      for (const folders of Object.values(STATION_FOLDERS)) {
        if (folders.includes(rec.folder)) return true;
      }
      return false;
    });
  }, [definitions]);

  const stations = useMemo<StationRow[]>(() => {
    const out: StationRow[] = [];
    for (const [k, rec] of definitions) {
      const group = stationGroupOf.get(k);
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
      // Pull the family key + tier from the chain index when the
      // station is part of one. Falls back to a name-only key for
      // singletons (the chain index returns a single-member chain
      // for those, so this branch is mostly a safety net).
      const chainId = chainIndex.byId.get(rec.id);
      const chain = chainId ? chainIndex.chains.get(chainId) ?? [] : [];
      const tier = chain.find((m) => m.id === rec.id)?.tier ?? 0;
      out.push({
        key: k,
        id: rec.id,
        folder: rec.folder,
        group,
        displayName: readDisplayName(rec.json),
        arrValue,
        recipeCount,
        familyKey: chainId ?? nameFamilyKey(rec.id),
        tier,
      });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  }, [definitions, findKeyById, stationGroupOf, chainIndex]);

  type RankedRow = { row: StationRow; ranges: ReadonlyArray<readonly [number, number]> };
  const ranked = useHybridSearch(
    stations,
    filter,
    (s) => [s.displayName, s.id],
    { semanticKey: (s) => s.key },
  );
  const filtered = useMemo<RankedRow[]>(
    () => ranked.map((r) => ({ row: r.item, ranges: r.ranges })),
    [ranked],
  );

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
    const byGroup: Record<StationGroup, RankedFamily[]> = { crafting: [], production: [], shop: [], plantable: [] };
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

  // Auto-create the missing ARR when a station is selected without
  // one. Removes the dead-end empty state — the user lands on a
  // working recipe stack regardless of how the station was authored.
  // Only fires once per (station, missing) — the asset is minted,
  // the station's `available_recipe_rules_definition` ref is set,
  // and the chain index resolves on the next render.
  const lastAutoArrFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedKey) return;
    const row = stations.find((s) => s.key === selectedKey);
    if (!row) return;
    const arrKey = row.arrValue ? findKeyById(row.arrValue) : null;
    const arrLoaded = arrKey ? !!definitions.get(arrKey) : false;
    if (arrLoaded) return;
    if (lastAutoArrFor.current === selectedKey) return;
    lastAutoArrFor.current = selectedKey;
    createArrForStation(selectedKey, row.group);
    // The toast emitted by createDefinitionForClass keeps the user
    // informed that a fresh ARR was minted.
  }, [selectedKey, stations, findKeyById, definitions]);

  const selectedStation = selectedKey ? definitions.get(selectedKey) : null;
  const selectedRow = selectedKey ? stations.find((s) => s.key === selectedKey) ?? null : null;
  const selectedArrKey = selectedRow?.arrValue ? findKeyById(selectedRow.arrValue) : null;
  const selectedArr = selectedArrKey ? definitions.get(selectedArrKey) : null;

  /** Auto-filter the items palette by the classes referenced by the
   *  selected recipe. With ONLY a station selected the palette stays
   *  on its prop defaults — restricting to ARR/recipe classes alone
   *  would hide every material the user wants to drag into recipes,
   *  which is the whole point of the palette. */
  const paletteAutoFolders = useMemo<Set<string> | null>(() => {
    if (!selectedRecipeKey) return null;
    const recipeRec = definitions.get(selectedRecipeKey);
    if (!recipeRec) return null;
    return inferAcceptedFolders(recipeRec, { records: definitions, findKeyById, classNodes });
  }, [definitions, findKeyById, classNodes, selectedRecipeKey]);

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

  /** Mint an empty ARR for an existing station and wire the station's
   *  `available_recipe_rules_definition` ref. Used both by + New
   *  station (which mints both at once) and by the "+ Create empty
   *  ARR" affordance shown when a station has no ARR set. */
  const createArrForStation = (stationKey: DefinitionsKey, group: StationGroup) => {
    const station = definitions.get(stationKey);
    if (!station) return null;
    const stem = station.id.replace(/^FD_/, '').replace(/_[A-Z]{2,3}$/, '');
    let arrId = `ARR_${stem}`;
    let n = 2;
    while (findKeyById(arrId)) arrId = `ARR_${stem}${n++}`;
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
    return arrKey;
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
    createArrForStation(stationKey, group);
    setSelectedKey(stationKey);
  };

  /** + Add upgrade tier on `top`. Mints a new station that follows
   *  `top` in the upgrade chain, plus a fresh
   *  UFurnitureUpgradeRecipe that links them. Works on a singleton
   *  (turning it into a 2-member chain) and on the top of an
   *  existing family. */
  const onAddUpgradeTier = (top: StationRow) => {
    const nextTier = (top.tier || 1) + (top.tier > 0 ? 1 : 1);
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
    createArrForStation(stationKey, top.group);
    // Wire the upgrade chain: mint an upgrade recipe that links the
    // previous tier to the new one.
    const upgradeRecipeId = `RD_${newId.replace(/^FD_/, '').replace(/_[A-Z]{2,3}$/, '')}_CN`;
    const upgradeKey = createDefinitionForClass('FurnitureUpgradeRecipe', upgradeRecipeId);
    if (upgradeKey) {
      updateValueAtPath(upgradeKey, ['properties', 'upgraded_furniture_definition'], {
        type: 'definition_ref',
        class: cls,
        value: newId,
      });
      updateValueAtPath(upgradeKey, ['properties', 'upgrade_tier'], {
        type: 'int',
        value: nextTier,
      });
    }
    updateValueAtPath(top.key, ['properties', 'upgrade_recipe'], {
      type: 'definition_ref',
      class: 'FurnitureUpgradeRecipe',
      value: upgradeRecipeId,
    });
    setSelectedKey(stationKey);
  };

  /** Wraps onAddUpgradeTier for the family-row "+ Tier" pill. */
  const onNewTier = (family: typeof families.crafting[number]) => {
    if (family.members.length === 0) return;
    onAddUpgradeTier(family.members[family.members.length - 1].row);
  };

  return (
    <div className="stations-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Stations</h3>
          <SearchBox value={filter} onChange={setFilter} placeholder="search…" />
          <div className="rail-add-row">
            <AddPicker
              label="＋ New station…"
              title="Mint a new station of any kind"
              options={[
                { value: 'crafting', label: 'Crafting station', emoji: GROUP_EMOJI.crafting, color: '#ff9b54', hint: 'UCraftingStationDefinition' },
                { value: 'production', label: 'Production station', emoji: GROUP_EMOJI.production, color: '#a78fff', hint: 'UProductionStationDefinition' },
                { value: 'plantable', label: 'Plantable station', emoji: GROUP_EMOJI.plantable, color: '#9adc7e', hint: 'UPlantableDefinition' },
              ]}
              onPick={(v) => onNewStation(v as StationGroup)}
            />
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
                {fams.map((fam) => (
                  <StationFamilyEntry
                    key={fam.familyKey}
                    members={fam.members}
                    selectedKey={selectedKey}
                    onSelect={(k) => setSelectedKey(k)}
                    onAddTier={() => onNewTier(fam)}
                    onDeleteTier={(k) => void deleteDefinition(k)}
                  />
                ))}
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
                <AssetTitle
                  assetKey={selectedRow.key}
                  onRenamed={(newKey) => setSelectedKey(newKey)}
                />
                <span className="cls">{String(selectedStation.json?.class ?? '').replace(/^U/, '')}</span>
                {(() => {
                  const cls = String(selectedStation?.json?.class ?? '');
                  const target = cls === 'UCraftingStationDefinition' ? 'crafting-stations'
                              : cls === 'UProductionStationDefinition' ? 'production-stations'
                              : cls === 'UPlantableDefinition' ? 'plantable'
                              : null;
                  if (!target) return null;
                  return (
                    <button className="cross-link" onClick={() => {
                      useAppStore.getState().setTab('furniture');
                      useAppStore.getState().setFurnitureSubTab(target as any);
                    }}>↗ Edit intrinsic</button>
                  );
                })()}
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
            <div className="upgrade-tier-action">
              <button onClick={() => onAddUpgradeTier(selectedRow)}>
                ＋ Add upgrade tier (mints next station + linking recipe)
              </button>
            </div>
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
              // The auto-create effect above mints an ARR for any
              // station that's missing one; this branch is only
              // reached for the brief render before the effect
              // commits, or in the unlikely case where the mint
              // failed (e.g. unknown class). Show a friendly hint
              // rather than a wall of text.
              <div className="empty-state-mini">Preparing recipe stack…</div>
            )}
          </>
        ) : (
          <div className="empty-state-mini">Pick a station from the rail.</div>
        )}
      </section>

      <ItemPalette autoFolders={paletteAutoFolders} />
    </div>
  );
}

/** Unified station rail entry. Top row is always the family/asset
 *  header with a folder emoji + label + an inline + button.
 *  Multi-member chains add a second-line tier-pill strip. The
 *  station-row drop target lives on the top row so recipe cards can
 *  still be dragged into any station (including singletons). */
function StationFamilyEntry({
  members,
  selectedKey,
  onSelect,
  onAddTier,
  onDeleteTier,
}: {
  members: Array<{ row: StationRow; ranges: ReadonlyArray<readonly [number, number]> }>;
  selectedKey: DefinitionsKey | null;
  onSelect: (k: DefinitionsKey) => void;
  onAddTier: () => void;
  onDeleteTier: (memberKey: DefinitionsKey) => void;
}) {
  const dndCtx = useDndContext();
  const activeType = (dndCtx.active?.data?.current as any)?.type;
  const isChain = members.length > 1;
  const selectedMember = members.find((m) => m.row.key === selectedKey);
  const familySelected = !!selectedMember;
  const headEntry = selectedMember ?? members[0];
  // The station-row drop target points at whichever station the head
  // row currently represents (selected member when one is set, else
  // first member). This keeps recipe-card drags pointing at the
  // correct ARR.
  const dropStationKey = headEntry.row.key;
  const { setNodeRef, isOver } = useDroppable({
    id: `station-row:${dropStationKey}`,
    data: { type: 'station-row', stationKey: dropStationKey } as any,
    disabled: activeType !== 'recipe-card',
  });
  const theme = getFolderTheme(members[0].row.folder);
  const totalRecipes = members.reduce((n, m) => n + m.row.recipeCount, 0);
  const familyName = isChain
    ? familyDisplayName(members.map((m) => m.row))
    : headEntry.row.displayName;
  const jumpToDef = useJumpToDefinition();
  return (
    <div
      ref={setNodeRef}
      className={`rail-family ${familySelected ? 'selected' : ''} ${isChain ? 'is-chain' : 'is-singleton'} ${isOver ? 'over' : ''}`}
      style={{ borderLeft: `3px solid ${theme.color}` }}
    >
      <div className="rail-family-headline">
        <button
          className={`rail-family-head ${familySelected ? 'selected' : ''}`}
          onClick={() => onSelect(headEntry.row.key)}
          title={`${headEntry.row.displayName} (${headEntry.row.id})\nMiddle-click to open in Definitions`}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(headEntry.row.id); } }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        >
          <span className="emoji" aria-hidden>{theme.emoji}</span>
          <span className="label">
            <HighlightedText text={familyName} ranges={headEntry.ranges} />
          </span>
          {totalRecipes > 0 && <span className="rail-count">{totalRecipes}</span>}
        </button>
        <button
          className="rail-inline-add"
          onClick={(e) => { e.stopPropagation(); onAddTier(); }}
          title="Add an upgraded tier (mints next station + linking recipe)"
        >＋</button>
      </div>
      {isChain && (
        <div className="rail-family-tiers">
          {members.map((m) => {
            const tier = m.row.tier;
            const label = tier > 0 ? `T${tier}` : 'base';
            const isSel = selectedKey === m.row.key;
            return (
              <span
                key={m.row.key}
                className={`tier-pill-wrap ${isSel ? 'selected' : ''}`}
              >
                <button
                  className={`tier-pill ${isSel ? 'selected' : ''}`}
                  onClick={() => onSelect(m.row.key)}
                  title={`${m.row.displayName} · ${m.row.recipeCount} recipe${m.row.recipeCount === 1 ? '' : 's'}\nMiddle-click to open in Definitions`}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(m.row.id); } }}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                >
                  {label}
                  {m.row.recipeCount > 0 && <span className="tier-pill-count">{m.row.recipeCount}</span>}
                </button>
                <button
                  className="tier-pill-x"
                  title={`Delete ${m.row.displayName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete ${m.row.displayName} (${m.row.id})?\nThe upgrade chain links pointing at it will be cleared on save.`)) return;
                    onDeleteTier(m.row.key);
                  }}
                >×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
