import { useDefinitionsStore } from '../store/definitionsStore';

export function LoadGate() {
  const futureBlock = useDefinitionsStore((s) => s.futureVersionBlock);
  const dismissFuture = useDefinitionsStore((s) => s.dismissFutureVersionBlock);
  const gate = useDefinitionsStore((s) => s.loadGate);
  const dismissGate = useDefinitionsStore((s) => s.dismissLoadGate);

  if (futureBlock) {
    return (
      <div className="loadgate-overlay" onClick={dismissFuture}>
        <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
          <h2>This project needs a newer editor</h2>
          <p>
            The project's <code>project.json</code> declares{' '}
            <code>schema_version: {futureBlock.foundVersion}</code>, but this editor only
            supports up to <code>{futureBlock.supportedVersion}</code>.
          </p>
          <p>Update the editor before opening this project to avoid data loss.</p>
          <div className="loadgate-actions">
            <button autoFocus onClick={dismissFuture}>Got it</button>
          </div>
        </div>
      </div>
    );
  }

  if (gate && gate.mode === 'drift') {
    const shown = gate.issues.filter((i) => i.recordKey !== '__and_more__').slice(0, 50);
    const sentinel = gate.issues.find((i) => i.recordKey === '__and_more__');
    const more = (gate.issues.length - shown.length) - (sentinel ? 1 : 0);
    return (
      <div className="loadgate-overlay" onClick={() => dismissGate('cancel')}>
        <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
          <h2>Schema drift detected</h2>
          <p>
            The following records use classes or properties that don't appear in the current app schema.
            You can load them and edit anyway; schema drift won't block saves.
          </p>
          <ul className="loadgate-issues">
            {shown.map((i, idx) => (
              <li key={idx}>
                {i.kind === 'unknown-class' && (
                  <>Unknown class <code>{i.className}</code> in <code>{i.recordKey}</code></>
                )}
                {i.kind === 'unknown-property' && (
                  <>
                    Unknown property <code>{i.parentType}.{i.propertyName}</code> in <code>{i.recordKey}</code>
                  </>
                )}
              </li>
            ))}
            {(more > 0 || sentinel) && (
              <li>
                <em>…and {more > 0 ? more : 'many'} more.</em>
              </li>
            )}
          </ul>
          <div className="loadgate-actions">
            <button onClick={() => dismissGate('cancel')}>Cancel</button>
            <button autoFocus onClick={() => dismissGate('continue')}>
              Continue anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gate && gate.mode === 'structural') {
    const shown = gate.issues.slice(0, 50);
    const more = gate.issues.length - shown.length;
    return (
      <div className="loadgate-overlay" onClick={() => dismissGate('cancel')}>
        <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
          <h2>
            {gate.issues.length} problem{gate.issues.length === 1 ? '' : 's'} loading this project
          </h2>
          <p>The following files are structurally invalid and will be skipped if you continue.</p>
          <ul className="loadgate-issues">
            {shown.map((i, idx) => (
              <li key={idx}>
                <code>{i.folder}/{i.file}</code> —{' '}
                {i.kind === 'invalid-json' && <>invalid JSON: {i.error}</>}
                {i.kind === 'missing-field' && (
                  <>missing required field <code>{i.field}</code></>
                )}
                {i.kind === 'id-mismatch' && (
                  <>id <code>{i.json_id}</code> ≠ filename <code>{i.file_id}</code></>
                )}
              </li>
            ))}
            {more > 0 && (
              <li>
                <em>…and {more} more.</em>
              </li>
            )}
          </ul>
          <div className="loadgate-actions">
            <button onClick={() => dismissGate('cancel')}>Cancel</button>
            <button autoFocus onClick={() => dismissGate('continue')}>
              Continue anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
