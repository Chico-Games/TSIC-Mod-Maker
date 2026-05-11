import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore, type AppTab } from '../store/appStore';
import { SemanticChip } from './SemanticChip';
import { useEffect, useState } from 'react';

const SYNC_ENDPOINT = 'http://localhost:13378/sync';

/** Polls the sync endpoint for reachability. Returns "yes" / "no" / "checking"
 *  ("checking" only on first tick before the first fetch resolves). */
function useEditorReachable(): 'yes' | 'no' | 'checking' {
  const [state, setState] = useState<'yes' | 'no' | 'checking'>('checking');

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 1500);
        const resp = await fetch(SYNC_ENDPOINT, {
          method: 'OPTIONS',
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        if (cancelled) return;
        setState(resp.ok || resp.status === 204 ? 'yes' : 'no');
      } catch {
        if (cancelled) return;
        setState('no');
      }
    };
    ping(); // immediate
    const id = window.setInterval(ping, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return state;
}

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
  const syncToUnreal = useDefinitionsStore((s) => s.syncToUnreal);
  const unrealSyncPath = useDefinitionsStore((s) => s.unrealSyncPath);
  const setUnrealSyncPath = useDefinitionsStore((s) => s.setUnrealSyncPath);
  const [syncing, setSyncing] = useState(false);
  const [pathEditing, setPathEditing] = useState(false);

  const editorReachable = useEditorReachable();

  const dirtyCount = dirty.size;
  const fsa = typeof (window as any).showDirectoryPicker === 'function';

  // Decide the Sync-button state. Order matters: most-specific blocker first
  // so the title attribute tells the user the one thing they need to do.
  let syncBlocker: string | null = null;
  if (syncing) {
    syncBlocker = 'Sync already in progress';
  } else if (editorReachable === 'no') {
    syncBlocker = 'Unreal Editor is not reachable at localhost:13378. Launch it (with the TSICEditorSync plugin) and try again.';
  } else if (!directoryHandle) {
    syncBlocker = 'No folder picked. Open the Definitions folder first.';
  } else if (dirtyCount > 0) {
    syncBlocker = `Save the ${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'} before syncing.`;
  } else if (!unrealSyncPath) {
    syncBlocker = 'Set the absolute path to the Definitions folder (⚙ button) first.';
  }

  const syncTitle = syncBlocker ?? 'Reconcile this JSON tree into Unreal (UE assets are mutated in place).';

  const tabs: Array<{ id: AppTab; label: string; badge?: number }> = [
    { id: 'recipes-loot', label: 'Recipes & Loot' },
    { id: 'items', label: 'Items' },
    { id: 'furniture', label: 'Furniture' },
    { id: 'definitions', label: 'Definitions' },
    { id: 'validations', label: 'Validations' },
  ];

  return (
    <div className="header">
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
      <span className="file-info">
        {directoryHandle ? (directoryHandle.name ?? 'folder') : 'bundled defaults'}
        {' · '}
        {definitions.size} defs · {folders.length} folders
        {dirtyCount > 0 && <span className="dirty"> · {dirtyCount} unsaved</span>}
        {loading && <span> · loading…</span>}
        {' · '}
        <span
          title={
            editorReachable === 'yes'
              ? 'Unreal Editor reachable at localhost:13378'
              : editorReachable === 'no'
                ? 'Unreal Editor not running'
                : 'Checking for Unreal Editor…'
          }
          style={{
            color:
              editorReachable === 'yes'
                ? '#7dd87d'
                : editorReachable === 'no'
                  ? '#888'
                  : '#cca747',
          }}
        >
          ● UE {editorReachable === 'yes' ? 'connected' : editorReachable === 'no' ? 'offline' : '…'}
        </span>
      </span>
      <SemanticChip />
      <div className="spacer" />
      <button onClick={() => setSearchOpen(true)} title="Ctrl+K">⌘K Search</button>
      <button onClick={pickDirectory} disabled={!fsa}>📂 Open folder</button>
      <button onClick={() => void saveAllDirty()} disabled={dirtyCount === 0 || !directoryHandle}>
        💾 Save{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
      </button>
      <button
        onClick={async () => {
          setSyncing(true);
          try {
            await syncToUnreal();
          } finally {
            setSyncing(false);
          }
        }}
        disabled={syncBlocker !== null}
        title={syncTitle}
      >
        {syncing ? '⏳ Syncing…' : '🔄 Sync to Unreal'}
      </button>
      <button
        onClick={() => setPathEditing(true)}
        title="Set the absolute path to the Definitions folder (used by Sync to Unreal)"
      >⚙</button>
      <button onClick={() => void saveAs()} disabled={!fsa || definitions.size === 0}>Save as…</button>
      <button
        onClick={async () => {
          await loadBundledDefaults();
          if (typeof (window as any).showDirectoryPicker === 'function') {
            await saveAs();
          }
        }}
        title="Load the bundled sample data into a fresh save folder"
      >📂 Load test project</button>
      {directoryHandle && <button onClick={() => void reload()} title="Reload from disk">⟳ Reload</button>}
      <h1>TSIC Definition Editor</h1>

      {pathEditing && (
        <div className="path-editor-overlay" onClick={() => setPathEditing(false)}>
          <div className="path-editor" onClick={(e) => e.stopPropagation()}>
            <label>Absolute path to Definitions folder (for Sync to Unreal):</label>
            <input
              autoFocus
              defaultValue={unrealSyncPath}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setUnrealSyncPath((e.target as HTMLInputElement).value.trim());
                  setPathEditing(false);
                } else if (e.key === 'Escape') {
                  setPathEditing(false);
                }
              }}
              onBlur={(e) => {
                setUnrealSyncPath(e.target.value.trim());
                setPathEditing(false);
              }}
              style={{ width: '40rem' }}
            />
            <p style={{ fontSize: '0.85em', opacity: 0.7 }}>
              Example: C:\Users\Administrator\Documents\Unreal Projects\TSIC\Tools\Export\test-output\Definitions
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
