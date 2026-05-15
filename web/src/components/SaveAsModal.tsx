import { useEffect, useRef, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

export function SaveAsModal({ onClose }: { onClose: () => void }) {
  const projectsRootHandle = useDefinitionsStore((s) => s.projectsRootHandle);
  const projectsInRoot = useDefinitionsStore((s) => s.projectsInRoot);
  const projectMeta = useDefinitionsStore((s) => s.projectMeta);
  const saveAs = useDefinitionsStore((s) => s.saveAs);
  const refreshProjectsInRoot = useDefinitionsStore((s) => s.refreshProjectsInRoot);

  const [name, setName] = useState(projectMeta?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectsRootHandle) void refreshProjectsInRoot();
    inputRef.current?.select();
  }, [projectsRootHandle, refreshProjectsInRoot]);

  const trimmed = name.trim();
  const collision = projectsInRoot.some((p) => p.folderName === trimmed);
  const valid = trimmed.length > 0 && NAME_RE.test(trimmed);

  const submit = async () => {
    if (!valid) {
      setError('Use letters, numbers, spaces, _ . - (must start with a letter or number).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveAs({ targetName: trimmed });
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="new-project-overlay" onClick={onClose}>
      <div className="new-project-form" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 0.5rem' }}>💾 Save as…</h2>
        <p style={{ margin: '0 0 1rem', color: 'var(--muted)', fontSize: '0.9em' }}>
          Saving under <span style={{ fontFamily: 'monospace' }}>{projectsRootHandle?.name ?? '—'}</span>.
          A subfolder with the project name will be created (or reused).
        </p>

        <div className="np-form-row">
          <label>Project name</label>
          <input
            ref={inputRef}
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid && !busy) void submit(); }}
            placeholder="My Project"
            style={{ width: '20rem' }}
          />
        </div>

        {collision && (
          <p style={{ color: 'var(--warn)', margin: '0.25rem 0', fontSize: '0.9em' }}>
            A folder named <strong>{trimmed}</strong> already exists. Saving will overwrite its contents.
          </p>
        )}
        {error && <p style={{ color: 'var(--error)', margin: '0.5rem 0' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !valid}>
            {busy ? 'Saving…' : (collision ? 'Overwrite & save' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
