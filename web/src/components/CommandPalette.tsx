import { useEffect, useRef, useState } from 'react';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { HighlightedText } from './HighlightedText';
import { SearchBox } from './SearchBox';
import { getSemantic, type SemanticStatus } from '../search/semantic';
import { semanticTextFor } from '../search/semanticText';
import type { AppTab } from '../store/appStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onJump: (tab: AppTab) => void;
}

interface PaletteHit {
  key: DefinitionsKey;
  folder: string;
  id: string;
  matchPath: string;
  snippet: string;
  ranges: Array<[number, number]>;
  /** Cosine similarity when a semantic-only result. */
  semantic?: { score: number };
}

export function CommandPalette({ open, onClose, onJump }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const searchAll = useDefinitionsStore((s) => s.searchAll);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);

  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<PaletteHit[]>([]);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>('cold');
  const [semanticDownload, setSemanticDownload] = useState<number | null>(null);
  const [indexedCount, setIndexedCount] = useState(0);

  // Stay in sync with the store-level semantic singleton.
  useEffect(() => {
    const sem = getSemantic();
    setSemanticStatus(sem.status);
    setIndexedCount(sem.indexedCount);
    const off = sem.subscribe((s, p) => {
      setSemanticStatus(s);
      setIndexedCount(getSemantic().indexedCount);
      if (p?.stage === 'downloading' && typeof p.progress === 'number') {
        setSemanticDownload(p.progress);
      }
      if (s === 'ready') setSemanticDownload(null);
    });
    return off;
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
    }
  }, [open]);

  // Combined fuzzy + semantic. Fuzzy resolves immediately; semantic
  // is appended once the index is ready and the query stabilizes.
  const reqRef = useRef(0);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const my = ++reqRef.current;

    // 1) Instant fuzzy results via the store's existing searchAll
    //    (which also walks string property values, not just ids).
    const fuzzyHits: PaletteHit[] = searchAll(q, 60).map((h) => ({ ...h }));
    setHits(fuzzyHits);

    // 2) Semantic-only matches appended after a short debounce.
    if (semanticStatus !== 'ready') return;
    const timer = setTimeout(async () => {
      try {
        const sem = getSemantic();
        const allItems = [...definitions.entries()].map(([key, rec]) => ({ key, rec }));
        const ranked = await sem.search(
          q,
          allItems,
          (it) => it.key,
          { limit: 60, minScore: 0.25 },
        );
        if (my !== reqRef.current) return;
        const seen = new Set(fuzzyHits.map((h) => h.key));
        const semanticOnly: PaletteHit[] = [];
        for (const r of ranked) {
          if (seen.has(r.item.key)) continue;
          semanticOnly.push({
            key: r.item.key,
            folder: r.item.rec.folder,
            id: r.item.rec.id,
            matchPath: 'semantic',
            snippet: semanticTextFor(r.item.rec),
            ranges: [],
            semantic: { score: r.score },
          });
        }
        if (semanticOnly.length > 0) setHits([...fuzzyHits, ...semanticOnly]);
      } catch (e) {
        console.warn('[semantic] palette search failed', e);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q, semanticStatus, searchAll, definitions]);

  useEffect(() => { setCursor(0); }, [q]);

  if (!open) return null;

  const choose = (i: number) => {
    const h = hits[i];
    if (!h) return;
    selectFolder(h.folder);
    selectDefinition(h.key);
    onJump('definitions');
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(hits.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(cursor);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const totalCount = definitions.size;
  const semanticBadge = (() => {
    if (semanticStatus === 'error') return <span className="palette-mode-state error">model failed</span>;
    if (semanticDownload != null && semanticDownload < 100) {
      return <span className="palette-mode-state">downloading {semanticDownload}%</span>;
    }
    if (semanticStatus === 'ready') return <span className="palette-mode-state ready">🧠 {indexedCount}/{totalCount}</span>;
    if (semanticStatus === 'loading') return <span className="palette-mode-state">🧠 loading…</span>;
    return null;
  })();

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <span className="palette-icon">⌘K</span>
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder='Search — exact id, value, or concept ("food", "wooden")…'
            autoFocus
            onKeyDown={onKey}
          />
          {semanticBadge}
        </div>
        <div className="palette-results">
          {hits.length === 0 && q.trim() && (
            <div className="palette-empty">No matches</div>
          )}
          {hits.length === 0 && !q.trim() && (
            <div className="palette-empty">
              Type to search — exact ids and concepts both land hits.
            </div>
          )}
          {hits.map((h, i) => {
            const theme = getFolderTheme(h.folder);
            return (
              <div
                key={h.key}
                className={`palette-hit ${i === cursor ? 'cursor' : ''} ${h.semantic ? 'semantic' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(i)}
              >
                <span className="hit-emoji" aria-hidden>{theme.emoji}</span>
                <span className="hit-label" style={{ color: theme.color }}>
                  <HighlightedText
                    text={humanizeAssetId(h.id)}
                    ranges={h.matchPath === 'id' ? h.ranges : undefined}
                    query={h.matchPath === 'id' || h.semantic ? undefined : q}
                  />
                </span>
                <span className="hit-kind">{h.folder}</span>
                <span className="hit-sub">
                  {h.semantic
                    ? <>🧠 sim {h.semantic.score.toFixed(2)} · <em>{h.snippet.slice(0, 80)}</em></>
                    : <>{h.matchPath}: <HighlightedText text={h.snippet} ranges={h.matchPath !== 'id' ? h.ranges : undefined} /></>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close
          {semanticStatus === 'ready' && <span className="muted small"> · semantic via MiniLM-L6-v2</span>}
        </div>
      </div>
    </div>
  );
}
