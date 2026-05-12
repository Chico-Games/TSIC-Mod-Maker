import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore, type AppTab } from '../store/appStore';
import { SemanticChip } from './SemanticChip';
import { useEffect, useRef, useState } from 'react';

function relativeTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

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
  const projectMeta = useDefinitionsStore((s) => s.projectMeta);
  const definitions = useDefinitionsStore((s) => s.definitions);
  const dirty = useDefinitionsStore((s) => s.dirty);
  const folders = useDefinitionsStore((s) => s.folders);
  const loading = useDefinitionsStore((s) => s.loading);
  const openProject = useDefinitionsStore((s) => s.openProject);
  const pickDirectory = useDefinitionsStore((s) => s.pickDirectory);
  const createProject = useDefinitionsStore((s) => s.createProject);
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
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const recents = useDefinitionsStore((s) => s.recents);
  const openRecent = useDefinitionsStore((s) => s.openRecent);
  const refreshRecents = useDefinitionsStore((s) => s.refreshRecents);
  const dataSource = useDefinitionsStore((s) => s.dataSource);
  const readOnly = dataSource?.readOnly ?? true;
  useEffect(() => { void refreshRecents(); }, [refreshRecents]);

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
    syncBlocker = "No project open. Click 'Open project' or 'New project' to get started.";
  } else if (readOnly) {
    syncBlocker = 'Starter project is read-only. Save As to make this project editable.';
  } else if (dirtyCount > 0) {
    syncBlocker = `Save the ${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'} before syncing.`;
  } else if (!unrealSyncPath) {
    syncBlocker = 'Set the absolute path to the Unreal Definitions folder (⚙ button) first.';
  }

  const syncTitle = syncBlocker ?? 'Reconcile this JSON tree into Unreal (UE assets are mutated in place).';

  const tabs: Array<{ id: AppTab; label: string; badge?: number }> = [
    { id: 'recipes-loot', label: 'Recipes & Loot' },
    { id: 'items', label: 'Items' },
    { id: 'furniture', label: 'Furniture' },
    { id: 'definitions', label: 'Definitions' },
    { id: 'layouts', label: 'Layouts' },
    { id: 'validations', label: 'Validations' },
  ];

  // Derive the display name for file-info line.
  const projectDisplayName = projectMeta?.name ?? directoryHandle?.name ?? null;

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
        {dataSource
          ? (projectDisplayName ? `Project: ${projectDisplayName}` : `Project: ${dataSource.displayName}`)
          : 'no project'}
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
      <div className="open-project-split">
        <button onClick={() => void openProject()} disabled={!fsa}>📂 Open project</button>
        <button
          className="open-project-chevron"
          disabled={!fsa}
          onClick={() => setRecentsOpen((v) => !v)}
          title="Recent projects"
        >▾</button>
        {recentsOpen && (
          <div className="recents-dropdown" onMouseLeave={() => setRecentsOpen(false)}>
            {recents.filter((r) => r.handleName !== 'starter-project').length === 0 && (
              <div className="recents-empty">No recent projects yet.</div>
            )}
            {recents.map((r) => (
              <button
                key={r.handleName}
                className="recents-item"
                onClick={async () => { setRecentsOpen(false); await openRecent(r.handleName); }}
              >
                <span className="recents-name">{r.name}</span>
                <span className="recents-time">{relativeTime(r.lastOpened)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => setNewProjectOpen(true)} disabled={!fsa} title="Create a new project folder">✨ New project</button>
      <button
        onClick={() => void saveAllDirty()}
        disabled={dirtyCount === 0 || !directoryHandle || readOnly}
        title={readOnly ? 'This source is read-only — use Save As to write changes.' : undefined}
      >
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
        title="Set the absolute path to the Unreal Definitions folder for this project (used by Sync to Unreal)"
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

      {pathEditing && (
        <div className="path-editor-overlay" onClick={() => setPathEditing(false)}>
          <div className="path-editor" onClick={(e) => e.stopPropagation()}>
            <label>Absolute path to Unreal Definitions folder for this project (for Sync to Unreal):</label>
            <input
              autoFocus
              defaultValue={unrealSyncPath}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void setUnrealSyncPath((e.target as HTMLInputElement).value.trim());
                  setPathEditing(false);
                } else if (e.key === 'Escape') {
                  setPathEditing(false);
                }
              }}
              onBlur={(e) => {
                void setUnrealSyncPath(e.target.value.trim());
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

      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreate={async (opts) => {
            setNewProjectOpen(false);
            await createProject(opts);
          }}
        />
      )}
    </div>
  );
}

interface NewProjectOpts {
  handle: FileSystemDirectoryHandle;
  name: string;
  ueSyncPath?: string;
  seedFromBundled?: boolean;
}

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (opts: NewProjectOpts) => Promise<void>;
}) {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [name, setName] = useState('');
  const [ueSyncPath, setUeSyncPath] = useState('');
  const [seed, setSeed] = useState(true);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const pickFolder = async () => {
    const w = window as any;
    if (!w.showDirectoryPicker) return;
    setPicking(true);
    try {
      const h: FileSystemDirectoryHandle = await w.showDirectoryPicker({ mode: 'readwrite' });
      setHandle(h);
      // Pre-fill name from folder name if blank.
      if (!name) setName(h.name);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(String(e));
    } finally {
      setPicking(false);
    }
  };

  const handleCreate = async () => {
    if (!handle) { setError('Pick a folder first.'); return; }
    if (!name.trim()) { setError('Project name is required.'); return; }
    setCreating(true);
    setError(null);
    try {
      await onCreate({
        handle,
        name: name.trim(),
        ueSyncPath: ueSyncPath.trim() || undefined,
        seedFromBundled: seed,
      });
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  };

  return (
    <div className="new-project-overlay" onClick={onClose}>
      <div className="new-project-form" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>✨ New project</h2>

        <div className="np-form-row">
          <label>Folder</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.9em', color: '#ccc' }}>
              {handle ? handle.name : '—'}
            </span>
            <button onClick={() => void pickFolder()} disabled={picking}>
              {picking ? 'Picking…' : '📂 Choose folder'}
            </button>
          </div>
        </div>

        <div className="np-form-row">
          <label>Project name</label>
          <input
            ref={nameRef}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My TSIC Project"
            style={{ width: '20rem' }}
          />
        </div>

        <div className="np-form-row">
          <label>Unreal sync path <span style={{ opacity: 0.6 }}>(optional)</span></label>
          <input
            value={ueSyncPath}
            onChange={(e) => setUeSyncPath(e.target.value)}
            placeholder="C:\...\Tools\Export\test-output\Definitions"
            style={{ width: '30rem', fontFamily: 'monospace' }}
          />
        </div>

        <div className="np-form-row">
          <label>Seed from bundled defaults?</label>
          <input
            type="checkbox"
            checked={seed}
            onChange={(e) => setSeed(e.target.checked)}
            style={{ width: 'auto', accentColor: 'var(--accent)' }}
          />
        </div>

        {error && <p style={{ color: '#f88', margin: '0.5rem 0' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={creating}>Cancel</button>
          <button onClick={() => void handleCreate()} disabled={creating || !handle}>
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
