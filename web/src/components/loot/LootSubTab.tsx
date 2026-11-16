import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useDefinitionsStore,
  type DefinitionRecord,
  type DefinitionsKey,
} from '../../store/definitionsStore';
import { useAppStore } from '../../store/appStore';
import { humanizeAssetId } from '../definitionsNaming';
import { SearchBox } from '../SearchBox';
import { HighlightedText } from '../HighlightedText';
import { VirtualList } from '../VirtualList';
import { AssetTitle } from '../AssetTitle';
import { ItemIcon, presentedName, presentedRecord, recordById } from '../ItemIcon';
import { getFolderTheme } from '../folderTheme';
import { useHybridSearch } from '../../search/hybrid';
import { useJumpToDefinition } from '../useJumpToDefinition';
import {
  DIFFICULTY_LABEL,
  LOOT_FOLDER,
  SOURCE_LABEL,
  SOURCE_TYPES,
  dropEnvelopeWith,
  dropListPath,
  effectiveRows,
  enemyListPath,
  enemyListWith,
  expectedDrops,
  pickableFolders,
  readDropRows,
  readEnemyRows,
  readWorldLoot,
  shares,
  summarise,
  without,
  worldListWith,
  worldTiersWith,
  type DropRow,
  type LootKind,
  type WeightedRow,
  type WorldLoot,
} from './lootModel';
import '../../styles-loot.css';

type Defs = Map<DefinitionsKey, DefinitionRecord>;

const KINDS: Array<{ id: LootKind; label: string; hint: string; emoji: string }> = [
  { id: 'drop', label: 'Drop tables', emoji: '💰', hint: 'What furniture leaves behind when it breaks' },
  { id: 'world', label: 'World loot', emoji: '✨', hint: 'What spawns on floors, on furniture and in containers' },
  { id: 'enemy', label: 'Enemy drops', emoji: '👹', hint: 'What an enemy drops when it dies' },
];

const LS_KIND = 'tsic.loot.kind.v1';

// ── where-used index ───────────────────────────────────────────────────────
// Loot is referenced through soft refs and plain strings, neither of which the
// store's definition_ref index tracks. Each record's mentioned ids are cached
// against its json object, which only changes identity when that record is
// edited, so a keystroke re-scans one record rather than three thousand.

const mentionCache = new WeakMap<object, Set<string>>();
const ID_LIKE = /^[A-Za-z0-9_]{3,80}$/;

function mentions(json: any): Set<string> {
  if (!json || typeof json !== 'object') return new Set();
  let out = mentionCache.get(json);
  if (out) return out;
  out = new Set<string>();
  const visit = (v: any) => {
    if (typeof v === 'string') { if (ID_LIKE.test(v)) out!.add(v); return; }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const e of v) visit(e); return; }
    for (const k of Object.keys(v)) visit(v[k]);
  };
  visit(json.properties);
  mentionCache.set(json, out);
  return out;
}

function useUsage(defs: Defs, targetFolders: string[]): Map<string, DefinitionRecord[]> {
  return useMemo(() => {
    const targets = new Set<string>();
    for (const rec of defs.values()) if (targetFolders.includes(rec.folder)) targets.add(rec.id);
    const out = new Map<string, DefinitionRecord[]>();
    for (const rec of defs.values()) {
      if (!rec.json) continue;
      for (const id of mentions(rec.json)) {
        if (!targets.has(id) || id === rec.id) continue;
        const list = out.get(id);
        if (list) list.push(rec); else out.set(id, [rec]);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, targetFolders.join('|')]);
}

// ── small inputs ───────────────────────────────────────────────────────────

/** Number box that commits on blur/Enter, so typing "12" doesn't write "1"
 *  to the store on the way. */
function Num({ value, onCommit, min = 0, max, step = 1, suffix, title, width = 56 }: {
  value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number;
  suffix?: string; title?: string; width?: number;
}) {
  const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(shown); return; }
    const clamped = Math.max(min, max != null ? Math.min(max, n) : n);
    if (clamped !== value) onCommit(clamped);
    else setDraft(shown);
  };
  return (
    <span className="lt-num" title={title}>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        style={{ width }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {suffix && <span className="lt-num-suffix">{suffix}</span>}
    </span>
  );
}

/** 0..1 stored, 0..100% shown. Slider for the coarse move, box for the exact one. */
function Percent({ value, onCommit, title }: { value: number; onCommit: (n: number) => void; title?: string }) {
  const pct = Math.round(value * 1000) / 10;
  const [drag, setDrag] = useState<number | null>(null);
  const live = drag ?? pct;
  return (
    <span className="lt-percent" title={title}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={live}
        style={{ ['--fill' as any]: `${live}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => { if (drag != null) { onCommit(drag / 100); setDrag(null); } }}
        onKeyUp={() => { if (drag != null) { onCommit(drag / 100); setDrag(null); } }}
        onBlur={() => { if (drag != null) { onCommit(drag / 100); setDrag(null); } }}
        aria-label={title}
      />
      <Num value={live} onCommit={(n) => onCommit(n / 100)} min={0} max={100} suffix="%" width={52} />
    </span>
  );
}

const fmtPct = (f: number) => {
  const p = f * 100;
  if (p === 0) return '0%';
  if (p < 1) return '<1%';
  return `${p >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`;
};
const fmtAvg = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/0$/, ''));

function ItemCell({ id, onJump }: { id: string; onJump: (id: string) => void }) {
  const defs = useDefinitionsStore((s) => s.definitions);
  const known = !!recordById(defs, id);
  return (
    <span className={`lt-item ${known ? '' : 'missing'}`}>
      <ItemIcon id={id} size={28} />
      <span className="lt-item-text">
        <span className="lt-item-name">{id ? presentedName(defs, id) : 'No item chosen'}</span>
        <button
          className="lt-item-id"
          title={known ? 'Open this item' : 'This id does not match any definition'}
          onClick={() => known && onJump(id)}
        >
          {known ? id : `${id || '—'} · not found`}
        </button>
      </span>
    </span>
  );
}

function UsedBy({ users, noun, emptyText }: { users: DefinitionRecord[]; noun: string; emptyText: string }) {
  const defs = useDefinitionsStore((s) => s.definitions);
  const jump = useJumpToDefinition();
  const [all, setAll] = useState(false);
  if (users.length === 0) return <div className="lt-usedby empty">⚠ {emptyText}</div>;
  const shown = all ? users : users.slice(0, 8);
  return (
    <div className="lt-usedby">
      <span className="lt-usedby-label">{noun} {users.length}</span>
      {shown.map((u) => (
        <button key={`${u.folder}/${u.id}`} className="lt-chip" onClick={() => jump(u.id)} title={`${u.id} — open`}>
          <span aria-hidden>{getFolderTheme(u.folder).emoji}</span> {presentedName(defs, u.id)}
        </button>
      ))}
      {users.length > shown.length && (
        <button className="lt-chip more" onClick={() => setAll(true)}>+{users.length - shown.length} more</button>
      )}
    </div>
  );
}

/** "Make this furniture drop this table" without leaving the Loot tab: search
 *  for a breakable furniture, click it, and the table is appended to its death
 *  loot. */
function AttachToFurniture({ tableId, already }: { tableId: string; already: DefinitionRecord[] }) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const assetsOfClass = useDefinitionsStore((s) => s.assetsOfClass);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const setToast = useDefinitionsStore((s) => s.setToast);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const candidates = useMemo(() => {
    if (!open) return [];
    const taken = new Set(already.map((r) => r.id));
    return assetsOfClass('DamageableFurnitureDefinition')
      .filter((id) => !taken.has(id))
      .map((id) => ({ id, name: presentedName(definitions, id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, definitions, already.length]);
  const hits = useHybridSearch(candidates, q, (c) => [c.name, c.id]);

  const attach = (furnitureId: string) => {
    const key = findKeyById(furnitureId);
    const furn = key ? definitions.get(key) : null;
    if (!key || !furn) return;
    const cur = furn.json?.properties?.loot_dropped_on_death;
    const sibling = Array.isArray(cur?.value) ? cur.value[0] : null;
    const entry = { ...(sibling && typeof sibling === 'object' ? sibling : { type: 'soft_asset_ref', class: 'LootDefinition' }), value: tableId };
    const base = cur && Array.isArray(cur.value)
      ? cur
      : { type: 'array', element_type: { type: 'soft_asset_ref', class: 'LootDefinition' }, value: [] };
    updateValueAtPath(key, ['properties', 'loot_dropped_on_death'], { ...base, value: [...base.value, entry] });
    setToast({ kind: 'info', text: `${presentedName(definitions, furnitureId)} now drops ${humanizeAssetId(tableId)}.` });
    setOpen(false);
    setQ('');
  };

  return (
    <div className="lt-attach" ref={rootRef}>
      <button className="lt-chip lt-attach-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>＋ Use on furniture…</button>
      {open && (
        <div className="lt-attach-pop" role="dialog" aria-label="Choose furniture">
          <SearchBox value={q} onChange={setQ} placeholder="Search furniture…" autoFocus />
          <div className="lt-attach-list">
            {hits.slice(0, 40).map((h) => (
              <button key={h.item.id} className="lt-pick" onClick={() => attach(h.item.id)} title={h.item.id}>
                <span aria-hidden>🪑</span>
                <span className="lt-pick-name"><HighlightedText text={h.item.name} ranges={h.ranges} /></span>
                <span className="lt-pick-add" aria-hidden>＋</span>
              </button>
            ))}
            {hits.length === 0 && <div className="empty-state-mini">No furniture matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── the tab ────────────────────────────────────────────────────────────────

export function LootSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const duplicateDefinition = useDefinitionsStore((s) => s.duplicateDefinition);
  const deleteDefinition = useDefinitionsStore((s) => s.deleteDefinition);
  const setToast = useDefinitionsStore((s) => s.setToast);
  const jump = useJumpToDefinition();

  const [kind, setKindState] = useState<LootKind>(() => {
    try { const v = localStorage.getItem(LS_KIND); if (v === 'drop' || v === 'world' || v === 'enemy') return v; } catch { /* noop */ }
    return 'drop';
  });
  const setKind = (k: LootKind) => { setKindState(k); try { localStorage.setItem(LS_KIND, k); } catch { /* noop */ } };
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Record<LootKind, DefinitionsKey | null>>({ drop: null, world: null, enemy: null });
  const [activeTier, setActiveTier] = useState('EASY');
  const [flash, setFlash] = useState<string | null>(null);

  // Another view (a biome's loot card, a furniture's death loot) asked for a
  // specific table: switch to its kind and select it.
  const lootFocus = useAppStore((s) => s.lootFocus);
  const clearLootFocus = useAppStore((s) => s.clearLootFocus);
  useEffect(() => {
    if (!lootFocus) return;
    const k = findKeyById(lootFocus.id);
    setKind(lootFocus.kind);
    if (k) setSelected((s) => ({ ...s, [lootFocus.kind]: k }));
    setFilter('');
    clearLootFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lootFocus]);

  const usage = useUsage(definitions, ['loot_definitions', 'loot_spawn_point_definitions']);

  const counts = useMemo(() => {
    const c: Record<LootKind, number> = { drop: 0, world: 0, enemy: 0 };
    for (const rec of definitions.values()) {
      if (!rec.json) continue;
      if (rec.folder === LOOT_FOLDER.drop) c.drop++;
      else if (rec.folder === LOOT_FOLDER.world) c.world++;
      else if (rec.folder === LOOT_FOLDER.enemy) c.enemy++;
    }
    return c;
  }, [definitions]);

  type Row = { key: DefinitionsKey; id: string; name: string; text: string; count: number; users: number };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const [key, rec] of definitions) {
      if (rec.folder !== LOOT_FOLDER[kind] || !rec.json) continue;
      const s = summarise(kind, rec);
      out.push({
        key,
        id: rec.id,
        name: kind === 'enemy' ? presentedName(definitions, rec.id) : humanizeAssetId(rec.id),
        text: s.text,
        count: s.count,
        users: usage.get(rec.id)?.length ?? 0,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [definitions, kind, usage]);

  const hits = useHybridSearch(rows, filter, (r) => [r.name, r.id], { semanticKey: (r) => r.key });

  const selectedKey = selected[kind] && definitions.get(selected[kind]!)?.json ? selected[kind] : rows[0]?.key ?? null;
  const rec = selectedKey ? definitions.get(selectedKey) ?? null : null;
  const select = (k: DefinitionsKey | null) => setSelected((s) => ({ ...s, [kind]: k }));

  const write = (path: (string | number)[], value: any) => { if (selectedKey) updateValueAtPath(selectedKey, path, value); };

  // What clicking an item in the picker does, and where the result lands.
  const world = kind === 'world' ? readWorldLoot(rec) : null;
  const tier = world ? world.tiers.find((t) => t.difficulty === activeTier && t.index >= 0) ?? world.tiers.find((t) => t.index >= 0) ?? null : null;
  const canAdd = !!rec && (kind !== 'world' || !!tier);
  const addTargetLabel = !rec
    ? ''
    : kind === 'world'
      ? (tier ? `${DIFFICULTY_LABEL[tier.difficulty] ?? tier.difficulty} tier` : 'add a difficulty tier first')
      : kind === 'drop' ? humanizeAssetId(rec.id) : presentedName(definitions, rec.id);

  const addItem = (itemId: string) => {
    if (!rec || !selectedKey) return;
    if (kind === 'drop') write(dropListPath(), dropEnvelopeWith(rec, itemId));
    else if (kind === 'enemy') write(enemyListPath(), enemyListWith(rec, itemId));
    else if (tier?.listPath) write(tier.listPath, worldListWith(rec, tier, itemId));
    else { setToast({ kind: 'error', text: 'Add a difficulty tier before adding items.' }); return; }
    setFlash(itemId);
    window.setTimeout(() => setFlash((f) => (f === itemId ? null : f)), 900);
  };

  const newTable = () => {
    const cls = kind === 'drop' ? 'LootDefinition' : kind === 'world' ? 'LootSpawnPointDefinition' : 'EnemyDefinition';
    const prefix = kind === 'drop' ? 'LD_New' : kind === 'world' ? 'LSP_New' : 'ED_New';
    let n = 1;
    while (findKeyById(`${prefix}${n}`)) n++;
    const k = createDefinitionForClass(cls, `${prefix}${n}`);
    if (!k) return;
    // A blank minted from a sibling keeps the sibling's property shapes but
    // must not keep its rows.
    const created = useDefinitionsStore.getState().definitions.get(k);
    if (kind === 'drop' && created?.json?.properties?.items_to_drop) {
      updateValueAtPath(k, [...dropListPath(), 'value'], []);
    } else if (kind === 'world' && created?.json?.properties?.loot_by_difficulty) {
      updateValueAtPath(k, ['properties', 'loot_by_difficulty', 'value'], []);
    }
    // …nor zeroed world-gen dials: every shipped table uses the class default
    // of 1000 for both, and a weight of 0 would mean "never picked".
    for (const dial of ['weighted_chance', 'world_gen_priority']) {
      const env = created?.json?.properties?.[dial];
      if (env && env.value === 0) updateValueAtPath(k, ['properties', dial, 'value'], 1000);
    }
    select(k);
    setFilter('');
  };

  const duplicate = () => {
    if (!rec || !selectedKey) return;
    let n = 2;
    const base = rec.id.replace(/_?\d+$/, '');
    while (findKeyById(`${base}_${n}`)) n++;
    const k = duplicateDefinition(selectedKey, `${base}_${n}`);
    if (k) select(k);
  };

  const remove = async () => {
    if (!rec || !selectedKey) return;
    const users = usage.get(rec.id)?.length ?? 0;
    const msg = users > 0
      ? `Delete ${rec.id}? ${users} definition${users === 1 ? '' : 's'} still point${users === 1 ? 's' : ''} at it and will be left with a dangling reference.`
      : `Delete ${rec.id}?`;
    if (!window.confirm(msg)) return;
    await deleteDefinition(selectedKey);
    select(null);
  };

  const kindMeta = KINDS.find((k) => k.id === kind)!;

  return (
    <div className="lt-layout">
      <aside className="rail lt-rail">
        <div className="rail-header">
          <div className="lt-kinds" role="tablist">
            {KINDS.map((k) => (
              <button
                key={k.id}
                role="tab"
                aria-selected={kind === k.id}
                className={`lt-kind ${kind === k.id ? 'active' : ''}`}
                onClick={() => setKind(k.id)}
                title={k.hint}
              >
                <span aria-hidden>{k.emoji}</span>
                <span className="lt-kind-label">{k.label}</span>
                <span className="lt-kind-count">{counts[k.id]}</span>
              </button>
            ))}
          </div>
          <p className="lt-kind-hint">{kindMeta.hint}.</p>
          <SearchBox value={filter} onChange={setFilter} placeholder={`Search ${kindMeta.label.toLowerCase()}…`} />
          {kind !== 'enemy' && (
            <div className="rail-add-row">
              <button className="add-row" onClick={newTable}>＋ New {kind === 'drop' ? 'drop table' : 'world loot table'}</button>
            </div>
          )}
        </div>
        <div className="rail-body lt-rail-body">
          {hits.map((h) => (
            <button
              key={h.item.key}
              className={`rail-row lt-rail-row ${selectedKey === h.item.key ? 'selected' : ''}`}
              onClick={() => select(h.item.key)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jump(h.item.id); } }}
              title={`${h.item.id}\nMiddle-click to open in Definitions`}
            >
              <span className="label">
                <HighlightedText text={h.item.name} ranges={h.ranges} />
                <span className="lt-rail-sub">
                  {h.item.text}
                  {kind !== 'enemy' && (h.item.users > 0 ? ` · used by ${h.item.users}` : '')}
                </span>
              </span>
              {kind !== 'enemy' && h.item.users === 0 && <span className="lt-flag" title="Nothing uses this table yet">unused</span>}
              {h.item.count === 0 && <span className="lt-flag warn" title="This table has no items">empty</span>}
            </button>
          ))}
          {hits.length === 0 && <div className="empty-state-mini">{filter ? 'Nothing matches.' : 'None yet.'}</div>}
        </div>
      </aside>

      <section className="lt-pane">
        {!rec || !selectedKey ? (
          <div className="lt-empty">
            <h2>{kindMeta.emoji} {kindMeta.label}</h2>
            <p>{kindMeta.hint}. Pick one on the left{kind !== 'enemy' ? ', or make a new one' : ''}.</p>
          </div>
        ) : (
          <>
            <header className="lt-header">
              <div className="lt-title">
                <span className="lt-title-emoji" aria-hidden>{kindMeta.emoji}</span>
                {kind === 'enemy'
                  ? <h2>{presentedName(definitions, rec.id)}</h2>
                  : <AssetTitle assetKey={selectedKey} onRenamed={(k) => select(k)} />}
                <code className="lt-id">{rec.id}</code>
                <span className="lt-spacer" />
                {kind !== 'enemy' && <button onClick={duplicate} title="Copy this table under a new name">Duplicate</button>}
                <button onClick={() => jump(rec.id)} title="Open the full property editor">All properties</button>
                {kind !== 'enemy' && <button className="danger" onClick={() => void remove()} title="Delete this table">Delete</button>}
              </div>
              {kind === 'drop' && (
                <div className="lt-usedby-row">
                  <UsedBy users={usage.get(rec.id) ?? []} noun="Dropped by" emptyText="No furniture drops this table yet." />
                  <AttachToFurniture tableId={rec.id} already={usage.get(rec.id) ?? []} />
                </div>
              )}
              {kind === 'world' && (
                <UsedBy users={(usage.get(rec.id) ?? [])} noun="Used by" emptyText="No biome or layout uses this table yet." />
              )}
            </header>

            {kind === 'drop' && (
              <DropEditor rec={rec} write={write} onJump={jump} flash={flash} />
            )}
            {kind === 'world' && world && (
              <WorldEditor
                rec={rec}
                loot={world}
                write={write}
                onJump={jump}
                activeTier={tier?.difficulty ?? activeTier}
                setActiveTier={setActiveTier}
                flash={flash}
              />
            )}
            {kind === 'enemy' && (
              <EnemyEditor rec={rec} write={write} onJump={jump} flash={flash} />
            )}
          </>
        )}
      </section>

      <LootPicker kind={kind} canAdd={canAdd} targetLabel={addTargetLabel} onPick={addItem} />
    </div>
  );
}

// ── drop table ─────────────────────────────────────────────────────────────

interface EditorProps {
  rec: DefinitionRecord;
  write: (path: (string | number)[], value: any) => void;
  onJump: (id: string) => void;
  flash: string | null;
}

function DropEditor({ rec, write, onJump, flash }: EditorProps) {
  const defs = useDefinitionsStore((s) => s.definitions);
  const rows = readDropRows(rec);
  const expected = expectedDrops(rows);
  const listEnv = rec.json?.properties?.items_to_drop;

  return (
    <>
      <div className="lt-explain">
        Every row rolls on its own when the furniture breaks: <b>chance</b> decides whether it drops at all,
        <b> count</b> is how many you get when it does.
      </div>
      <div className="lt-table">
        <div className="lt-row lt-head drop">
          <span>Item</span><span>Count</span><span>Chance</span><span className="right">Avg per break</span><span />
        </div>
        {rows.map((r: DropRow, i) => (
          <div key={i} className={`lt-row drop ${flash === r.item ? 'flash' : ''}`}>
            <ItemCell id={r.item} onJump={onJump} />
            <Num value={r.count} min={1} onCommit={(n) => write([...r.path, 'value', 'count', 'value'], Math.round(n))} title="How many drop" />
            <Percent value={r.chance} onCommit={(n) => write([...r.path, 'value', 'chance_to_drop', 'value'], n)} title="Chance this row drops" />
            <span className="right lt-avg">{fmtAvg(r.count * Math.min(1, Math.max(0, r.chance)))}</span>
            <button className="lt-x" title="Remove" aria-label={`Remove ${r.item}`} onClick={() => write(dropListPath(), without(listEnv, i))}>✕</button>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="lt-table-empty">This table drops nothing yet. Pick items from the list on the right →</div>
        )}
      </div>
      {expected.length > 0 && (
        <div className="lt-summary">
          <span className="lt-summary-label">One break yields on average</span>
          {expected.map((e) => (
            <span key={e.item} className="lt-summary-item">
              <ItemIcon id={e.item} size={18} /> {fmtAvg(e.avg)}× {presentedName(defs, e.item)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ── weighted list (shared by world tiers and enemy drops) ──────────────────

function WeightedList({ rows, ownCount, onWrite, onRemove, onJump, flash, emptyText }: {
  rows: WeightedRow[];
  /** Rows after this many inherited ones belong to the list being edited. */
  ownCount: number;
  onWrite: (row: WeightedRow, field: 'count' | 'weight', n: number) => void;
  onRemove: (ownIndex: number) => void;
  onJump: (id: string) => void;
  flash: string | null;
  emptyText: string;
}) {
  const share = shares(rows);
  const inherited = rows.length - ownCount;
  return (
    <div className="lt-table">
      <div className="lt-row lt-head weighted">
        <span>Item</span><span>Count</span><span>Weight</span><span>Share of picks</span><span />
      </div>
      {rows.map((r, i) => {
        const isOwn = i >= inherited;
        return (
          <div key={i} className={`lt-row weighted ${isOwn ? '' : 'inherited'} ${flash === r.item && isOwn ? 'flash' : ''}`}>
            <ItemCell id={r.item} onJump={onJump} />
            {isOwn ? (
              <>
                <Num value={r.count} min={1} onCommit={(n) => onWrite(r, 'count', Math.round(n))} title="Stack size" />
                <Num value={r.weight} min={0} onCommit={(n) => onWrite(r, 'weight', Math.round(n))} title="Weight against the other rows" />
              </>
            ) : (
              <>
                <span className="lt-ro">{r.count}</span>
                <span className="lt-ro">{r.weight}</span>
              </>
            )}
            <span className="lt-share" title={`${fmtPct(share[i])} of picks`}>
              <span className="lt-share-bar"><span style={{ width: `${share[i] * 100}%` }} /></span>
              <span className="lt-share-num">{fmtPct(share[i])}</span>
            </span>
            {isOwn
              ? <button className="lt-x" title="Remove" aria-label={`Remove ${r.item}`} onClick={() => onRemove(i - inherited)}>✕</button>
              : <span className="lt-from" title={`Defined on the ${DIFFICULTY_LABEL[r.inheritedFrom ?? ''] ?? r.inheritedFrom} tier`}>{DIFFICULTY_LABEL[r.inheritedFrom ?? ''] ?? r.inheritedFrom}</span>}
          </div>
        );
      })}
      {rows.length === 0 && <div className="lt-table-empty">{emptyText}</div>}
    </div>
  );
}

// ── world loot ─────────────────────────────────────────────────────────────

function WorldEditor({ rec, loot, write, onJump, activeTier, setActiveTier, flash }: EditorProps & {
  loot: WorldLoot; activeTier: string; setActiveTier: (d: string) => void;
}) {
  const tierIdx = Math.max(0, loot.tiers.findIndex((t) => t.difficulty === activeTier));
  const tier = loot.tiers[tierIdx];
  const rows = tier.index >= 0 ? effectiveRows(loot, tierIdx) : [];
  // An unauthored tier isn't empty in game: it falls back to the nearest easier one.
  const fallback = tier.index < 0
    ? [...loot.tiers.slice(0, tierIdx)].reverse().find((t) => t.index >= 0) ?? null
    : null;
  const listEnv = tier.index >= 0
    ? rec.json?.properties?.loot_by_difficulty?.value?.[tier.index]?.value?.value?.loot_items
    : null;
  const sourceEnv = rec.json?.properties?.source_type;

  const addTier = (difficulty: string) => {
    const seed = fallback?.spawnChance ?? loot.tiers.find((t) => t.index >= 0)?.spawnChance ?? 0.25;
    write(['properties', 'loot_by_difficulty'], worldTiersWith(rec, difficulty, seed));
    setActiveTier(difficulty);
  };

  return (
    <>
      <div className="lt-settings">
        <label className="lt-setting">
          <span className="lt-setting-label">Spawns</span>
          <select
            value={loot.source}
            onChange={(e) => write(['properties', 'source_type'], { ...(sourceEnv ?? { type: 'enum', enum_name: 'ELootSource' }), value: e.target.value })}
          >
            {SOURCE_TYPES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            {!SOURCE_TYPES.includes(loot.source as any) && <option value={loot.source}>{loot.source}</option>}
          </select>
        </label>
        <label className="lt-setting check" title="When on, a harder store also picks from every easier tier's items">
          <input
            type="checkbox"
            checked={loot.accumulate}
            onChange={(e) => write(['properties', 'accumulate_previous_tiers'], { type: 'bool', value: e.target.checked })}
          />
          <span>Harder stores keep the easier tiers' items</span>
        </label>
      </div>

      <div className="lt-tiers" role="tablist">
        {loot.tiers.map((t) => (
          <button
            key={t.difficulty}
            role="tab"
            aria-selected={t.difficulty === tier.difficulty}
            className={`lt-tier-tab ${t.difficulty === tier.difficulty ? 'active' : ''} ${t.index < 0 ? 'unset' : ''}`}
            onClick={() => setActiveTier(t.difficulty)}
          >
            <span className="lt-tier-name">{DIFFICULTY_LABEL[t.difficulty] ?? t.difficulty}</span>
            <span className="lt-tier-meta">
              {t.index < 0 ? 'not set' : `${fmtPct(t.spawnChance)} · ${t.rows.length} item${t.rows.length === 1 ? '' : 's'}`}
            </span>
          </button>
        ))}
      </div>

      {tier.index < 0 ? (
        <div className="lt-tier-unset">
          <p>
            <b>{DIFFICULTY_LABEL[tier.difficulty] ?? tier.difficulty}</b> has no tier of its own.{' '}
            {fallback
              ? <>In game it uses the <b>{DIFFICULTY_LABEL[fallback.difficulty]}</b> tier.</>
              : <>In game nothing spawns at this difficulty.</>}
          </p>
          <button className="primary" onClick={() => addTier(tier.difficulty)}>
            ＋ Give {DIFFICULTY_LABEL[tier.difficulty] ?? tier.difficulty} its own tier
          </button>
        </div>
      ) : (
        <>
          <div className="lt-chance-card">
            <div>
              <div className="lt-chance-title">Spawn chance</div>
              <div className="lt-chance-sub">How often a spawn point produces anything at all. When it does, one row below is picked by weight.</div>
            </div>
            <Percent value={tier.spawnChance} onCommit={(n) => tier.spawnChancePath && write(tier.spawnChancePath, n)} title="Spawn chance" />
          </div>
          <WeightedList
            rows={rows}
            ownCount={tier.rows.length}
            onWrite={(r, field, n) => write([...r.path, 'value', field, 'value'], n)}
            onRemove={(i) => tier.listPath && write(tier.listPath, without(listEnv, i))}
            onJump={onJump}
            flash={flash}
            emptyText="Nothing can spawn at this tier yet. Pick items from the list on the right →"
          />
        </>
      )}
    </>
  );
}

// ── enemy drops ────────────────────────────────────────────────────────────

function EnemyEditor({ rec, write, onJump, flash }: EditorProps) {
  const rows = readEnemyRows(rec);
  const listEnv = rec.json?.properties?.death_drop_table;
  const variants = rec.json?.properties?.variants?.value;
  const overriding = Array.isArray(variants)
    ? variants.filter((v: any) => {
        const t = v?.value?.value?.death_drop_table?.value;
        return Array.isArray(t) && t.length > 0;
      }).length
    : 0;
  return (
    <>
      <div className="lt-explain">
        When this enemy dies, <b>one</b> row is picked by weight and dropped as a stack of <b>count</b>.
        {overriding > 0 && <> {overriding} difficulty variant{overriding === 1 ? ' replaces' : 's replace'} this table with their own — edit those under <i>All properties</i>.</>}
      </div>
      <WeightedList
        rows={rows}
        ownCount={rows.length}
        onWrite={(r, field, n) => write([...r.path, 'value', field, 'value'], n)}
        onRemove={(i) => write(enemyListPath(), without(listEnv, i))}
        onJump={onJump}
        flash={flash}
        emptyText="This enemy drops nothing. Pick items from the list on the right →"
      />
    </>
  );
}

// ── picker ─────────────────────────────────────────────────────────────────

function LootPicker({ kind, canAdd, targetLabel, onPick }: {
  kind: LootKind; canAdd: boolean; targetLabel: string; onPick: (id: string) => void;
}) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const [filter, setFilter] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const folders = pickableFolders(kind);
  const kindRef = useRef(kind);
  if (kindRef.current !== kind) { kindRef.current = kind; if (folder) setFolder(null); }

  type P = { id: string; folder: string; name: string; sub: string };
  const { items, present } = useMemo(() => {
    const items: P[] = [];
    const present = new Map<string, number>();
    for (const rec of definitions.values()) {
      if (!rec.json || !folders.includes(rec.folder)) continue;
      const name = presentedName(definitions, rec.id);
      // World items are grouped by the kind of inventory item they stand for.
      const group = kind === 'drop' ? rec.folder : ownerFolder(definitions, rec.id);
      present.set(group, (present.get(group) ?? 0) + 1);
      items.push({ id: rec.id, folder: group, name, sub: rec.id });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { items, present };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions, kind]);

  const scoped = useMemo(() => (folder ? items.filter((i) => i.folder === folder) : items), [items, folder]);
  const hits = useHybridSearch(scoped, filter, (i) => [i.name, i.id]);
  const chips = [...present.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <aside className="lt-picker">
      <div className="lt-picker-head">
        <h3>Add items</h3>
        <p className={`lt-picker-target ${canAdd ? '' : 'off'}`}>
          {canAdd ? <>Click an item to add it to <b>{targetLabel}</b>.</> : targetLabel ? <>To add items, {targetLabel}.</> : 'Pick a table first.'}
        </p>
        <SearchBox value={filter} onChange={setFilter} placeholder="Search items…" />
        <div className="lt-picker-chips">
          <button className={`lt-chip ${folder == null ? 'on' : ''}`} onClick={() => setFolder(null)}>All {items.length}</button>
          {chips.map(([f, n]) => (
            <button key={f} className={`lt-chip ${folder === f ? 'on' : ''}`} onClick={() => setFolder(folder === f ? null : f)} title={f}>
              <span aria-hidden>{getFolderTheme(f).emoji}</span> {chipLabel(f)} <span className="lt-chip-n">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <VirtualList
        className="lt-picker-list"
        items={hits}
        rowHeight={40}
        overscan={8}
        keyOf={(h) => h.item.id}
        renderItem={(h) => (
          <button
            className="lt-pick"
            disabled={!canAdd}
            onClick={() => onPick(h.item.id)}
            title={canAdd ? `Add ${h.item.name} (${h.item.id})` : h.item.id}
          >
            <ItemIcon id={h.item.id} size={26} />
            <span className="lt-pick-name"><HighlightedText text={h.item.name} ranges={h.ranges} /></span>
            <span className="lt-pick-add" aria-hidden>＋</span>
          </button>
        )}
      />
      <div className="lt-picker-foot">{hits.length} of {items.length} items</div>
    </aside>
  );
}

function ownerFolder(defs: Defs, staticId: string): string {
  return presentedRecord(defs, staticId)?.folder ?? 'static_item_definitions';
}

function chipLabel(folder: string): string {
  const base = folder.replace(/_definitions?$/, '').replace(/_item$/, '').replace(/_/g, ' ');
  return base === 'static' ? 'world only' : base;
}
