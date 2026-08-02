// "What is this AI doing, and why."
//
// Everything here is read live off the same objects the sim ticks — nothing is recomputed
// for display, so a number shown is the number the machine used on the last update.

import { dist, fmt, vecText } from '../../ai/util';
import { armorReducedDamage } from '../../ai/sim';
import type { Actor, EnemyActor, EntityActor, PlayerActor, World } from '../../ai/sim';
import type { MachineFrame } from '../../ai/types';
import { setAiValue } from './defEdit';
import { NumberField } from './NumberField';

const STATE_CLASS: Record<string, string> = {
  None: 'st-none',
  Glimpsed: 'st-glimpsed',
  Spotted: 'st-spotted',
  Remembered: 'st-remembered',
};

const ARMOUR_TIERS: Record<number, string> = { 1: 'cardboard', 2: 'wood', 3: 'metal', 4: 'concrete' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="insp-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function KV({ rows }: { rows: Array<[string, React.ReactNode, string?]> }) {
  return (
    <div className="kv">
      {rows.map(([k, v, cls], i) => (
        <span key={`${k}-${i}`} style={{ display: 'contents' }}>
          <span className="kv-k">{k}</span>
          <span className={`kv-v ${cls ?? ''}`}>{v ?? '—'}</span>
        </span>
      ))}
    </div>
  );
}

function Bar({ fraction, label, cls = '' }: { fraction: number; label: string; cls?: string }) {
  return (
    <div className="bar">
      <div className={`bar-fill ${cls}`} style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
      <span className="bar-label">{label}</span>
    </div>
  );
}

export function Inspector({
  world,
  selected,
  onJumpToBehavior,
}: {
  world: World;
  selected: Actor | null;
  onJumpToBehavior?: (stateIndex: number) => void;
}) {
  if (!selected) {
    return (
      <div className="insp-empty">
        <p>Select an actor to inspect it.</p>
        <p className="muted">Drag a body to move it. Drag the arrow to rotate. Space pauses.</p>
      </div>
    );
  }
  if (selected.isPlayer) return <PlayerInspector world={world} player={selected as PlayerActor} />;
  if (selected.isEntity) return <EntityInspector world={world} entity={selected as EntityActor} />;
  return <EnemyInspector world={world} enemy={selected as EnemyActor} onJumpToBehavior={onJumpToBehavior} />;
}

function PlayerInspector({ world, player }: { world: World; player: PlayerActor }) {
  return (
    <>
      <h2 className="insp-title">{player.label}</h2>
      <Section title="Pawn">
        <KV
          rows={[
            ['position', `${player.pos.x.toFixed(0)}, ${player.pos.y.toFixed(0)}`],
            ['yaw', `${player.yaw.toFixed(0)}°`],
            ['health', `${player.health.toFixed(0)} / ${player.maxHealth}`],
            ['speed', `${Math.hypot(player.velocity.x, player.velocity.y).toFixed(0)} uu/s`],
            ['motion factor', fmt(player.motionFactor01, 2), 'accent'],
            ['stealthed', player.stealthed ? 'YES (Status.Stealth)' : 'no'],
            ['crouched', player.crouched ? 'yes' : 'no'],
            [
              'grabbed',
              world.time < player.grabbedUntil ? `${(player.grabbedUntil - world.time).toFixed(1)}s` : 'no',
            ],
          ]}
        />
        <p className="muted small">
          Sight gain is multiplied by <code>lerp(motion.still, motion.sprint, motionFactor)</code>, and
          motion factor is <code>speed2D / 600</code>. Standing still is not invisible — it is just the{' '}
          <code>still</code> multiplier.
        </p>
      </Section>
      <Section title="Who sees this player">
        {world.enemies.length === 0 ? (
          <p className="muted">No enemies in the scene.</p>
        ) : (
          world.enemies.map((enemy) => {
            const record = enemy.perception.sightRecords.find((r) => r.actor === player);
            const state = record ? enemy.perception.recordState(record) : 'None';
            const progress = record ? (record.spotted ? 1 : record.strength) : 0;
            return (
              <div className="record" key={enemy.id}>
                <div className="record-head">
                  <span>{enemy.label}</span>
                  <span className={`pill ${STATE_CLASS[state]}`}>{state}</span>
                </div>
                <Bar
                  fraction={progress}
                  label={`${(progress * 100).toFixed(0)}%  ${record?.lastVisibility?.reason ?? 'not sensed'}`}
                />
              </div>
            );
          })
        )}
      </Section>
    </>
  );
}

function EntityInspector({ world, entity }: { world: World; entity: EntityActor }) {
  return (
    <>
      <h2 className="insp-title">{entity.label}</h2>
      {entity.defId && <p className="muted small">{entity.defId}</p>}
      <Section title="Damageable furniture">
        <KV
          rows={[
            ['position', `${entity.pos.x.toFixed(0)}, ${entity.pos.y.toFixed(0)}`],
            ['health', `${entity.health.toFixed(0)} / ${entity.maxHealth}`, entity.dead ? 'warn' : ''],
            ['armour', `${entity.armour} (${ARMOUR_TIERS[entity.armour] ?? 'none'})`],
            ['breakable', entity.breakable ? 'yes' : 'NO — can_break_furniture fails'],
            ['blocks sight', entity.blocksSight ? 'yes' : 'no'],
            ['footprint', `${(entity.halfExtent * 2).toFixed(0)} uu`],
            ['deconstruction tier', entity.deconstructionTier],
            ['state', entity.dead ? 'BROKEN' : 'intact'],
            [
              'last hit',
              entity.lastDamage
                ? `${entity.lastDamage.raw.toFixed(0)} raw → ${entity.lastDamage.final.toFixed(1)} after armour`
                : '—',
            ],
          ]}
        />
      </Section>
      <Section title="Armour curve">
        <p className="muted small">
          <code>CalculateArmorReducedDamage</code> (Valheim): <code>H = D − A</code> when{' '}
          <code>A &lt; D/2</code>, else <code>H = D²/(4A)</code>.
        </p>
        <KV
          rows={[6, 12, 25, 50, 100].map((d) => {
            const through = armorReducedDamage(d, entity.armour);
            return [
              `${d} raw`,
              `${through.toFixed(1)} through · ${Math.ceil(entity.maxHealth / Math.max(through, 0.01))} hits to break`,
            ] as [string, string];
          })}
        />
      </Section>
      <Section title="Nuisance grudge">
        <p className="muted small">
          An entity becomes a nuisance only by <b>damaging</b> an agent (traps, hazards) — breaking
          furniture does not create one.
        </p>
        <KV
          rows={world.enemies.map((enemy) => {
            const record = enemy.perception.damageRecords.find((r) => r.actor === entity);
            return [enemy.label, record ? `${record.strength.toFixed(1)} dmg` : '—'] as [string, string];
          })}
        />
      </Section>
    </>
  );
}

function EnemyInspector({
  world,
  enemy,
  onJumpToBehavior,
}: {
  world: World;
  enemy: EnemyActor;
  onJumpToBehavior?: (stateIndex: number) => void;
}) {
  const perception = enemy.perception;
  const machine = enemy.machine;
  const profile = perception.profile;
  const now = world.time;
  const frame = machine.rootFrame;
  const perceptionId = enemy.enemyDef.properties?.perception as string | undefined;

  const path = frame.activePath.map((i) => frame.compiled.states[i].name);
  const actions: Array<{ depth: number; kind: string; status: string; params: any; memory: any }> = [];
  frame.activePath.forEach((stateIndex, depth) => {
    const state = frame.compiled.states[stateIndex];
    state.actions.forEach((action, slot) => {
      actions.push({
        depth,
        kind: action.kind,
        status: frame.actionStatus[depth]?.[slot] ?? '—',
        params: action.params,
        memory: frame.memory.get(`${depth}:${slot}`),
      });
    });
  });

  const reach = reachMismatch(enemy, world);

  return (
    <>
      <div className="insp-head">
        <h2 className="insp-title">{enemy.label}</h2>
        <span className={`pill ${enemy.paused ? 'st-paused' : 'st-live'}`}>
          {enemy.paused ? 'PAUSED' : 'live'}
        </span>
      </div>
      <p className="muted small">
        {enemy.enemyDef.id} · {enemy.enemyDef.properties?.behavior} · {perceptionId}
        {profile.activeDaySection ? ` · ${profile.activeDaySection}` : ''}
      </p>

      <Section title="Doing now">
        <div className="path">
          {path.map((name, i) => (
            <span key={`${name}-${i}`} style={{ display: 'contents' }}>
              {i > 0 && <span className="path-sep">›</span>}
              <button
                className="path-node"
                title="Show in the Behaviour graph"
                onClick={() => onJumpToBehavior?.(frame.activePath[i])}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
        {actions.map((a, i) => (
          <ActionRow key={i} action={a} world={world} machine={machine} />
        ))}
        <SkillFrames frame={frame} world={world} machine={machine} />
        {machine.holdBlocking && (
          <p className="warn small">
            hold window: wants &quot;{machine.holdBlocking.want}&quot;,{' '}
            {machine.holdBlocking.remaining.toFixed(1)}s left
          </p>
        )}
        {machine.commitBlocking && (
          <p className="warn small">leaf committed — root switch blocked (min_commit_seconds)</p>
        )}
      </Section>

      <Section title="Root selection">
        <p className="muted small">
          first match top-to-bottom wins · re-evaluated every{' '}
          <code>{machine.compiled.rootEvalInterval}s</code> (or immediately on a queued event)
        </p>
        {machine.rootTrace.map((trace) => (
          <div
            key={trace.entryIndex}
            className={`root-row ${trace.selected ? 'root-selected' : trace.pass ? 'root-pass' : 'root-fail'}`}
          >
            <div className="root-head">
              <span className="root-name">{trace.name}</span>
              {trace.alias && <span className="pill tiny">alias</span>}
              {trace.selected && <span className="pill tiny st-live">ACTIVE</span>}
              {trace.cooldown && (
                <span className="pill tiny st-cooldown">
                  fail cooldown {(trace.cooldownRemaining ?? 0).toFixed(1)}s
                </span>
              )}
            </div>
            {trace.conditions.length ? (
              <div className="conds">
                {trace.conditions.map((c, i) => (
                  <span key={i} className={`cond ${c.pass ? 'cond-pass' : 'cond-fail'}`}>
                    {c.label}
                  </span>
                ))}
              </div>
            ) : (
              <span className="muted tiny">no when-list (always matches)</span>
            )}
          </div>
        ))}
      </Section>

      <Section title="Target">
        <KV
          rows={[
            ['target', perception.target?.label ?? 'none', perception.target ? 'accent' : ''],
            ['state', perception.getTargetState()],
            ['acquired via', perception.lastAcquireRule ?? '—'],
            ['distance', perception.target ? `${dist(enemy.pos, perception.target.pos).toFixed(0)} uu` : '—'],
            ['time since seen', perception.target ? `${fmt(perception.timeSinceSeen(now), 1)}s` : '—'],
            ['since bloodshed', perception.target ? `${fmt(perception.secondsSinceBloodshed(now), 1)}s` : '—'],
            [
              'stalemate give-up',
              profile.stalemate.give_up_seconds > 0
                ? `${profile.stalemate.give_up_seconds}s (resume ${profile.stalemate.resume_seconds}s)`
                : 'disabled',
            ],
            ['provoked', perception.isProvoked() ? 'YES' : 'no'],
            [
              'observed now',
              profile.observed.enabled ? (perception.isObservedNow() ? 'YES' : 'no') : 'sense off',
            ],
            ['attack token', world.coordinator.hasToken(enemy) ? 'HELD' : 'none'],
            ['nav policy', machine.navPolicy],
          ]}
        />
        {perception.acquireTrace?.length ? (
          <div className="acquire">
            <p className="muted small">acquisition rules, in order — first rule with a Spotted candidate wins:</p>
            {perception.acquireTrace.map((t, i) => (
              <div className="acquire-row" key={i}>
                <span className="acquire-rule">{t.rule}</span>
                <span className="muted tiny">
                  {t.considered.length
                    ? t.considered.map((c) => `${c.pawn}: ${c.note ?? c.score.toExponential(2)}`).join(', ')
                    : 'no Spotted candidates'}
                </span>
                {t.winner && <span className="pill tiny st-spotted">→ {t.winner}</span>}
              </div>
            ))}
          </div>
        ) : null}
        {perception.giveUpUntil.size > 0 && (
          <p className="warn small">
            gave up on:{' '}
            {[...perception.giveUpUntil]
              .map(([p, t]) => `${p.label} (${(t - now).toFixed(0)}s)`)
              .join(', ')}
          </p>
        )}
      </Section>

      {reach && (
        <Section title="⚠ Reach check">
          <p className="warn small">{reach.headline}</p>
          <KV
            rows={[
              ['skill', reach.skill],
              ['move_to acceptance', `${reach.acceptance.toFixed(0)} uu`],
              ['ability', reach.abilityLabel],
              ['ability max range', `${reach.maxRange} uu`],
              ['actual distance', Number.isNaN(reach.distance) ? '—' : `${reach.distance.toFixed(0)} uu`],
            ]}
          />
          <p className="muted small">
            <code>move_to</code> also accepts <code>acceptance_from_actor</code>, which uses the
            capsule-sum approach envelope instead of a fixed number. No shipped skill uses it — add it
            to the skill JSON and the sandbox will pick it up immediately.
          </p>
        </Section>
      )}

      <Section title="Attack selection">
        <AttackTable enemy={enemy} />
      </Section>

      <Section title="Sight records">
        {perception.sightRecords.length ? (
          perception.sightRecords.map((record, i) => (
            <SightRecordRow key={i} record={record} enemy={enemy} now={now} />
          ))
        ) : (
          <p className="muted">nothing sensed</p>
        )}
      </Section>

      {perception.noiseRecords.length > 0 && (
        <Section title="Hearing">
          {perception.noiseRecords.map((r, i) => (
            <Bar
              key={i}
              fraction={(r.liveStrength ?? r.strength) / Math.max(r.strength, 0.01)}
              cls="bar-noise"
              label={`${(r.liveStrength ?? r.strength).toFixed(2)} @ ${vecText(r.lastKnownLocation)} (${(
                now - r.firstSensedTime
              ).toFixed(1)}s / ${profile.hearing.noise_lifetime}s)`}
            />
          ))}
        </Section>
      )}

      {perception.damageRecords.length > 0 && (
        <Section title="Damage sense">
          <p className="muted small">
            total half-life <code>{profile.damage.total_halflife}s</code> · recent window{' '}
            <code>{profile.damage.recent_window}s</code> · steal needs recent &gt; max(
            <code>{profile.targeting.switch_damage}</code>, 1.5× incumbent)
          </p>
          <KV
            rows={perception.damageRecords.map(
              (r) =>
                [
                  r.actor?.label ?? '(anonymous)',
                  `total ${r.strength.toFixed(1)} · recent ${r.recentDamage.toFixed(1)}${
                    r.avoid ? ' · AVOID' : ''
                  }`,
                ] as [string, string],
            )}
          />
        </Section>
      )}

      <Section title="Context slots ($)">
        <KV
          rows={[
            ['$Perception.Target', perception.target?.label ?? 'null'],
            ['$Perception.TargetLocation', vecText(perception.lastKnownTargetLocation)],
            [
              '$Perception.PointOfInterest',
              `${vecText(perception.pointOfInterest)}  (${perception.poiSource ?? '—'})`,
            ],
            ['$Perception.PatrolAnchor', vecText(perception.patrolAnchor)],
            ['$Perception.Nuisance', perception.getStrongestNuisance()?.label ?? 'null'],
            ['$Attack.Tag', machine.context['Attack.Tag'] ?? 'null'],
            ['$Attack.Melee', machine.context['Attack.Melee'] ?? 'null'],
            ['$Attack.MaxRange', `${fmt(machine.context['Attack.MaxRange'], 0)} (approach envelope)`],
            ['$Path.BlockingEntity', machine.context['Path.BlockingEntity']?.label ?? 'null'],
            ['$World.DaySection', machine.context['World.DaySection'] ?? 'null'],
          ]}
        />
      </Section>

      <Section title="Perception profile">
        <p className="muted small">resolved from: {profile.sourceChain.join(' → ')}</p>
        {perceptionId && <InlineSightEditor perceptionId={perceptionId} profile={profile} />}
        <KV
          rows={[
            [
              'update interval',
              `${perception.activeInterval?.toFixed(2) ?? '—'}s (near ${profile.update_interval.near} / mid ${
                profile.update_interval.mid
              } / far ${profile.update_interval.far})`,
            ],
            ['stealth', `spot ×${profile.sight.stealth.spot_multiplier}, range ×${profile.sight.stealth.range_multiplier}`],
            ['motion', `still ${profile.sight.motion.still} → sprint ${profile.sight.motion.sprint}`],
            [
              'hearing',
              `acuity ${profile.hearing.acuity}, occlusion ×${profile.hearing.occlusion_attenuation}, lifetime ${profile.hearing.noise_lifetime}s`,
            ],
            [
              'observed',
              profile.observed.enabled
                ? `on, ${profile.observed.range}uu, +${profile.observed.fov_margin}° margin`
                : 'off',
            ],
            ['targeting', profile.targeting.target_priority.join(' → ')],
            ['alert allies', `${profile.targeting.alert_allies_radius}uu`],
          ]}
        />
      </Section>

      <Section title="Log">
        <div className="log">
          {[...(perception.lastEvent ? [perception.lastEvent] : []), ...machine.log]
            .sort((a, b) => b.t - a.t)
            .slice(0, 25)
            .map((entry, i) => (
              <div className="log-row" key={i}>
                <span className="log-t">{entry.t.toFixed(1)}s</span>
                <span>{entry.text}</span>
              </div>
            ))}
        </div>
      </Section>
    </>
  );
}

/** The handful of sight numbers worth nudging without leaving the sandbox. */
function InlineSightEditor({ perceptionId, profile }: { perceptionId: string; profile: any }) {
  const fields: Array<[string, (string | number)[], number, number, number]> = [
    ['range', ['sight', 'range'], 0, 8000, 50],
    ['cone angle', ['sight', 'cone_angle'], 0, 360, 5],
    ['time to spot', ['sight', 'time_to_spot'], 0.05, 10, 0.05],
    ['memory', ['sight', 'memory_seconds'], 0, 300, 5],
  ];
  return (
    <div className="inline-edit">
      {fields.map(([label, path, min, max, step]) => (
        <NumberField
          key={label}
          label={label}
          value={path.reduce((o: any, k) => o?.[k], profile)}
          min={min}
          max={max}
          step={step}
          onChange={(v) => setAiValue('perception', perceptionId, path, v)}
        />
      ))}
      <p className="muted tiny">
        Writes a local override onto <code>{perceptionId}</code> — inherited values from the{' '}
        <code>extends</code> chain are never edited in place.
      </p>
    </div>
  );
}

function ActionRow({ action, world, machine }: { action: any; world: World; machine: any }) {
  const params = Object.entries(action.params)
    .filter(([k]) => k !== 'do' && k !== 'params')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  const extra: string[] = [];
  const m = action.memory;
  if (action.kind === 'wait' && m?.until) extra.push(`${Math.max(0, m.until - world.time).toFixed(1)}s left`);
  if (action.kind === 'move_to') {
    if (m?.destination) extra.push(`→ ${vecText(m.destination)}`);
    if (m?.path?.blockedBy) extra.push(`BLOCKED BY ${m.path.blockedBy.label}`);
    if (m?.failReason) extra.push(`FAILED: ${m.failReason}`);
  }
  if (action.kind === 'wander' && m) {
    extra.push(['picking', 'moving', 'pausing'][m.phase ?? 0]);
    if (m.destination) extra.push(`→ ${vecText(m.destination)}`);
  }
  if (action.kind === 'activate_ability' && m?.cast) {
    extra.push(`${Math.max(0, m.cast.endsAt - world.time).toFixed(1)}s of montage`);
  }
  if (action.kind === 'claim_attack_token') {
    extra.push(world.coordinator.hasToken(machine.agent) ? 'token held' : 'queued');
  }
  return (
    <div className={`action action-${String(action.status).toLowerCase()}`}>
      <span className="action-status">{action.status}</span>
      <span className="action-kind">{action.kind}</span>
      <span className="action-params">{params}</span>
      {extra.length > 0 && <span className="action-extra">{extra.join('  ·  ')}</span>}
    </div>
  );
}

function SkillFrames({ frame, world, machine }: { frame: MachineFrame; world: World; machine: any }) {
  const rows: React.ReactNode[] = [];
  const walk = (f: MachineFrame, depth: number) => {
    for (const memory of f.memory.values()) {
      if (!memory?.frame) continue;
      const child: MachineFrame = memory.frame;
      const path = child.activePath.map((i) => child.compiled.states[i].name).join(' › ');
      rows.push(
        <div className="skill-frame" style={{ marginLeft: depth * 12 }} key={`${child.skillId}-${depth}-${rows.length}`}>
          <span className="skill-name">{child.skillId}</span>
          <span className="path-node">{path || '(entering)'}</span>
        </div>,
      );
      child.activePath.forEach((stateIndex, d) => {
        const state = child.compiled.states[stateIndex];
        state.actions.forEach((action, slot) => {
          rows.push(
            <div style={{ marginLeft: (depth + 1) * 12 }} key={`a-${depth}-${d}-${slot}-${rows.length}`}>
              <ActionRow
                action={{
                  kind: action.kind,
                  params: action.params,
                  status: child.actionStatus[d]?.[slot] ?? '—',
                  memory: child.memory.get(`${d}:${slot}`),
                }}
                world={world}
                machine={machine}
              />
            </div>,
          );
        });
      });
      walk(child, depth + 1);
    }
  };
  walk(frame, 0);
  return rows.length ? <div className="skill-frames">{rows}</div> : null;
}

function AttackTable({ enemy }: { enemy: EnemyActor }) {
  const rows = enemy.machine.attackTrace;
  if (!rows.length) return <p className="muted">no target — attack selection idle</p>;
  return (
    <>
      <p className="muted small">
        sorted by highest <b>min</b> range first (standoff specials before the point-blank filler),
        then longest max range, then longest cooldown, then weight
      </p>
      <table className="attacks">
        <thead>
          <tr>
            {['#', 'ability', 'min', 'max', 'cd', 'w', 'verdict'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tag} className={row.eligible ? 'atk-ok' : 'atk-no'}>
              <td>{row.rank ?? '—'}</td>
              <td>
                {row.label}
                {(row.dead || row.notGranted) && <span className="pill tiny st-dead">DEAD</span>}
              </td>
              <td>{row.minRange ? String(row.minRange) : '—'}</td>
              <td>{row.maxRange ? String(row.maxRange) : '∞'}</td>
              <td>{row.cooldown ? `${row.cooldown}s` : '—'}</td>
              <td>{row.weight}</td>
              <td className="verdict">{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows
        .filter((r) => r.deadNote)
        .map((r) => (
          <p className="warn small" key={r.tag}>
            {r.label}: {r.deadNote}
          </p>
        ))}
    </>
  );
}

function SightRecordRow({ record, enemy, now }: { record: any; enemy: EnemyActor; now: number }) {
  const state = enemy.perception.recordState(record);
  const vis = record.lastVisibility ?? {};
  const progress = record.spotted ? 1 : Math.max(0, record.strength);
  const sight = enemy.perception.profile.sight;
  return (
    <div className="record">
      <div className="record-head">
        <span>{record.actor?.label ?? '(anonymous)'}</span>
        <span className={`pill ${STATE_CLASS[state]}`}>{state}</span>
      </div>
      <Bar
        fraction={progress}
        cls={record.spotted ? 'bar-spotted' : ''}
        label={`${(progress * 100).toFixed(0)}%   ${vis.reason ?? ''}`}
      />
      <KV
        rows={[
          ['distance', `${fmt(vis.distance, 0)} uu`],
          [
            'angle off centre',
            `${fmt(vis.angle, 0)}° (cone ${sight.cone_angle / 2}° / periph ${sight.peripheral_cone_angle / 2}°)`,
          ],
          ['entered via', vis.via ?? '—'],
          ['line of sight', vis.coneGain > 0 ? (vis.los ? 'clear' : 'BLOCKED') : 'n/a'],
          ['cone gain', fmt(vis.coneGain, 2)],
          ['distance falloff', fmt(vis.distanceFalloff, 2)],
          ['motion mult', `${fmt(vis.motionMultiplier, 2)} (motion ${fmt(vis.motion01, 2)})`],
          ['stealth mult', fmt(vis.stealthMultiplier, 2)],
          ['fill rate', `${fmt(vis.fill, 3)} / ${sight.time_to_spot}s`],
          ['last seen', record.lastSeenTime < 0 ? 'never' : `${(now - record.lastSeenTime).toFixed(1)}s ago`],
          [
            'memory left',
            record.spotted
              ? `${Math.max(0, sight.memory_seconds - (now - record.lastSensedTime)).toFixed(1)}s`
              : `glimpse drains in ${(record.strength * sight.time_to_forget_glimpse).toFixed(1)}s`,
          ],
          ['last known loc', vecText(record.lastKnownLocation)],
          [
            'ghost track',
            record.spotted && record.lastSeenTime >= 0
              ? now - record.lastSeenTime < sight.ghost_track_seconds
                ? 'following truth'
                : 'frozen'
              : '—',
          ],
        ]}
      />
    </div>
  );
}

/**
 * The stranding check: a skill whose move_to acceptance is WIDER than the reach of the
 * ability it then tries to fire. The approach "succeeds" out of range, the ability refuses,
 * the skill fails, and the root burns its fail_cooldown.
 */
export function reachMismatch(enemy: EnemyActor, world: World) {
  const frames: MachineFrame[] = [];
  const walk = (f: MachineFrame | null) => {
    if (!f) return;
    frames.push(f);
    for (const memory of f.memory.values()) if (memory?.frame) walk(memory.frame);
  };
  walk(enemy.machine.rootFrame);

  for (const frame of frames) {
    if (frame.kind !== 'skill') continue;
    let acceptance: number | null = null;
    let destination: any = null;
    for (const memory of frame.memory.values()) {
      if (memory?.acceptance != null) {
        acceptance = memory.acceptance;
        destination = memory.destination;
      }
    }
    if (acceptance === null) continue;

    const abilityTag = frame.inputs?.Ability
      ? enemy.machine.resolve(frame.parent ?? frame, frame.inputs.Ability)
      : enemy.machine.context['Attack.Tag'];
    const ability = abilityTag ? world.abilities[abilityTag] : null;
    if (!ability?.maxRange || ability.maxRange <= 0) continue;
    if (acceptance <= ability.maxRange) continue;

    return {
      skill: frame.skillId ?? '(skill)',
      acceptance,
      abilityLabel: ability.label,
      maxRange: ability.maxRange,
      distance: destination ? dist(enemy.pos, destination) : NaN,
      headline: `${frame.skillId} approaches to ${acceptance.toFixed(0)}uu but ${ability.label} only reaches ${ability.maxRange}uu — the approach succeeds out of range, the ability refuses, and the skill fails.`,
    };
  }
  return null;
}
