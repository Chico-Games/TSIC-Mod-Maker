import { useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';

export function PublishDefaultModal(props: { onClose: () => void }) {
  const def = useDefinitionsStore((s) => s.defaultProject);
  const publish = useDefinitionsStore((s) => s.publishAsNewDefaultVersion);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const cur = def?.meta.version ?? 0;
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Publish as new Default Project version</h2>
        <p>
          This will overwrite the picked folder with the current working set and bump the default
          version from <b>v{cur}</b> to <b>v{cur + 1}</b>.
        </p>
        <label>
          Optional label:{' '}
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
            placeholder="e.g. 2026-05 winter pass"
          />
        </label>
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button onClick={props.onClose} disabled={busy}>Cancel</button>
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await publish({ label: label.trim() || undefined });
                props.onClose();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Pick folder + publish
          </button>
        </div>
      </div>
    </div>
  );
}
