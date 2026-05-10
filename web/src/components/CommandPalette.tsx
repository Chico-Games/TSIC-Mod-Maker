import { useEffect, useMemo, useRef, useState } from 'react';
import { useDefinitionsStore, type DefinitionRecord, type DefinitionsKey } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { HighlightedText } from './HighlightedText';
import { SearchBox } from './SearchBox';
import { getSemantic, type SemanticStatus } from '../search/semantic';
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
  /** When set, semantic ranking placed this hit; surfaces a small
   *  badge so the user knows why it appeared. */
  semantic?: { score: number };
}

/** Build the text we hand the embedder for each asset. The richer
 *  the input, the better semantic matching gets — we throw in the
 *  humanized id, display_name, description, and bare class so a
 *  query like "food" lights up the consumables. */
function semanticTextFor(rec: DefinitionRecord): string {
  const parts: string[] = [humanizeAssetId(rec.id)];
  const props = rec.json?.properties ?? {};
  const dn = props.display_name;
  if (dn && typeof dn === 'object' && typeof dn.value === 'string' && dn.value) {
    parts.push(dn.value);
  }
  const desc = props.description;
  if (desc && typeof desc === 'object' && typeof desc.value === 'string' && desc.value) {
    parts.push(desc.value);
  }
  const cls = String(rec.json?.class ?? '').replace(/^U/, '').replace(/Definition$/, '');
  if (cls) parts.push(cls.replace(/([a-z])([A-Z])/g, '$1 $2'));
  return parts.join(' · ');
}

export function CommandPalette({ open, onClose, onJump }: Props) {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const searchAll = useDefinitionsStore((s) => s.searchAll);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);

  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [semanticMode, setSemanticMode] = useState(false);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>('cold');
  const [semanticProgress, setSemanticProgress] = useState<{ done: number; total: number } | null>(null);
  const [semanticDownload, setSemanticDownload] = useState<number | null>(null);
  const [hits, setHits] = useState<PaletteHit[]>([]);

  // Subscribe to worker progress so we can render a live status line.
  useEffect(() => {
    const sem = getSemantic();
    const off = sem.subscribe((s, p) => {
      setSemanticStatus(s);
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

  // Fuzzy path: instant, runs every keystroke.
  useEffect(() => {
    if (semanticMode) return;
    if (!q.trim()) { setHits([]); return; }
    setHits(searchAll(q, 60).map((h) => ({ ...h })));
  }, [q, semanticMode, searchAll]);

  // Semantic path: kicks the worker, runs an embed per query. We
  // debounce a bit because embedding has noticeable latency.
  const semanticReqId = useRef(0);
  useEffect(() => {
    if (!semanticMode) return;
    const my = ++semanticReqId.current;
    if (!q.trim()) { setHits([]); return; }
    const timer = setTimeout(async () => {
      const sem = getSemantic();
      const allItems = [...definitions.entries()].map(([key, rec]) => ({ key, rec }));
      try {
        const ranked = await sem.search(
          q,
          allItems,
          (it) => it.key,
          { limit: 50, minScore: 0.2 },
        );
        if (my !== semanticReqId.current) return; // outdated
        setHits(ranked.map(({ item, score }) => ({
          key: item.key,
          folder: item.rec.folder,
          id: item.rec.id,
          matchPath: 'semantic',
          snippet: semanticTextFor(item.rec),
          ranges: [],
          semantic: { score },
        })));
      } catch (e) {
        if (my !== semanticReqId.current) return;
        console.warn('[semantic] search failed', e);
        setHits([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q, semanticMode, definitions]);

  useEffect(() => { setCursor(0); }, [q]);

  const indexedCount = useMemo(() => getSemantic().indexedCount, [semanticStatus]);
  const totalCount = definitions.size;

  /** Toggle semantic mode. The first time it goes ON we kick the
   *  worker (downloads the model) and embed every loaded asset. */
  const toggleSemantic = async () => {
    const next = !semanticMode;
    setSemanticMode(next);
    if (!next) return;
    const sem = getSemantic();
    if (sem.indexedCount < totalCount) {
      await sem.warmup().catch(() => { /* error surfaces via subscribe */ });
      const items = [...definitions.entries()];
      let lastEmit = 0;
      await sem.indexItems(
        items,
        ([k]) => k,
        ([, rec]) => semanticTextFor(rec),
        (done, total) => {
          // Throttle setState to one update every ~50 items.
          if (done - lastEmit >= 50 || done === total) {
            lastEmit = done;
            setSemanticProgress({ done, total });
          }
        },
      );
      setSemanticProgress(null);
    }
  };

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

  const semanticBadge = (() => {
    if (!semanticMode) return null;
    if (semanticStatus === 'error') return <span className="palette-mode-state error">model failed</span>;
    if (semanticDownload != null && semanticDownload < 100) {
      return <span className="palette-mode-state">downloading {semanticDownload}%</span>;
    }
    if (semanticProgress) {
      return <span className="palette-mode-state">indexing {semanticProgress.done}/{semanticProgress.total}</span>;
    }
    if (semanticStatus === 'loading') return <span className="palette-mode-state">loading model…</span>;
    return <span className="palette-mode-state ready">{indexedCount}/{totalCount} indexed</span>;
  })();

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <span className="palette-icon">⌘K</span>
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder={semanticMode
              ? 'Semantic search — try "food", "wooden", "weapon"…'
              : 'Search definitions by id or value…'}
            autoFocus
            onKeyDown={onKey}
          />
          <button
            className={`palette-mode-btn ${semanticMode ? 'on' : ''}`}
            onClick={() => void toggleSemantic()}
            title={semanticMode
              ? 'Switch to fuzzy text search'
              : 'Switch to semantic search (loads ~25 MB model on first use)'}
          >🧠 {semanticMode ? 'Semantic' : 'Fuzzy'}</button>
          {semanticBadge}
        </div>
        <div className="palette-results">
          {hits.length === 0 && q.trim() && (
            <div className="palette-empty">No matches</div>
          )}
          {hits.length === 0 && !q.trim() && (
            <div className="palette-empty">
              {semanticMode
                ? 'Type a concept — "food", "tier 2 weapon", "wooden"…'
                : 'Type to search across every loaded definition'}
            </div>
          )}
          {hits.map((h, i) => {
            const theme = getFolderTheme(h.folder);
            return (
              <div
                key={h.key}
                className={`palette-hit ${i === cursor ? 'cursor' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(i)}
              >
                <span className="hit-emoji" aria-hidden>{theme.emoji}</span>
                <span className="hit-label" style={{ color: theme.color }}>
                  <HighlightedText
                    text={humanizeAssetId(h.id)}
                    ranges={h.matchPath === 'id' ? h.ranges : undefined}
                    query={h.matchPath === 'id' ? undefined : (semanticMode ? undefined : q)}
                  />
                </span>
                <span className="hit-kind">{h.folder}</span>
                <span className="hit-sub">
                  {h.semantic
                    ? <>sim {h.semantic.score.toFixed(2)} · <em>{h.snippet.slice(0, 80)}</em></>
                    : <>{h.matchPath}: <HighlightedText text={h.snippet} ranges={h.matchPath !== 'id' ? h.ranges : undefined} /></>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close
          {semanticMode && <span className="muted small"> · semantic via MiniLM-L6-v2</span>}
        </div>
      </div>
    </div>
  );
}
