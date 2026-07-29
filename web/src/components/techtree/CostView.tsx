import { useMemo, useState } from 'react';
import { getFolderTheme } from '../folderTheme';
import { flattenRaw, rollupCost } from './graph';
import type { CostLine, TechGraph } from './graph';
import type { TechFilters, TechView } from './TechTreeSubTab';
import { nodePasses } from './filters';

interface Props {
  graph: TechGraph;
  filters: TechFilters;
  focusId: string | null;
  onFocus: (id: string, view?: TechView) => void;
  onOpen: (id: string) => void;
}

/** "What does this actually cost me?" — expands a craftable recursively down
 *  to the things the player has to find in the world, and totals them. */
export function CostView({ graph, filters, focusId, onFocus, onOpen }: Props) {
  const [qty, setQty] = useState(1);

  const craftables = useMemo(
    () =>
      [...graph.nodes.values()]
        .filter((n) => n.producedBy.length > 0 && nodePasses(graph, n, filters))
        .sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label)),
    [graph, filters],
  );

  const targetId = focusId && graph.nodes.get(focusId)?.producedBy.length ? focusId : craftables[0]?.id ?? null;
  const tree = useMemo(
    () => (targetId ? rollupCost(graph, targetId, qty) : null),
    [graph, targetId, qty],
  );
  const raw = useMemo(() => (tree ? flattenRaw(tree) : new Map()), [tree]);

  const rawTotal = useMemo(() => [...raw.values()].reduce((s, r) => s + r.qty, 0), [raw]);
  const stepCount = useMemo(() => {
    if (!tree) return 0;
    let n = 0;
    const walk = (l: CostLine) => {
      if (l.via) n += 1;
      l.children.forEach(walk);
    };
    walk(tree);
    return n;
  }, [tree]);

  if (!targetId || !tree) {
    return <p className="muted tt-empty">Nothing craftable matches the current filters.</p>;
  }

  return (
    <div className="tt-cost">
      <div className="tt-cost-tools">
        <label className="tt-cost-pick">
          make
          <input
            type="number"
            min={1}
            max={999}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(999, +e.target.value || 1)))}
          />
          ×
          <select value={targetId} onChange={(e) => onFocus(e.target.value)}>
            {craftables.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <span className="tt-tooldiv" />
        <span className="muted small">
          {stepCount} crafting steps · {raw.size} distinct raw materials · {rawTotal} items total
        </span>
      </div>

      <div className="tt-cost-panes">
        <section className="tt-cost-tree">
          <h4>Chain</h4>
          <CostNode line={tree} graph={graph} onOpen={onOpen} onFocus={onFocus} />
        </section>

        <section className="tt-cost-totals">
          <h4>Raw materials</h4>
          <ul>
            {[...raw.entries()]
              .sort((a, b) => b[1].qty - a[1].qty)
              .map(([id, r]) => {
                const theme = getFolderTheme(r.folder);
                const share = rawTotal > 0 ? (r.qty / rawTotal) * 100 : 0;
                return (
                  <li key={id}>
                    <button className="tt-cost-rawrow" onClick={() => onFocus(id, 'graph')} title={id}>
                      <span className="tt-cost-bar" style={{ width: `${share}%` }} />
                      <span className="tt-cost-rawname">
                        {theme.emoji} {r.label}
                      </span>
                      <span className="tt-cost-rawqty">{r.qty}</span>
                    </button>
                  </li>
                );
              })}
            {raw.size === 0 && <li className="muted small">no inputs — this is a raw material</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CostNode({
  line,
  graph,
  onOpen,
  onFocus,
}: {
  line: CostLine;
  graph: TechGraph;
  onOpen: (id: string) => void;
  onFocus: (id: string, view?: TechView) => void;
}) {
  const [open, setOpen] = useState(line.depth < 2);
  const theme = getFolderTheme(line.folder);
  const recipe = line.via ? graph.recipes.get(line.via) : undefined;
  const hasChildren = line.children.length > 0;

  return (
    <div className="tt-cost-node" style={{ marginLeft: line.depth === 0 ? 0 : 16 }}>
      <div className="tt-cost-noderow">
        {hasChildren ? (
          <button className="tt-cost-twisty" onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tt-cost-twisty" />
        )}
        <span className="tt-cost-qty">{line.qty}×</span>
        <button className="tt-cost-name" onClick={() => onFocus(line.id, 'graph')} onDoubleClick={() => onOpen(line.id)}>
          {theme.emoji} {line.label}
        </button>
        {line.isRaw && <span className="tt-cost-tag raw">raw</span>}
        {line.cyclic && <span className="tt-cost-tag cyclic" title="Recipe loops back on itself — stopped here">loop</span>}
        {recipe && (
          <span className="tt-cost-tag via">
            L{recipe.level} ·{' '}
            {recipe.stations.map((s) => graph.stations.get(s)?.label ?? s).join(', ') ||
              (recipe.kind === 'upgrade' ? 'build' : '⚠ no station')}
          </span>
        )}
      </div>
      {open && line.children.map((c, i) => (
        <CostNode key={`${c.id}-${i}`} line={c} graph={graph} onOpen={onOpen} onFocus={onFocus} />
      ))}
    </div>
  );
}
