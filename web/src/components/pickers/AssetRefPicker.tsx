import { useEffect, useMemo, useState } from 'react';
import { useAssetCatalogStore } from '../../store/assetCatalogStore';
import type { AssetCatalogEntry } from '../../persistence/dataSource';
import { fuzzyRankMulti, type RankedHit } from '../../search/fuzzy';
import { HighlightedText } from '../HighlightedText';
import { VirtualList } from '../VirtualList';

// Catalog-backed inline dropdown for `soft_asset_ref` envelopes. The picker
// loads its catalog lazily via `assetCatalogStore.loadCatalog(className)` on
// first mount, exposes the full catalog through either a flat fuzzy-ranked
// list or a /Game/-rooted folder tree, and writes the selected path back via
// `onChange`. The current value is preserved verbatim even when it's not in
// the loaded catalog (handles assets outside the bundled `.assets/<Class>.json`
// index).

type Props = {
  className: string;
  value: string | null;
  onChange: (next: string | null) => void;
};

type ViewMode = 'list' | 'tree';

type TreeNode = {
  /** Display label for this segment (e.g. "Furniture"). */
  label: string;
  /** Full folder path from root (e.g. "/Game/Furniture"). Used as the
   *  React key and as the expansion key. */
  fullPath: string;
  /** Child folder nodes, sorted by label. */
  children: Map<string, TreeNode>;
  /** Catalog entries that live directly in this folder, sorted by name. */
  entries: AssetCatalogEntry[];
};

/** Flat row produced by walking the tree for VirtualList. */
type TreeRow =
  | { kind: 'folder'; node: TreeNode; depth: number; expanded: boolean; matchCount: number }
  | { kind: 'entry'; entry: AssetCatalogEntry; depth: number; ranges: Array<[number, number]> };

function buildTree(entries: AssetCatalogEntry[]): TreeNode {
  const root: TreeNode = { label: '', fullPath: '', children: new Map(), entries: [] };
  for (const e of entries) {
    const segs = (e.folder ?? '').split('/').filter(Boolean);
    let cur = root;
    let path = '';
    for (const s of segs) {
      path = `${path}/${s}`;
      let next = cur.children.get(s);
      if (!next) {
        next = { label: s, fullPath: path, children: new Map(), entries: [] };
        cur.children.set(s, next);
      }
      cur = next;
    }
    cur.entries.push(e);
  }
  // Sort entries within each folder.
  const walk = (n: TreeNode) => {
    n.entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of n.children.values()) walk(c);
  };
  walk(root);
  return root;
}

/** Walk the tree producing visible rows for the current expansion + filter.
 *  When `matches` is null, every entry is shown. When it's a set, only
 *  entries whose path is in the set are shown and ancestor folders are
 *  forced expanded so the user can see what matched. */
function flattenTree(
  root: TreeNode,
  expanded: Set<string>,
  matches: Map<string, RankedHit<AssetCatalogEntry>> | null,
): TreeRow[] {
  const out: TreeRow[] = [];
  const recurse = (node: TreeNode, depth: number) => {
    const childList = [...node.children.values()].sort((a, b) => a.label.localeCompare(b.label));
    for (const child of childList) {
      const matchCount = matches ? countMatches(child, matches) : -1;
      if (matches && matchCount === 0) continue;
      const forced = matches != null;
      const isExpanded = forced || expanded.has(child.fullPath);
      out.push({ kind: 'folder', node: child, depth, expanded: isExpanded, matchCount });
      if (isExpanded) recurse(child, depth + 1);
    }
    for (const entry of node.entries) {
      if (matches && !matches.has(entry.path)) continue;
      const ranges = matches?.get(entry.path)?.ranges ?? [];
      out.push({ kind: 'entry', entry, depth, ranges });
    }
  };
  recurse(root, 0);
  return out;
}

function countMatches(
  node: TreeNode,
  matches: Map<string, RankedHit<AssetCatalogEntry>>,
): number {
  let n = 0;
  for (const e of node.entries) if (matches.has(e.path)) n++;
  for (const c of node.children.values()) n += countMatches(c, matches);
  return n;
}

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
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem('tsic.assetpicker.view.v1');
      return v === 'tree' ? 'tree' : 'list';
    } catch { return 'list'; }
  });
  const setViewPersist = (v: ViewMode) => {
    setView(v);
    try { localStorage.setItem('tsic.assetpicker.view.v1', v); } catch { /* noop */ }
  };
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleFolder = (fullPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath); else next.add(fullPath);
      return next;
    });
  };

  // Lazy-load on first mount.
  useEffect(() => { void loadCatalog(className); }, [className, loadCatalog]);

  const ranked = useMemo<RankedHit<AssetCatalogEntry>[]>(() => {
    return fuzzyRankMulti(entries, q, (e) => [e.name, e.path]);
  }, [entries, q]);

  const matchMap = useMemo(() => {
    if (!q.trim()) return null;
    const m = new Map<string, RankedHit<AssetCatalogEntry>>();
    for (const h of ranked) m.set(h.item.path, h);
    return m;
  }, [ranked, q]);

  const tree = useMemo(() => buildTree(entries), [entries]);
  const treeRows = useMemo(
    () => view === 'tree' ? flattenTree(tree, expanded, matchMap) : [],
    [view, tree, expanded, matchMap],
  );

  const current = value ? entries.find((e) => e.path === value) ?? null : null;
  const matchCount = matchMap?.size ?? entries.length;

  const pick = (path: string) => {
    onChange(path);
    setOpen(false);
  };

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
          <div className="assetrefpicker-toolbar">
            <input
              type="text" autoFocus value={q}
              className="assetrefpicker-search"
              placeholder={`Search ${className}…`}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ranked[0]) {
                  e.preventDefault();
                  pick(ranked[0].item.path);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            />
            <div className="assetrefpicker-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={view === 'list' ? 'active' : ''}
                onClick={() => setViewPersist('list')}
                title="Flat list"
              >☰</button>
              <button
                type="button"
                className={view === 'tree' ? 'active' : ''}
                onClick={() => setViewPersist('tree')}
                title="Folder tree"
              >🗂</button>
            </div>
          </div>
          <div className="assetrefpicker-status">
            {status === 'loading' && 'loading…'}
            {status === 'missing' && `no catalog for ${className}`}
            {status === 'loaded' && `${entries.length} assets${q ? ` · ${matchCount} match` : ''}`}
          </div>
          {view === 'list' ? (
            <VirtualList
              className="assetrefpicker-vlist"
              items={ranked}
              rowHeight={28}
              keyOf={(h) => h.item.path}
              renderItem={(h) => (
                <button
                  type="button"
                  className="assetrefpicker-row"
                  onMouseDown={(ev) => { ev.preventDefault(); pick(h.item.path); }}
                  title={h.item.path}
                >
                  <span className="assetrefpicker-row-name">
                    <HighlightedText text={h.item.name} ranges={h.ranges} />
                  </span>
                  <code className="assetrefpicker-row-folder">{h.item.folder}</code>
                </button>
              )}
            />
          ) : (
            <VirtualList
              className="assetrefpicker-vlist"
              items={treeRows}
              rowHeight={26}
              keyOf={(r) => r.kind === 'folder' ? `F:${r.node.fullPath}` : `E:${r.entry.path}`}
              renderItem={(r) => {
                if (r.kind === 'folder') {
                  return (
                    <button
                      type="button"
                      className="assetrefpicker-tree-folder"
                      style={{ paddingLeft: `${0.5 + r.depth * 0.9}em` }}
                      onMouseDown={(ev) => { ev.preventDefault(); toggleFolder(r.node.fullPath); }}
                    >
                      <span className="assetrefpicker-tree-caret">{r.expanded ? '▾' : '▸'}</span>
                      <span className="assetrefpicker-tree-label">{r.node.label}</span>
                      {r.matchCount > 0 && q && (
                        <span className="assetrefpicker-tree-count">{r.matchCount}</span>
                      )}
                    </button>
                  );
                }
                return (
                  <button
                    type="button"
                    className="assetrefpicker-tree-entry"
                    style={{ paddingLeft: `${1.4 + r.depth * 0.9}em` }}
                    onMouseDown={(ev) => { ev.preventDefault(); pick(r.entry.path); }}
                    title={r.entry.path}
                  >
                    <HighlightedText text={r.entry.name} ranges={r.ranges} />
                  </button>
                );
              }}
            />
          )}
          {status === 'loaded' && ranked.length === 0 && q.trim() && (
            <div className="assetrefpicker-empty">no matches</div>
          )}
        </div>
      )}
    </div>
  );
}
