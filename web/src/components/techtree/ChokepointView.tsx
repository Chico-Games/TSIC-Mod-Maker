import { useMemo, useState } from 'react';
import { getFolderTheme } from '../folderTheme';
import { transitiveDependents } from './graph';
import type { TechGraph } from './graph';
import type { TechFilters, TechView } from './TechTreeSubTab';
import { nodePasses } from './filters';

type Metric = 'reach' | 'recipes';

interface Props {
  graph: TechGraph;
  filters: TechFilters;
  onFocus: (id: string, view?: TechView) => void;
}

/** Ranks materials by how much of the tree collapses without them. A direct
 *  consumer count under-reads deep chains — Scrap Metal feeding one recipe
 *  that feeds forty is a chokepoint, and only the transitive measure says so. */
export function ChokepointView({ graph, filters, onFocus }: Props) {
  const [metric, setMetric] = useState<Metric>('reach');
  const reach = useMemo(() => transitiveDependents(graph), [graph]);

  const rows = useMemo(() => {
    const list = [...graph.nodes.values()]
      .filter((n) => nodePasses(graph, n, filters))
      .map((n) => ({
        node: n,
        reach: reach.get(n.id) ?? 0,
        recipes: n.consumedBy.length,
      }))
      .filter((r) => r.recipes > 0);
    list.sort((a, b) => b[metric] - a[metric] || a.node.label.localeCompare(b.node.label));
    return list.slice(0, 40);
  }, [graph, filters, reach, metric]);

  const max = rows.length ? rows[0][metric] : 1;

  return (
    <div className="tt-choke">
      <div className="tt-choke-tools">
        <div className="tt-chipgroup">
          <span className="tt-chipgroup-label">rank by</span>
          <button className={`tt-chip${metric === 'reach' ? ' on' : ''}`} onClick={() => setMetric('reach')}>
            things downstream
          </button>
          <button className={`tt-chip${metric === 'recipes' ? ' on' : ''}`} onClick={() => setMetric('recipes')}>
            recipes using it
          </button>
        </div>
        <span className="tt-tooldiv" />
        <span className="muted small">
          top {rows.length} of {graph.nodes.size} · {metric === 'reach'
            ? 'how many things become uncraftable without it'
            : 'how many recipes list it as an input'}
        </span>
      </div>

      <ol className="tt-choke-list">
        {rows.map((r, i) => {
          const theme = getFolderTheme(r.node.folder);
          const pct = max > 0 ? (r[metric] / max) * 100 : 0;
          return (
            <li key={r.node.id}>
              <button className="tt-choke-row" onClick={() => onFocus(r.node.id, 'graph')}>
                <span className="tt-choke-rank">{i + 1}</span>
                <span className="tt-choke-name">
                  {theme.emoji} {r.node.label}
                </span>
                <span className="tt-choke-track">
                  <span
                    className="tt-choke-fill"
                    style={{ width: `${pct}%`, background: theme.color }}
                  />
                </span>
                <span className="tt-choke-num">{r[metric]}</span>
                <span className="tt-choke-sub muted">
                  {metric === 'reach' ? `${r.recipes} recipes` : `${r.reach} downstream`}
                  {r.node.depth === 0 ? ' · raw' : ` · ${r.node.depth} steps`}
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <p className="muted tt-empty">Nothing matches the current filters.</p>}
      </ol>
    </div>
  );
}
