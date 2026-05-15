import { useMemo, useState } from 'react';
import { useGameplayTagStore } from '../../store/gameplayTagStore';
import { fuzzyRankMulti, type RankedHit } from '../../search/fuzzy';
import { HighlightedText } from '../HighlightedText';
import { VirtualList } from '../VirtualList';

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
  /** Unreal's FGameplayTag `meta=(Categories="A,B")` — comma-separated list of
   *  root tags. Only tags equal to or descended from one of these roots are
   *  offered. When omitted, the entire catalog is searchable. */
  categories?: string | null;
};

type ViewMode = 'list' | 'tree';

type TagTreeNode = {
  /** Last segment, e.g. "Forest". */
  label: string;
  /** Full tag from root, e.g. "Tile.Forest". May or may not be a real tag. */
  fullTag: string;
  /** True when this node corresponds to a real selectable tag in the catalog
   *  (some intermediate folders are implicit and only group children). */
  isLeaf: boolean;
  children: Map<string, TagTreeNode>;
};

type TreeRow =
  | { kind: 'branch'; node: TagTreeNode; depth: number; expanded: boolean; matchCount: number }
  | { kind: 'leaf'; node: TagTreeNode; depth: number; ranges: Array<[number, number]> };

function inCategories(tag: string, roots: string[]): boolean {
  if (roots.length === 0) return true;
  return roots.some((r) => tag === r || tag.startsWith(r + '.'));
}

function buildTagTree(tags: string[]): TagTreeNode {
  const root: TagTreeNode = { label: '', fullTag: '', isLeaf: false, children: new Map() };
  for (const t of tags) {
    const segs = t.split('.');
    let cur = root;
    let path = '';
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      path = path ? `${path}.${s}` : s;
      let next = cur.children.get(s);
      if (!next) {
        next = { label: s, fullTag: path, isLeaf: false, children: new Map() };
        cur.children.set(s, next);
      }
      if (i === segs.length - 1) next.isLeaf = true;
      cur = next;
    }
  }
  return root;
}

function countTagMatches(node: TagTreeNode, matches: Map<string, RankedHit<string>>): number {
  let n = node.isLeaf && matches.has(node.fullTag) ? 1 : 0;
  for (const c of node.children.values()) n += countTagMatches(c, matches);
  return n;
}

function flattenTagTree(
  root: TagTreeNode,
  expanded: Set<string>,
  matches: Map<string, RankedHit<string>> | null,
): TreeRow[] {
  const out: TreeRow[] = [];
  const recurse = (node: TagTreeNode, depth: number) => {
    const childList = [...node.children.values()].sort((a, b) => a.label.localeCompare(b.label));
    for (const child of childList) {
      const hasChildren = child.children.size > 0;
      const matchCount = matches ? countTagMatches(child, matches) : -1;
      if (matches && matchCount === 0) continue;
      if (hasChildren) {
        const forced = matches != null;
        const isExpanded = forced || expanded.has(child.fullTag);
        out.push({ kind: 'branch', node: child, depth, expanded: isExpanded, matchCount });
        if (child.isLeaf && (matches == null || matches.has(child.fullTag))) {
          out.push({
            kind: 'leaf',
            node: child,
            depth: depth + 1,
            ranges: matches?.get(child.fullTag)?.ranges ?? [],
          });
        }
        if (isExpanded) recurse(child, depth + 1);
      } else {
        if (!child.isLeaf) continue;
        out.push({
          kind: 'leaf',
          node: child,
          depth,
          ranges: matches?.get(child.fullTag)?.ranges ?? [],
        });
      }
    }
  };
  recurse(root, 0);
  return out;
}

export function TagPicker({ multi, value, onChange, categories }: Props) {
  const tags = useGameplayTagStore((s) => s.tags);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem('tsic.tagpicker.view.v1');
      return v === 'tree' ? 'tree' : 'list';
    } catch { return 'list'; }
  });
  const setViewPersist = (v: ViewMode) => {
    setView(v);
    try { localStorage.setItem('tsic.tagpicker.view.v1', v); } catch { /* noop */ }
  };
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleNode = (fullTag: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fullTag)) next.delete(fullTag); else next.add(fullTag);
      return next;
    });
  };

  const roots = useMemo(() => {
    if (!categories) return [] as string[];
    return categories.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }, [categories]);

  const selected: string[] = multi
    ? (Array.isArray(value) ? value : [])
    : (typeof value === 'string' && value ? [value] : []);

  const candidates = useMemo(() => {
    return tags.filter((t) => !selected.includes(t) && inCategories(t, roots));
  }, [tags, selected, roots]);

  const ranked = useMemo<RankedHit<string>[]>(() => {
    return fuzzyRankMulti(candidates, q, (t) => [t]);
  }, [candidates, q]);

  const matchMap = useMemo(() => {
    if (!q.trim()) return null;
    const m = new Map<string, RankedHit<string>>();
    for (const h of ranked) m.set(h.item, h);
    return m;
  }, [ranked, q]);

  const tree = useMemo(() => buildTagTree(candidates), [candidates]);
  const treeRows = useMemo(
    () => view === 'tree' ? flattenTagTree(tree, expanded, matchMap) : [],
    [view, tree, expanded, matchMap],
  );

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
                if (ranked[0]) add(ranked[0].item);
                else if (q.trim()) add(q.trim()); // free-form fallback
              } else if (e.key === 'Escape') {
                setOpen(false);
              } else if (e.key === 'Backspace' && q === '' && selected.length > 0) {
                remove(selected[selected.length - 1]);
              }
            }}
          />
        )}
      </div>
      {open && (
        <div className="tagpicker-menu">
          <div className="tagpicker-menu-toolbar">
            <span className="tagpicker-menu-status">
              {candidates.length} tag{candidates.length === 1 ? '' : 's'}
              {q ? ` · ${ranked.length} match` : ''}
            </span>
            <div className="tagpicker-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={view === 'list' ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); setViewPersist('list'); }}
                title="Flat list"
              >☰</button>
              <button
                type="button"
                className={view === 'tree' ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); setViewPersist('tree'); }}
                title="Folder tree"
              >🗂</button>
            </div>
          </div>
          {view === 'list' ? (
            ranked.length === 0 ? (
              <div className="tagpicker-empty">no matches</div>
            ) : (
              <VirtualList
                className="tagpicker-vlist"
                items={ranked}
                rowHeight={26}
                keyOf={(h) => h.item}
                renderItem={(h) => (
                  <button
                    type="button"
                    className="tagpicker-row"
                    onMouseDown={(e) => { e.preventDefault(); add(h.item); }}
                    title={h.item}
                  >
                    <code><HighlightedText text={h.item} ranges={h.ranges} /></code>
                  </button>
                )}
              />
            )
          ) : (
            treeRows.length === 0 ? (
              <div className="tagpicker-empty">no matches</div>
            ) : (
              <VirtualList
                className="tagpicker-vlist"
                items={treeRows}
                rowHeight={24}
                keyOf={(r) => r.kind === 'branch' ? `B:${r.node.fullTag}` : `L:${r.node.fullTag}:${r.depth}`}
                renderItem={(r) => {
                  if (r.kind === 'branch') {
                    return (
                      <button
                        type="button"
                        className="tagpicker-tree-branch"
                        style={{ paddingLeft: `${0.5 + r.depth * 0.9}em` }}
                        onMouseDown={(e) => { e.preventDefault(); toggleNode(r.node.fullTag); }}
                        title={r.node.fullTag}
                      >
                        <span className="tagpicker-tree-caret">{r.expanded ? '▾' : '▸'}</span>
                        <span className="tagpicker-tree-label">{r.node.label}</span>
                        {r.matchCount > 0 && q && (
                          <span className="tagpicker-tree-count">{r.matchCount}</span>
                        )}
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      className="tagpicker-tree-leaf"
                      style={{ paddingLeft: `${1.4 + r.depth * 0.9}em` }}
                      onMouseDown={(e) => { e.preventDefault(); add(r.node.fullTag); }}
                      title={r.node.fullTag}
                    >
                      <code><HighlightedText text={r.node.label} ranges={r.ranges} /></code>
                    </button>
                  );
                }}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
