import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore, type AppTab } from '../store/appStore';

export function Header() {
  const directoryHandle = useDefinitionsStore((s) => s.directoryHandle);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const dirty = useDefinitionsStore((s) => s.dirty);
  const folders = useDefinitionsStore((s) => s.folders);
  const loading = useDefinitionsStore((s) => s.loading);
  const pickDirectory = useDefinitionsStore((s) => s.pickDirectory);
  const saveAllDirty = useDefinitionsStore((s) => s.saveAllDirty);
  const saveAs = useDefinitionsStore((s) => s.saveAs);
  const loadBundledDefaults = useDefinitionsStore((s) => s.loadBundledDefaults);
  const reload = useDefinitionsStore((s) => s.reload);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);

  const dirtyCount = dirty.size;
  const fsa = typeof (window as any).showDirectoryPicker === 'function';

  const tabs: Array<{ id: AppTab; label: string; badge?: number }> = [
    { id: 'recipes-loot', label: 'Recipes & Loot' },
    { id: 'furniture-loot', label: 'Furniture Loot' },
    { id: 'definitions', label: 'Definitions' },
    { id: 'validations', label: 'Validations' },
  ];

  return (
    <div className="header">
      <h1>TSIC Crafting Tool</h1>
      <span className="file-info">
        {directoryHandle ? (directoryHandle.name ?? 'folder') : 'bundled defaults'}
        {' · '}
        {definitions.size} defs · {folders.length} folders
        {dirtyCount > 0 && <span className="dirty"> · {dirtyCount} unsaved</span>}
        {loading && <span> · loading…</span>}
      </span>
      <div className="spacer" />
      <button onClick={() => setSearchOpen(true)} title="Ctrl+K">⌘K Search</button>
      <button onClick={pickDirectory} disabled={!fsa}>📂 Open folder</button>
      <button onClick={() => void saveAllDirty()} disabled={dirtyCount === 0 || !directoryHandle}>
        💾 Save{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
      </button>
      <button onClick={() => void saveAs()} disabled={!fsa || definitions.size === 0}>Save as…</button>
      <button onClick={() => void loadBundledDefaults()}>↺ Bundled defaults</button>
      {directoryHandle && <button onClick={() => void reload()} title="Reload from disk">⟳ Reload</button>}
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && <span className="badge">{t.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
