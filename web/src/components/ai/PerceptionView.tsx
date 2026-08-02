// The perception editor: the PRC_ profile drawn as the cones it actually is, with handles
// you drag to retune it.
//
// Two things this makes obvious that a property grid cannot:
//   1. Inheritance — every field says whether it is authored here or coming from the
//      `extends` chain, and editing an inherited value writes a LOCAL override rather than
//      silently retuning every enemy that shares the base.
//   2. Day/night — the night profile is drawn as a ghost behind the day one, so
//      "how much further does it see at night" is a picture, not two numbers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clamp, deg2rad, rad2deg } from '../../ai/util';
import { resolvePerception, daySectionsFor } from '../../ai/pack';
import type { DefJson, ResolvedProfile } from '../../ai/types';
import type { AiWorldApi } from './useAiWorld';
import { setAiValue, isLocallyAuthored } from './defEdit';
import { envelopeAt } from './envelope';
import { NumberField } from './NumberField';

/** Handles the diagram exposes, each bound to one field on the profile. */
type HandleId = 'range' | 'coneAngle' | 'peripheralRange' | 'peripheralAngle' | 'autoDetect';

const HANDLE_PATH: Record<HandleId, (string | number)[]> = {
  range: ['sight', 'range'],
  coneAngle: ['sight', 'cone_angle'],
  peripheralRange: ['sight', 'peripheral_range'],
  peripheralAngle: ['sight', 'peripheral_cone_angle'],
  autoDetect: ['sight', 'auto_detect_radius'],
};

export function PerceptionView({ api }: { api: AiWorldApi }) {
  const { pack, enemies } = api;
  const [enemyId, setEnemyId] = useState(enemies[0]?.id ?? '');

  useEffect(() => {
    if (!enemies.some((e) => e.id === enemyId) && enemies[0]) setEnemyId(enemies[0].id);
  }, [enemies, enemyId]);

  const enemyDef = pack.enemies[enemyId] as DefJson | undefined;
  const perceptionId = enemyDef?.properties?.perception as string | undefined;
  const perceptionDef = perceptionId ? pack.perception[perceptionId] : undefined;

  const dayProfile = useMemo(
    () => (perceptionId ? resolvePerception(pack.perception, perceptionId, null) : null),
    [pack.perception, perceptionId],
  );
  const nightSections = useMemo(
    () => (perceptionId ? daySectionsFor(pack.perception, perceptionId) : []),
    [pack.perception, perceptionId],
  );
  const [compareSection, setCompareSection] = useState<string>('');
  useEffect(() => {
    if (compareSection && !nightSections.includes(compareSection)) setCompareSection('');
  }, [nightSections, compareSection]);

  const compareProfile = useMemo(
    () =>
      perceptionId && compareSection
        ? resolvePerception(pack.perception, perceptionId, compareSection)
        : null,
    [pack.perception, perceptionId, compareSection],
  );

  if (!perceptionId || !perceptionDef || !dayProfile) {
    return <div className="ai-empty">This enemy has no perception definition.</div>;
  }

  const authored = (path: (string | number)[]) => isLocallyAuthored(perceptionDef, path);

  /**
   * Nearest ancestor in the `extends` chain that authors this path — the template whose
   * envelope TYPES a new local override should copy. sourceChain is root-first, so scan
   * backwards to find the most specific one.
   */
  const templateFor = (path: (string | number)[]): string | undefined => {
    for (let i = dayProfile.sourceChain.length - 1; i >= 0; i -= 1) {
      const id = dayProfile.sourceChain[i];
      if (id === perceptionId) continue;
      if (envelopeAt(pack.perception[id], path) !== undefined) return id;
    }
    return undefined;
  };

  const write = (path: (string | number)[], value: number) =>
    setAiValue('perception', perceptionId, path, value, templateFor(path));

  return (
    <div className="ai-perception">
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
          <p className="muted small">resolved from: {dayProfile.sourceChain.join(' → ')}</p>
        </section>

        {nightSections.length > 0 && (
          <section>
            <h4>Compare</h4>
            <select value={compareSection} onChange={(e) => setCompareSection(e.target.value)}>
              <option value="">no overlay</option>
              {nightSections.map((s) => (
                <option key={s} value={s}>
                  {s.split('.').pop()} overlay
                </option>
              ))}
            </select>
            <p className="muted small">
              The overlay is drawn as a dashed ghost — that is the same enemy under its
              <code> day_section_overrides</code>.
            </p>
          </section>
        )}

        <section>
          <h4>Sight</h4>
          <Field label="range" path={['sight', 'range']} value={dayProfile.sight.range} min={0} max={12000} step={50} unit="uu" authored={authored} write={write} />
          <Field label="cone angle" path={['sight', 'cone_angle']} value={dayProfile.sight.cone_angle} min={0} max={360} step={5} unit="°" authored={authored} write={write} />
          <Field label="peripheral range" path={['sight', 'peripheral_range']} value={dayProfile.sight.peripheral_range} min={0} max={12000} step={50} unit="uu" authored={authored} write={write} />
          <Field label="peripheral angle" path={['sight', 'peripheral_cone_angle']} value={dayProfile.sight.peripheral_cone_angle} min={0} max={360} step={5} unit="°" authored={authored} write={write} />
          <Field label="peripheral gain" path={['sight', 'peripheral_gain']} value={dayProfile.sight.peripheral_gain} min={0} max={1} step={0.05} authored={authored} write={write} />
          <Field label="auto-detect radius" path={['sight', 'auto_detect_radius']} value={dayProfile.sight.auto_detect_radius} min={0} max={2000} step={10} unit="uu" authored={authored} write={write} />
        </section>

        <section>
          <h4>Memory</h4>
          <Field label="time to spot" path={['sight', 'time_to_spot']} value={dayProfile.sight.time_to_spot} min={0.05} max={20} step={0.05} unit="s" authored={authored} write={write} />
          <Field label="forget glimpse" path={['sight', 'time_to_forget_glimpse']} value={dayProfile.sight.time_to_forget_glimpse} min={0.05} max={60} step={0.5} unit="s" authored={authored} write={write} />
          <Field label="memory" path={['sight', 'memory_seconds']} value={dayProfile.sight.memory_seconds} min={0} max={600} step={5} unit="s" authored={authored} write={write} />
          <Field label="ghost track" path={['sight', 'ghost_track_seconds']} value={dayProfile.sight.ghost_track_seconds} min={0} max={60} step={0.5} unit="s" authored={authored} write={write} />
        </section>

        <section>
          <h4>Multipliers</h4>
          <Field label="motion · still" path={['sight', 'motion', 'still']} value={dayProfile.sight.motion.still} min={0} max={5} step={0.05} authored={authored} write={write} />
          <Field label="motion · sprint" path={['sight', 'motion', 'sprint']} value={dayProfile.sight.motion.sprint} min={0} max={5} step={0.05} authored={authored} write={write} />
          <Field label="stealth · spot" path={['sight', 'stealth', 'spot_multiplier']} value={dayProfile.sight.stealth.spot_multiplier} min={0} max={2} step={0.05} authored={authored} write={write} />
          <Field label="stealth · range" path={['sight', 'stealth', 'range_multiplier']} value={dayProfile.sight.stealth.range_multiplier} min={0} max={2} step={0.05} authored={authored} write={write} />
        </section>

        <section>
          <h4>Give up</h4>
          <Field label="stalemate give-up" path={['stalemate', 'give_up_seconds']} value={dayProfile.stalemate.give_up_seconds} min={0} max={120} step={1} unit="s" authored={authored} write={write} />
          <Field label="resume block" path={['stalemate', 'resume_seconds']} value={dayProfile.stalemate.resume_seconds} min={0} max={300} step={1} unit="s" authored={authored} write={write} />
          <p className="muted small">
            Give-up ends a chase on a lack of <b>bloodshed</b>, not a lack of stimulus — an agent
            that can see but never reach its target would otherwise chase forever. 0 disables it.
          </p>
        </section>

        <section>
          <h4>Hearing &amp; damage</h4>
          <Field label="acuity" path={['hearing', 'acuity']} value={dayProfile.hearing.acuity} min={0} max={5} step={0.05} authored={authored} write={write} />
          <Field label="occlusion ×" path={['hearing', 'occlusion_attenuation']} value={dayProfile.hearing.occlusion_attenuation} min={0} max={1} step={0.05} authored={authored} write={write} />
          <Field label="noise lifetime" path={['hearing', 'noise_lifetime']} value={dayProfile.hearing.noise_lifetime} min={0.5} max={60} step={0.5} unit="s" authored={authored} write={write} />
          <Field label="damage half-life" path={['damage', 'total_halflife']} value={dayProfile.damage.total_halflife} min={0.1} max={60} step={0.5} unit="s" authored={authored} write={write} />
          <Field label="recent window" path={['damage', 'recent_window']} value={dayProfile.damage.recent_window} min={0.1} max={30} step={0.1} unit="s" authored={authored} write={write} />
          <Field label="switch damage" path={['targeting', 'switch_damage']} value={dayProfile.targeting.switch_damage} min={0} max={500} step={5} authored={authored} write={write} />
        </section>
      </aside>

      <div className="perception-stage">
        <ConeDiagram
          profile={dayProfile}
          ghost={compareProfile}
          onDrag={(handle, value) => write(HANDLE_PATH[handle], value)}
        />
        <div className="perception-notes">
          <h4>How a sighting fills</h4>
          <p className="muted small">
            Inside the cones the gain is not flat: it lerps from <b>1</b> dead-centre down to{' '}
            <code>peripheral_gain</code> at the outer edge of the wide cone. The primary/peripheral
            split gates <b>range</b> only — you see further straight ahead, not more sharply. Then:
          </p>
          <pre className="formula">
{`fill = distanceFalloff × coneGain × stealth × motion
progress += fill × dt / time_to_spot   →  Spotted at 1.0`}
          </pre>
          <p className="muted small">
            Inside <code>auto_detect_radius</code> the cones and stealth are ignored entirely and
            the target is Spotted instantly — but the line-of-sight trace still applies, so it never
            works through a wall.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  path,
  value,
  min,
  max,
  step,
  unit,
  authored,
  write,
}: {
  label: string;
  path: (string | number)[];
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  authored: (p: (string | number)[]) => boolean;
  write: (p: (string | number)[], v: number) => void;
}) {
  const local = authored(path);
  return (
    <NumberField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      inherited={!local}
      title={
        local
          ? 'Authored on this profile.'
          : 'Inherited from the extends chain — editing writes a local override here, leaving the base alone.'
      }
      onChange={(v) => write(path, v)}
    />
  );
}

/** The draggable cone diagram. Agent sits at the centre facing right. */
function ConeDiagram({
  profile,
  ghost,
  onDrag,
}: {
  profile: ResolvedProfile;
  ghost: ResolvedProfile | null;
  onDrag: (handle: HandleId, value: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 700, h: 620 });
  const dragging = useRef<HandleId | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const resize = () => {
      const rect = svg.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const maxRange = Math.max(
    profile.sight.range,
    profile.sight.peripheral_range,
    ghost?.sight.range ?? 0,
    ghost?.sight.peripheral_range ?? 0,
    500,
  );
  const cx = size.w * 0.28;
  const cy = size.h / 2;
  const scale = Math.min((size.w - cx - 40) / maxRange, (size.h / 2 - 30) / maxRange);

  const toPoint = (range: number, angleDeg: number) => ({
    x: cx + Math.cos(deg2rad(angleDeg)) * range * scale,
    y: cy + Math.sin(deg2rad(angleDeg)) * range * scale,
  });

  const wedge = (range: number, fullAngle: number) => {
    const half = Math.min(fullAngle / 2, 180);
    if (half >= 180) {
      return `M ${cx - range * scale} ${cy} a ${range * scale} ${range * scale} 0 1 0 ${
        range * scale * 2
      } 0 a ${range * scale} ${range * scale} 0 1 0 ${-range * scale * 2} 0`;
    }
    const a = toPoint(range, -half);
    const b = toPoint(range, half);
    const largeArc = half > 90 ? 1 : 0;
    return `M ${cx} ${cy} L ${a.x} ${a.y} A ${range * scale} ${range * scale} 0 ${largeArc} 1 ${b.x} ${b.y} Z`;
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const handle = dragging.current;
      if (!handle) return;
      const rect = svgRef.current!.getBoundingClientRect();
      const dx = e.clientX - rect.left - cx;
      const dy = e.clientY - rect.top - cy;
      const rangeUU = Math.hypot(dx, dy) / scale;
      const angle = Math.abs(rad2deg(Math.atan2(dy, dx)));
      if (handle === 'range') onDrag('range', Math.round(clamp(rangeUU, 0, 12000) / 25) * 25);
      else if (handle === 'peripheralRange') onDrag('peripheralRange', Math.round(clamp(rangeUU, 0, 12000) / 25) * 25);
      else if (handle === 'autoDetect') onDrag('autoDetect', Math.round(clamp(rangeUU, 0, 2000) / 5) * 5);
      else if (handle === 'coneAngle') onDrag('coneAngle', Math.round(clamp(angle * 2, 0, 360) / 5) * 5);
      else if (handle === 'peripheralAngle') onDrag('peripheralAngle', Math.round(clamp(angle * 2, 0, 360) / 5) * 5);
    },
    [cx, cy, scale, onDrag],
  );

  const handles: Array<{ id: HandleId; at: { x: number; y: number }; label: string }> = [
    { id: 'range', at: toPoint(profile.sight.range, 0), label: `${profile.sight.range} uu` },
    {
      id: 'coneAngle',
      at: toPoint(profile.sight.range * 0.72, profile.sight.cone_angle / 2),
      label: `${profile.sight.cone_angle}°`,
    },
    {
      id: 'peripheralRange',
      at: toPoint(profile.sight.peripheral_range, 0),
      label: `${profile.sight.peripheral_range} uu`,
    },
    {
      id: 'peripheralAngle',
      at: toPoint(profile.sight.peripheral_range * 0.85, profile.sight.peripheral_cone_angle / 2),
      label: `${profile.sight.peripheral_cone_angle}°`,
    },
    {
      id: 'autoDetect',
      at: toPoint(profile.sight.auto_detect_radius, 45),
      label: `${profile.sight.auto_detect_radius} uu`,
    },
  ];

  return (
    <svg
      ref={svgRef}
      className="cone-svg"
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragging.current = null)}
      onPointerLeave={() => (dragging.current = null)}
    >
      {/* Distance rings, every 1000uu. */}
      {Array.from({ length: Math.ceil(maxRange / 1000) }, (_, i) => (i + 1) * 1000).map((r) => (
        <g key={r}>
          <circle cx={cx} cy={cy} r={r * scale} className="ring" />
          <text x={cx + r * scale + 4} y={cy - 4} className="ring-label">
            {r}
          </text>
        </g>
      ))}

      {ghost && (
        <>
          <path d={wedge(ghost.sight.peripheral_range, ghost.sight.peripheral_cone_angle)} className="ghost-wedge" />
          <path d={wedge(ghost.sight.range, ghost.sight.cone_angle)} className="ghost-wedge" />
        </>
      )}

      <path d={wedge(profile.sight.peripheral_range, profile.sight.peripheral_cone_angle)} className="periph-wedge" />
      <path d={wedge(profile.sight.range, profile.sight.cone_angle)} className="primary-wedge" />
      <circle cx={cx} cy={cy} r={profile.sight.auto_detect_radius * scale} className="auto-detect" />

      {/* Facing. */}
      <line x1={cx} y1={cy} x2={cx + 46} y2={cy} className="facing" />
      <circle cx={cx} cy={cy} r={7} className="agent" />

      {handles.map((h) => (
        <g
          key={h.id}
          className="cone-handle"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            dragging.current = h.id;
          }}
        >
          <circle cx={h.at.x} cy={h.at.y} r={7} />
          <text x={h.at.x + 11} y={h.at.y + 4}>
            {h.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
