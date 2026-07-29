import { useMemo, useState } from 'react';
import { getFolderTheme } from '../folderTheme';
import type { TechGraph, TechNode } from './graph';
import type { TechFilters, TechView } from './TechTreeSubTab';
import { nodePasses } from './filters';

type GroupBy = 'tier' | 'level' | 'station';

interface Props {
  graph: TechGraph;
  filters: TechFilters;
  focusId: string | null;
  onFocus: (id: string, view?: TechView) => void;
}

const LEVEL_COLOR = ['#6b7280', '#5fb3ff', '#e8c45e', '#ff8f6b'];

/** The ladder deliberately draws *no* edges. Progression questions ("what's
 *  gated behind L2", "how deep does the tree actually go") are answered by
 *  position and colour; lines only get in the way. */
export function LadderView({ graph, filters, focusId, onFocus }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('tier');
  const [hideRaw, setHideRaw] = useState(false);

  const columns = useMemo(() => {
    const passing = [...graph.nodes.values()].filter((n) => nodePasses(graph, n, filters));
    const buckets = new Map<string, { key: string; label: string; sort: number; nodes: TechNode[] }>();

    const push = (key: string, label: string, sort: number, node: TechNode) => {
      const b = buckets.get(key);
      if (b) b.nodes.push(node);
      else buckets.set(key, { key, label, sort, nodes: [node] });
    };

    for (const node of passing) {
      if (hideRaw && node.depth === 0) continue;

      if (groupBy === 'tier') {
        push(`t${node.depth}`, node.depth === 0 ? 'Raw materials' : `${node.depth} step${node.depth === 1 ? '' : 's'} from raw`, node.depth, node);
      } else if (groupBy === 'level') {
        push(`l${node.level}`, node.level === 0 ? 'Raw / found' : `Level ${node.level}`, node.level, node);
      } else {
        if (node.stations.length === 0) {
          push('__none', node.depth === 0 ? 'Found in world' : 'Build / upgrade', 999, node);
        } else {
          for (const st of node.stations) {
            push(st, graph.stations.get(st)?.label ?? st, 0, node);
          }
        }
      }
    }

    return [...buckets.values()]
      .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
      .map((b) => ({
        ...b,
        nodes: b.nodes.slice().sort((x, y) => x.level - y.level || x.label.localeCompare(y.label)),
      }));
  }, [graph, filters, groupBy, hideRaw]);

  const total = columns.reduce((sum, c) => sum + c.nodes.length, 0);

  return (
    <div className="tt-ladder">
      <div className="tt-ladder-tools">
        <div className="tt-chipgroup">
          <span className="tt-chipgroup-label">columns</span>
          {(['tier', 'level', 'station'] as GroupBy[]).map((g) => (
            <button
              key={g}
              className={`tt-chip${groupBy === g ? ' on' : ''}`}
              onClick={() => setGroupBy(g)}
            >
              {g === 'tier' ? 'craft depth' : g === 'level' ? 'recipe level' : 'station'}
            </button>
          ))}
        </div>
        <label className="tt-toolcheck">
          <input type="checkbox" checked={hideRaw} onChange={(e) => setHideRaw(e.target.checked)} />
          hide raw materials
        </label>
        <span className="tt-tooldiv" />
        <span className="tt-legend-inline">
          {[0, 1, 2, 3].map((lv) => (
            <span key={lv}>
              <i className="tt-swatch" style={{ background: LEVEL_COLOR[lv] }} />
              {lv === 0 ? 'raw' : `L${lv}`}
            </span>
          ))}
        </span>
        <span className="muted small">{total} entries across {columns.length} columns</span>
      </div>

      <div className="tt-ladder-cols">
        {columns.map((col) => (
          <div className="tt-ladder-col" key={col.key}>
            <header>
              <span className="tt-ladder-colname">{col.label}</span>
              <span className="tt-ladder-count">{col.nodes.length}</span>
            </header>
            <div className="tt-ladder-list">
              {col.nodes.map((n) => {
                const theme = getFolderTheme(n.folder);
                return (
                  <button
                    key={`${col.key}-${n.id}`}
                    className={`tt-ladder-chip${n.id === focusId ? ' focused' : ''}`}
                    style={{ borderLeftColor: LEVEL_COLOR[Math.min(3, n.level)] }}
                    onClick={() => onFocus(n.id, 'graph')}
                    title={`${n.label}\n${n.depth} steps from raw · recipe level ${n.level}\n${
                      n.stations.map((s) => graph.stations.get(s)?.label ?? s).join(', ') || 'no station'
                    }\n\nclick to trace the chain`}
                  >
                    <span className="tt-ladder-emoji">{theme.emoji}</span>
                    <span className="tt-ladder-label">{n.label}</span>
                    {n.isTerminal && n.depth > 0 && <span className="tt-ladder-flag" title="nothing uses this">▪</span>}
                  </button>
                );
              })}
              {col.nodes.length === 0 && <p className="muted small">empty</p>}
            </div>
          </div>
        ))}
        {columns.length === 0 && <p className="muted">Nothing matches the current filters.</p>}
      </div>
    </div>
  );
}
