import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { humanizeAssetId } from '../definitionsNaming';
import { getFolderTheme } from '../folderTheme';
import { ItemPalette } from '../ItemPalette';
import { VirtualList } from '../VirtualList';
import { HighlightedText } from '../HighlightedText';
import { type RankedHit } from '../../search/fuzzy';
import { useHybridSearch } from '../../search/hybrid';
import { useJumpToDefinition } from '../useJumpToDefinition';
import { SearchBox } from '../SearchBox';
import { PropertyEchoProvider, usePropertyEcho } from './PropertyEchoContext';
import { DetailPane } from './DetailPane';
import { ResizeHandle } from './ResizeHandle';
import { CollapseStrip } from './CollapseStrip';
import { SpreadsheetView } from './SpreadsheetView';
import { BulkEditDialog } from './BulkEditDialog';
import type { ClassBrowserConfig } from './types';
import { DEFAULT_WARNINGS } from './RowWarnings';
import type { WarningRule, WarningSeverity, WarningCtx } from './types';

interface Props {
  folder: string;
  config: ClassBrowserConfig;
}

function severityOrder(s: WarningSeverity): number {
  switch (s) { case 'error': return 3; case 'warn': return 2; case 'info': return 1; }
}

function clampWidth(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

const RAIL_W_LS = 'tsic.classBrowser.layout.rail.w.v1';
const PALETTE_W_LS = 'tsic.classBrowser.layout.palette.w.v1';
const RAIL_COLLAPSED_LS = 'tsic.classBrowser.layout.rail.collapsed.v1';
const PALETTE_COLLAPSED_LS = 'tsic.classBrowser.layout.palette.collapsed.v1';
const RAIL_DEFAULT_W = 260;
const PALETTE_DEFAULT_W = 280;
const RAIL_MIN_W = 180;
const PALETTE_MIN_W = 200;
const RAIL_MAX_W = 600;
const PALETTE_MAX_W = 600;

const SPLIT_RATIO_LS = (folder: string) => `tsic.classBrowser.${folder}.split.ratio.v1`;
const PIN_LS = (folder: string) => `tsic.classBrowser.${folder}.pin.v1`;
const SPLIT_DEFAULT_RATIO = 0.5;
const SPLIT_MIN_RATIO = 0.2;
const SPLIT_MAX_RATIO = 0.8;

export function ClassBrowserTab({ folder, config }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const jumpToDef = useJumpToDefinition();

  const warningCtx: WarningCtx = useMemo(() => ({
    records: definitions,
    findKeyById,
    createDefinitionForClass,
    updateValueAtPath,
  }), [definitions, findKeyById, createDefinitionForClass, updateValueAtPath]);

  const allRules = useMemo<WarningRule[]>(
    () => [...DEFAULT_WARNINGS, ...(config.warnings ?? [])],
    [config.warnings],
  );

  const warningsForRow = (key: DefinitionsKey): { rule: WarningRule; text: string }[] => {
    const rec = definitions.get(key);
    if (!rec) return [];
    const out: { rule: WarningRule; text: string }[] = [];
    for (const rule of allRules) {
      const text = rule.test(rec, warningCtx);
      if (text) out.push({ rule, text });
    }
    return out;
  };

  const [filter, setFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<DefinitionsKey | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<DefinitionsKey>>(() => new Set());
  const [lastClickedKey, setLastClickedKey] = useState<DefinitionsKey | null>(null);
  const MODE_LS_KEY = `tsic.classBrowser.${folder}.mode.v1`;
  const [mode, setMode] = useState<'detail' | 'spreadsheet'>(() => {
    try {
      const v = localStorage.getItem(MODE_LS_KEY);
      if (v === 'compare') return 'detail'; // legacy migration
      if (v === 'detail' || v === 'spreadsheet') return v;
    } catch { /* noop */ }
    return 'detail';
  });
  useEffect(() => {
    try { localStorage.setItem(MODE_LS_KEY, mode); } catch { /* noop */ }
  }, [mode, MODE_LS_KEY]);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Layout state — global across folders.
  const [railWidth, setRailWidth] = useState<number>(() => {
    try { const v = localStorage.getItem(RAIL_W_LS); if (v) return clampWidth(Number(v), RAIL_MIN_W, RAIL_MAX_W); } catch { /* noop */ }
    return RAIL_DEFAULT_W;
  });
  const [paletteWidth, setPaletteWidth] = useState<number>(() => {
    try { const v = localStorage.getItem(PALETTE_W_LS); if (v) return clampWidth(Number(v), PALETTE_MIN_W, PALETTE_MAX_W); } catch { /* noop */ }
    return PALETTE_DEFAULT_W;
  });
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_COLLAPSED_LS) === '1'; } catch { return false; }
  });
  const [paletteCollapsed, setPaletteCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(PALETTE_COLLAPSED_LS) === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(RAIL_W_LS, String(railWidth)); } catch { /* noop */ } }, [railWidth]);
  useEffect(() => { try { localStorage.setItem(PALETTE_W_LS, String(paletteWidth)); } catch { /* noop */ } }, [paletteWidth]);
  useEffect(() => { try { localStorage.setItem(RAIL_COLLAPSED_LS, railCollapsed ? '1' : '0'); } catch { /* noop */ } }, [railCollapsed]);
  useEffect(() => { try { localStorage.setItem(PALETTE_COLLAPSED_LS, paletteCollapsed ? '1' : '0'); } catch { /* noop */ } }, [paletteCollapsed]);

  // Pin + split state — per-folder.
  const [pinnedKey, setPinnedKey] = useState<DefinitionsKey | null>(() => {
    try {
      const v = localStorage.getItem(PIN_LS(folder));
      return v && v.length > 0 ? (v as DefinitionsKey) : null;
    } catch { return null; }
  });
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const v = localStorage.getItem(SPLIT_RATIO_LS(folder));
      const n = v ? Number(v) : NaN;
      if (Number.isFinite(n)) return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, n));
    } catch { /* noop */ }
    return SPLIT_DEFAULT_RATIO;
  });
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      if (pinnedKey) localStorage.setItem(PIN_LS(folder), pinnedKey);
      else localStorage.removeItem(PIN_LS(folder));
    } catch { /* noop */ }
  }, [pinnedKey, folder]);
  useEffect(() => { try { localStorage.setItem(SPLIT_RATIO_LS(folder), String(splitRatio)); } catch { /* noop */ } }, [splitRatio, folder]);

  // Stale-pin guard: drop pin when its record is gone.
  useEffect(() => {
    if (pinnedKey && !definitions.has(pinnedKey)) setPinnedKey(null);
  }, [definitions, pinnedKey]);

  const duplicateOne = (sourceKey: DefinitionsKey): DefinitionsKey | null => {
    const rec = definitions.get(sourceKey);
    if (!rec) return null;
    const base = rec.id;
    const tryIds = [`${base}_Copy`, ...Array.from({ length: 50 }, (_, i) => `${base}_Copy${i + 2}`)];
    let newId: string | null = null;
    for (const id of tryIds) { if (!findKeyById(id)) { newId = id; break; } }
    if (!newId) return null;
    const newKey = createDefinitionForClass(rec.json?.class?.replace(/^U/, ''), newId);
    if (!newKey) return null;
    // Deep-clone properties from the source.
    const cloned = structuredClone(rec.json?.properties ?? {});
    updateValueAtPath(newKey, ['properties'], cloned);
    return newKey;
  };

  const duplicateSelected = () => {
    const sources = Array.from(selectedKeys);
    let last: DefinitionsKey | null = null;
    for (const k of sources) {
      const newKey = duplicateOne(k);
      if (newKey) last = newKey;
    }
    if (last) {
      setSelectedKey(last);
      setSelectedKeys(new Set([last]));
    }
  };

  type Row = { key: DefinitionsKey; id: string };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const [k, rec] of definitions) {
      if (rec.folder !== folder) continue;
      out.push({ key: k, id: rec.id });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }, [definitions, folder]);

  // Reset selection when folder changes (sub-tab switch).
  useEffect(() => {
    setSelectedKey(null);
    setSelectedKeys(new Set());
    setLastClickedKey(null);
    try {
      const k = `tsic.classBrowser.${folder}.mode.v1`;
      const v = localStorage.getItem(k);
      if (v === 'compare') { localStorage.setItem(k, 'detail'); setMode('detail'); }
      else if (v === 'detail' || v === 'spreadsheet') setMode(v);
      else setMode('detail');
    } catch { setMode('detail'); }
    // Re-load per-folder pin and split ratio.
    try {
      const v = localStorage.getItem(PIN_LS(folder));
      setPinnedKey(v && v.length > 0 ? (v as DefinitionsKey) : null);
    } catch { setPinnedKey(null); }
    try {
      const v = localStorage.getItem(SPLIT_RATIO_LS(folder));
      const n = v ? Number(v) : NaN;
      setSplitRatio(Number.isFinite(n) ? Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, n)) : SPLIT_DEFAULT_RATIO);
    } catch { setSplitRatio(SPLIT_DEFAULT_RATIO); }
    setLeftCollapsed(false);
    setRightCollapsed(false);
  }, [folder]);

  const filtered = useHybridSearch(
    rows, filter,
    (r) => [humanizeAssetId(r.id), r.id],
    { semanticKey: (r) => r.key },
  ) as RankedHit<Row>[];

  const handleRailClick = (e: React.MouseEvent, key: DefinitionsKey) => {
    if (e.shiftKey && lastClickedKey) {
      const ids = filtered.map((h) => h.item.key);
      const a = ids.indexOf(lastClickedKey);
      const b = ids.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const next = new Set(selectedKeys);
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
        setSelectedKeys(next);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedKeys);
      if (next.has(key)) next.delete(key); else next.add(key);
      setSelectedKeys(next);
      setLastClickedKey(key);
      return;
    }
    setSelectedKeys(new Set([key]));
    setLastClickedKey(key);
    setSelectedKey(key);
  };

  if (selectedKey == null && rows.length > 0) setSelectedKey(rows[0].key);

  const theme = getFolderTheme(folder);

  // Publish the warning-fix context on a global so the RailColumn child can
  // invoke rule.fix(rec, ctx) without us threading another prop down. Only
  // one ClassBrowserTab is mounted at a time, so collisions aren't possible.
  // This is a deliberate small hack to keep the RailColumn signature lean.
  (window as any).__cbCtx = warningCtx;

  return (
    <PropertyEchoProvider>
      <div
        className={`class-browser ${railCollapsed ? 'rail-collapsed' : ''} ${paletteCollapsed ? 'palette-collapsed' : ''}`}
        style={{
          ['--cb-rail-w' as any]: `${railWidth}px`,
          ['--cb-palette-w' as any]: `${paletteWidth}px`,
        } as React.CSSProperties}
      >
        {railCollapsed ? (
          <CollapseStrip side="left" onExpand={() => setRailCollapsed(false)} label="Expand record list" />
        ) : (
          <RailColumn
            filtered={filtered}
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            selectedKeys={selectedKeys}
            handleRailClick={handleRailClick}
            setSelectedKeys={setSelectedKeys}
            setLastClickedKey={setLastClickedKey}
            setMode={setMode}
            setBulkOpen={setBulkOpen}
            duplicateSelected={duplicateSelected}
            duplicateOne={duplicateOne}
            theme={theme}
            config={config}
            findKeyById={findKeyById}
            createDefinitionForClass={createDefinitionForClass}
            filter={filter}
            setFilter={setFilter}
            jumpToDef={jumpToDef}
            warningsForRow={warningsForRow}
            definitions={definitions}
            onCollapse={() => setRailCollapsed(true)}
          />
        )}

        {!railCollapsed && (
          <ResizeHandle
            label="Resize record list"
            onDelta={(dx) => setRailWidth((w) => clampWidth(w + dx, RAIL_MIN_W, RAIL_MAX_W))}
            onReset={() => setRailWidth(RAIL_DEFAULT_W)}
          />
        )}

        <EchoPublishingPane>
          <div className="mode-toggle">
            <button className={mode === 'detail' ? 'active' : ''} onClick={() => setMode('detail')}>Detail</button>
            <button className={mode === 'spreadsheet' ? 'active' : ''} onClick={() => setMode('spreadsheet')}>Spreadsheet</button>
          </div>
          {mode === 'detail' && (
            pinnedKey == null ? (
              <DetailPane
                assetKey={selectedKey}
                pinned={false}
                onPin={() => selectedKey && setPinnedKey(selectedKey)}
                onRenamed={(k) => setSelectedKey(k)}
              />
            ) : (
              <div
                ref={splitContainerRef}
                className={`split-pane ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}
                style={{
                  ['--cb-split-left' as any]: `${splitRatio * 100}%`,
                  ['--cb-split-right' as any]: `${(1 - splitRatio) * 100}%`,
                } as React.CSSProperties}
              >
                {leftCollapsed ? (
                  <CollapseStrip side="left" onExpand={() => setLeftCollapsed(false)} label="Expand left pane" />
                ) : (
                  <div className="split-half left">
                    <button
                      className="split-collapse-btn left"
                      title="Collapse left pane"
                      aria-label="Collapse left pane"
                      onClick={() => setLeftCollapsed(true)}
                    >‹</button>
                    <DetailPane
                      assetKey={selectedKey}
                      pinned={false}
                      onPin={() => selectedKey && setPinnedKey(selectedKey)}
                      onRenamed={(k) => setSelectedKey(k)}
                    />
                  </div>
                )}
                {!leftCollapsed && !rightCollapsed && (
                  <ResizeHandle
                    label="Resize split"
                    onDelta={(dx) => {
                      const el = splitContainerRef.current;
                      if (!el) return;
                      const width = el.getBoundingClientRect().width;
                      if (width <= 0) return;
                      setSplitRatio((r) => {
                        const next = r + dx / width;
                        return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, next));
                      });
                    }}
                    onReset={() => setSplitRatio(SPLIT_DEFAULT_RATIO)}
                  />
                )}
                {rightCollapsed ? (
                  <CollapseStrip side="right" onExpand={() => setRightCollapsed(false)} label="Expand right pane" />
                ) : (
                  <div className="split-half right">
                    <button
                      className="split-collapse-btn right"
                      title="Collapse right pane"
                      aria-label="Collapse right pane"
                      onClick={() => setRightCollapsed(true)}
                    >›</button>
                    <DetailPane
                      assetKey={pinnedKey}
                      pinned={true}
                      onUnpin={() => setPinnedKey(null)}
                    />
                  </div>
                )}
              </div>
            )
          )}
          {mode === 'spreadsheet' && (
            <SpreadsheetView
              rows={rows.map((r) => ({ key: r.key, rec: definitions.get(r.key)! })).filter((r) => r.rec)}
              config={config}
              onPickRow={(k) => { setSelectedKey(k); setSelectedKeys(new Set([k])); setMode('detail'); }}
            />
          )}
        </EchoPublishingPane>

        {!paletteCollapsed && (
          <ResizeHandle
            label="Resize item palette"
            onDelta={(dx) => setPaletteWidth((w) => clampWidth(w - dx, PALETTE_MIN_W, PALETTE_MAX_W))}
            onReset={() => setPaletteWidth(PALETTE_DEFAULT_W)}
          />
        )}

        {paletteCollapsed ? (
          <CollapseStrip side="right" onExpand={() => setPaletteCollapsed(false)} label="Expand item palette" />
        ) : (
          <ItemPalette
            folders={config.paletteFolders ?? [folder, 'crafting_material_definitions', 'consumable_definitions', 'ammo_definitions']}
            title="Items"
            onCollapse={() => setPaletteCollapsed(true)}
          />
        )}

        {bulkOpen && (
          <BulkEditDialog
            selectedKeys={Array.from(selectedKeys)}
            onClose={() => setBulkOpen(false)}
          />
        )}
      </div>
    </PropertyEchoProvider>
  );
}

function RailColumn(props: {
  filtered: any[];
  selectedKey: DefinitionsKey | null;
  setSelectedKey: (k: DefinitionsKey) => void;
  selectedKeys: Set<DefinitionsKey>;
  handleRailClick: (e: React.MouseEvent, k: DefinitionsKey) => void;
  setSelectedKeys: (s: Set<DefinitionsKey>) => void;
  setLastClickedKey: (k: DefinitionsKey | null) => void;
  setMode: (m: 'detail' | 'spreadsheet') => void;
  setBulkOpen: (b: boolean) => void;
  duplicateSelected: () => void;
  duplicateOne: (k: DefinitionsKey) => DefinitionsKey | null;
  theme: { color: string; emoji: string };
  config: ClassBrowserConfig;
  findKeyById: (id: string) => DefinitionsKey | null;
  createDefinitionForClass: (cls: string, id: string) => DefinitionsKey | null;
  filter: string;
  setFilter: (s: string) => void;
  jumpToDef: (id: string) => void;
  warningsForRow: (k: DefinitionsKey) => { rule: WarningRule; text: string }[];
  definitions: Map<DefinitionsKey, any>;
  onCollapse?: () => void;
}) {
  const {
    filtered, selectedKey, setSelectedKey, selectedKeys, handleRailClick,
    setSelectedKeys, setLastClickedKey, setMode, setBulkOpen, duplicateSelected, duplicateOne,
    theme, config, findKeyById,
    createDefinitionForClass, filter, setFilter, jumpToDef, warningsForRow, definitions,
    onCollapse,
  } = props;
  const { echo, setEcho } = usePropertyEcho();

  // Esc clears the property-echo (so the rail doesn't get stuck showing it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEcho(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setEcho]);

  const valueAtPath = (json: any, path: string[]): any => {
    let cur: any = json;
    for (const seg of path) { if (cur == null) return undefined; cur = cur[seg]; }
    return cur;
  };
  const fmtEcho = (v: any): string => {
    if (v == null) return '—';
    if (typeof v === 'string') return v.length > 14 ? v.slice(0, 12) + '…' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      if (v.type === 'array') return `[${(v.value ?? []).length}]`;
      if (v.type === 'map') return `{${(v.value ?? []).length}}`;
      if (v.type === 'struct') {
        const name = v.struct_name ?? 'struct';
        return name.length > 14 ? name.slice(0, 12) + '…' : name;
      }
      if ('value' in v) return fmtEcho(v.value);
    }
    return JSON.stringify(v).slice(0, 14);
  };

  return (
    <aside className="rail">
      <div className="rail-header">
        {onCollapse && (
          <button className="rail-collapse-btn" title="Collapse" aria-label="Collapse record list" onClick={onCollapse}>‹</button>
        )}
        <h3>{config.label}</h3>
        <SearchBox value={filter} onChange={setFilter} placeholder="search…" />
        <div className="rail-add-row">
          <button className="add-row" onClick={() => {
            let n = 1;
            const tpl = config.idTemplate ?? ((i: number) => `ID_New${i}`);
            let id = tpl(n);
            while (findKeyById(id)) { n++; id = tpl(n); }
            const k = createDefinitionForClass(config.newRecordClass, id);
            if (k) setSelectedKey(k);
          }}>＋ New {config.label}</button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state-mini">No records.</div>
      ) : (
        <VirtualList
          className="rail-body"
          items={filtered}
          rowHeight={30}
          keyOf={(h: any) => h.item.key}
          renderItem={(h: any) => {
            const rec = definitions.get(h.item.key);
            const echoVal = echo && rec ? fmtEcho(valueAtPath(rec.json, echo.path)) : null;
            const ws = warningsForRow(h.item.key);
            const top = ws.length ? ws.sort((a, b) => severityOrder(b.rule.severity) - severityOrder(a.rule.severity))[0] : null;
            return (
              <button
                className={`rail-row ${selectedKey === h.item.key ? 'selected' : ''} ${selectedKeys.has(h.item.key) ? 'selected-multi' : ''}`}
                onClick={(e) => handleRailClick(e, h.item.key)}
                style={{ borderLeft: `3px solid ${theme.color}` }}
                title={`${h.item.id}\nMiddle-click to open in Definitions`}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(h.item.id); } }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              >
                <span className="emoji" aria-hidden>{theme.emoji}</span>
                <span className="label"><HighlightedText text={humanizeAssetId(h.item.id)} ranges={h.ranges} /></span>
                {echoVal != null && <span className="row-echo">{echoVal}</span>}
                <button
                  className="row-dup"
                  title="Duplicate"
                  onClick={(e) => { e.stopPropagation(); duplicateOne(h.item.key); }}
                >⎘</button>
                {top && (
                  <span
                    className={`row-warning sev-${top.rule.severity}`}
                    title={ws.map((w) => `[${w.rule.severity}] ${w.text}`).join('\n')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (top.rule.fix) {
                        const rec2 = definitions.get(h.item.key);
                        if (rec2) top.rule.fix(rec2, (window as any).__cbCtx);
                      }
                    }}
                  >{ws.length}</span>
                )}
              </button>
            );
          }}
        />
      )}
      {selectedKeys.size >= 2 && (
        <div className="action-bar">
          <span>{selectedKeys.size} selected</span>
          <button onClick={() => setBulkOpen(true)}>Bulk edit…</button>
          <button onClick={() => duplicateSelected()}>Duplicate × {selectedKeys.size}</button>
          <button onClick={() => { setSelectedKeys(new Set()); setLastClickedKey(null); }}>Clear</button>
        </div>
      )}
    </aside>
  );
}

function EchoPublishingPane({ children }: { children: ReactNode }) {
  const { setEcho } = usePropertyEcho();
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    let el: HTMLElement | null = e.target as HTMLElement;
    while (el) {
      const p = el.dataset?.propPath;
      if (p) { try { setEcho({ path: JSON.parse(p) as string[] }); } catch { /* ignore bad json */ } return; }
      el = el.parentElement;
    }
  };
  return <section className="class-browser-pane" onClickCapture={onClick}>{children}</section>;
}
