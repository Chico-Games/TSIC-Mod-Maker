import { useDefinitionsStore } from '../store/definitionsStore';

function relativeTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'less than a minute ago';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} hr ago`;
  return `${Math.floor(d / 86_400_000)} days ago`;
}

export function RestoreDraftPrompt() {
  const prompt = useDefinitionsStore((s) => s.restoreDraftPrompt);
  const accept = useDefinitionsStore((s) => s.acceptDraftRestore);
  const decline = useDefinitionsStore((s) => s.declineDraftRestore);
  if (!prompt) return null;
  const n = prompt.recordCount;
  return (
    <div className="loadgate-overlay" onClick={() => void decline()}>
      <div className="loadgate-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Restore unsaved changes?</h2>
        <p>
          {n} record{n === 1 ? '' : 's'} ha{n === 1 ? 's' : 've'} unsaved edits from{' '}
          {relativeTime(prompt.savedAt)}.
        </p>
        <div className="loadgate-actions">
          <button onClick={() => void decline()}>Discard</button>
          <button autoFocus onClick={() => void accept()}>Restore</button>
        </div>
      </div>
    </div>
  );
}
