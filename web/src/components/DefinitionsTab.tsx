import { useEffect, useMemo, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { JsonValueEditor } from './JsonValueEditor';
import { TypedPropertiesEditor, type PinAdapter, type RefAdapter } from './TypedValueEditor';
import { ReferenceViewer } from './ReferenceViewer';
import { humanizeAssetId } from './definitionsNaming';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import { getFolderTheme } from './folderTheme';
import { DefinitionsTable } from './DefinitionsTable';
import { RecipeBuilderView, isRecipeFolder } from './RecipeBuilderView';

// Three-pane layout:
//   left: folder list (one per definition class)
//   middle: file list within selected folder
//   right: schema-aware editor for the selected file
// A toolbar at the top covers picking the path, reload, save, save-all,
// and export.

export function DefinitionsTab() {
  const {
    directoryHandle,
    definitions,
    folders,
    dirty,
    selectedFolder,
    selectedKey,
    filter,
    autoLoadEnabled,
    loading,
    loadedAt,
    pickDirectory,
    forgetDirectory,
    reload,
    selectFolder,
    selectDefinition,
    setFilter,
    setAutoLoad,
    saveOne,
    saveAllDirty,
    revertOne,
    updateValueAtPath,
    replaceJson,
    exportZip,
    findKeyById,
    createDefinition,
    createDefinitionForClass,
    assetsOfClass,
    lookupContainerType,
    getPropertyMeta,
    lookupArrayElementClass,
    classNodes,
    changeClass,
    pinnedProperties,
    togglePinnedProperty,
    getEnumMembers,
    renameAsset,
    findItemStaticPair,
    duplicateDefinition,
    deleteDefinition,
    searchAll,
    findOrphanReferences,
    findItemStaticOrphans,
    outgoingReferences,
    incomingReferences,
  } = useDefinitionsStore();

  const [globalQuery, setGlobalQuery] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [folderQuery, setFolderQuery] = useState('');
  const [viewMode, setViewMode] = useState<'form' | 'table' | 'recipe'>('form');
  /** Extra keys included in the multi-select. The primary `selectedKey`
   *  in the store always counts. */
  const [extraSelected, setExtraSelected] = useState<Set<string>>(new Set());
  const [showAllFields, setShowAllFields] = useState(() => {
    try { return localStorage.getItem('tsic.def.showAll.v1') === '1'; }
    catch { return false; }
  });
  const setShowAll = (v: boolean) => {
    setShowAllFields(v);
    try { localStorage.setItem('tsic.def.showAll.v1', v ? '1' : '0'); } catch { /* noop */ }
  };

  const fsaSupported = typeof (window as any).showDirectoryPicker === 'function';

  // Files in the currently selected folder, filtered by search.
  const filesInFolder = useMemo(() => {
    if (!selectedFolder) return [];
    const out: { key: string; id: string }[] = [];
    const q = filter.trim().toLowerCase();
    for (const [key, rec] of definitions.entries()) {
      if (rec.folder !== selectedFolder) continue;
      if (q && !rec.id.toLowerCase().includes(q)) continue;
      out.push({ key, id: rec.id });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }, [definitions, selectedFolder, filter]);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const rec of definitions.values()) {
      counts[rec.folder] = (counts[rec.folder] ?? 0) + 1;
    }
    return counts;
  }, [definitions]);

  const folderDirtyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const k of dirty) {
      const rec = definitions.get(k);
      if (rec) counts[rec.folder] = (counts[rec.folder] ?? 0) + 1;
    }
    return counts;
  }, [dirty, definitions]);

  const totalDirty = dirty.size;
  const totalDefs = definitions.size;
  const selected = selectedKey ? definitions.get(selectedKey) : null;
  const selectedDirty = selectedKey ? dirty.has(selectedKey) : false;

  const onExport = async () => {
    try {
      const blob = await exportZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tsic-definitions.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    }
  };

  const headerLabel = directoryHandle
    ? `Target: ${directoryHandle.name}`
    : 'No directory selected';

  return (
    <div className="def-layout">
      <div className="def-toolbar">
        <span className={`def-target ${directoryHandle ? '' : 'def-target-none'}`}>
          {headerLabel}
        </span>
        <button onClick={pickDirectory} disabled={!fsaSupported} title="Pick the Definitions root directory">
          {directoryHandle ? 'Change…' : 'Pick directory…'}
        </button>
        {directoryHandle && (
          <button onClick={reload} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
        )}
        {directoryHandle && (
          <button onClick={forgetDirectory} title="Stop auto-loading from this path">
            Forget path
          </button>
        )}
        <label className="def-autoload" title="Auto-load on app start">
          <input
            type="checkbox"
            checked={autoLoadEnabled}
            onChange={(e) => setAutoLoad(e.target.checked)}
          />
          Auto-load
        </label>
        <div className="spacer" />
        <span className="def-stats">
          {totalDefs} files · {Object.keys(folderCounts).length} folders
          {totalDirty > 0 && <span className="def-dirty"> · {totalDirty} unsaved</span>}
          {loadedAt && <span className="def-loaded"> · loaded {timeAgo(loadedAt)}</span>}
        </span>
        <button
          onClick={() => selectedKey && saveOne(selectedKey)}
          disabled={!selectedDirty}
        >
          Save current
        </button>
        <button
          onClick={() => saveAllDirty()}
          disabled={totalDirty === 0}
          className={totalDirty > 0 ? 'primary' : ''}
        >
          Save all ({totalDirty})
        </button>
        <button onClick={onExport} disabled={totalDefs === 0}>
          Export ZIP
        </button>
      </div>

      {directoryHandle && totalDefs > 0 && (
        <div className="def-toolbar def-subbar">
          <input
            type="text"
            className="def-global-search"
            placeholder="Global search (id or any string property)…"
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
          />
          <button
            onClick={() => setShowCreate((v) => !v)}
            className={showCreate ? 'primary' : ''}
            disabled={!selectedFolder}
            title="Create a new definition in the current folder"
          >+ New in folder</button>
          <button
            onClick={() => {
              if (!selectedKey) return;
              const rec = definitions.get(selectedKey)!;
              const newId = window.prompt(`Duplicate "${rec.id}" — new asset name:`, rec.id + '_copy');
              if (newId) duplicateDefinition(selectedKey, newId);
            }}
            disabled={!selectedKey}
          >⎘ Duplicate</button>
          <button
            className="danger"
            disabled={!selectedKey}
            onClick={async () => {
              if (!selectedKey) return;
              const rec = definitions.get(selectedKey)!;
              if (!window.confirm(`Delete ${rec.id}.json? This will delete the file from disk if it exists.`)) return;
              await deleteDefinition(selectedKey);
            }}
          >🗑 Delete</button>
          <div className="spacer" />
          <label className="def-autoload" title="Reveal noisy/engine fields normally hidden">
            <input
              type="checkbox"
              checked={showAllFields}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show all fields
          </label>
          <button
            onClick={() => setShowValidation((v) => !v)}
            className={showValidation ? 'primary' : ''}
          >
            {showValidation ? 'Hide' : 'Show'} validation
          </button>
          <div className="def-view-mode" role="group" aria-label="Editor view">
            <button
              type="button"
              className={viewMode === 'form' ? 'primary' : ''}
              onClick={() => setViewMode('form')}
            >Form</button>
            <button
              type="button"
              className={viewMode === 'table' ? 'primary' : ''}
              onClick={() => setViewMode('table')}
              title="Edit multiple selected definitions side-by-side"
            >Table{extraSelected.size + (selectedKey ? 1 : 0) > 1 ? ` (${extraSelected.size + (selectedKey ? 1 : 0)})` : ''}</button>
            {isRecipeFolder(selectedFolder) && (
              <button
                type="button"
                className={viewMode === 'recipe' ? 'primary' : ''}
                onClick={() => setViewMode('recipe')}
                title="Recipe builder — drag items into ingredient/output slots"
              >Recipes</button>
            )}
          </div>
        </div>
      )}

      {showCreate && selectedFolder && (
        <CreateDefinitionPanel
          folder={selectedFolder}
          existing={definitions}
          onCancel={() => setShowCreate(false)}
          onCreate={(folder, id, template) => {
            const k = createDefinition(folder, id, template);
            if (k) setShowCreate(false);
          }}
        />
      )}

      {showValidation && (
        <ValidationPanel
          issues={findOrphanReferences()}
          pairIssues={findItemStaticOrphans()}
          onJump={(k) => {
            const rec = definitions.get(k);
            if (!rec) return;
            selectFolder(rec.folder);
            selectDefinition(k);
          }}
        />
      )}

      {globalQuery && (
        <SearchResults
          query={globalQuery}
          results={searchAll(globalQuery, 80)}
          onJump={(k) => {
            const rec = definitions.get(k);
            if (!rec) return;
            selectFolder(rec.folder);
            selectDefinition(k);
            setGlobalQuery('');
          }}
        />
      )}

      {!fsaSupported && (
        <div className="def-warning">
          Your browser does not support the File System Access API. Use a recent
          Chromium-based browser (Chrome, Edge, Brave) for this feature.
        </div>
      )}

      {!directoryHandle && totalDefs === 0 ? (
        <div className="def-empty-state">
          <h2>Pick a Definitions root</h2>
          <p>
            Point this at the folder generated by{' '}
            <code>Tools/Export/export_definitions.py</code> — typically{' '}
            <code>Documents\Unreal Projects\TSIC\Tools\Export\test-output\Definitions</code>.
            The path is remembered between sessions. You can also click
            <em> Load test project</em> in the header to start from the
            bundled sample data.
          </p>
          <button className="primary" onClick={pickDirectory} disabled={!fsaSupported}>
            Pick directory…
          </button>
        </div>
      ) : directoryHandle && totalDefs === 0 && !loading ? (
        <div className="def-empty-state">
          <h2>No JSON files found</h2>
          <p>The chosen directory has no <code>*_definitions/*.json</code> files.</p>
          <button onClick={reload}>Reload</button>
        </div>
      ) : (
        <div className="def-grid">
          <div className="def-folders">
            <div className="def-pane-head">
              <input
                type="text"
                placeholder="Filter types…"
                value={folderQuery}
                onChange={(e) => setFolderQuery(e.target.value)}
              />
            </div>
            <ul>
              {folders
                .filter((f) => {
                  if (!folderQuery.trim()) return true;
                  const q = folderQuery.trim().toLowerCase();
                  return f.toLowerCase().includes(q) || prettifyFolder(f).toLowerCase().includes(q);
                })
                .map((f) => {
                  const theme = getFolderTheme(f);
                  return (
                    <li
                      key={f}
                      className={`def-folder ${f === selectedFolder ? 'active' : ''}`}
                      style={{ ['--def-folder-color' as any]: theme.color }}
                      onClick={() => selectFolder(f)}
                      title={f}
                    >
                      <span className="def-folder-emoji" aria-hidden="true">{theme.emoji}</span>
                      <span className="def-folder-name">{prettifyFolder(f)}</span>
                      <span className="def-folder-count">
                        {folderCounts[f] ?? 0}
                        {folderDirtyCounts[f] ? <span className="def-dirty">·{folderDirtyCounts[f]}</span> : null}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>

          <div className="def-files">
            <div className="def-pane-head">
              <input
                type="text"
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <ul>
              {filesInFolder.map((f) => {
                const isDirty = dirty.has(f.key);
                const isPrimary = f.key === selectedKey;
                const isExtra = extraSelected.has(f.key);
                return (
                  <li
                    key={f.key}
                    className={`${isPrimary ? 'active' : ''} ${isExtra ? 'extra-selected' : ''}`.trim()}
                    onClick={(e) => {
                      // Cmd/Ctrl-click toggles multi-select (without
                      // changing the primary selection). Plain click
                      // resets multi-select to just this file.
                      if (e.ctrlKey || e.metaKey) {
                        setExtraSelected((cur) => {
                          const next = new Set(cur);
                          if (next.has(f.key)) next.delete(f.key);
                          else next.add(f.key);
                          // The primary selection is itself part of the
                          // multi-select; flipping it off via ctrl-click
                          // shouldn't deselect — leave selectedKey alone.
                          return next;
                        });
                      } else {
                        setExtraSelected(new Set());
                        selectDefinition(f.key);
                      }
                    }}
                    title={f.id}
                  >
                    <span className="def-file-name">{humanizeAssetId(f.id)}</span>
                    {isDirty && <span className="def-dirty-dot" title="Unsaved" />}
                  </li>
                );
              })}
              {filesInFolder.length === 0 && (
                <li className="def-empty-li">{selectedFolder ? 'No matches.' : 'Pick a type on the left.'}</li>
              )}
            </ul>
          </div>

          <div className="def-editor">
            {viewMode === 'recipe' && selectedFolder && isRecipeFolder(selectedFolder) ? (
              <RecipeBuilderView folder={selectedFolder} />
            ) : viewMode === 'table' ? (
              (() => {
                const keys = new Set(extraSelected);
                if (selectedKey) keys.add(selectedKey);
                const records = [...keys]
                  .map((k) => definitions.get(k))
                  .filter((r): r is NonNullable<typeof r> => !!r)
                  .map((r) => ({ key: `${r.folder}/${r.id}`, folder: r.folder, id: r.id, json: r.json }));
                if (records.length === 0) {
                  return (
                    <div className="def-empty-state">
                      <p>Pick one or more files (Ctrl/Cmd-click for additional rows).</p>
                    </div>
                  );
                }
                return (
                  <DefinitionsTable
                    records={records}
                    refAdapter={{
                      options: (className) => assetsOfClass(className),
                      resolves: (assetId) => findKeyById(assetId) != null,
                      navigate: (assetId) => {
                        const k = findKeyById(assetId);
                        if (!k) return;
                        const rec = definitions.get(k);
                        if (!rec) return;
                        selectFolder(rec.folder);
                        selectDefinition(k);
                      },
                      createNew: (className, id) => {
                        if (!className || !id) return null;
                        const k = createDefinitionForClass(className, id);
                        if (!k) return null;
                        return id;
                      },
                      lookupContainerType: (path, slot) => lookupContainerType(path, slot),
                      getPropertyMeta: (parent, propName) => getPropertyMeta(parent, propName),
                      lookupArrayElementClass: (parent, propName) => lookupArrayElementClass(parent, propName),
                      getEnumMembers: (enumName) => getEnumMembers(enumName),
                      folderForId: (assetId) => {
                        const k = findKeyById(assetId);
                        if (!k) return null;
                        return definitions.get(k)?.folder ?? null;
                      },
                    }}
                    pinAdapter={{
                      isPinned: (name) => pinnedProperties.has(name),
                      toggle: (name) => togglePinnedProperty(name),
                    }}
                    showAllFields={showAllFields}
                    onChangeAt={(k, path, value) => updateValueAtPath(k, path, value)}
                    onReplaceJson={(k, json) => replaceJson(k, json)}
                  />
                );
              })()
            ) : selected ? (
              <DefinitionEditor
                key={selectedKey ?? ''}
                rec={selected}
                isDirty={selectedDirty}
                showAllFields={showAllFields}
                onChange={(path, value) => updateValueAtPath(selectedKey!, path, value)}
                onReplace={(json) => replaceJson(selectedKey!, json)}
                onSave={() => saveOne(selectedKey!)}
                onRevert={() => revertOne(selectedKey!)}
                onChangeClass={(cls) => changeClass(selectedKey!, cls)}
                classNodes={classNodes}
                pinAdapter={{
                  isPinned: (name) => pinnedProperties.has(name),
                  toggle: (name) => togglePinnedProperty(name),
                }}
                outgoing={outgoingReferences(selectedKey!)}
                incoming={incomingReferences(selectedKey!)}
                onJumpToKey={(k) => {
                  const rec = definitions.get(k);
                  if (!rec) return;
                  selectFolder(rec.folder);
                  selectDefinition(k);
                }}
                refAdapter={{
                  options: (className) => assetsOfClass(className),
                  resolves: (assetId) => findKeyById(assetId) != null,
                  navigate: (assetId) => {
                    const k = findKeyById(assetId);
                    if (!k) return;
                    const rec = definitions.get(k);
                    if (!rec) return;
                    selectFolder(rec.folder);
                    selectDefinition(k);
                  },
                  createNew: (className, id) => {
                    if (!className || !id) return null;
                    const k = createDefinitionForClass(className, id);
                    if (!k) return null;
                    return id;
                  },
                  lookupContainerType: (path, slot) => lookupContainerType(path, slot),
                  getPropertyMeta: (parent, propName) => getPropertyMeta(parent, propName),
                  lookupArrayElementClass: (parent, propName) => lookupArrayElementClass(parent, propName),
                  getEnumMembers: (enumName) => getEnumMembers(enumName),
                  folderForId: (assetId) => {
                    const k = findKeyById(assetId);
                    if (!k) return null;
                    return definitions.get(k)?.folder ?? null;
                  },
                }}
                onRename={(bareName) => renameAsset(selectedKey!, bareName)}
                pairKey={findItemStaticPair(selectedKey!)}
                partnerRec={(() => {
                  const pk = findItemStaticPair(selectedKey!);
                  return pk ? definitions.get(pk) ?? null : null;
                })()}
                onPartnerChange={(path, value) => {
                  const pk = findItemStaticPair(selectedKey!);
                  if (pk) updateValueAtPath(pk, path, value);
                }}
                onJumpToPair={(k) => {
                  const rec = definitions.get(k);
                  if (!rec) return;
                  selectFolder(rec.folder);
                  selectDefinition(k);
                }}
              />
            ) : (
              <div className="def-empty-state">
                <p>Select a file on the left to edit it.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function prettifyFolder(folder: string): string {
  return folder
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function DefinitionEditor({
  rec,
  isDirty,
  showAllFields,
  onChange,
  onReplace: _onReplace,  // eslint-disable-line @typescript-eslint/no-unused-vars
  onSave,
  onRevert,
  onChangeClass,
  onRename,
  pairKey,
  onJumpToPair,
  partnerRec,
  onPartnerChange,
  classNodes,
  pinAdapter,
  refAdapter,
  outgoing,
  incoming,
  onJumpToKey,
}: {
  rec: { folder: string; id: string; json: any; originalText: string };
  isDirty: boolean;
  showAllFields: boolean;
  onChange: (path: (string | number)[], value: any) => void;
  onReplace: (json: any) => void;
  onSave: () => void;
  onRevert: () => void;
  onChangeClass: (newClass: string) => void;
  onRename: (newBareName: string) => void;
  pairKey: string | null;
  onJumpToPair: (key: string) => void;
  /** When the selected asset has an Item↔StaticItem partner, the
   *  partner record is passed in so its properties render inline
   *  under the main editor — letting the user edit both halves of
   *  the pair without jumping. */
  partnerRec?: { folder: string; id: string; json: any } | null;
  onPartnerChange?: (path: (string | number)[], value: any) => void;
  classNodes: Map<string, { name: string; parents: string[]; folder: string | null }>;
  pinAdapter: PinAdapter;
  refAdapter: RefAdapter;
  outgoing: Array<{ refClass: string; refValue: string; refPath: string; targetKey: string | null }>;
  incoming: Array<{ sourceKey: string; sourceFolder: string; sourceId: string; refClass: string; refPath: string }>;
  onJumpToKey: (key: string) => void;
}) {
  // Editor head shows: editable bare-name input on the left, class
  // SearchableSelect on the right, action buttons after. The full
  // prefix/suffix id and asset_path round-trip through the rename
  // pipeline — the user never sees or edits them directly.
  const json = rec.json;
  const propertiesKey = 'properties' in (json ?? {}) ? 'properties' : null;
  const bareClass = String(json.class ?? '').replace(/^U/, '');

  const [propSearch, setPropSearch] = useState('');
  const [groupBy, setGroupBy] = useState<'default' | 'type' | 'category'>('default');
  const [bareNameDraft, setBareNameDraft] = useState(humanizeAssetId(rec.id));
  // Item↔StaticItem inline partner panel: collapsible, defaults open
  // when a partner exists so users see both halves at once.
  const [showPartner, setShowPartner] = useState(true);

  useEffect(() => {
    setPropSearch('');
    setBareNameDraft(humanizeAssetId(rec.id));
  }, [rec.id]);

  const commitRename = () => {
    const trimmed = bareNameDraft.trim();
    if (!trimmed) {
      setBareNameDraft(humanizeAssetId(rec.id));
      return;
    }
    if (trimmed === humanizeAssetId(rec.id)) return;
    onRename(trimmed);
  };

  // SearchableSelect options for the class dropdown — each ClassNode
  // becomes one entry; the parent chain is the hover hint so the user
  // gets the full hierarchy on focus.
  const classOptions = useMemo<SelectOption[]>(() => {
    const out: SelectOption[] = [];
    for (const node of classNodes.values()) {
      const chain = [node.name, ...node.parents].join(' → ');
      out.push({ value: node.name, label: node.name, hint: chain });
    }
    out.sort((a, b) => a.value.localeCompare(b.value));
    return out;
  }, [classNodes]);

  const classChainTitle = useMemo(() => {
    const node = classNodes.get(json.class) ?? classNodes.get(`U${bareClass}`);
    if (!node) return String(json.class ?? '');
    return [node.name, ...node.parents].join(' → ');
  }, [classNodes, json.class, bareClass]);

  return (
    <div className="def-editor-inner">
      <div className="def-editor-head">
        <input
          type="text"
          className="def-name-input"
          value={bareNameDraft}
          title={`Filename id: ${rec.id}.json`}
          onChange={(e) => setBareNameDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setBareNameDraft(humanizeAssetId(rec.id));
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {isDirty && <span className="def-dirty"> · unsaved</span>}
        {pairKey && (
          <button
            type="button"
            className="def-pair-btn"
            title="Jump to the matching Item / StaticItem partner"
            onClick={() => onJumpToPair(pairKey)}
          >
            ↔ partner
          </button>
        )}
        <div className="spacer" />
        <SearchableSelect
          value={String(json.class ?? '')}
          options={classOptions}
          placeholder="(set class)"
          triggerClassName="def-class-select"
          triggerTitle={classChainTitle}
          allowEmpty={false}
          onChange={(v) => v && onChangeClass(v)}
        />
        <button onClick={onRevert} disabled={!isDirty}>Revert</button>
        <button onClick={onSave} disabled={!isDirty} className={isDirty ? 'primary' : ''}>
          Save
        </button>
      </div>

      <div className="def-editor-body">
        <ReferenceViewer
          outgoing={outgoing}
          incoming={incoming}
          onJump={onJumpToKey}
        />

        {propertiesKey && (
          <section className="def-section">
            <div className="def-prop-toolbar">
              <input
                type="text"
                className="def-prop-search"
                placeholder="Search this asset's properties…"
                value={propSearch}
                onChange={(e) => setPropSearch(e.target.value)}
              />
              <label className="def-prop-group">
                Group:
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
                >
                  <option value="default">Default</option>
                  <option value="type">By Type</option>
                  <option value="category">By Category</option>
                </select>
              </label>
            </div>
            <TypedPropertiesEditor
              properties={json[propertiesKey]}
              parentTypeName={bareClass}
              onChange={(v) => onChange([propertiesKey], v)}
              refAdapter={refAdapter}
              showAllFields={showAllFields}
              propertySearch={propSearch}
              groupBy={groupBy}
              pinAdapter={pinAdapter}
              ownerKey={`${rec.folder}/${rec.id}`}
            />
          </section>
        )}

        {partnerRec && pairKey && onPartnerChange && (
          <section className="def-section def-partner-section">
            <div className="def-partner-head">
              <button
                className="def-partner-toggle"
                onClick={() => setShowPartner((v) => !v)}
                title={showPartner ? 'Collapse partner properties' : 'Expand partner properties'}
              >
                {showPartner ? '▼' : '▶'}
              </button>
              <h4>
                ↔ Partner: <code>{partnerRec.id}</code>
                <span className="muted small"> · {partnerRec.folder.replace(/_definitions?$/, '').replace(/_/g, ' ')}</span>
              </h4>
              <div className="spacer" />
              <button onClick={() => onJumpToPair(pairKey)}>Open partner →</button>
            </div>
            {showPartner && partnerRec.json && 'properties' in partnerRec.json && (
              <TypedPropertiesEditor
                properties={partnerRec.json.properties ?? {}}
                parentTypeName={String(partnerRec.json.class ?? '').replace(/^U/, '')}
                onChange={(v) => onPartnerChange(['properties'], v)}
                refAdapter={refAdapter}
                showAllFields={showAllFields}
                propertySearch=""
                groupBy="default"
                pinAdapter={pinAdapter}
                ownerKey={pairKey}
              />
            )}
          </section>
        )}

        {/* Any remaining top-level keys we don't know about (e.g. exporter
            additions) get a generic editor at the bottom. id, asset_path,
            class, parent_classes are managed via the head bar / rename. */}
        {Object.keys(json)
          .filter((k) => k !== 'id' && k !== 'asset_path' && k !== 'class' && k !== 'parent_classes' && k !== propertiesKey)
          .map((k) => (
            <section className="def-section" key={k}>
              <h4>{k}</h4>
              <JsonValueEditor
                value={json[k]}
                path={[k]}
                onChange={(v) => onChange([k], v)}
              />
            </section>
          ))}
      </div>
    </div>
  );
}

function CreateDefinitionPanel({
  folder,
  existing,
  onCreate,
  onCancel,
}: {
  folder: string;
  existing: Map<string, { folder: string; id: string; json: any }>;
  onCreate: (folder: string, id: string, template?: any) => void;
  onCancel: () => void;
}) {
  // Suggest a template from the first definition in the same folder so the
  // shape (class, parent_classes, properties keys) matches the type. Editable.
  const sample = useMemo(() => {
    for (const rec of existing.values()) {
      if (rec.folder === folder) return rec.json;
    }
    return null;
  }, [existing, folder]);
  const [id, setId] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  return (
    <div className="def-create-panel">
      <strong>New definition in <code>{folder}</code></strong>
      <input
        ref={(el) => el?.focus()}
        type="text"
        placeholder="Asset name (filename stem)"
        value={id}
        onChange={(e) => setId(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && id.trim()) {
            const template = useTemplate && sample
              ? blankFromTemplate(sample, id.trim())
              : undefined;
            onCreate(folder, id.trim(), template);
          }
        }}
      />
      <label className="def-autoload">
        <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
        Use shape from existing {folder}
      </label>
      <div className="spacer" />
      <button
        className="primary"
        disabled={!id.trim()}
        onClick={() => {
          const template = useTemplate && sample
            ? blankFromTemplate(sample, id.trim())
            : undefined;
          onCreate(folder, id.trim(), template);
        }}
      >Create</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

function blankFromTemplate(sample: any, newId: string): any {
  const out = JSON.parse(JSON.stringify(sample));
  if (out && typeof out === 'object') {
    out.id = newId;
    if (typeof out.asset_path === 'string') {
      // Replace the trailing segment with the new id.
      const segs = out.asset_path.split('/');
      segs[segs.length - 1] = newId;
      out.asset_path = segs.join('/');
    }
    // Clear name-y properties so the new asset is obviously a stub.
    if (out.properties && typeof out.properties === 'object') {
      if ('display_name' in out.properties) out.properties.display_name = newId;
      if ('description' in out.properties) out.properties.description = '';
    }
  }
  return out;
}

function ValidationPanel({
  issues,
  pairIssues,
  onJump,
}: {
  issues: Array<{ key: string; folder: string; id: string; refPath: string; refValue: string }>;
  pairIssues: Array<{ key: string; folder: string; id: string; issue: string; detail: string }>;
  onJump: (key: string) => void;
}) {
  return (
    <div className="def-validation-panel">
      <strong>Orphan references ({issues.length})</strong>
      {issues.length === 0 && <span className="def-empty">All references resolve.</span>}
      <div className="def-validation-list">
        {issues.slice(0, 100).map((iss, i) => (
          <div className="def-validation-row" key={i}>
            <a onClick={() => onJump(iss.key)}>
              {iss.folder}/{iss.id}
            </a>
            <span className="def-muted">{iss.refPath}</span>
            <code>{iss.refValue}</code>
          </div>
        ))}
        {issues.length > 100 && (
          <div className="def-empty">Showing first 100 of {issues.length}.</div>
        )}
      </div>
      <strong>Item ↔ StaticItem pairs ({pairIssues.length})</strong>
      {pairIssues.length === 0 && <span className="def-empty">All item/static pairs resolve.</span>}
      <div className="def-validation-list">
        {pairIssues.slice(0, 100).map((iss, i) => (
          <div className="def-validation-row" key={i}>
            <a onClick={() => onJump(iss.key)}>
              {iss.folder}/{iss.id}
            </a>
            <span className="def-muted">{iss.issue}</span>
            <code>{iss.detail}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchResults({
  query,
  results,
  onJump,
}: {
  query: string;
  results: Array<{ key: string; folder: string; id: string; matchPath: string; snippet: string }>;
  onJump: (key: string) => void;
}) {
  return (
    <div className="def-search-results">
      <strong>Search "{query}"</strong>
      <span className="def-muted">{results.length} hits</span>
      <div className="def-search-list">
        {results.length === 0 && <div className="def-empty">No matches.</div>}
        {results.map((r) => (
          <div className="def-search-row" key={r.key}>
            <a onClick={() => onJump(r.key)}>{r.id}</a>
            <span className="def-muted">{r.folder} · {r.matchPath}</span>
            <span className="def-search-snippet">{r.snippet}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
