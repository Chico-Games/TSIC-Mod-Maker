import { useEffect, useMemo, useState } from 'react';
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
import { PropertyEchoProvider } from './PropertyEchoContext';
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
  useEffect(() => { setSelectedKey(null); }, [folder]);

  const filtered = useHybridSearch(
    rows, filter,
    (r) => [humanizeAssetId(r.id), r.id],
    { semanticKey: (r) => r.key },
  ) as RankedHit<Row>[];

  if (selectedKey == null && rows.length > 0) setSelectedKey(rows[0].key);

  const selected = selectedKey ? definitions.get(selectedKey) : null;
  const theme = getFolderTheme(folder);

  return (
    <PropertyEchoProvider>
      <div className="class-browser">
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
              keyOf={(h) => h.item.key}
              renderItem={(h) => (
                <button
                  className={`rail-row ${selectedKey === h.item.key ? 'selected' : ''}`}
                  onClick={() => setSelectedKey(h.item.key)}
                  style={{ borderLeft: `3px solid ${theme.color}` }}
                  title={`${h.item.id}\nMiddle-click to open in Definitions`}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); jumpToDef(h.item.id); } }}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                >
                  <span className="emoji" aria-hidden>{theme.emoji}</span>
                  <span className="label">
                    <HighlightedText text={humanizeAssetId(h.item.id)} ranges={h.ranges} />
                  </span>
                  {(() => {
                    const ws = warningsForRow(h.item.key);
                    if (ws.length === 0) return null;
                    const top = ws.sort((a, b) => severityOrder(b.rule.severity) - severityOrder(a.rule.severity))[0];
                    return (
                      <span
                        className={`row-warning sev-${top.rule.severity}`}
                        title={ws.map(w => `[${w.rule.severity}] ${w.text}`).join('\n')}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (top.rule.fix) {
                            const rec = definitions.get(h.item.key);
                            if (rec) top.rule.fix(rec, warningCtx);
                          }
                        }}
                      >{ws.length}</span>
                    );
                  })()}
                </button>
              )}
            />
          )}
        </aside>

        <section className="class-browser-pane">
          {selected && selectedKey ? (
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
            </>
          ) : (
            <div className="empty-state-mini">Pick a record from the rail.</div>
          )}
        </section>

        <ItemPalette
          folders={config.paletteFolders ?? [folder, 'crafting_material_definitions', 'consumable_definitions', 'ammo_definitions']}
          title="Items"
        />
      </div>
    </PropertyEchoProvider>
  );
}
