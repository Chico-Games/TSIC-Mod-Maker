import { useMemo, useState } from 'react';
import { getFolderTheme } from '../folderTheme';
import type { TechGraph } from './graph';
import type { TechView } from './TechTreeSubTab';

interface Props {
  graph: TechGraph;
  onFocus: (id: string, view?: TechView) => void;
  onOpen: (id: string) => void;
}

interface Finding {
  id: string;
  label: string;
  folder: string;
  detail: string;
}

interface Group {
  key: string;
  title: string;
  blurb: string;
  severity: 'error' | 'warn' | 'info';
  findings: Finding[];
}

/** The things you can only see by walking the whole graph — each row jumps
 *  straight to the definition that needs fixing. */
export function AuditView({ graph, onFocus, onOpen }: Props) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];

    // Recipes that produce nothing at all.
    out.push({
      key: 'no-output',
      title: 'Recipes that produce nothing',
      blurb: 'Empty `output` and no `upgraded_furniture_definition` — the recipe consumes materials and yields nothing.',
      severity: 'error',
      findings: graph.brokenRecipes.map((id) => {
        const r = graph.recipes.get(id)!;
        return {
          id,
          label: r.label,
          folder: r.folder,
          detail: `${r.inputs.length} inputs · L${r.level}`,
        };
      }),
    });

    // Recipes no station offers (upgrades are reached via the build flow, so
    // they're expected to have none).
    out.push({
      key: 'no-station',
      title: 'Recipes on no station',
      blurb: 'Not listed in any station ARR, so the player has no way to reach them. Furniture upgrades are excluded — those come from the build flow.',
      severity: 'error',
      findings: [...graph.recipes.values()]
        .filter((r) => r.kind !== 'upgrade' && r.stations.length === 0)
        .map((r) => ({
          id: r.id,
          label: r.label,
          folder: r.folder,
          detail: `${r.kind} · L${r.level} · → ${r.outputs.map((o) => o.id).join(', ') || '—'}`,
        })),
    });

    // Inputs nothing produces and no station sells — must come from the world.
    out.push({
      key: 'dangling',
      title: 'Referenced but undefined',
      blurb: 'Something references these ids, but no definition folder claims them — usually a typo or a deleted asset.',
      severity: 'error',
      findings: [...graph.nodes.values()]
        .filter((n) => !n.folder)
        .map((n) => ({
          id: n.id,
          label: n.label,
          folder: '',
          detail: `${n.producedBy.length} producers · ${n.consumedBy.length} consumers`,
        })),
    });

    // Things whose every producing recipe needs the thing itself.
    out.push({
      key: 'unreachable',
      title: 'Cannot be reached from raw materials',
      blurb: 'Every recipe that produces this also requires it, directly or through a loop — so a player starting from nothing can never make the first one. Check it drops in the world, or break the cycle.',
      severity: 'error',
      findings: [...graph.nodes.values()]
        .filter((n) => n.isUnreachable)
        .map((n) => ({
          id: n.id,
          label: n.label,
          folder: n.folder,
          detail: `from ${n.producedBy.length} recipe(s) · used by ${n.consumedBy.length}`,
        })),
    });

    // Crafted things nothing ever consumes and which aren't obviously an end
    // product — a soft signal, not a defect.
    out.push({
      key: 'dead-end',
      title: 'Craftable but never used',
      blurb: 'Produced by a recipe, consumed by none. Fine for final gear; suspicious for intermediates.',
      severity: 'warn',
      findings: [...graph.nodes.values()]
        .filter((n) => n.producedBy.length > 0 && n.consumedBy.length === 0)
        .sort((a, b) => b.depth - a.depth)
        .map((n) => ({
          id: n.id,
          label: n.label,
          folder: n.folder,
          detail: `${n.depth} steps · L${n.level} · from ${n.producedBy.length} recipe(s)`,
        })),
    });

    // Deep chains — a pacing signal more than a bug.
    out.push({
      key: 'deep',
      title: 'Deepest chains',
      blurb: `The longest ingredient chains in the pack — ${graph.maxDepth} crafting steps from raw materials at the deepest. This is measured depth, unrelated to the authored recipe \`level\` or a furniture \`upgrade_tier\`; where the two disagree, pacing is being set by ingredients rather than by the level gate.`,
      severity: 'info',
      findings: [...graph.nodes.values()]
        .filter((n) => n.depth >= Math.max(3, graph.maxDepth - 1))
        .sort((a, b) => b.depth - a.depth)
        .map((n) => ({
          id: n.id,
          label: n.label,
          folder: n.folder,
          detail: `${n.depth} steps · L${n.level}`,
        })),
    });

    return out.filter((g) => g.findings.length > 0);
  }, [graph]);

  if (groups.length === 0) {
    return <p className="muted tt-empty">Nothing flagged — the graph is clean.</p>;
  }

  return (
    <div className="tt-audit">
      {groups.map((g) => {
        const isOpen = openGroup === g.key || groups.length === 1;
        return (
          <section key={g.key} className={`tt-audit-group sev-${g.severity}`}>
            <header onClick={() => setOpenGroup(isOpen ? null : g.key)}>
              <span className="tt-audit-twisty">{isOpen ? '▾' : '▸'}</span>
              <span className="tt-audit-title">{g.title}</span>
              <span className="tt-audit-count">{g.findings.length}</span>
            </header>
            {isOpen && (
              <>
                <p className="tt-audit-blurb">{g.blurb}</p>
                <ul>
                  {g.findings.slice(0, 200).map((f) => {
                    const theme = getFolderTheme(f.folder);
                    return (
                      <li key={f.id}>
                        <button
                          className="tt-audit-row"
                          onClick={() => onFocus(f.id, 'graph')}
                          onDoubleClick={() => onOpen(f.id)}
                          title={`${f.id}\n\nclick to trace · double-click to open the definition`}
                        >
                          <span className="tt-audit-name">
                            {theme.emoji} {f.label}
                          </span>
                          <span className="tt-audit-detail muted">{f.detail}</span>
                        </button>
                      </li>
                    );
                  })}
                  {g.findings.length > 200 && (
                    <li className="muted small">…and {g.findings.length - 200} more</li>
                  )}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
