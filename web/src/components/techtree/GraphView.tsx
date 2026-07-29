import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dagre from 'dagre';
import { getFolderTheme } from '../folderTheme';
import { neighbourhood, transitiveDependents } from './graph';
import type { TechGraph, TechEdge } from './graph';
import type { TechFilters, TechView } from './TechTreeSubTab';
import { nodePasses } from './filters';

const NODE_H = 30;
const MIN_W = 96;
const MAX_W = 230;
const ROW_GAP = 8;
const SUBCOL_GAP = 12;
const RANK_GAP = 120;

const KIND_COLOR: Record<string, string> = {
  craft: '#5fb3ff',
  plant: '#7ec97a',
  upgrade: '#d8b06b',
};

function nodeWidth(label: string): number {
  return Math.max(MIN_W, Math.min(MAX_W, 26 + label.length * 6.6));
}

interface Props {
  graph: TechGraph;
  filters: TechFilters;
  focusId: string | null;
  onFocus: (id: string, view?: TechView) => void;
  onOpen: (id: string) => void;
}

export function GraphView({ graph, filters, focusId, onFocus, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 1200, h: 700 });
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<TechEdge | null>(null);
  const [up, setUp] = useState(2);
  const [down, setDown] = useState(2);
  const [showLabels, setShowLabels] = useState(true);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- which nodes/edges are in play ----------------------------------
  const scope = useMemo(() => {
    if (focusId && graph.nodes.has(focusId)) {
      const nb = neighbourhood(graph, focusId, up, down);
      return {
        nodeIds: new Set(nb.hops.keys()),
        edgeIds: nb.edgeIds,
        hops: nb.hops,
      };
    }
    const nodeIds = new Set(
      [...graph.nodes.values()].filter((n) => nodePasses(graph, n, filters)).map((n) => n.id),
    );
    const edgeIds = new Set(
      graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)).map((e) => e.id),
    );
    return { nodeIds, edgeIds, hops: null as Map<string, number> | null };
  }, [graph, filters, focusId, up, down]);

  const visibleNodes = useMemo(
    () => [...scope.nodeIds].map((id) => graph.nodes.get(id)!).filter(Boolean),
    [scope, graph],
  );
  const visibleEdges = useMemo(
    () => graph.edges.filter((e) => scope.edgeIds.has(e.id)),
    [scope, graph],
  );

  // ---- layout ----------------------------------------------------------
  const viewportH = viewport.h;
  const layout = useMemo(() => {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: 'LR', nodesep: 16, ranksep: 110, marginx: 40, marginy: 40, ranker: 'longest-path' });
    g.setDefaultEdgeLabel(() => ({}));

    const sizes = new Map<string, number>();
    for (const n of visibleNodes) {
      const w = nodeWidth(n.label);
      sizes.set(n.id, w);
      g.setNode(n.id, { width: w, height: NODE_H });
    }
    // Collapse parallel edges for layout purposes — several recipes can link
    // the same pair and dagre only needs to know they're adjacent.
    const seen = new Set<string>();
    for (const e of visibleEdges) {
      const key = `${e.from}->${e.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      g.setEdge(e.from, e.to);
    }
    dagre.layout(g);

    // Keep dagre's rank *centre* — nodes in one rank share it, whereas their
    // left edges differ because each node is sized to its own label.
    const raw = new Map<string, { cx: number; y: number; w: number }>();
    for (const n of visibleNodes) {
      const v = g.node(n.id);
      if (!v) continue;
      raw.set(n.id, { cx: v.x, y: v.y - NODE_H / 2, w: sizes.get(n.id) ?? MIN_W });
    }

    // Dagre gives every rank a single column, so a hub with 64 dependents
    // becomes a 64-tall strip that only fits on screen at ~20% zoom. Wrap any
    // over-long rank into sub-columns instead, keeping dagre's within-rank
    // ordering (which is already crossing-minimised) and pushing later ranks
    // right to make room.
    const maxRows = Math.max(6, Math.floor((viewportH - 90) / (NODE_H + ROW_GAP)));
    const ranks = new Map<number, string[]>();
    for (const [id, p] of raw) {
      const key = Math.round(p.cx);
      const list = ranks.get(key);
      if (list) list.push(id);
      else ranks.set(key, [id]);
    }

    const pos = new Map<string, { x: number; y: number; w: number }>();
    const columns: Array<{ x: number; count: number; depth: number }> = [];
    const baseY = 40;
    let cursorX = 40;

    for (const rankX of [...ranks.keys()].sort((a, b) => a - b)) {
      const ids = ranks.get(rankX)!.sort((a, b) => (raw.get(a)!.y - raw.get(b)!.y));
      const colWidth = Math.max(...ids.map((id) => raw.get(id)!.w));
      const subCols = Math.max(1, Math.ceil(ids.length / maxRows));
      const perCol = Math.ceil(ids.length / subCols);

      ids.forEach((id, i) => {
        const sub = Math.floor(i / perCol);
        const row = i % perCol;
        pos.set(id, {
          x: cursorX + sub * (colWidth + SUBCOL_GAP),
          y: baseY + row * (NODE_H + ROW_GAP),
          w: raw.get(id)!.w,
        });
      });

      const depths = new Map<number, number>();
      for (const id of ids) {
        const d = graph.nodes.get(id)?.depth ?? 0;
        depths.set(d, (depths.get(d) ?? 0) + 1);
      }
      let depth = 0;
      let best = -1;
      for (const [d, n] of depths) {
        if (n > best) {
          best = n;
          depth = d;
        }
      }
      columns.push({ x: cursorX, count: ids.length, depth });

      cursorX += subCols * (colWidth + SUBCOL_GAP) - SUBCOL_GAP + RANK_GAP;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pos.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 100;
      maxY = 100;
    }

    return { pos, minX, minY, maxX, maxY, columns };
  }, [visibleNodes, visibleEdges, graph, viewportH]);

  // ---- fit -------------------------------------------------------------
  const fit = useCallback(() => {
    const w = layout.maxX - layout.minX;
    const h = layout.maxY - layout.minY;
    if (w <= 0 || h <= 0 || viewport.w <= 0) return;
    const k = Math.min(viewport.w / w, viewport.h / h, 1.6) * 0.92;
    setTransform({
      k,
      x: viewport.w / 2 - ((layout.minX + layout.maxX) / 2) * k,
      y: viewport.h / 2 - ((layout.minY + layout.maxY) / 2) * k,
    });
  }, [layout, viewport]);

  // Refit whenever the layout is rebuilt — including the first time the
  // project finishes loading, which arrives well after mount.
  useEffect(() => {
    fit();
  }, [fit]);

  const onWheel = (ev: React.WheelEvent) => {
    ev.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    setTransform((t) => {
      const k = Math.max(0.08, Math.min(4, t.k * factor));
      const ratio = k / t.k;
      return { k, x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio };
    });
  };

  const onMouseDown = (ev: React.MouseEvent) => {
    if (ev.button !== 0) return;
    panRef.current = { x: ev.clientX, y: ev.clientY, tx: transform.x, ty: transform.y };
  };
  const onMouseMove = (ev: React.MouseEvent) => {
    const p = panRef.current;
    if (!p) return;
    setTransform((t) => ({ ...t, x: p.tx + (ev.clientX - p.x), y: p.ty + (ev.clientY - p.y) }));
  };
  const endPan = () => {
    panRef.current = null;
  };

  // ---- highlight -------------------------------------------------------
  const highlight = useMemo(() => {
    if (!hover) return null;
    const nodes = new Set<string>([hover]);
    const edges = new Set<string>();
    for (const e of visibleEdges) {
      if (e.from === hover || e.to === hover) {
        edges.add(e.id);
        nodes.add(e.from);
        nodes.add(e.to);
      }
    }
    return { nodes, edges };
  }, [hover, visibleEdges]);

  const edgePath = (e: TechEdge): string | null => {
    const a = layout.pos.get(e.from);
    const b = layout.pos.get(e.to);
    if (!a || !b) return null;
    const x1 = a.x + a.w;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const dx = Math.max(28, (x2 - x1) * 0.5);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };

  const focusedMode = !!focusId && graph.nodes.has(focusId);
  const labelsOn = showLabels && transform.k > 0.45;

  // An unfiltered, unfocused graph is ~180 nodes over ~6 ranks — a tall thin
  // strip that's unreadable at whatever zoom fits it. Rather than render a
  // hairball nobody can use, offer somewhere to start. The Ladder view is the
  // real overview; this one is for tracing.
  const tooBroad = !focusedMode && visibleNodes.length > 60;
  if (tooBroad) {
    return <GraphLanding graph={graph} onFocus={onFocus} count={visibleNodes.length} />;
  }

  return (
    <div className="tt-graph">
      <div className="tt-graph-tools">
        <button onClick={fit} title="Fit graph to view">⤢ fit</button>
        <button onClick={() => setTransform((t) => ({ ...t, k: Math.min(4, t.k * 1.25) }))}>＋</button>
        <button onClick={() => setTransform((t) => ({ ...t, k: Math.max(0.08, t.k / 1.25) }))}>－</button>
        <span className="tt-zoomreadout">{Math.round(transform.k * 100)}%</span>

        <label className="tt-toolcheck">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          labels
        </label>

        {focusedMode && (
          <>
            <span className="tt-tooldiv" />
            <label className="tt-hopctl">
              ← ingredients
              <input type="range" min={0} max={5} value={up} onChange={(e) => setUp(+e.target.value)} />
              <b>{up}</b>
            </label>
            <label className="tt-hopctl">
              uses →
              <input type="range" min={0} max={5} value={down} onChange={(e) => setDown(+e.target.value)} />
              <b>{down}</b>
            </label>
          </>
        )}

        <span className="tt-tooldiv" />
        <span className="muted small">
          {visibleNodes.length} shown · {visibleEdges.length} links
        </span>
        {!focusedMode && <span className="tt-hint">click a node to trace its chain</span>}
      </div>

      <div
        className="tt-graph-canvas"
        ref={wrapRef}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endPan}
        onMouseLeave={() => {
          endPan();
          setHover(null);
        }}
      >
        <svg width={viewport.w} height={viewport.h}>
          <defs>
            {Object.entries(KIND_COLOR).map(([kind, color]) => (
              <marker
                key={kind}
                id={`tt-arrow-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill={color} />
              </marker>
            ))}
          </defs>

          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {/* tier ruler */}
            {!focusedMode &&
              layout.columns.map((col) => (
                <text
                  key={col.x}
                  x={col.x}
                  y={layout.minY - 14}
                  className="tt-tierlabel"
                  fontSize={13}
                >
                  {col.depth === 0 ? 'raw' : `${col.depth} steps`} · {col.count}
                </text>
              ))}

            {/* edges */}
            <g className="tt-edges">
              {visibleEdges.map((e) => {
                const d = edgePath(e);
                if (!d) return null;
                const dim = highlight ? !highlight.edges.has(e.id) : false;
                const color = KIND_COLOR[e.kind] ?? '#8a8f98';
                return (
                  <path
                    key={e.id}
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={dim ? 1 : 1.8}
                    opacity={dim ? 0.07 : highlight ? 0.95 : 0.34}
                    markerEnd={dim ? undefined : `url(#tt-arrow-${e.kind})`}
                    onMouseEnter={() => setHoverEdge(e)}
                    onMouseLeave={() => setHoverEdge(null)}
                    style={{ cursor: 'pointer' }}
                  />
                );
              })}
            </g>

            {/* Edge quantities. On a hub every edge shares an origin, so
                drawing them all stacks the numbers into an unreadable wall on
                the left — show them only for a small graph, or on hover. */}
            {labelsOn &&
              visibleEdges.map((e) => {
                if (!(visibleEdges.length <= 14 || highlight?.edges.has(e.id))) return null;
                const a = layout.pos.get(e.from);
                const b = layout.pos.get(e.to);
                if (!a || !b) return null;
                const mx = (a.x + a.w + b.x) / 2;
                const my = (a.y + b.y) / 2 + NODE_H / 2;
                return (
                  <text key={`q-${e.id}`} x={mx} y={my - 4} className="tt-edgeqty" fontSize={10}>
                    {e.qtyIn}×
                  </text>
                );
              })}

            {/* nodes */}
            {visibleNodes.map((n) => {
              const p = layout.pos.get(n.id);
              if (!p) return null;
              const theme = getFolderTheme(n.folder);
              const dim = highlight ? !highlight.nodes.has(n.id) : false;
              const isFocus = n.id === focusId;
              const hop = scope.hops?.get(n.id) ?? 0;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={dim ? 0.16 : 1}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onFocus(n.id)}
                  onDoubleClick={() => onOpen(n.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    width={p.w}
                    height={NODE_H}
                    rx={7}
                    ry={7}
                    fill={isFocus ? '#2b3444' : '#1c1f26'}
                    stroke={isFocus ? '#ffd479' : theme.color}
                    strokeWidth={isFocus ? 2.5 : 1.4}
                  />
                  {focusedMode && hop !== 0 && (
                    <circle
                      cx={hop < 0 ? 0 : p.w}
                      cy={NODE_H / 2}
                      r={3}
                      fill={hop < 0 ? '#5fb3ff' : '#7ec97a'}
                    />
                  )}
                  {labelsOn && (
                    <text x={9} y={20} fill="#e3e6ea" fontSize={12} className="tt-label">
                      {theme.emoji} {n.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {hoverEdge && (
          <div className="tt-edgecard">
            <div className="tt-edgecard-title">
              {graph.recipes.get(hoverEdge.recipeId)?.label ?? hoverEdge.recipeId}
            </div>
            <RecipeSummary graph={graph} recipeId={hoverEdge.recipeId} />
          </div>
        )}
      </div>

      <div className="tt-legend">
        <span><i className="tt-swatch" style={{ background: KIND_COLOR.craft }} /> craft</span>
        <span><i className="tt-swatch" style={{ background: KIND_COLOR.plant }} /> plant</span>
        <span><i className="tt-swatch" style={{ background: KIND_COLOR.upgrade }} /> furniture upgrade</span>
        <span className="muted">scroll = zoom · drag = pan · click = focus · double-click = open definition</span>
      </div>
    </div>
  );
}

/** Entry point for the Chain view. Tracing needs a subject; this offers the
 *  three that are usually worth looking at, plus a search. */
function GraphLanding({
  graph,
  onFocus,
  count,
}: {
  graph: TechGraph;
  onFocus: (id: string) => void;
  count: number;
}) {
  const [q, setQ] = useState('');
  const reach = useMemo(() => transitiveDependents(graph), [graph]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return [...graph.nodes.values()]
      .filter((n) => n.label.toLowerCase().includes(needle) || n.id.toLowerCase().includes(needle))
      .sort((a, b) => a.label.length - b.label.length)
      .slice(0, 12);
  }, [graph, q]);

  const deepest = useMemo(
    () =>
      [...graph.nodes.values()]
        .filter((n) => n.depth > 0)
        .sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label))
        .slice(0, 8),
    [graph],
  );

  const loadBearing = useMemo(
    () =>
      [...graph.nodes.values()]
        .filter((n) => n.consumedBy.length > 0)
        .sort((a, b) => (reach.get(b.id) ?? 0) - (reach.get(a.id) ?? 0))
        .slice(0, 8),
    [graph, reach],
  );

  const endProducts = useMemo(
    () =>
      [...graph.nodes.values()]
        .filter((n) => n.isTerminal && n.depth > 1)
        .sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label))
        .slice(0, 8),
    [graph],
  );

  const column = (title: string, blurb: string, nodes: typeof deepest, note: (n: (typeof deepest)[0]) => string) => (
    <section className="tt-landing-col">
      <h4>{title}</h4>
      <p className="muted small">{blurb}</p>
      <ul>
        {nodes.map((n) => (
          <li key={n.id}>
            <button onClick={() => onFocus(n.id)}>
              <span className="tt-landing-name">
                {getFolderTheme(n.folder).emoji} {n.label}
              </span>
              <span className="muted small">{note(n)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="tt-landing">
      <div className="tt-landing-head">
        <h3>Trace a chain</h3>
        <p className="muted">
          {count} things is too many to draw at once — the whole graph is a strip you can't read.
          Pick something and this view shows just what feeds it and what it feeds.
          For the bird's-eye read, use <strong>Ladder</strong>.
        </p>
        <div className="tt-landing-search">
          <input
            type="text"
            autoFocus
            placeholder="search for an item, material or furniture…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {matches.length > 0 && (
            <ul className="tt-landing-results">
              {matches.map((n) => (
                <li key={n.id}>
                  <button onClick={() => onFocus(n.id)}>
                    <span className="tt-landing-name">
                      {getFolderTheme(n.folder).emoji} {n.label}
                    </span>
                    <span className="muted small">
                      {n.depth === 0 ? 'raw' : `${n.depth} steps`} · {n.producedBy.length} recipe(s) in ·{' '}
                      {n.consumedBy.length} out
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim() && matches.length === 0 && <p className="muted small">nothing matches “{q}”.</p>}
        </div>
      </div>

      <div className="tt-landing-cols">
        {column('Deepest chains', 'Most crafting steps from raw materials.', deepest, (n) => `${n.depth} steps`)}
        {column(
          'Load-bearing materials',
          'Most of the tree becomes uncraftable without these.',
          loadBearing,
          (n) => `${reach.get(n.id) ?? 0} downstream`,
        )}
        {column('End products', 'Crafted, then never used as an ingredient.', endProducts, (n) => `${n.depth} steps`)}
      </div>
    </div>
  );
}

function RecipeSummary({ graph, recipeId }: { graph: TechGraph; recipeId: string }) {
  const r = graph.recipes.get(recipeId);
  if (!r) return null;
  return (
    <div className="tt-edgecard-body">
      <div className="tt-edgecard-row">
        <span className="tt-edgecard-key">in</span>
        <span>
          {r.inputs.map((i) => `${i.qty}× ${graph.nodes.get(i.id)?.label ?? i.id}`).join(', ') || '—'}
        </span>
      </div>
      <div className="tt-edgecard-row">
        <span className="tt-edgecard-key">out</span>
        <span>
          {r.outputs.map((o) => `${o.qty}× ${graph.nodes.get(o.id)?.label ?? o.id}`).join(', ') || '—'}
        </span>
      </div>
      <div className="tt-edgecard-row">
        <span className="tt-edgecard-key">at</span>
        <span>
          {r.stations.map((s) => graph.stations.get(s)?.label ?? s).join(', ') ||
            (r.kind === 'upgrade' ? 'build / upgrade' : '⚠ no station')}
        </span>
      </div>
      <div className="tt-edgecard-meta">
        L{r.level} · {r.duration}s{r.upgradeTier !== undefined ? ` · tier ${r.upgradeTier}` : ''}
      </div>
    </div>
  );
}
