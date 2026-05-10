import { useEffect, useMemo, useRef, useState } from 'react';
import { useDefinitionsStore } from '../store/definitionsStore';
import { getFolderTheme } from './folderTheme';
import { humanizeAssetId } from './definitionsNaming';
import { HighlightedText } from './HighlightedText';
import type { AppTab } from '../store/appStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onJump: (tab: AppTab) => void;
}

export function CommandPalette({ open, onClose, onJump }: Props) {
  const searchAll = useDefinitionsStore((s) => s.searchAll);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);

  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const hits = useMemo(() => {
    if (!q.trim()) return [];
    return searchAll(q, 60);
  }, [q, searchAll]);

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

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <span className="palette-icon">⌘K</span>
          <input
            ref={inputRef}
            placeholder="Search definitions by id or value…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="palette-results">
          {hits.length === 0 && q.trim() && (
            <div className="palette-empty">No matches</div>
          )}
          {hits.length === 0 && !q.trim() && (
            <div className="palette-empty">Type to search across every loaded definition</div>
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
                  <HighlightedText text={h.id} ranges={h.matchPath === 'id' ? h.ranges : undefined} query={h.matchPath === 'id' ? undefined : q} />
                </span>
                <span className="hit-kind">{h.folder}</span>
                <span className="hit-sub">{h.matchPath}: <HighlightedText text={h.snippet} ranges={h.matchPath !== 'id' ? h.ranges : undefined} /></span>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  );
}
