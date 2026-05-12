import { useEffect, useMemo, useState } from 'react';
import { useAssetCatalogStore } from '../../store/assetCatalogStore';

// Catalog-backed inline dropdown for `soft_asset_ref` envelopes. The picker
// loads its catalog lazily via `assetCatalogStore.loadCatalog(className)` on
// first mount, shows a searchable list of paths, and writes the selected
// path back via `onChange`. The current value is preserved verbatim even
// when it's not in the loaded catalog (handles assets outside the bundled
// `.assets/<Class>.json` index).

type Props = {
  className: string;
  value: string | null;
  onChange: (next: string | null) => void;
};

export function AssetRefPicker({ className, value, onChange }: Props) {
  const loadCatalog = useAssetCatalogStore((s) => s.loadCatalog);
  const entries = useAssetCatalogStore((s) => {
    const c = s.catalogs[className];
    return Array.isArray(c) ? c : [];
  });
  const status = useAssetCatalogStore((s) => {
    const c = s.catalogs[className];
    return Array.isArray(c) ? 'loaded' : (c ?? null);
  });

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  // Lazy-load on first mount.
  useEffect(() => { void loadCatalog(className); }, [className, loadCatalog]);

  const filtered = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return entries
      .filter((e) => e.path.toLowerCase().includes(lc) || e.name.toLowerCase().includes(lc))
      .slice(0, 50);
  }, [entries, q]);

  const current = value ? entries.find((e) => e.path === value) ?? null : null;

  return (
    <div className="assetrefpicker" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button
        type="button"
        className="assetrefpicker-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="assetrefpicker-class">[{className}]</span>
        <span className="assetrefpicker-label">
          {value ? (current?.name ?? value) : '(none)'}
        </span>
        {value && (
          <button
            type="button"
            className="danger assetrefpicker-clear"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            title="Clear"
          >×</button>
        )}
      </button>
      {open && (
        <div className="assetrefpicker-pop">
          <input
            type="text" autoFocus value={q}
            className="assetrefpicker-search"
            placeholder={`Search ${className}…`}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) {
                e.preventDefault();
                onChange(filtered[0].path);
                setOpen(false);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          <div className="assetrefpicker-status">
            {status === 'loading' && 'loading…'}
            {status === 'missing' && `no catalog for ${className}`}
            {status === 'loaded' && `${entries.length} assets${q ? ` (${filtered.length} match)` : ''}`}
          </div>
          <ul className="assetrefpicker-list">
            {filtered.map((e) => (
              <li
                key={e.path}
                tabIndex={-1}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  onChange(e.path);
                  setOpen(false);
                }}
              >
                <span className="assetrefpicker-list-name">{e.name}</span>
                <code className="assetrefpicker-list-folder">{e.folder}</code>
              </li>
            ))}
            {filtered.length === 0 && status === 'loaded' && (
              <li className="assetrefpicker-empty">no matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
