import { useEffect, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { getSemantic, type SemanticStatus } from '../search/semantic';

/** Tiny header indicator for the background semantic indexer. Lives
 *  in the header so users can see progress without opening ⌘K. */
export function SemanticChip() {
  const totalCount = useDefinitionsStore((s) => s.definitions.size);
  const [status, setStatus] = useState<SemanticStatus>('cold');
  const [download, setDownload] = useState<number | null>(null);
  const [indexed, setIndexed] = useState(0);

  useEffect(() => {
    const sem = getSemantic();
    setStatus(sem.status);
    setIndexed(sem.indexedCount);
    return sem.subscribe((s, p) => {
      setStatus(s);
      setIndexed(getSemantic().indexedCount);
      if (p?.stage === 'downloading' && typeof p.progress === 'number') setDownload(p.progress);
      if (s === 'ready') setDownload(null);
    });
  }, []);

  if (status === 'cold' || totalCount === 0) return null;
  let label: string;
  let cls: string;
  if (status === 'error') { label = '🧠 model failed'; cls = 'error'; }
  else if (download != null && download < 100) { label = `🧠 ${download}%`; cls = 'loading'; }
  else if (status === 'loading') { label = '🧠 loading…'; cls = 'loading'; }
  else if (indexed < totalCount) { label = `🧠 ${indexed}/${totalCount}`; cls = 'loading'; }
  else { label = `🧠 ready`; cls = 'ready'; }

  return (
    <span
      className={`header-semantic-chip ${cls}`}
      title={status === 'ready'
        ? 'Semantic search index ready — try concepts like "food" or "wooden" in any search box.'
        : 'Background-loading the semantic search model.'}
    >{label}</span>
  );
}
