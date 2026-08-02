// Attack reach audit across every enemy in the project.
//
// This is the view that answers "can this enemy actually hit anything", which is not
// obvious from either the loadout JSON or the ability assets on their own. The catch is
// that `SKL_Engage` drives to `$Attack.MaxRange × 0.9`, and `$Attack.MaxRange` is the
// capsule-sum APPROACH ENVELOPE — not the ability's range. An attack whose `maxRange` is
// below that envelope can never activate: the approach reports success out of reach, the
// ability refuses, and the skill fails.

import { useMemo, useState } from 'react';
import { ABILITY_PACK } from '../../ai/abilities';
import { approachEnvelope } from '../../ai/attack';
import type { AbilityData, DefJson } from '../../ai/types';
import type { AiWorldApi } from './useAiWorld';

/** Default capsule radius the sandbox gives every pawn. */
const DEFAULT_RADIUS = 42;

interface Row {
  enemy: DefJson;
  enemyName: string;
  envelope: number;
  allUnknown?: boolean;
  attacks: Array<{
    tag: string;
    weight: number;
    ability: AbilityData | null;
    granted: boolean;
    reachable: boolean;
    /** No entry in the ability table — we can't say anything about its reach. */
    unknown: boolean;
    dead: boolean;
    note: string | null;
  }>;
  anyReachable: boolean;
}

export function AttackMatrixView({ api }: { api: AiWorldApi }) {
  const { enemies } = api;
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [engageScale, setEngageScale] = useState(0.9);

  const rows: Row[] = useMemo(() => {
    const fake = { radius } as any;
    const envelope = approachEnvelope(fake, fake);
    return enemies.map((enemy) => {
      const notGranted = new Set(ABILITY_PACK.grantedByEnemy?.[enemy.id]?.notGranted ?? []);
      const attacks = (enemy.properties?.attacks ?? []).map((entry: any) => {
        const ability = (ABILITY_PACK.abilities[entry.ability] as AbilityData | undefined) ?? null;
        const granted = !notGranted.has(entry.ability);
        const max = ability?.maxRange ?? 0;
        // An attack is reachable when the engage stopping distance is inside its range.
        // maxRange 0 means "no maximum" — unlimited reach, so always reachable.
        const stop = envelope * engageScale;
        const reachable = Boolean(ability) && granted && (max <= 0 || stop <= max);
        return {
          tag: entry.ability,
          weight: entry.weight ?? 1,
          ability,
          granted,
          reachable,
          unknown: !ability,
          dead: Boolean(ability?.deadNote) || !granted,
          note: !ability
            ? 'no range data in src/ai/abilities.ts — add it there to audit this attack'
            : (ability.deadNote ?? (granted ? null : 'ability was never granted')),
        };
      });
      return {
        enemy,
        enemyName: String(enemy.properties?.display_name ?? enemy.id),
        envelope,
        attacks,
        anyReachable: attacks.some((a: Row['attacks'][number]) => a.reachable && !a.dead),
        allUnknown: attacks.length > 0 && attacks.every((a: Row['attacks'][number]) => a.unknown),
      };
    });
  }, [enemies, radius, engageScale]);

  const maxRangeSeen = Math.max(
    400,
    ...rows.flatMap((r) => r.attacks.map((a) => (a.ability?.maxRange ?? 0) || 0)),
  );
  const stop = rows[0]?.envelope * engageScale || 0;
  // Only flag an enemy when we actually have the data to say it can't reach.
  const broken = rows.filter((r) => !r.anyReachable && !r.allUnknown && r.attacks.length > 0);

  const barPct = (uu: number) => `${Math.min(100, (uu / maxRangeSeen) * 100)}%`;

  return (
    <div className="ai-matrix">
      <aside className="ai-left">
        <section>
          <h4>Model</h4>
          <label className="num-field">
            <span className="num-label">capsule radius</span>
            <span className="num-input">
              <input
                type="number"
                value={radius}
                min={10}
                max={200}
                step={1}
                onChange={(e) => setRadius(Number(e.target.value) || DEFAULT_RADIUS)}
              />
              <span className="num-unit">uu</span>
            </span>
          </label>
          <label className="num-field">
            <span className="num-label">acceptance_scale</span>
            <span className="num-input">
              <input
                type="number"
                value={engageScale}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(e) => setEngageScale(Number(e.target.value) || 0.9)}
              />
            </span>
          </label>
          <p className="muted small">
            approach envelope = <code>r + r + 40</code> = <b>{rows[0]?.envelope ?? 0} uu</b>
            <br />
            SKL_Engage stops at <code>envelope × {engageScale}</code> = <b>{stop.toFixed(0)} uu</b>
          </p>
          <p className="muted small">
            The sandbox gives every pawn the same {DEFAULT_RADIUS}uu capsule. Real rigs differ, so
            treat the marginal rows as "check this in PIE", not as proof.
          </p>
        </section>

        <section>
          <h4>Verdict</h4>
          {broken.length === 0 ? (
            <p className="ok small">Every enemy has at least one attack it can reach with.</p>
          ) : (
            <>
              <p className="warn small">
                {broken.length} of {rows.length} enemies cannot land any attack at the engage
                stopping distance:
              </p>
              <ul className="verdict-list">
                {broken.map((r) => (
                  <li key={r.enemy.id}>{r.enemyName}</li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="help">
          <h4>The fix</h4>
          <p className="muted small">
            <code>move_to</code> accepts <code>acceptance_from_actor</code>, which uses the
            capsule-sum envelope directly instead of a fixed number — that is what it exists for.
            No shipped skill uses it. Add it to <code>SKL_Engage</code> /{' '}
            <code>SKL_DestroyEntity</code> and the sandbox picks it up on the next edit.
          </p>
        </section>
      </aside>

      <div className="matrix-scroll">
        <div className="matrix-legend">
          <span>
            <i className="mk-stop" /> engage stopping distance ({stop.toFixed(0)} uu)
          </span>
          <span>
            <i className="mk-ok" /> reachable
          </span>
          <span>
            <i className="mk-no" /> out of reach at that distance
          </span>
          <span>
            <i className="mk-dead" /> dead ability (no hitbox / not granted / no montage)
          </span>
        </div>

        {rows.map((row) => (
          <div className={`matrix-row ${row.anyReachable ? '' : 'broken'}`} key={row.enemy.id}>
            <div className="matrix-head">
              <span className="matrix-name">{row.enemyName}</span>
              <span className="muted tiny">{row.enemy.id}</span>
              {!row.anyReachable && !row.allUnknown && row.attacks.length > 0 && (
              <span className="pill tiny st-dead">CANNOT ATTACK</span>
            )}
            </div>
            {row.attacks.length === 0 && <p className="muted small">no attacks in the loadout</p>}
            {row.attacks.map((a) => {
              const max = a.ability?.maxRange ?? 0;
              const min = a.ability?.minRange ?? 0;
              const cls = a.unknown ? 'unknown' : a.dead ? 'dead' : a.reachable ? 'ok' : 'no';
              return (
                <div className={`atk-row ${cls}`} key={a.tag}>
                  <span className="atk-name" title={a.tag}>
                    {a.ability?.label ?? a.tag}
                  </span>
                  <span className="atk-bar">
                    {min > 0 && (
                      <span className="atk-min" style={{ width: barPct(min) }} title={`min ${min}uu`} />
                    )}
                    <span
                      className="atk-max"
                      style={{ left: min > 0 ? barPct(min) : 0, width: barPct(Math.max(0, (max || maxRangeSeen) - min)) }}
                      title={`${min || 0} – ${max || '∞'} uu`}
                    />
                    <span className="atk-stop" style={{ left: barPct(stop) }} />
                  </span>
                  <span className="atk-range">
                    {a.unknown ? '—' : `${min || 0}–${max || '∞'} uu`}
                  </span>
                  <span className="atk-verdict">
                    {a.unknown
                      ? 'no range data'
                      : a.dead
                        ? 'DEAD'
                        : a.reachable
                          ? 'reachable'
                          : `needs ≤${max}uu, engage stops at ${stop.toFixed(0)}uu`}
                  </span>
                </div>
              );
            })}
            {row.attacks
              .filter((a) => a.note)
              .map((a) => (
                <p className="warn small" key={`${a.tag}-note`}>
                  {a.ability?.label ?? a.tag}: {a.note}
                </p>
              ))}
          </div>
        ))}

        <p className="muted small matrix-foot">
          Ranges come from <code>src/ai/abilities.ts</code>, read out of the live editor from each{' '}
          <code>GA_*</code> CDO. They are not part of the mod project, so a project that renames an
          ability tag will show it as missing here.
        </p>
      </div>
    </div>
  );
}
