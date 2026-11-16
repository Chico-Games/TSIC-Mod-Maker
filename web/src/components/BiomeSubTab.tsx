import { useMemo, useState } from 'react';
import { useDefinitionsStore, type DefinitionRecord, type DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { TypedPropertiesEditor } from './TypedValueEditor';
import { useRefAdapter } from './useRefAdapter';
import { HighlightedText } from './HighlightedText';
import { useHybridSearch } from '../search/hybrid';
import { SearchBox } from './SearchBox';
import { useJumpToDefinition } from './useJumpToDefinition';
import { humanizeAssetId, humanizeProperty } from './definitionsNaming';
import { ItemIcon, presentedName } from './ItemIcon';
import { DIFFICULTY_LABEL, readWorldLoot } from './loot/lootModel';
import '../styles-loot.css';

// A biome is three things to a modder: how it looks on the map, how its maze
// is shaped, and what you find lying around in it. The first two are a handful
// of scalar properties; the third is up to three world-loot tables, one per
// place loot can appear. The generic property grid is used for the scalars
// only — a biome also carries a per-rotation colour table with several
// thousand entries that the grid would render in full (it used to: this tab
// took the better part of a minute to open).

const LSP_FOLDER = 'loot_spawn_point_definitions';
const BD_FOLDER = 'biome_definitions';

const LOOT_SLOTS = [
  { prop: 'floor_lsp', suffix: 'Floor', source: 'FLOOR', label: 'On the floor', hint: 'Loose items lying on the ground' },
  { prop: 'furniture_lsp', suffix: 'Furniture', source: 'FURNITURE', label: 'On furniture', hint: 'Items sitting on shelves, tables and counters' },
  { prop: 'container_loot_table', suffix: 'Container', source: 'CONTAINER', label: 'In containers', hint: 'What you find when you open a box, locker or drawer' },
] as const;
type Slot = (typeof LOOT_SLOTS)[number];

/** Properties too large to be worth drawing as a form. */
const HEAVY_CHARS = 6000;

const stemOf = (bdId: string) => bdId.replace(/^BD_/, '');

function colourOf(rec: DefinitionRecord | null | undefined): string | null {
  const c = rec?.json?.properties?.map_color?.value;
  const ch = (k: string) => {
    const v = c?.[k]?.value;
    return typeof v === 'number' ? Math.round(Math.max(0, Math.min(1, v)) * 255) : null;
  };
  const r = ch('r'); const g = ch('g'); const b = ch('b');
  return r == null || g == null || b == null ? null : `rgb(${r}, ${g}, ${b})`;
}

function displayNameOf(rec: DefinitionRecord): string {
  const dn = rec.json?.properties?.display_name?.value;
  return typeof dn === 'string' && dn.trim() ? dn : humanizeAssetId(rec.id);
}

export function BiomeSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const openLoot = useAppStore((s) => s.openLoot);
  const jump = useJumpToDefinition();
  const refAdapter = useRefAdapter((id) => jump(id));

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);

  type Row = { key: DefinitionsKey; id: string; name: string; colour: string | null; tables: number };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const [key, rec] of definitions) {
      if (rec.folder !== BD_FOLDER || !rec.json) continue;
      const tables = LOOT_SLOTS.filter((s) => resolveSlot(rec, s, findKeyById) != null).length;
      out.push({ key, id: rec.id, name: displayNameOf(rec), colour: colourOf(rec), tables });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions]);

  const lspIds = useMemo(() => {
    const out: string[] = [];
    for (const rec of definitions.values()) if (rec.folder === LSP_FOLDER && rec.json) out.push(rec.id);
    return out.sort();
  }, [definitions]);

  const hits = useHybridSearch(rows, filter, (r) => [r.name, r.id], { semanticKey: (r) => r.key });

  const activeKey = selectedKey && definitions.get(selectedKey)?.json ? selectedKey : rows[0]?.key ?? null;
  const rec = activeKey ? definitions.get(activeKey) ?? null : null;

  const newBiome = () => {
    let n = 1;
    while (findKeyById(`BD_New${n}`)) n++;
    const stem = `New${n}`;
    const k = createDefinitionForClass('BiomeDefinition', `BD_${stem}`);
    if (!k) return;
    const set = (prop: string, env: any) => updateValueAtPath(k, ['properties', prop], env);
    set('display_name', { type: 'text', value: `New biome ${n}` });
    set('biome_tag_name', { type: 'name', value: `Tile.Biome.${stem}` });
    set('biome_tag', { type: 'gameplay_tag', value: `Tile.Biome.${stem}` });
    set('loot_multiplier', { type: 'float', value: 1 });
    set('maze_openness', { type: 'float', value: 0.5 });
    setSelectedKey(k);
    setFilter('');
  };

  return (
    <div className="bm-layout">
      <aside className="rail">
        <div className="rail-header">
          <h3>Biomes</h3>
          <SearchBox value={filter} onChange={setFilter} placeholder="Search biomes…" />
          <div className="rail-add-row">
            <button className="add-row" onClick={newBiome}>＋ New biome</button>
          </div>
        </div>
        <div className="rail-body lt-rail-body">
          {hits.map((h) => (
            <button
              key={h.item.key}
              className={`rail-row lt-rail-row ${activeKey === h.item.key ? 'selected' : ''}`}
              onClick={() => setSelectedKey(h.item.key)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jump(h.item.id); } }}
              title={`${h.item.id}\nMiddle-click to open in Definitions`}
            >
              <span className="bm-swatch" style={{ background: h.item.colour ?? 'transparent' }} aria-hidden />
              <span className="label">
                <HighlightedText text={h.item.name} ranges={h.ranges} />
                <span className="lt-rail-sub">
                  {h.item.tables === 0 ? 'no loot' : `${h.item.tables} loot table${h.item.tables === 1 ? '' : 's'}`}
                </span>
              </span>
            </button>
          ))}
          {hits.length === 0 && <div className="empty-state-mini">{filter ? 'Nothing matches.' : 'No biomes loaded.'}</div>}
        </div>
      </aside>

      <section className="lt-pane bm-pane">
        {!rec || !activeKey ? (
          <div className="lt-empty"><h2>✨ Biomes</h2><p>Pick a biome on the left, or make a new one.</p></div>
        ) : (
          <>
            <header className="lt-header">
              <div className="lt-title">
                <span className="bm-swatch big" style={{ background: colourOf(rec) ?? 'transparent' }} aria-hidden />
                <h2>{displayNameOf(rec)}</h2>
                <code className="lt-id">{rec.id}</code>
                <span className="lt-spacer" />
                <button onClick={() => jump(rec.id)} title="Open the full property editor">All properties</button>
              </div>
            </header>

            <section className="bm-section">
              <h3>Loot</h3>
              <p className="lt-explain">
                What can be found in this biome, by where it turns up. Every count is scaled by the biome's
                <b> loot multiplier</b> below.
              </p>
              <div className="bm-slots">
                {LOOT_SLOTS.map((slot) => (
                  <LootSlotCard
                    key={slot.prop}
                    slot={slot}
                    biome={rec}
                    biomeKey={activeKey}
                    lspIds={lspIds}
                    onEdit={(id) => openLoot('world', id)}
                  />
                ))}
              </div>
            </section>

            <BiomeBasics rec={rec} recKey={activeKey} refAdapter={refAdapter} onOpenFull={() => jump(rec.id)} />
          </>
        )}
      </section>
    </div>
  );
}

/** The loot table a slot points at: the biome's own reference when it has one,
 *  else the conventionally named table if it exists. */
function resolveSlot(
  biome: DefinitionRecord,
  slot: Slot,
  findKeyById: (id: string) => DefinitionsKey | null,
): { id: string; key: DefinitionsKey; byName: boolean } | null {
  const explicit = biome.json?.properties?.[slot.prop]?.value;
  if (typeof explicit === 'string' && explicit) {
    // Older packs stored a full object path; the id is its last segment.
    const id = explicit.split('/').pop()!.split('.').pop()!;
    const key = findKeyById(id);
    return key ? { id, key, byName: false } : null;
  }
  const guess = `LSP_${stemOf(biome.id)}_${slot.suffix}`;
  const key = findKeyById(guess);
  return key ? { id: guess, key, byName: true } : null;
}

function LootSlotCard({ slot, biome, biomeKey, lspIds, onEdit }: {
  slot: Slot; biome: DefinitionRecord; biomeKey: DefinitionsKey; lspIds: string[]; onEdit: (id: string) => void;
}) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);

  const resolved = resolveSlot(biome, slot, findKeyById);
  const explicit = biome.json?.properties?.[slot.prop]?.value;
  const dangling = typeof explicit === 'string' && explicit && !resolved;
  const table = resolved ? definitions.get(resolved.key) ?? null : null;
  const loot = table ? readWorldLoot(table) : null;

  const point = (id: string) => {
    const cur = biome.json?.properties?.[slot.prop];
    updateValueAtPath(biomeKey, ['properties', slot.prop], {
      ...(cur && typeof cur === 'object' ? cur : { type: 'definition_ref', class: 'LootSpawnPointDefinition' }),
      value: id,
    });
  };

  const create = () => {
    let id = `LSP_${stemOf(biome.id)}_${slot.suffix}`;
    let n = 2;
    while (findKeyById(id)) id = `LSP_${stemOf(biome.id)}_${slot.suffix}_${n++}`;
    const k = createDefinitionForClass('LootSpawnPointDefinition', id);
    if (!k) return;
    const made = useDefinitionsStore.getState().definitions.get(k);
    if (made?.json?.properties?.loot_by_difficulty) updateValueAtPath(k, ['properties', 'loot_by_difficulty', 'value'], []);
    const src = made?.json?.properties?.source_type;
    updateValueAtPath(k, ['properties', 'source_type'], { ...(src ?? { type: 'enum', enum_name: 'ELootSource' }), value: slot.source });
    updateValueAtPath(k, ['properties', 'accumulate_previous_tiers'], { type: 'bool', value: true });
    point(id);
    onEdit(id);
  };

  // Up to nine distinct items across the tiers, for an at-a-glance preview.
  const preview: string[] = [];
  if (loot) {
    for (const t of loot.tiers) for (const r of t.rows) {
      if (r.item && !preview.includes(r.item)) preview.push(r.item);
    }
  }
  const authored = loot ? loot.tiers.filter((t) => t.index >= 0) : [];

  return (
    <div className={`bm-slot ${resolved ? '' : 'unset'}`}>
      <div className="bm-slot-head">
        <div>
          <div className="bm-slot-label">{slot.label}</div>
          <div className="bm-slot-hint">{slot.hint}</div>
        </div>
      </div>

      {resolved && loot ? (
        <>
          <button className="bm-slot-table" onClick={() => onEdit(resolved.id)} title="Edit this loot table">
            <span className="bm-slot-name">{humanizeAssetId(resolved.id)}</span>
            <span className="bm-slot-tiers">
              {authored.length === 0
                ? 'empty — nothing spawns'
                : authored.map((t) => `${DIFFICULTY_LABEL[t.difficulty] ?? t.difficulty} ${Math.round(t.spawnChance * 100)}%`).join(' · ')}
            </span>
            {preview.length > 0 && (
              <span className="bm-slot-icons">
                {preview.slice(0, 9).map((id) => (
                  <span key={id} title={presentedName(definitions, id)}><ItemIcon id={id} size={26} /></span>
                ))}
                {preview.length > 9 && <span className="bm-slot-more">+{preview.length - 9}</span>}
              </span>
            )}
          </button>
          {resolved.byName && (
            <div className="bm-slot-note">
              Matched by name only — the biome doesn't reference it, so the game won't use it.{' '}
              <button className="link" onClick={() => point(resolved.id)}>Link it</button>
            </div>
          )}
        </>
      ) : (
        <div className="bm-slot-none">
          {dangling ? <>Points at <code>{String(explicit)}</code>, which doesn't exist.</> : 'Nothing spawns here.'}
        </div>
      )}

      <div className="bm-slot-actions">
        {resolved
          ? <button className="primary" onClick={() => onEdit(resolved.id)}>Edit loot</button>
          : <button className="primary" onClick={create}>＋ New table</button>}
        <select
          value={resolved && !resolved.byName ? resolved.id : ''}
          onChange={(e) => point(e.target.value)}
          aria-label={`${slot.label}: choose loot table`}
          title="Use an existing loot table"
        >
          <option value="">{resolved && !resolved.byName ? 'None' : 'Use existing…'}</option>
          {lspIds.map((id) => <option key={id} value={id}>{humanizeAssetId(id)}</option>)}
        </select>
      </div>
    </div>
  );
}

function BiomeBasics({ rec, recKey, refAdapter, onOpenFull }: {
  rec: DefinitionRecord; recKey: DefinitionsKey; refAdapter: any; onOpenFull: () => void;
}) {
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const props: Record<string, any> = rec.json?.properties ?? {};

  const { shown, hidden } = useMemo(() => {
    const lootProps = new Set<string>(LOOT_SLOTS.map((s) => s.prop));
    const shown: Record<string, any> = {};
    const hidden: string[] = [];
    for (const [k, v] of Object.entries(props)) {
      if (lootProps.has(k)) continue;
      if (JSON.stringify(v ?? null).length > HEAVY_CHARS) { hidden.push(k); continue; }
      shown[k] = v;
    }
    return { shown, hidden };
  }, [props]);

  // The grid hands back only the keys it was given. Fold its edits into the
  // full property set without disturbing key order — order is what keeps a
  // save from rewriting lines the user never touched.
  const onChange = (next: Record<string, any>) => {
    const merged: Record<string, any> = {};
    for (const k of Object.keys(props)) {
      if (k in shown) { if (next[k] !== undefined) merged[k] = next[k]; }
      else merged[k] = props[k];
    }
    for (const k of Object.keys(next)) if (!(k in props) && next[k] !== undefined) merged[k] = next[k];
    updateValueAtPath(recKey, ['properties'], merged);
  };

  // The grid sorts alphabetically, which buries the five things people come
  // here to change under audio and tag plumbing. Lead with those.
  const primary: Record<string, any> = {};
  const rest: Record<string, any> = {};
  for (const [k, v] of Object.entries(shown)) (PRIMARY.has(k) ? primary : rest)[k] = v;
  const editor = (subset: Record<string, any>) => (
    <TypedPropertiesEditor
      parentTypeName={String(rec.json?.class ?? '').replace(/^U/, '')}
      properties={subset}
      showAllFields={false}
      onChange={(next) => onChange({ ...shown, ...next, ...deletions(subset, next) })}
      refAdapter={refAdapter}
      ownerKey={recKey}
    />
  );

  return (
    <section className="bm-section">
      <h3>Map &amp; maze</h3>
      {editor(primary)}
      {Object.keys(rest).length > 0 && (
        <details className="bm-more">
          <summary>Tags, audio and layouts <span className="muted">({Object.keys(rest).length})</span></summary>
          {editor(rest)}
        </details>
      )}
      {hidden.length > 0 && (
        <p className="bm-hidden-note">
          Not shown here because {hidden.length === 1 ? 'it is a large generated table' : 'they are large generated tables'}:{' '}
          {hidden.map((h) => humanizeProperty(h)).join(', ')}.{' '}
          <button className="link" onClick={onOpenFull}>Open in Definitions</button>
        </p>
      )}
    </section>
  );
}

const PRIMARY = new Set(['display_name', 'role', 'map_color', 'loot_multiplier', 'maze_openness', 'is_maze_border', 'hides_maze_walls']);

/** Keys the grid removed from `subset`, as explicit `undefined`s so a spread
 *  over the full set doesn't resurrect them. */
function deletions(subset: Record<string, any>, next: Record<string, any>): Record<string, undefined> {
  const out: Record<string, undefined> = {};
  for (const k of Object.keys(subset)) if (!(k in next)) out[k] = undefined;
  return out;
}
