import { useDefinitionsStore } from '../store/definitionsStore';

export function LoadGate() {
  const futureBlock = useDefinitionsStore((s) => s.futureVersionBlock);
  const dismissFuture = useDefinitionsStore((s) => s.dismissFutureVersionBlock);

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

  return null;
}
