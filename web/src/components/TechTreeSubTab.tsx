import { useMemo, useState } from 'react';
import dagre from 'dagre';
import { useDefinitionsStore } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';
import { humanizeAssetId } from './definitionsNaming';
import { getFolderTheme } from './folderTheme';

type NodeKind = 'item' | 'recipe' | 'station';

interface Node {
  id: string;
  kind: NodeKind;
  label: string;
  folder: string;
}

interface Edge {
  from: string;
  to: string;
  kind: 'input' | 'output' | 'station';
}

const RECIPE_FOLDERS = new Set([
  'craft_recipe_definitions',
  'plant_recipe_definitions',
  'furniture_upgrade_recipe',
]);
const STATION_FOLDERS = new Set([
  'crafting_station_definitions',
  'production_station_definitions',
  'plantable_definitions',
]);

export function TechTreeSubTab() {
  const definitions = useDefinitionsStore((s) => s.definitions);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const setTab = useAppStore((s) => s.setTab);

  const [showRecipes, setShowRecipes] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [filterText, setFilterText] = useState('');

  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, Node>();
    const edges: Edge[] = [];

    const addNode = (id: string, kind: NodeKind, folder: string) => {
      if (nodeMap.has(id)) return;
      nodeMap.set(id, { id, kind, label: humanizeAssetId(id), folder });
    };

    // Recipes drive most edges. We walk every recipe's input/output maps to
    // produce item nodes and item↔recipe edges. Station↔recipe edges come
    // from each station's ARR.
    for (const rec of definitions.values()) {
      if (!RECIPE_FOLDERS.has(rec.folder)) continue;
      addNode(rec.id, 'recipe', rec.folder);
      const inputs: any = rec.json?.properties?.input;
      const outputs: any = rec.json?.properties?.output;
      if (inputs?.type === 'map' && Array.isArray(inputs.value)) {
        for (const e of inputs.value) {
          const k = e?.key;
          const refId = k && typeof k === 'object' ? String(k.value ?? '') : '';
          if (!refId) continue;
          const tk = findKeyById(refId);
          const folder = tk ? definitions.get(tk)?.folder ?? '' : '';
          addNode(refId, 'item', folder);
          edges.push({ from: refId, to: rec.id, kind: 'input' });
        }
      }
      if (outputs?.type === 'map' && Array.isArray(outputs.value)) {
        for (const e of outputs.value) {
          const k = e?.key;
          const refId = k && typeof k === 'object' ? String(k.value ?? '') : '';
          if (!refId) continue;
          const tk = findKeyById(refId);
          const folder = tk ? definitions.get(tk)?.folder ?? '' : '';
          addNode(refId, 'item', folder);
          edges.push({ from: rec.id, to: refId, kind: 'output' });
        }
      }
    }

    // Station→recipe via ARR.
    for (const rec of definitions.values()) {
      if (!STATION_FOLDERS.has(rec.folder)) continue;
      const arrRef: any = rec.json?.properties?.available_recipe_rules_definition;
      const arrId = arrRef && typeof arrRef === 'object' ? String(arrRef.value ?? '') : '';
      if (!arrId) continue;
      const arrKey = findKeyById(arrId);
      if (!arrKey) continue;
      const arr = definitions.get(arrKey);
      const recipesArr: any = arr?.json?.properties?.production_machine_rules?.value?.recipes;
      if (!recipesArr || recipesArr.type !== 'array' || !Array.isArray(recipesArr.value)) continue;
      addNode(rec.id, 'station', rec.folder);
      for (const e of recipesArr.value) {
        const recipeId = e && typeof e === 'object' ? String(e.value ?? '') : '';
        if (!recipeId) continue;
        // Make sure recipe node exists even if no inputs/outputs (orphan recipe).
        if (!nodeMap.has(recipeId)) {
          const rk = findKeyById(recipeId);
          if (rk) addNode(recipeId, 'recipe', definitions.get(rk)?.folder ?? '');
        }
        edges.push({ from: rec.id, to: recipeId, kind: 'station' });
      }
    }

    return { nodes: [...nodeMap.values()], edges };
  }, [definitions, findKeyById]);

  const visibleNodes = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return nodes.filter((n) => {
      if (n.kind === 'recipe' && !showRecipes) return false;
      if (n.kind === 'station' && !showStations) return false;
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nodes, showRecipes, showStations, filterText]);

  const visibleEdges = useMemo(() => {
    const visible = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => visible.has(e.from) && visible.has(e.to));
  }, [edges, visibleNodes]);

  const layout = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 60, marginx: 12, marginy: 12 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of visibleNodes) {
      g.setNode(n.id, { width: 180, height: 40 });
    }
    for (const e of visibleEdges) {
      g.setEdge(e.from, e.to);
    }
    dagre.layout(g);
    const positions: Record<string, { x: number; y: number }> = {};
    visibleNodes.forEach((n) => {
      const v = g.node(n.id);
      if (v) positions[n.id] = { x: v.x - 90, y: v.y - 20 };
    });
    const graph = g.graph() as { width?: number; height?: number };
    return {
      positions,
      width: graph.width ?? 1200,
      height: graph.height ?? 800,
    };
  }, [visibleNodes, visibleEdges]);

  const onClick = (id: string) => {
    const k = findKeyById(id);
    if (!k) return;
    const rec = definitions.get(k);
    if (!rec) return;
    selectFolder(rec.folder);
    selectDefinition(k);
    setTab('definitions');
  };

  return (
    <div className="tech-tree-layout">
      <div className="tt-toolbar">
        <input
          type="text"
          placeholder="filter nodes…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <label><input type="checkbox" checked={showRecipes} onChange={(e) => setShowRecipes(e.target.checked)} /> recipes</label>
        <label><input type="checkbox" checked={showStations} onChange={(e) => setShowStations(e.target.checked)} /> stations</label>
        <span className="muted small">{visibleNodes.length} nodes · {visibleEdges.length} edges</span>
      </div>
      <div className="tt-canvas-wrap">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="tt-canvas"
        >
          <defs>
            <marker id="tt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 Z" fill="#9aa0a6" />
            </marker>
          </defs>
          {visibleEdges.map((e, i) => {
            const a = layout.positions[e.from];
            const b = layout.positions[e.to];
            if (!a || !b) return null;
            const x1 = a.x + 180;
            const y1 = a.y + 20;
            const x2 = b.x;
            const y2 = b.y + 20;
            const stroke = e.kind === 'station' ? '#a78fff' : e.kind === 'output' ? '#7bc97c' : '#a4c8ff';
            return (
              <line
                key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={stroke} strokeWidth={1.4} opacity={0.8}
                markerEnd="url(#tt-arrow)"
              />
            );
          })}
          {visibleNodes.map((n) => {
            const pos = layout.positions[n.id];
            if (!pos) return null;
            const t = getFolderTheme(n.folder);
            return (
              <g key={n.id} transform={`translate(${pos.x},${pos.y})`}>
                <rect width={180} height={40} rx={6} ry={6} fill="#1c1f26" stroke={t.color} strokeWidth={1.5} />
                <text x={10} y={26} fill="#e3e6ea" fontSize={12} className="tt-label">
                  {t.emoji} {n.label}
                </text>
                <rect width={180} height={40} rx={6} ry={6} fill="transparent" style={{ cursor: 'pointer' }}
                  onClick={() => onClick(n.id)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
