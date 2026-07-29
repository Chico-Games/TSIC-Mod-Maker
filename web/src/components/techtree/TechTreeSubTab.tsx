import { useMemo, useState } from 'react';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { useAppStore } from '../../store/appStore';
import { buildTechGraph } from './graph';
import type { RecipeKind, TechGraph } from './graph';
import { GraphView } from './GraphView';
import { LadderView } from './LadderView';
import { CostView } from './CostView';
import { ChokepointView } from './ChokepointView';
import { AuditView } from './AuditView';

export type TechView = 'graph' | 'ladder' | 'cost' | 'chokepoints' | 'audit';

const VIEWS: Array<{ id: TechView; label: string; emoji: string; hint: string }> = [
  { id: 'graph', label: 'Chain', emoji: '🕸️', hint: 'Trace what feeds into and out of one thing' },
  { id: 'ladder', label: 'Ladder', emoji: '🪜', hint: 'Everything laid out by tier — read the pacing' },
  { id: 'cost', label: 'Cost', emoji: '🧾', hint: 'Recursive raw-material rollup for one item' },
  { id: 'chokepoints', label: 'Chokepoints', emoji: '🎯', hint: 'Which materials the tree leans on' },
  { id: 'audit', label: 'Audit', emoji: '🚩', hint: 'Dead ends, orphans, unreachable content' },
];

export interface TechFilters {
  text: string;
  levels: Set<number>;
  kinds: Set<RecipeKind>;
  station: string;
}

export function TechTreeSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);

  const [view, setView] = useState<TechView>('graph');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [levels, setLevels] = useState<Set<number>>(new Set());
  const [kinds, setKinds] = useState<Set<RecipeKind>>(new Set());
  const [station, setStation] = useState('');

  const graph: TechGraph = useMemo(
    () => buildTechGraph(definitions, findKeyById),
    [definitions, findKeyById],
  );

  const filters: TechFilters = useMemo(
    () => ({ text, levels, kinds, station }),
    [text, levels, kinds, station],
  );

  /** Jump to a definition in the Definitions tab. */
  const openDefinition = (id: string) => {
    const key = findKeyById(id);
    if (!key) return;
    const rec = definitions.get(key);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(key);
    setTab('definitions');
  };

  /** Focus a node and switch to whichever view makes sense for it. */
  const focusNode = (id: string, targetView?: TechView) => {
    setFocusId(id);
    if (targetView) setView(targetView);
  };

  const toggleLevel = (lv: number) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });
  };

  const toggleKind = (k: RecipeKind) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const stationOptions = useMemo(
    () => [...graph.stations.values()].sort((a, b) => a.label.localeCompare(b.label)),
    [graph],
  );

  const focusLabel = focusId ? graph.nodes.get(focusId)?.label ?? focusId : null;
  const filtersActive = !!text || levels.size > 0 || kinds.size > 0 || !!station;

  return (
    <div className="tech-tree-layout">
      <div className="tt-viewbar">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`tt-viewbtn${view === v.id ? ' active' : ''}`}
            onClick={() => setView(v.id)}
            title={v.hint}
          >
            <span className="tt-viewbtn-emoji">{v.emoji}</span>
            {v.label}
          </button>
        ))}

        <div className="tt-viewbar-spacer" />

        {focusLabel && (
          <span className="tt-focus-chip" title="Focused node — click to clear">
            focus: <strong>{focusLabel}</strong>
            <button onClick={() => setFocusId(null)} aria-label="clear focus">
              ×
            </button>
          </span>
        )}
        <span className="muted small">
          {graph.nodes.size} things · {graph.recipes.size} recipes · {graph.edges.length} links
        </span>
      </div>

      <div className="tt-filterbar">
        <input
          className="tt-filter-text"
          type="text"
          placeholder="search things…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="tt-chipgroup" role="group" aria-label="recipe level">
          <span className="tt-chipgroup-label">level</span>
          {[1, 2, 3].map((lv) => (
            <button
              key={lv}
              className={`tt-chip lv${lv}${levels.has(lv) ? ' on' : ''}`}
              onClick={() => toggleLevel(lv)}
            >
              L{lv}
            </button>
          ))}
        </div>

        <div className="tt-chipgroup" role="group" aria-label="recipe kind">
          <span className="tt-chipgroup-label">via</span>
          {(['craft', 'plant', 'upgrade'] as RecipeKind[]).map((k) => (
            <button
              key={k}
              className={`tt-chip kind-${k}${kinds.has(k) ? ' on' : ''}`}
              onClick={() => toggleKind(k)}
            >
              {k}
            </button>
          ))}
        </div>

        <select
          className="tt-filter-select"
          value={station}
          onChange={(e) => setStation(e.target.value)}
          title="Only things craftable at this station"
        >
          <option value="">any station</option>
          {stationOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.recipes.length})
            </option>
          ))}
        </select>

        {filtersActive && (
          <button
            className="tt-clear-filters"
            onClick={() => {
              setText('');
              setLevels(new Set());
              setKinds(new Set());
              setStation('');
            }}
          >
            clear filters
          </button>
        )}
      </div>

      <div className="tt-viewport">
        {view === 'graph' && (
          <GraphView
            graph={graph}
            filters={filters}
            focusId={focusId}
            onFocus={focusNode}
            onOpen={openDefinition}
          />
        )}
        {view === 'ladder' && (
          <LadderView graph={graph} filters={filters} focusId={focusId} onFocus={focusNode} />
        )}
        {view === 'cost' && (
          <CostView graph={graph} filters={filters} focusId={focusId} onFocus={focusNode} onOpen={openDefinition} />
        )}
        {view === 'chokepoints' && (
          <ChokepointView graph={graph} filters={filters} onFocus={focusNode} />
        )}
        {view === 'audit' && <AuditView graph={graph} onFocus={focusNode} onOpen={openDefinition} />}
      </div>
    </div>
  );
}
