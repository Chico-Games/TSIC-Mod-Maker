import { useEffect, useMemo, useRef, useState } from 'react';

// Combobox: trigger button shows the selected option's label; clicking it
// opens a popover with a text filter and a keyboard-navigable list. Used
// by the typed editor to replace native <select> in places where the
// option list is hundreds of items long.

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  color?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  /** When set, an extra entry "+ <createLabel>…" appears at the bottom of
   *  the popover. Selecting it switches the popover to inline-create mode. */
  onCreateNew?: (id: string) => void;
  createLabel?: string;
  /** Whether to allow clearing the selection (renders "— None —" entry). */
  allowEmpty?: boolean;
  /** Optional className applied to the trigger button. */
  triggerClassName?: string;
  /** Optional title attribute on the trigger (the full id, in many cases). */
  triggerTitle?: string;
}

export function SearchableSelect({
  value,
  options,
  placeholder = 'Select…',
  onChange,
  onCreateNew,
  createLabel = 'New',
  allowEmpty = true,
  triggerClassName,
  triggerTitle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, filter]);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Reset highlight when the filter changes.
  useEffect(() => {
    setHighlight(0);
  }, [filter, open]);

  useEffect(() => {
    if (open) {
      // Focus the search input on open.
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setFilter('');
      setCreating(false);
      setNewId('');
    }
  }, [open]);

  // Scroll the highlighted item into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlight, open, filtered.length]);

  const totalOptions = filtered.length + (allowEmpty ? 1 : 0);
  // Layout: [None?, ...filtered, +New?]
  const noneOffset = allowEmpty ? 1 : 0;
  const createOffset = onCreateNew ? 1 : 0;
  const totalWithCreate = totalOptions + createOffset;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(totalWithCreate - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(highlight);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const pick = (idx: number) => {
    if (allowEmpty && idx === 0) {
      onChange('');
      setOpen(false);
      return;
    }
    const optIdx = idx - noneOffset;
    if (optIdx < filtered.length) {
      onChange(filtered[optIdx].value);
      setOpen(false);
      return;
    }
    // The "+ create" row.
    if (onCreateNew) {
      setCreating(true);
      setNewId('');
    }
  };

  const triggerLabel = selected ? selected.label : value || placeholder;
  return (
    <div className="ss-root" ref={rootRef}>
      <button
        type="button"
        className={`ss-trigger ${triggerClassName ?? ''}`}
        title={triggerTitle ?? selected?.hint ?? value}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ss-trigger-label">{triggerLabel}</span>
        <span className="ss-caret">▾</span>
      </button>
      {open && (
        <div className="ss-popover" role="listbox">
          {creating ? (
            <div className="ss-create">
              <input
                ref={(el) => el?.focus()}
                type="text"
                placeholder={`New ${createLabel}…`}
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newId.trim()) {
                    onCreateNew?.(newId.trim());
                    setOpen(false);
                  } else if (e.key === 'Escape') {
                    setCreating(false);
                  }
                }}
              />
              <button
                type="button"
                className="primary"
                disabled={!newId.trim()}
                onClick={() => {
                  if (!newId.trim()) return;
                  onCreateNew?.(newId.trim());
                  setOpen(false);
                }}
              >
                Create
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="text"
                className="ss-search"
                placeholder="Type to filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={onKey}
              />
              <ul className="ss-list" ref={listRef}>
                {allowEmpty && (
                  <li
                    className={`ss-item ${highlight === 0 ? 'highlight' : ''}`}
                    onMouseEnter={() => setHighlight(0)}
                    onClick={() => pick(0)}
                  >
                    <span className="ss-item-label ss-item-empty">— None —</span>
                  </li>
                )}
                {filtered.length === 0 && !onCreateNew && (
                  <li className="ss-empty">No matches.</li>
                )}
                {filtered.map((opt, i) => {
                  const idx = i + noneOffset;
                  return (
                    <li
                      key={opt.value}
                      className={`ss-item ${highlight === idx ? 'highlight' : ''} ${
                        opt.value === value ? 'selected' : ''
                      }`}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => pick(idx)}
                      title={opt.hint ?? opt.value}
                      style={opt.color ? { borderLeftColor: opt.color } : undefined}
                    >
                      <span className="ss-item-label">{opt.label}</span>
                      {opt.hint && <span className="ss-item-hint">{opt.hint}</span>}
                    </li>
                  );
                })}
                {onCreateNew && (
                  <li
                    className={`ss-item ss-create-row ${
                      highlight === totalOptions ? 'highlight' : ''
                    }`}
                    onMouseEnter={() => setHighlight(totalOptions)}
                    onClick={() => pick(totalOptions)}
                  >
                    <span className="ss-item-label">+ New {createLabel}…</span>
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
