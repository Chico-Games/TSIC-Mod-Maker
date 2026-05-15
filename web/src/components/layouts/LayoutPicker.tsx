import { useEffect, useMemo, useRef, useState } from 'react';

export interface LayoutPickerOption {
  key: string;
  label: string;
  tags: string[];
  issueCount?: number;
}

interface Props {
  value: string;
  options: LayoutPickerOption[];
  onChange: (key: string) => void;
  placeholder?: string;
}

function tagSuffix(tag: string, prefix: string): string | null {
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : null;
}

function deriveBiome(tags: string[]): string | null {
  for (const t of tags) {
    const v = tagSuffix(t, 'Tile.Biome.');
    if (v) return v;
  }
  return null;
}

function deriveTypes(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const v = tagSuffix(t, 'Layout.Type.');
    if (v) out.push(v);
  }
  return out;
}

export function LayoutPicker({ value, options, onChange, placeholder = 'Pick a layout…' }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [biome, setBiome] = useState<string | null>(null);
  const [layoutType, setLayoutType] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => options.find((o) => o.key === value) ?? null, [options, value]);

  const allBiomes = useMemo(() => {
    const s = new Set<string>();
    for (const o of options) {
      const b = deriveBiome(o.tags);
      if (b) s.add(b);
    }
    return [...s].sort();
  }, [options]);

  const allTypes = useMemo(() => {
    const s = new Set<string>();
    for (const o of options) for (const t of deriveTypes(o.tags)) s.add(t);
    return [...s].sort();
  }, [options]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return options.filter((o) => {
      if (biome && deriveBiome(o.tags) !== biome) return false;
      if (layoutType && !deriveTypes(o.tags).includes(layoutType)) return false;
      if (!q) return true;
      return o.label.toLowerCase().includes(q) || o.key.toLowerCase().includes(q);
    });
  }, [options, filter, biome, layoutType]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setFilter('');
  }, [open]);

  return (
    <div className="layout-picker" ref={rootRef}>
      <button
        type="button"
        className="layout-picker-trigger"
        title={selected?.key ?? ''}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="layout-picker-label">{selected ? selected.label : placeholder}</span>
        {selected?.issueCount ? (
          <span className="layout-picker-issue-dot" title={`${selected.issueCount} issue${selected.issueCount === 1 ? '' : 's'}`} />
        ) : null}
        <span className="layout-picker-caret">▾</span>
      </button>
      {open && (
        <div className="layout-picker-popover">
          <input
            ref={inputRef}
            className="layout-picker-search"
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {allBiomes.length > 0 && (
            <div className="layout-picker-chip-row">
              <span className="layout-picker-chip-label">Biome:</span>
              <button
                type="button"
                className={`chip ${biome === null ? 'active' : ''}`}
                onClick={() => setBiome(null)}
              >All</button>
              {allBiomes.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`chip ${biome === b ? 'active' : ''}`}
                  onClick={() => setBiome(b === biome ? null : b)}
                >{b}</button>
              ))}
            </div>
          )}
          {allTypes.length > 0 && (
            <div className="layout-picker-chip-row">
              <span className="layout-picker-chip-label">Type:</span>
              <button
                type="button"
                className={`chip ${layoutType === null ? 'active' : ''}`}
                onClick={() => setLayoutType(null)}
              >All</button>
              {allTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip ${layoutType === t ? 'active' : ''}`}
                  onClick={() => setLayoutType(t === layoutType ? null : t)}
                >{t}</button>
              ))}
            </div>
          )}
          <div className="layout-picker-count">
            {filtered.length} match{filtered.length === 1 ? '' : 'es'}
          </div>
          <ul className="layout-picker-list">
            {filtered.length === 0 && <li className="layout-picker-empty">No matches.</li>}
            {filtered.map((opt) => (
              <li
                key={opt.key}
                className={`layout-picker-item${opt.key === value ? ' selected' : ''}`}
                title={opt.key}
                onClick={() => { onChange(opt.key); setOpen(false); }}
              >
                <span className="layout-picker-item-label">{opt.label}</span>
                {opt.issueCount ? (
                  <span className="layout-picker-issue-dot" title={`${opt.issueCount} issue${opt.issueCount === 1 ? '' : 's'}`} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
