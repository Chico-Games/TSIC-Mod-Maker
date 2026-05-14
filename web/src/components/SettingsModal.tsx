import { useEffect, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { getShowDeveloperActions, setShowDeveloperActions } from '../persistence/devFlags';
import { getDefaultSourceHandle } from '../persistence/defaultSourceSetting';
import { PublishDefaultModal } from './PublishDefaultModal';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const projectsRootHandle = useDefinitionsStore((s) => s.projectsRootHandle);
  const projectsInRoot = useDefinitionsStore((s) => s.projectsInRoot);
  const setProjectsRootHandle = useDefinitionsStore((s) => s.setProjectsRootHandle);
  const clearProjectsRootHandle = useDefinitionsStore((s) => s.clearProjectsRootHandle);
  const refreshProjectsInRoot = useDefinitionsStore((s) => s.refreshProjectsInRoot);

  const setDefaultProjectSource = useDefinitionsStore((s) => s.setDefaultProjectSource);
  const clearDefaultProjectSource = useDefinitionsStore((s) => s.clearDefaultProjectSource);

  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fsa = typeof (window as any).showDirectoryPicker === 'function';

  const [defaultHandleName, setDefaultHandleName] = useState<string | null>(null);
  const [devOn, setDevOn] = useState(getShowDeveloperActions());
  const [showPublish, setShowPublish] = useState(false);
  const [defaultPicking, setDefaultPicking] = useState(false);

  useEffect(() => {
    void getDefaultSourceHandle().then((h) => setDefaultHandleName(h?.name ?? null));
  }, []);

  useEffect(() => {
    if (projectsRootHandle) void refreshProjectsInRoot();
  }, [projectsRootHandle, refreshProjectsInRoot]);

  const pickRoot = async () => {
    const w = window as any;
    if (!w.showDirectoryPicker) return;
    setPicking(true);
    setError(null);
    try {
      const h: FileSystemDirectoryHandle = await w.showDirectoryPicker({ mode: 'readwrite' });
      await setProjectsRootHandle(h);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(String(e));
    } finally {
      setPicking(false);
    }
  };

  const clearRoot = async () => {
    setError(null);
    await clearProjectsRootHandle();
  };

  return (
    <>
    <div className="new-project-overlay" onClick={onClose}>
      <div className="new-project-form" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>⚙ Settings</h2>

        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--muted)' }}>Projects folder</h3>
        <p style={{ margin: '0 0 0.75rem', color: 'var(--muted)', fontSize: '0.9em' }}>
          Pick one folder on disk to be the home for all your projects. Each project
          will be its own subfolder under it. <strong>Save As</strong> creates a
          subfolder named after the project, and the projects dropdown lists them.
        </p>

        <div className="np-form-row">
          <label>Current</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.9em', color: projectsRootHandle ? 'var(--text)' : 'var(--muted)' }}>
              {projectsRootHandle ? projectsRootHandle.name : '— not set —'}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => void pickRoot()} disabled={picking || !fsa}>
                {picking ? 'Picking…' : projectsRootHandle ? 'Change…' : '📂 Choose folder'}
              </button>
              {projectsRootHandle && (
                <button onClick={() => void clearRoot()} title="Forget the configured projects folder">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {projectsRootHandle && (
          <div className="np-form-row" style={{ alignItems: 'flex-start' }}>
            <label>Projects found</label>
            <div style={{ flex: 1, maxHeight: '12rem', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: '0.4rem 0.6rem', background: 'var(--panel-2)' }}>
              {projectsInRoot.length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '0.9em' }}>No projects yet.</span>
              )}
              {projectsInRoot.map((p) => (
                <div key={p.folderName} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', padding: '0.15rem 0' }}>
                  <span>{p.name}</span>
                  <span style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: '0.85em' }}>
                    {p.folderName}{p.hasMeta ? '' : ' (no project.json)'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!fsa && (
          <p style={{ color: 'var(--warn)', margin: '0.5rem 0', fontSize: '0.9em' }}>
            File System Access API unavailable — use Chrome / Edge / Brave.
          </p>
        )}
        {error && <p style={{ color: 'var(--error)', margin: '0.5rem 0' }}>{error}</p>}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0' }} />

        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--muted)' }}>Default project</h3>
        <p style={{ margin: '0 0 0.75rem', color: 'var(--muted)', fontSize: '0.9em' }}>
          The Default Project is the baseline that every project layers on top of.
          By default it is the bundled tree shipped with the editor (loaded over HTTP).
          Devs can point at a local copy on disk to load read-write and publish new versions from.
        </p>

        <div className="np-form-row">
          <label>Location</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.9em', color: defaultHandleName ? 'var(--text)' : 'var(--muted)' }}>
              {defaultHandleName ?? 'Bundled (HTTP)'}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={async () => {
                  const w = window as any;
                  if (!w.showDirectoryPicker) return;
                  setDefaultPicking(true);
                  setError(null);
                  try {
                    const h: FileSystemDirectoryHandle = await w.showDirectoryPicker({ mode: 'readwrite' });
                    await setDefaultProjectSource(h);
                    setDefaultHandleName(h.name);
                  } catch (e) {
                    if ((e as Error)?.name !== 'AbortError') setError(String(e));
                  } finally {
                    setDefaultPicking(false);
                  }
                }}
                disabled={defaultPicking || !fsa}
              >
                {defaultPicking ? 'Picking…' : defaultHandleName ? 'Change…' : '📂 Choose folder'}
              </button>
              {defaultHandleName && (
                <button
                  onClick={async () => {
                    await clearDefaultProjectSource();
                    setDefaultHandleName(null);
                  }}
                  title="Forget the configured default-project folder"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="np-form-row">
          <label>
            <input
              type="checkbox"
              checked={devOn}
              onChange={(e) => { setDevOn(e.target.checked); setShowDeveloperActions(e.target.checked); }}
            />
            {' '}Show developer actions
          </label>
        </div>

        {devOn && (
          <div className="np-form-row">
            <label />
            <div>
              <button onClick={() => setShowPublish(true)}>
                Publish as new Default Project version…
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
    {showPublish && <PublishDefaultModal onClose={() => setShowPublish(false)} />}
    </>
  );
}
