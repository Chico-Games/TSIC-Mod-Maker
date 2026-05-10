import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { humanizeAssetId } from './definitionsNaming';
import { getFolderTheme } from './folderTheme';
import { DefRefSlot } from './DefRefSlot';
import { ItemPalette } from './ItemPalette';
import { HighlightedText } from './HighlightedText';
import { fuzzyRankMulti, type RankedHit } from '../search/fuzzy';
import { useJumpToDefinition } from './useJumpToDefinition';
import { UpgradeRecipeSection } from './UpgradeRecipeSection';
import { buildUpgradeChains, familyKey as nameFamilyKey } from '../upgradeChains';
import { AssetTitle } from './AssetTitle';
import { inferAcceptedFolders } from '../inferFolders';

const FURNITURE_FOLDER = 'damageable_furniture_definitions';

interface FurnitureRow {
  key: DefinitionsKey;
  id: string;
  displayName: string;
  /** Chain id (or name family fallback) — multi-member groups render
   *  as a quick-swap pill family. */
  familyKey: string;
  /** Position within the chain (1 = root). 0 when not part of any chain. */
  tier: number;
}

function readDisplayName(json: any): string {
  const dn = json?.properties?.display_name;
  if (dn && typeof dn === 'object' && typeof dn.value === 'string' && dn.value) return dn.value;
  return humanizeAssetId(String(json?.id ?? ''));
}

function familyDisplayName(rows: FurnitureRow[]): string {
  const base = rows[0];
  const cleaned = base.displayName.replace(/\s*Tier\s*\d+/i, '').trim();
  return cleaned || humanizeAssetId(base.familyKey);
}

export function FurnitureSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const deleteDefinition = useDefinitionsStore((s) => s.deleteDefinition);
  const classNodes = useDefinitionsStore((s) => s.classNodes);
  const jumpToDef = useJumpToDefinition();

  const chainIndex = useMemo(() => buildUpgradeChains(definitions, (rec) => rec.folder === FURNITURE_FOLDER), [definitions]);

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);

  const rows = useMemo<FurnitureRow[]>(() => {
    const out: FurnitureRow[] = [];
    for (const [k, rec] of definitions) {
      if (rec.folder !== FURNITURE_FOLDER) continue;
      const chainId = chainIndex.byId.get(rec.id);
      const chain = chainId ? chainIndex.chains.get(chainId) ?? [] : [];
      const tier = chain.find((m) => m.id === rec.id)?.tier ?? 0;
      out.push({
        key: k,
        id: rec.id,
        displayName: readDisplayName(rec.json),
        familyKey: chainId ?? nameFamilyKey(rec.id),
        tier,
      });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  }, [definitions, chainIndex]);

  const filtered = useMemo<RankedHit<FurnitureRow>[]>(() => {
    return fuzzyRankMulti(rows, filter, (r) => [r.displayName, r.id]);
  }, [rows, filter]);

  /** Group ranked rows by familyKey so chains render as a single
   *  rail entry with quick-swap tier pills, like the Stations rail. */
  type RankedFamily = {
    familyKey: string;
    members: RankedHit<FurnitureRow>[];
    bestRank: number;
  };
  const families = useMemo<RankedFamily[]>(() => {
    const byKey = new Map<string, RankedFamily>();
    const list: RankedFamily[] = [];
    filtered.forEach((h, idx) => {
      let fam = byKey.get(h.item.familyKey);
      if (!fam) {
        fam = { familyKey: h.item.familyKey, members: [], bestRank: idx };
        byKey.set(h.item.familyKey, fam);
        list.push(fam);
      }
      fam.members.push(h);
    });
    list.sort((a, b) => a.bestRank - b.bestRank);
    for (const fam of list) {
      fam.members.sort((a, b) => {
        const at = a.item.tier || 99;
        const bt = b.item.tier || 99;
        if (at !== bt) return at - bt;
        return a.item.displayName.localeCompare(b.item.displayName);
      });
    }
    return list;
  }, [filtered]);

  if (selectedKey == null && rows.length > 0) setSelectedKey(rows[0].key);

  const selected = selectedKey ? definitions.get(selectedKey) : null;

  const paletteAutoFolders = useMemo<Set<string> | null>(() => {
    if (!selected) return null;
    return inferAcceptedFolders(selected, { records: definitions, findKeyById, classNodes });
  }, [definitions, findKeyById, classNodes, selected]);
  const props: any = selected?.json?.properties ?? {};
  const lootArrayEnvelope: any = props.loot_dropped_on_death;
  const lootEntries: any[] = lootArrayEnvelope?.type === 'array' && Array.isArray(lootArrayEnvelope.value)
    ? lootArrayEnvelope.value : [];

  /** + Tier — mint a new furniture and link it to `top` via a fresh
   *  upgrade recipe. The chain index picks up the link on the next
   *  render so the new tier appears in the rail's family pills. */
  const onNewFurnitureTier = (top: FurnitureRow) => {
    const nextTier = (top.tier || 0) + 1;
    let newId = top.id;
    if (/Tier\d+/.test(newId)) {
      newId = newId.replace(/Tier\d+/, `Tier${nextTier}`);
    } else {
      const m = newId.match(/^(.+?)(_[A-Z]{2,3})$/);
      newId = m ? `${m[1]}Tier${nextTier}${m[2]}` : `${newId}Tier${nextTier}`;
    }
    if (findKeyById(newId)) return;
    const newKey = createDefinitionForClass('DamageableFurnitureDefinition', newId);
    if (!newKey) return;
    const upgradeRecipeId = `RD_${newId.replace(/^FD_/, '').replace(/_[A-Z]{2,3}$/, '')}_CN`;
    const upgradeKey = createDefinitionForClass('FurnitureUpgradeRecipe', upgradeRecipeId);
    if (upgradeKey) {
      updateValueAtPath(upgradeKey, ['properties', 'upgraded_furniture_definition'], {
        type: 'definition_ref',
        class: 'DamageableFurnitureDefinition',
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
    setSelectedKey(newKey);
  };

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
        {families.length === 0 ? (
          <div className="empty-state-mini">No furniture loaded.</div>
        ) : (
          <div className="rail-body">
            {families.map((fam) =>
              fam.members.length === 1 ? (
                <FurnitureRailRow
                  key={fam.members[0].item.key}
                  hit={fam.members[0]}
                  selected={selectedKey === fam.members[0].item.key}
                  onSelect={() => setSelectedKey(fam.members[0].item.key)}
                />
              ) : (
                <FurnitureFamilyRow
                  key={fam.familyKey}
                  members={fam.members}
                  selectedKey={selectedKey}
                  onSelect={(k) => setSelectedKey(k)}
                  onAddTier={() => onNewFurnitureTier(fam.members[fam.members.length - 1].item)}
                  onDeleteTier={(k) => void deleteDefinition(k)}
                />
              ),
            )}
          </div>
        )}
      </aside>

      <section className="furniture-pane">
        {selected && selectedKey ? (
          <>
            <header className="station-header">
              <div className="station-title">
                <span aria-hidden>🪑</span>
                <AssetTitle
                  assetKey={selectedKey}
                  onRenamed={(newKey) => setSelectedKey(newKey)}
                />
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
            <div className="upgrade-tier-action">
              <button onClick={() => {
                const row = rows.find((r) => r.key === selectedKey);
                if (row) onNewFurnitureTier(row);
              }}>
                ＋ Add upgrade tier (mints next furniture + linking recipe)
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state-mini">Pick a furniture from the rail.</div>
        )}
      </section>

      <ItemPalette
        folders={['loot_definitions', 'damageable_furniture_definitions', 'crafting_material_definitions']}
        title="Drop targets"
        autoFolders={paletteAutoFolders}
      />
    </div>
  );
}

function FurnitureRailRow({
  hit,
  selected,
  onSelect,
}: {
  hit: RankedHit<FurnitureRow>;
  selected: boolean;
  onSelect: () => void;
}) {
  const jumpToDef = useJumpToDefinition();
  return (
    <button
      className={`rail-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      style={{ borderLeft: `3px solid ${getFolderTheme(FURNITURE_FOLDER).color}` }}
      title={`${hit.item.displayName} (${hit.item.id})\nMiddle-click to open in Definitions`}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(hit.item.id); } }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
    >
      <span className="emoji" aria-hidden>🪑</span>
      <span className="label"><HighlightedText text={hit.item.displayName} ranges={hit.ranges} /></span>
    </button>
  );
}

function FurnitureFamilyRow({
  members,
  selectedKey,
  onSelect,
  onAddTier,
  onDeleteTier,
}: {
  members: RankedHit<FurnitureRow>[];
  selectedKey: DefinitionsKey | null;
  onSelect: (k: DefinitionsKey) => void;
  onAddTier: () => void;
  onDeleteTier: (k: DefinitionsKey) => void;
}) {
  const theme = getFolderTheme(FURNITURE_FOLDER);
  const selectedMember = members.find((m) => m.item.key === selectedKey);
  const familySelected = !!selectedMember;
  const familyName = familyDisplayName(members.map((m) => m.item));
  const jumpToDef = useJumpToDefinition();
  return (
    <div
      className={`rail-family ${familySelected ? 'selected' : ''}`}
      style={{ borderLeft: `3px solid ${theme.color}` }}
    >
      <button
        className="rail-family-head"
        onClick={() => onSelect(selectedMember?.item.key ?? members[0].item.key)}
        title={members.map((m) => m.item.displayName).join(' · ')}
      >
        <span className="emoji" aria-hidden>🪑</span>
        <span className="label">
          <HighlightedText text={familyName} ranges={selectedMember?.ranges ?? members[0].ranges} />
        </span>
      </button>
      <div className="rail-family-tiers">
        {members.map((m) => {
          const tier = m.item.tier;
          const label = tier > 0 ? `T${tier}` : 'base';
          const isSel = selectedKey === m.item.key;
          return (
            <span key={m.item.key} className={`tier-pill-wrap ${isSel ? 'selected' : ''}`}>
              <button
                className={`tier-pill ${isSel ? 'selected' : ''}`}
                onClick={() => onSelect(m.item.key)}
                title={`${m.item.displayName}\nMiddle-click to open in Definitions`}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(m.item.id); } }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              >
                {label}
              </button>
              <button
                className="tier-pill-x"
                title={`Delete ${m.item.displayName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!confirm(`Delete ${m.item.displayName} (${m.item.id})?`)) return;
                  onDeleteTier(m.item.key);
                }}
              >×</button>
            </span>
          );
        })}
        <button className="tier-pill tier-pill-add" onClick={onAddTier} title="Mint the next tier">＋</button>
      </div>
    </div>
  );
}
