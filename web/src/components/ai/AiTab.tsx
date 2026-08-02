// The AI tab: a live sandbox for the AI2 stack, sitting on the same definitions every
// other tab edits.
//
// Sub-tabs are four views of one running world:
//   Sandbox   — drag pawns and furniture around, watch senses and decisions in real time
//   Scenarios — run the deterministic test suite, then watch any failure in the Sandbox
//   Behaviour — the BHV_ graph, lit up along the active path, click-to-edit
//   Perception — the PRC_ cones as a draggable diagram
//   Attacks   — a whole-project reach audit across every enemy

import { useAppStore, type AiSubTab } from '../../store/appStore';
import { useAiWorld } from './useAiWorld';
import { SandboxView } from './SandboxView';
import { ScenarioView } from './ScenarioView';
import { BehaviorGraphView } from './BehaviorGraphView';
import { PerceptionView } from './PerceptionView';
import { AttackMatrixView } from './AttackMatrixView';

const SUB_TABS: Array<{ id: AiSubTab; label: string; hint: string }> = [
  { id: 'sandbox', label: 'Sandbox', hint: 'Drag actors, watch senses and decisions live' },
  { id: 'scenarios', label: 'Scenarios', hint: 'Run the deterministic AI suite and watch any failure' },
  { id: 'behavior', label: 'Behaviour', hint: 'The BHV_ graph, lit up as it runs' },
  { id: 'perception', label: 'Perception', hint: 'Drag the PRC_ cones to tune them' },
  { id: 'attacks', label: 'Attacks', hint: 'Reach audit across every enemy' },
];

export function AiTab() {
  const sub = useAppStore((s) => s.aiSubTab);
  const setSub = useAppStore((s) => s.setAiSubTab);
  const api = useAiWorld();

  if (!api.enemies.length) {
    return (
      <div className="ai-empty">
        <h2>No AI content in this project</h2>
        <p>
          The sandbox needs at least one <code>enemy_definitions</code> record with
          {' '}<code>ai_stack: "v2"</code> and a <code>behavior</code>, plus the
          {' '}<code>behavior_definitions</code>, <code>perception_definitions</code> and
          {' '}<code>skill_definitions</code> it points at.
        </p>
      </div>
    );
  }

  return (
    <div className="ai-tab">
      <div className="ai-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            className={`subtab ${sub === t.id ? 'active' : ''}`}
            title={t.hint}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
        {api.issues.length > 0 && (
          <span className="ai-issues" title={api.issues.join('\n')}>
            ⚠ {api.issues.length} broken reference{api.issues.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="ai-body">
        {sub === 'sandbox' && <SandboxView api={api} />}
        {sub === 'scenarios' && <ScenarioView api={api} />}
        {sub === 'behavior' && <BehaviorGraphView api={api} />}
        {sub === 'perception' && <PerceptionView api={api} />}
        {sub === 'attacks' && <AttackMatrixView api={api} />}
      </div>
    </div>
  );
}
