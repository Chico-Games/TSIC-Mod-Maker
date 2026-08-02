// The behaviour graph: a BHV_ definition drawn as roots (ordered by priority, top to
// bottom) with each root's nested state machine laid out beside it.
//
// It is LIVE. While the sandbox runs, the active path lights up, when-conditions flash
// pass/fail per root, fail-cooldowns count down on the node, and transitions pulse as they
// fire. Clicking anything opens its JSON for editing.

import { useEffect, useMemo, useRef, useState } from 'react';
import dagre from 'dagre';
import { compileBehavior } from '../../ai/pack';
import type { CompiledBehavior, CompiledState, DefJson } from '../../ai/types';
import type { EnemyActor } from '../../ai/sim';
import type { AiWorldApi } from './useAiWorld';
import { setAiValue, setAiJson } from './defEdit';
import { NumberField } from './NumberField';

const NODE_W = 170;
const NODE_H = 34;

/** Short edge captions — the raw trigger names are too long to sit on an arrow. */
const EDGE_LABEL = (trigger: string, event: string | null) => {
  if (trigger === 'event') return (event ?? 'event').replace(/^AI\.Event\./, '');
  if (trigger === 'actions_succeeded') return 'done';
  if (trigger === 'action_failed') return 'failed';
  return trigger;
};

interface Laid {
  index: number;
  x: number;
  y: number;
  state: CompiledState;
}

interface Edge {
  from: number;
  to: number;
  label: string;
  trigger: string;
}

/** Lay out one root's child states left-to-right with dagre. */
function layoutRoot(compiled: CompiledBehavior, rootIndex: number) {
  const root = compiled.states[rootIndex];
  const nodes: Laid[] = [];
  const edges: Edge[] = [];
  if (!root.children.length) return { nodes, edges, width: 0, height: NODE_H };

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 60, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const child of root.children) {
    g.setNode(String(child), { width: NODE_W, height: NODE_H });
  }
  for (const child of root.children) {
    for (const t of compiled.states[child].transitions) {
      if (t.toIndex < 0) continue;
      g.setEdge(String(child), String(t.toIndex));
      edges.push({
        from: child,
        to: t.toIndex,
        trigger: t.trigger,
        label: EDGE_LABEL(t.trigger, t.event),
      });
    }
  }
  dagre.layout(g);

  for (const child of root.children) {
    const n = g.node(String(child));
    nodes.push({ index: child, x: n.x, y: n.y, state: compiled.states[child] });
  }
  const graph = g.graph();
  return {
    nodes,
    edges,
    width: (graph.width ?? 0) + 16,
    height: Math.max(graph.height ?? 0, NODE_H) + 8,
  };
}

export function BehaviorGraphView({ api }: { api: AiWorldApi }) {
  const { world, pack, enemies } = api;
  const [enemyId, setEnemyId] = useState(enemies[0]?.id ?? '');
  const [selectedState, setSelectedState] = useState<number | null>(null);
  const flashRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enemies.some((e) => e.id === enemyId) && enemies[0]) setEnemyId(enemies[0].id);
  }, [enemies, enemyId]);

  const enemyDef = pack.enemies[enemyId] as DefJson | undefined;
  const behaviorId = enemyDef?.properties?.behavior as string | undefined;
  const behaviorDef = behaviorId ? pack.behaviors[behaviorId] : undefined;

  const compiled = useMemo(
    () => (behaviorDef ? compileBehavior(behaviorDef, pack.skills) : null),
    [behaviorDef, pack.skills],
  );

  // The live agent of this type, if one is in the scene — that's what lights the graph up.
  const agent: EnemyActor | undefined = world.enemies.find((e) => e.enemyDef.id === enemyId);
  const activePath = agent ? agent.machine.rootFrame.activePath : [];
  const activeRoot = activePath[0] ?? -1;
  const activeSet = new Set(activePath);

  // Track transition firings so the edge can pulse.
  useEffect(() => {
    if (!agent) return;
    const last = agent.machine.log[0];
    if (!last) return;
    flashRef.current.set(last.text, world.time);
  }, [api.frame, agent, world.time]);

  const layouts = useMemo(() => {
    if (!compiled) return [];
    // One entry per distinct root state, in priority order (alias entries share a state).
    const seen = new Set<number>();
    return compiled.rootEntries
      .filter((e) => {
        if (seen.has(e.stateIndex)) return false;
        seen.add(e.stateIndex);
        return true;
      })
      .map((entry) => ({ entry, layout: layoutRoot(compiled, entry.stateIndex) }));
  }, [compiled]);

  if (!compiled || !behaviorId) {
    return <div className="ai-empty">This enemy has no behaviour definition.</div>;
  }

  const trace = agent?.machine.rootTrace ?? [];

  return (
    <div className="ai-graph">
      <aside className="ai-left">
        <section>
          <h4>Enemy</h4>
          <select value={enemyId} onChange={(e) => setEnemyId(e.target.value)}>
            {enemies.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.properties?.display_name ?? d.id)}
              </option>
            ))}
          </select>
          <p className="muted small">
            {behaviorId} · {compiled.rootEntries.length} entries ·{' '}
            {compiled.states.length} states
          </p>
          {!agent && (
            <p className="warn small">
              No {String(enemyDef?.properties?.display_name ?? enemyId)} in the scene — spawn one in
              the Sandbox to light the graph up.
            </p>
          )}
        </section>

        <section>
          <h4>Root eval</h4>
          <NumberField
            label="root_eval_interval"
            value={compiled.rootEvalInterval}
            min={0.01}
            max={5}
            step={0.05}
            unit="s"
            title="How often the root when-lists are re-evaluated. Any queued event forces an immediate pass."
            onChange={(v) => setAiValue('behaviors', behaviorId, ['root_eval_interval'], v)}
          />
        </section>

        {compiled.errors.length > 0 && (
          <section>
            <h4>Compile errors</h4>
            {compiled.errors.map((e, i) => (
              <p className="warn small" key={i}>
                {e}
              </p>
            ))}
          </section>
        )}

        <section className="help">
          <h4>Reading it</h4>
          <p className="muted small">
            Roots are listed in priority order — the first whose <b>when</b> list passes wins. A
            green root is currently selected; an amber chip is a <code>fail_cooldown</code> that
            selection is skipping. Inside a root, the boxed states are its nested machine; the lit
            one is where execution is.
          </p>
        </section>
      </aside>

      <div className="graph-scroll">
        {layouts.map(({ entry, layout }) => {
          const isActive = entry.stateIndex === activeRoot;
          const entryTraces = trace.filter((t) => t.name === entry.name);
          const aliasCount = compiled.rootEntries.filter((e) => e.stateIndex === entry.stateIndex).length;
          return (
            <div key={entry.stateIndex} className={`root-block ${isActive ? 'active' : ''}`}>
              <div className="root-block-head">
                <span className="root-order">#{entry.priority}</span>
                <button
                  className="root-title"
                  onClick={() => setSelectedState(entry.stateIndex)}
                >
                  {entry.name}
                </button>
                {aliasCount > 1 && <span className="pill tiny">{aliasCount} entries</span>}
                <span className="pill tiny">{entry.navPolicy}</span>
                {entry.holdSeconds > 0 && <span className="pill tiny">hold {entry.holdSeconds}s</span>}
                <span className="pill tiny">fail cd {entry.failCooldown}s</span>
                {isActive && <span className="pill tiny st-live">ACTIVE</span>}
              </div>

              {/* One when-list row per entry — this is where alias entries become visible. */}
              {compiled.rootEntries
                .filter((e) => e.stateIndex === entry.stateIndex)
                .map((e, idx) => {
                  const t = entryTraces[idx];
                  return (
                    <div className="when-row" key={e.entryIndex}>
                      <span className="when-tag">when{aliasCount > 1 ? ` #${idx + 1}` : ''}</span>
                      {e.when.length === 0 ? (
                        <span className="muted tiny">always matches</span>
                      ) : (
                        e.when.map((c, i) => {
                          const pass = t?.conditions[i]?.pass;
                          return (
                            <span
                              key={i}
                              className={`cond ${pass === undefined ? '' : pass ? 'cond-pass' : 'cond-fail'}`}
                            >
                              {c.negate ? '!' : ''}
                              {c.kind}
                              {Object.entries(c.params)
                                .filter(([k]) => !['if', 'negate', 'invert'].includes(k))
                                .map(([k, v]) => ` ${k}=${v}`)
                                .join('')}
                            </span>
                          );
                        })
                      )}
                      {t?.cooldown && (
                        <span className="pill tiny st-cooldown">
                          cooldown {(t.cooldownRemaining ?? 0).toFixed(1)}s
                        </span>
                      )}
                      {t?.selected && <span className="pill tiny st-live">won</span>}
                    </div>
                  );
                })}

              {/* Root-level actions (roots with no nested states run these directly). */}
              {compiled.states[entry.stateIndex].actions.length > 0 && (
                <div className="root-actions">
                  {compiled.states[entry.stateIndex].actions.map((a, i) => (
                    <span className="act-chip" key={i}>
                      {a.kind}
                      {a.params.skill ? `: ${a.params.skill}` : ''}
                    </span>
                  ))}
                </div>
              )}

              {/* Where execution ACTUALLY is when this root delegates to a skill. Combat is
                  the common case: the root has no nested states of its own, so without this
                  the graph shows an active root and nothing else while SKL_Engage does all
                  the work. */}
              {isActive && agent && <RunningSkills agent={agent} />}

              {layout.nodes.length > 0 && (
                <svg className="root-svg" width={layout.width} height={layout.height}>
                  <defs>
                    <marker
                      id="arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0,0 L0,6 L7,3 z" fill="#3a465a" />
                    </marker>
                  </defs>
                  {layout.edges.map((edge, i) => {
                    const a = layout.nodes.find((n) => n.index === edge.from)!;
                    const b = layout.nodes.find((n) => n.index === edge.to)!;
                    const self = edge.from === edge.to;
                    const lit = activeSet.has(edge.from) && activeSet.has(edge.to);
                    if (self) {
                      return (
                        <path
                          key={i}
                          d={`M ${a.x + NODE_W / 2 - 14} ${a.y - NODE_H / 2} q 22 -18 34 0`}
                          fill="none"
                          stroke={lit ? '#67e08a' : '#3a465a'}
                          strokeWidth={lit ? 2 : 1.2}
                          markerEnd="url(#arrow)"
                        />
                      );
                    }
                    const x1 = a.x + NODE_W / 2;
                    const x2 = b.x - NODE_W / 2;
                    const mid = (x1 + x2) / 2;
                    return (
                      <g key={i}>
                        <path
                          d={`M ${x1} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${x2} ${b.y}`}
                          fill="none"
                          stroke={lit ? '#67e08a' : '#3a465a'}
                          strokeWidth={lit ? 2 : 1.2}
                          markerEnd="url(#arrow)"
                        />
                        {/* Stagger captions: several transitions often connect the same two
                            states (done / failed / an event), and dagre puts them on the
                            same midpoint. */}
                        <text
                          x={mid}
                          y={(a.y + b.y) / 2 - 4 + (i % 3) * 11 - 11}
                          className="edge-label"
                        >
                          {edge.label}
                        </text>
                      </g>
                    );
                  })}
                  {layout.nodes.map((node) => {
                    const live = activeSet.has(node.index);
                    const isSelected = selectedState === node.index;
                    return (
                      <g
                        key={node.index}
                        transform={`translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`}
                        onClick={() => setSelectedState(node.index)}
                        className={`gnode ${live ? 'live' : ''} ${isSelected ? 'sel' : ''}`}
                      >
                        <rect width={NODE_W} height={NODE_H} rx={5} />
                        <text x={9} y={14} className="gnode-name">
                          {node.state.name}
                          {node.state.index === compiled.states[entry.stateIndex].initialChild ? ' ★' : ''}
                        </text>
                        <text x={9} y={26} className="gnode-sub">
                          {node.state.actions.map((a) => a.kind).join(', ') || '—'}
                          {node.state.minCommitSeconds > 0 ? ` · commit ${node.state.minCommitSeconds}s` : ''}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          );
        })}
      </div>

      <aside className="ai-right">
        <StateEditor
          compiled={compiled}
          behaviorId={behaviorId}
          behaviorDef={behaviorDef!}
          stateIndex={selectedState}
          agent={agent}
        />
      </aside>
    </div>
  );
}

/**
 * The skill frames running under the active root, innermost last, each showing its own
 * state chain with the live one lit and its actions' run status.
 */
function RunningSkills({ agent }: { agent: EnemyActor }) {
  const frames: any[] = [];
  const walk = (frame: any) => {
    if (!frame) return;
    for (const memory of frame.memory.values()) {
      if (!memory?.frame) continue;
      frames.push(memory.frame);
      walk(memory.frame);
    }
  };
  walk(agent.machine.rootFrame);
  if (!frames.length) return null;

  return (
    <div className="running-skills">
      {frames.map((frame, depth) => {
        const root = frame.compiled.states[frame.activePath[0]];
        const leaf = frame.activePath[frame.activePath.length - 1];
        const siblings: number[] = root?.children ?? [];
        return (
          <div className="skill-strip" style={{ marginLeft: depth * 14 }} key={`${frame.skillId}-${depth}`}>
            <span className="skill-name">{frame.skillId}</span>
            {siblings.map((index) => {
              const state = frame.compiled.states[index];
              const live = index === leaf;
              const status = live
                ? (frame.actionStatus[frame.activePath.length - 1] ?? []).join(' ')
                : '';
              return (
                <span className={`skill-state ${live ? 'live' : ''}`} key={index} title={status}>
                  {state.name}
                  {live && status && <span className="skill-status">{status.toLowerCase()}</span>}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Editing pane for whatever node is selected. Numbers and simple scalars get real inputs;
 * the whole node is also shown as JSON so anything the form doesn't cover is still editable.
 */
function StateEditor({
  compiled,
  behaviorId,
  behaviorDef,
  stateIndex,
  agent,
}: {
  compiled: CompiledBehavior;
  behaviorId: string;
  behaviorDef: DefJson;
  stateIndex: number | null;
  agent?: EnemyActor;
}) {
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Which root does this state belong to, and where in the JSON does it live?
  const location = useMemo(() => {
    if (stateIndex === null) return null;
    const roots = behaviorDef.properties?.roots ?? [];
    // Root state: its own index among distinct root names.
    const distinct: number[] = [];
    const seen = new Set<number>();
    for (const entry of compiled.rootEntries) {
      if (seen.has(entry.stateIndex)) continue;
      seen.add(entry.stateIndex);
      distinct.push(entry.stateIndex);
    }
    const rootPos = distinct.indexOf(stateIndex);
    if (rootPos >= 0) {
      const name = compiled.states[stateIndex].name;
      const jsonIndex = roots.findIndex((r: any) => r.name === name);
      return { path: ['roots', jsonIndex] as (string | number)[], json: roots[jsonIndex], kind: 'root' as const };
    }
    // Nested state: find its owning root, then its index in that root's `states`.
    for (const rootStateIndex of distinct) {
      const root = compiled.states[rootStateIndex];
      const childPos = root.children.indexOf(stateIndex);
      if (childPos < 0) continue;
      const jsonIndex = roots.findIndex((r: any) => r.name === root.name);
      return {
        path: ['roots', jsonIndex, 'states', childPos] as (string | number)[],
        json: roots[jsonIndex]?.states?.[childPos],
        kind: 'state' as const,
      };
    }
    return null;
  }, [stateIndex, compiled, behaviorDef]);

  useEffect(() => {
    setDraft(location?.json ? JSON.stringify(location.json, null, 2) : '');
    setError(null);
  }, [location]);

  if (stateIndex === null || !location?.json) {
    return (
      <div className="insp-empty">
        <p>Select a root or a state to edit it.</p>
        <p className="muted">
          Edits write straight into <code>{behaviorId}</code> and join the normal unsaved-changes
          pipeline — undo and Save work as usual.
        </p>
      </div>
    );
  }

  const state = compiled.states[stateIndex];
  const live = agent?.machine.rootFrame.activePath.includes(stateIndex);

  const commit = () => {
    try {
      const parsed = JSON.parse(draft);
      setAiJson('behaviors', behaviorId, location.path, parsed);
      setError(null);
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  return (
    <>
      <div className="insp-head">
        <h2 className="insp-title">{state.name}</h2>
        {live && <span className="pill tiny st-live">running</span>}
      </div>
      <p className="muted small">
        {behaviorId} · {location.kind} · properties.{location.path.join('.')}
      </p>

      {location.kind === 'root' && (
        <section className="insp-section">
          <h3>Root tuning</h3>
          <NumberField
            label="hold_seconds"
            value={location.json.hold_seconds ?? 0}
            min={0}
            max={30}
            step={0.5}
            unit="s"
            title="Lower-priority roots wait this out before they can take over. Higher-priority roots preempt immediately."
            onChange={(v) => setAiValue('behaviors', behaviorId, [...location.path, 'hold_seconds'], v)}
          />
          <NumberField
            label="fail_cooldown"
            value={location.json.fail_cooldown ?? 6}
            min={0}
            max={60}
            step={1}
            unit="s"
            title="After this root fails, selection skips it for this long so the next matching root can take over."
            onChange={(v) => setAiValue('behaviors', behaviorId, [...location.path, 'fail_cooldown'], v)}
          />
          <label className="num-field">
            <span className="num-label">nav_policy</span>
            <span className="num-input">
              <select
                value={location.json.nav_policy ?? 'blocking'}
                onChange={(e) =>
                  setAiValue('behaviors', behaviorId, [...location.path, 'nav_policy'], e.target.value)
                }
              >
                <option value="blocking">blocking — furniture stops the path</option>
                <option value="breach">breach — furniture is pathable at a cost</option>
              </select>
            </span>
          </label>
        </section>
      )}

      {location.kind === 'state' && (
        <section className="insp-section">
          <h3>State tuning</h3>
          <NumberField
            label="min_commit_seconds"
            value={location.json.min_commit_seconds ?? 0}
            min={0}
            max={10}
            step={0.1}
            unit="s"
            title="Blocks preemption for this long after entering. Completion transitions still run."
            onChange={(v) =>
              setAiValue('behaviors', behaviorId, [...location.path, 'min_commit_seconds'], v)
            }
          />
        </section>
      )}

      <section className="insp-section">
        <h3>Actions</h3>
        {state.actions.length === 0 ? (
          <p className="muted">none</p>
        ) : (
          state.actions.map((a, i) => (
            <div className="action action-running" key={i}>
              <span className="action-kind">{a.kind}</span>
              <span className="action-params">
                {Object.entries(a.params)
                  .filter(([k]) => k !== 'do')
                  .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
                  .join(' ')}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="insp-section">
        <h3>Transitions</h3>
        {state.transitions.length === 0 ? (
          <p className="muted">none</p>
        ) : (
          state.transitions.map((t, i) => (
            <div className="action action-running" key={i}>
              <span className="action-status">{t.trigger}</span>
              <span className="action-kind">
                {t.event ? t.event.replace(/^AI\.Event\./, '') : ''}
              </span>
              <span className="action-params">
                → {t.result ?? t.toName ?? '(none)'}
                {t.conditions.length ? `  if ${t.conditions.map((c) => c.kind).join(', ')}` : ''}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="insp-section">
        <h3>JSON</h3>
        <textarea
          className="json-edit"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="row">
          <button className="primary" onClick={commit}>
            Apply
          </button>
          <button onClick={() => setDraft(JSON.stringify(location.json, null, 2))}>Revert</button>
        </div>
        {error && <p className="warn small">{error}</p>}
      </section>
    </>
  );
}
