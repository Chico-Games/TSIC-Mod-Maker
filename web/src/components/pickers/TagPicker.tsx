import { useMemo, useState } from 'react';
import { useGameplayTagStore } from '../../store/gameplayTagStore';

// Catalog-backed autocomplete picker for gameplay tags. Replaces the free-text
// inputs previously used by GameplayTagEditor / GameplayTagContainerEditor.
// Both single-tag (FGameplayTag) and multi-tag (FGameplayTagContainer) modes
// share this component — the `multi` prop switches between chip-only / multi-
// chip behavior. Free-form fallback on Enter keeps the editor usable for
// tags not yet in the bundled catalog.

type Props = {
  multi: boolean;
  value: string | string[];
  onChange: (next: string | string[]) => void;
};

export function TagPicker({ multi, value, onChange }: Props) {
  const tags = useGameplayTagStore((s) => s.tags);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const selected: string[] = multi
    ? (Array.isArray(value) ? value : [])
    : (typeof value === 'string' && value ? [value] : []);

  const filtered = useMemo(() => {
    const lc = q.trim().toLowerCase();
    if (!lc && !open) return [];
    return tags
      .filter((t) => !selected.includes(t))
      .filter((t) => t.toLowerCase().includes(lc))
      .slice(0, 50);
  }, [tags, q, selected, open]);

  const add = (tag: string) => {
    if (multi) onChange([...selected, tag]);
    else onChange(tag);
    setQ('');
    setOpen(false);
  };

  const remove = (tag: string) => {
    if (multi) onChange(selected.filter((t) => t !== tag));
    else onChange('');
  };

  return (
    <div
      className="tagpicker"
      onBlur={(e) => {
        // Close menu when focus leaves the whole picker (not just the input).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="tagpicker-chips">
        {selected.map((t) => (
          <span key={t} className="tagpicker-chip">
            <code>{t}</code>
            <button
              type="button"
              className="tagpicker-chip-remove"
              onClick={() => remove(t)}
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
        {(!multi && selected.length > 0) ? null : (
          <input
            type="text"
            className="tagpicker-input"
            value={q}
            placeholder={selected.length > 0 ? 'Add another…' : 'Select tag…'}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[0]) add(filtered[0]);
                else if (q.trim()) {
                  // Allow free-form entry as a fallback (covers tags not yet
                  // in the catalog).
                  add(q.trim());
                }
              } else if (e.key === 'Escape') {
                setOpen(false);
              } else if (e.key === 'Backspace' && q === '' && selected.length > 0) {
                remove(selected[selected.length - 1]);
              }
            }}
          />
        )}
      </div>
      {open && filtered.length > 0 && (
        <ul className="tagpicker-menu">
          {filtered.map((t) => (
            <li
              key={t}
              tabIndex={-1}
              onMouseDown={(e) => {
                // mouseDown (not click) so the input's onBlur doesn't close
                // the menu before the click event fires.
                e.preventDefault();
                add(t);
              }}
            >
              <code>{t}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
