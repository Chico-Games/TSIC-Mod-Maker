import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../../store/definitionsStore';
import { useAppStore } from '../../store/appStore';
import { humanizeAssetId } from '../definitionsNaming';
import { getFolderTheme } from '../folderTheme';
import { ItemPalette } from '../ItemPalette';
import { VirtualList } from '../VirtualList';
import { HighlightedText } from '../HighlightedText';
import { type RankedHit } from '../../search/fuzzy';
import { useHybridSearch } from '../../search/hybrid';
import { useJumpToDefinition } from '../useJumpToDefinition';
import { AssetTitle } from '../AssetTitle';
import { SearchBox } from '../SearchBox';
import { TypedPropertiesEditor } from '../TypedValueEditor';
import { useRefAdapter } from '../useRefAdapter';
import { PropertyEchoProvider, usePropertyEcho } from './PropertyEchoContext';
import { WhereUsedPanel } from './WhereUsedPanel';
import { SpreadsheetView } from './SpreadsheetView';
import { CompareView } from './CompareView';
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

export function ClassBrowserTab({ folder, config }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const updateValueAtPath = useDefinitionsStore((s) => s.updateValueAtPath);
  const createDefinitionForClass = useDefinitionsStore((s) => s.createDefinitionForClass);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);
  const jumpToDef = useJumpToDefinition();

  const refAdapter = useRefAdapter((id) => {
    const k = findKeyById(id);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  });

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
  const [mode, setMode] = useState<'detail' | 'spreadsheet' | 'compare'>(() => {
    try {
      const v = localStorage.getItem(MODE_LS_KEY);
      if (v === 'detail' || v === 'spreadsheet' || v === 'compare') return v;
    } catch { /* noop */ }
    return 'detail';
  });
  useEffect(() => {
    try { localStorage.setItem(MODE_LS_KEY, mode); } catch { /* noop */ }
  }, [mode, MODE_LS_KEY]);
  const [bulkOpen, setBulkOpen] = useState(false);

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
      const v = localStorage.getItem(`tsic.classBrowser.${folder}.mode.v1`);
      if (v === 'detail' || v === 'spreadsheet' || v === 'compare') setMode(v);
      else setMode('detail');
    } catch { setMode('detail'); }
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

  const selected = selectedKey ? definitions.get(selectedKey) : null;
  const theme = getFolderTheme(folder);

  // Publish the warning-fix context on a global so the RailColumn child can
  // invoke rule.fix(rec, ctx) without us threading another prop down. Only
  // one ClassBrowserTab is mounted at a time, so collisions aren't possible.
  // This is a deliberate small hack to keep the RailColumn signature lean.
  (window as any).__cbCtx = warningCtx;

  return (
    <PropertyEchoProvider>
      <div className="class-browser">
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
        />

        <EchoPublishingPane>
          <div className="mode-toggle">
            <button className={mode === 'detail' ? 'active' : ''} onClick={() => setMode('detail')}>Detail</button>
            <button className={mode === 'spreadsheet' ? 'active' : ''} onClick={() => setMode('spreadsheet')}>Spreadsheet</button>
            <button className={mode === 'compare' ? 'active' : ''} disabled={selectedKeys.size < 2} onClick={() => setMode('compare')}>Compare</button>
          </div>
          {mode === 'detail' && (selected && selectedKey ? (
            <>
              <header className="station-header">
                <div className="station-title">
                  <span aria-hidden>{theme.emoji}</span>
                  <AssetTitle assetKey={selectedKey} onRenamed={(newKey) => setSelectedKey(newKey)} />
                  <span className="cls">{String(selected.json?.class ?? '').replace(/^U/, '')}</span>
                </div>
                <div className="station-sub">
                  <span className="muted">id:</span> <code>{selected.id}</code>
                </div>
              </header>

              <TypedPropertiesEditor
                parentTypeName={String(selected.json?.class ?? '').replace(/^U/, '')}
                properties={selected.json?.properties ?? {}}
                showAllFields={false}
                onChange={(next) => updateValueAtPath(selectedKey, ['properties'], next)}
                refAdapter={refAdapter}
                ownerKey={selectedKey}
              />
              {selected && <WhereUsedPanel assetId={selected.id} />}
            </>
          ) : <div className="empty-state-mini">Pick a record from the rail.</div>)}
          {mode === 'spreadsheet' && (
            <SpreadsheetView
              rows={rows.map((r) => ({ key: r.key, rec: definitions.get(r.key)! })).filter((r) => r.rec)}
              config={config}
              onPickRow={(k) => { setSelectedKey(k); setSelectedKeys(new Set([k])); setMode('detail'); }}
            />
          )}
          {mode === 'compare' && selectedKeys.size >= 2 && (
            <CompareView selected={Array.from(selectedKeys).slice(0, 3)} />
          )}
          {mode === 'compare' && selectedKeys.size < 2 && <div className="empty-state-mini">Pick 2 or 3 records on the rail to compare.</div>}
        </EchoPublishingPane>

        <ItemPalette
          folders={config.paletteFolders ?? [folder, 'crafting_material_definitions', 'consumable_definitions', 'ammo_definitions']}
          title="Items"
        />
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
  setMode: (m: 'detail' | 'spreadsheet' | 'compare') => void;
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
}) {
  const {
    filtered, selectedKey, setSelectedKey, selectedKeys, handleRailClick,
    setSelectedKeys, setLastClickedKey, setMode, setBulkOpen, duplicateSelected, duplicateOne,
    theme, config, findKeyById,
    createDefinitionForClass, filter, setFilter, jumpToDef, warningsForRow, definitions,
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
    return JSON.stringify(v).slice(0, 14);
  };

  return (
    <aside className="rail">
      <div className="rail-header">
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
          <button disabled={selectedKeys.size > 3} title={selectedKeys.size > 3 ? 'Compare supports max 3' : 'Compare'} onClick={() => setMode('compare')}>Compare</button>
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
